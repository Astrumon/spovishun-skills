# Component Architecture for a KMP Screen

Reference implementation only. The normative rules — when a component is required, who owns its
lifetime, why effects stay on the ViewModel — live in
`.claude/rules/kmp/component-architecture.md`. This file does not restate them; it shows the code
that satisfies them.

Adapted from Sergii Nerush, *Компонентна архітектура для Android*
(<https://dou.ua/forums/topic/52382/>) and [`Nerushok/ComArch`](https://github.com/Nerushok/ComArch)
(MIT). Three things differ from upstream — the store key, the coroutine scope, and dependency
injection. Each difference is required to compile in `commonMain` or to satisfy a rule this project
already had; the reasons are inline.

## The five types

Written **once per project** in `commonMain`, next to `MviViewModel`.

```kotlin
interface ComponentStoreOwner {

    val componentStore: ComponentStore

    // Returns what it was given, so a component can be created and bound in one expression —
    // there is no window in which it exists but is not attached to anything.
    fun <C : Component> attachComponent(component: C): C = componentStore.put(component)

    fun detachComponent(component: Component) = componentStore.remove(component.key)

    fun detachComponent(key: String) = componentStore.remove(key)

    fun clearComponents() = componentStore.clear()
}

interface Component : ComponentStoreOwner {

    val coroutineScope: CoroutineScope

    // Upstream derives the key from `this::class.java.canonicalName`. `.java` does not exist in
    // commonMain, and `KClass.qualifiedName` throws on JS and Wasm — so the key is a declared
    // member with a portable default. Override it when one owner holds several components of the
    // same type (one per list row); the default covers the usual one-per-type case.
    val key: String
        get() = this::class.simpleName
            ?: error("Anonymous and local classes cannot be Components — declare `key`")

    fun clear() {
        coroutineScope.cancel()
        clearComponents()
    }
}

class ComponentStore {

    private val map = mutableMapOf<String, Component>()

    fun <C : Component> put(component: C): C {
        // Replacing a key clears what was there. That is what stops a swapped-out region from
        // leaving a live scope behind writing into a screen nobody is looking at.
        map.put(component.key, component)?.clear()
        return component
    }

    operator fun get(key: String): Component? = map[key]

    fun remove(key: String) {
        map.remove(key)?.clear()
    }

    fun clear() {
        for (component in map.values) component.clear()
        map.clear()
    }
}
```

```kotlin
abstract class BaseComponent(
    dispatcher: CoroutineDispatcher,
    exceptionHandler: CoroutineExceptionHandler,
    override val componentStore: ComponentStore = ComponentStore(),
) : Component {

    // Upstream hardcodes `Dispatchers.Main.immediate`. Here both the dispatcher and the handler
    // are injected, exactly as in MviViewModel: the immediate main dispatcher is not available on
    // every target, a test must be able to substitute it, and architecture.md requires every
    // scope to carry a CoroutineExceptionHandler. SupervisorJob isolates a failed region from
    // its siblings — it does not report anything; the handler does.
    final override val coroutineScope: CoroutineScope =
        CoroutineScope(SupervisorJob() + dispatcher + exceptionHandler)

    protected fun launch(block: suspend CoroutineScope.() -> Unit): Job =
        coroutineScope.launch(block = block)
}

abstract class StateComponent<S : Any>(
    initialState: S,
    dispatcher: CoroutineDispatcher,
    exceptionHandler: CoroutineExceptionHandler,
) : BaseComponent(dispatcher, exceptionHandler) {

    private val _state = MutableStateFlow(initialState)
    // Named `state`, not upstream's `stateFlow`, so a component reads the same as a ViewModel
    // at the call site.
    val state: StateFlow<S> = _state.asStateFlow()

    protected val currentState: S get() = _state.value

    protected fun updateState(mutation: (S) -> S) = _state.update(mutation)
}
```

Annotate every **concrete** component `@Stable`. The annotation is not inherited: marking
`StateComponent` alone leaves each subclass Unstable as a composable parameter, and the
component-bound composable stops skipping.

## `MviViewModel` becomes the root owner

The base in `mvi-and-stability.md` stays the canonical definition — do not fork it. It gains one
supertype, one constructor parameter and one override:

```kotlin
abstract class MviViewModel<S : Any, I : Any, E : Any>(
    initialState: S,
    private val dispatcher: CoroutineDispatcher,
    private val exceptionHandler: CoroutineExceptionHandler,
    override val componentStore: ComponentStore = ComponentStore(),
) : ViewModel(), ComponentStoreOwner {

    // … _state / state / _effect / effect / currentState / onIntent / updateState /
    //   emitEffect / launch are unchanged — see mvi-and-stability.md

    override fun onCleared() {
        clearComponents()
        super.onCleared()
    }
}
```

`clearComponents()` runs **before** `super.onCleared()`: after the super call `viewModelScope` is
cancelled, and a component's `clear()` must still be able to run.

## A screen with two independent regions

Author details and reviews load separately and fail separately — two regions, so two components.

```kotlin
// ui/components/ReviewsComponent.kt
@Immutable
data class ReviewsState(val items: SectionState<List<Review>> = SectionState.Loading)

@Stable
class ReviewsComponent(
    private val bookId: BookId,
    private val loadReviews: LoadReviewsUseCase,
    // The owner's effect channel, handed down as a lambda. The component has no channel of its
    // own: the ViewModel stays the only emitter (architecture.md).
    private val emitEffect: (DetailsEffect) -> Unit,
    dispatcher: CoroutineDispatcher,
    exceptionHandler: CoroutineExceptionHandler,
) : StateComponent<ReviewsState>(ReviewsState(), dispatcher, exceptionHandler) {

    init { refresh() }

    fun refresh() {
        launch {
            updateState { it.copy(items = SectionState.Loading) }
            updateState { it.copy(items = load { loadReviews(bookId) }) }
        }
    }

    fun onReviewClick(id: ReviewId) = emitEffect(DetailsEffect.OpenReview(id))
}
```

```kotlin
// ui/DetailsViewModel.kt
typealias AuthorComponentFactory = (BookId, (DetailsEffect) -> Unit) -> AuthorComponent
typealias ReviewsComponentFactory = (BookId, (DetailsEffect) -> Unit) -> ReviewsComponent

class DetailsViewModel(
    bookId: BookId,
    authorComponent: AuthorComponentFactory,
    reviewsComponent: ReviewsComponentFactory,
    dispatcher: CoroutineDispatcher,
    exceptionHandler: CoroutineExceptionHandler,
) : MviViewModel<DetailsUiState, DetailsIntent, DetailsEffect>(
    DetailsUiState(), dispatcher, exceptionHandler,
) {
    // `::emitEffect` is protected and resolved here, inside the class — the channel never leaves.
    val author = attachComponent(authorComponent(bookId, ::emitEffect))
    val reviews = attachComponent(reviewsComponent(bookId, ::emitEffect))

    override fun onIntent(intent: DetailsIntent) = when (intent) {
        DetailsIntent.Retry -> {
            author.refresh()
            reviews.refresh()
        }
    }
}
```

`DetailsUiState` still exists and still holds what the ViewModel itself owns — the toolbar title,
the share button's enabled state. A region's state is never copied into it; that would give the
region two writers.

### Swapping a region at runtime

When a region is *replaced* rather than refreshed, the reference has to live somewhere observable,
which means a `@Stable` UiState rather than an `@Immutable` one — the field changes after
construction. Detach before attaching: `put` clears the displaced component, but only if the new one
carries the same key.

```kotlin
private fun onPurchased() {
    detachComponent(currentState.paywall)
    updateState { it.copy(paywall = attachComponent(unlockedPaywall(::emitEffect))) }
}
```

## Koin wiring

The article uses Hilt `@AssistedFactory`. The Koin equivalent is a **factory function type** bound
in the module and injected into the owner's constructor — construction stays constructor injection
and nothing reaches into the container at runtime.

```kotlin
// di/DetailsModule.kt
val detailsModule = module {
    factory<ReviewsComponentFactory> {
        { bookId, emit -> ReviewsComponent(bookId, get(), emit, get(), get()) }
    }
    factory<AuthorComponentFactory> {
        { bookId, emit -> AuthorComponent(bookId, get(), emit, get(), get()) }
    }
    viewModel { (bookId: BookId) -> DetailsViewModel(bookId, get(), get(), get(), get()) }
}
```

- A `typealias` is erased: Koin keys on the underlying function type. Two factories are
  distinguishable here only because their **return types** differ. Two factories returning the same
  type need a `named()` qualifier, not two aliases.
- `factory`, never `single` — a component bound as a singleton outlives the screen and carries stale
  state back on re-entry.
- Components are not ViewModels: no `viewModelOf`, no `koinViewModel()`, no `koinInject()` inside a
  component or a component-bound composable.
- Runtime arguments given to the ViewModel through `parametersOf` must be declared for
  verification, or a correct graph fails the check:

```kotlin
@Test
fun `details graph resolves`() {
    detailsModule.verify(extraTypes = listOf(BookId::class))
}
```

## Rendering a component

```kotlin
// ui/components/ReviewsUi.kt
@Composable
internal fun ReviewsUi(component: ReviewsComponent, modifier: Modifier = Modifier) {
    val state by component.state.collectAsStateWithLifecycle()
    ReviewsView(                              // stateless, lives in ui/viewcomponents/
        items = state.items,
        onReviewClick = component::onReviewClick,
        modifier = modifier,
    )
}
```

The Route still resolves exactly one thing from DI and passes the components down explicitly — a
composable never takes the ViewModel:

```kotlin
@Composable
fun DetailsRoute(bookId: BookId, onOpenReview: (ReviewId) -> Unit) {
    val viewModel = koinViewModel<DetailsViewModel> { parametersOf(bookId) }
    val state by viewModel.state.collectAsStateWithLifecycle()

    DetailsEffects(viewModel.effect, onOpenReview)
    DetailsScreen(
        state = state,
        author = viewModel.author,
        reviews = viewModel.reviews,
        onIntent = viewModel::onIntent,
    )
}
```

## Previewing a whole screen

`@Preview` of a screen made of components needs an instance of each, which is the cost the article
names. Pay it only for screens you actually preview whole: extract the component's public surface as
an interface and let the preview supply a fake with no dispatcher and no graph.

```kotlin
@Stable
interface ReviewsComponent {
    val state: StateFlow<ReviewsState>
    fun onReviewClick(id: ReviewId)
}

// the real one: class DefaultReviewsComponent(…) : StateComponent<ReviewsState>(…), ReviewsComponent

@Preview
@Composable
private fun DetailsScreenPreview() = AppTheme {
    DetailsScreen(
        state = DetailsUiState(title = "Dune"),
        author = FakeAuthorComponent,
        reviews = object : ReviewsComponent {
            override val state = MutableStateFlow(ReviewsState(SectionState.Content(previewReviews)))
            override fun onReviewClick(id: ReviewId) = Unit
        },
        onIntent = {},
    )
}
```

Previews of the individual views in `viewcomponents/` stay trivial and need none of this.

## Testing a component

A component is plain Kotlin: no ViewModel, no Compose, no `SavedStateHandle`, no Robolectric. This
is the payoff that justifies the manual lifetime.

```kotlin
@Test
fun `a failed load becomes a typed error state`() = runTest {
    val component = ReviewsComponent(
        bookId = BookId("b-1"),
        loadReviews = LoadReviewsUseCase(FailingReviewRepository()),
        emitEffect = {},
        dispatcher = StandardTestDispatcher(testScheduler),
        exceptionHandler = CoroutineExceptionHandler { _, _ -> },
    )

    advanceUntilIdle()

    assertIs<SectionState.Error>(component.state.value.items)
    component.clear()   // cancels the scope; a leaked scope fails runTest
}
```

`runTest` fails on a scope left running, which is what turns a forgotten `clear()` — the one failure
mode the compiler cannot catch — into a test failure.
