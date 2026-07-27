# MVI Base Class and Compose Stability Configuration

Reference implementation only. The normative rules — what an Intent/UiState/Effect is, what belongs
in state vs. an effect, how errors are modelled — live in `.claude/rules/kmp/architecture.md`.
This file does not restate them; it shows the code that satisfies them.

## `MviViewModel<S, I, E>`

Written **once per project** in `commonMain`, not once per screen.

```kotlin
abstract class MviViewModel<S : Any, I : Any, E : Any>(
    initialState: S,
    private val dispatcher: CoroutineDispatcher,
    private val exceptionHandler: CoroutineExceptionHandler,
) : ViewModel() {

    private val _state = MutableStateFlow(initialState)
    val state: StateFlow<S> = _state.asStateFlow()

    // BUFFERED, not SharedFlow: an effect emitted while the screen is off-composition
    // must survive until a collector returns, and must be consumed exactly once.
    private val _effect = Channel<E>(Channel.BUFFERED)
    val effect: Flow<E> = _effect.receiveAsFlow()

    protected val currentState: S get() = _state.value

    abstract fun onIntent(intent: I)

    protected fun updateState(mutation: (S) -> S) = _state.update(mutation)

    protected fun emitEffect(effect: E) {
        launch { _effect.send(effect) }
    }

    // The dispatcher is a constructor parameter so a test can pass a test dispatcher
    // instead of mutating global state.
    protected fun launch(block: suspend CoroutineScope.() -> Unit): Job =
        viewModelScope.launch(dispatcher + exceptionHandler, block = block)
}
```

`ViewModel` here is `androidx.lifecycle.ViewModel` — the multiplatform artifact. That is what gives
`viewModelScope` cancellation on `onCleared`, destination-scoped lifetime through `koinViewModel()`,
and access to `SavedStateHandle`.

## One screen against that base

```kotlin
sealed interface ProfileIntent {
    data object Refresh : ProfileIntent
    data class NameChanged(val value: String) : ProfileIntent
}

@Immutable
data class ProfileUiState(
    val name: String = "",
    val profile: SectionState<Profile> = SectionState.Loading,
)

sealed interface ProfileEffect {
    data object NavigateBack : ProfileEffect
    data class ShowMessage(val text: StringResource) : ProfileEffect
}

class ProfileViewModel(
    private val loadProfile: LoadProfileUseCase,
    dispatcher: CoroutineDispatcher,
    exceptionHandler: CoroutineExceptionHandler,
) : MviViewModel<ProfileUiState, ProfileIntent, ProfileEffect>(
    ProfileUiState(), dispatcher, exceptionHandler,
) {
    override fun onIntent(intent: ProfileIntent) = when (intent) {
        ProfileIntent.Refresh -> refresh()
        is ProfileIntent.NameChanged -> updateState { it.copy(name = intent.value) }
    }
}
```

## Turning an expected failure into a typed state

`CancellationException` must be re-thrown before any other catch — swallowing it breaks structured
concurrency and leaves a cancelled coroutine looking like a handled error.

```kotlin
private suspend fun <T> load(fetch: suspend () -> T): SectionState<T> = try {
    SectionState.Content(fetch())
} catch (e: CancellationException) {
    throw e
} catch (e: ApiException) {
    SectionState.Error(e.toDomainError())
}
```

## Compose stability configuration

```kotlin
// build.gradle.kts
composeCompiler {
    // Plural + add(): the singular `stabilityConfigurationFile` is deprecated since Kotlin 2.4
    // and is removed in 2.5.
    stabilityConfigurationFiles.add(rootProject.layout.projectDirectory.file("stability.txt"))
    // Both destinations are needed; set them to their own directories, not to build/reports.
    reportsDestination = layout.buildDirectory.dir("compose-reports")
    metricsDestination = layout.buildDirectory.dir("compose-metrics")
}
```

```
# stability.txt — types you do not own, or that come from a module
# without the Compose compiler. Wildcards are supported.
com.example.core.model.*
com.example.feature.*.domain.model.*
```

## Reading the compiler reports

The compiler writes `*-composables.txt` under the configured directory only when the module is
actually recompiled — pass `--rerun-tasks` if it is up to date. Exact filenames vary by Kotlin and
Compose version, so look inside the directory rather than assuming a path.

```bash
./gradlew :feature:profile:compileKotlinAndroid --rerun-tasks
ls feature/profile/build/compose-reports/
```

A screen-level composable should read `restartable skippable`. If it reads `restartable` alone, one
of its parameters is Unstable — find it in the same report, then either mark the type `@Immutable`
or add it to `stability.txt`.
