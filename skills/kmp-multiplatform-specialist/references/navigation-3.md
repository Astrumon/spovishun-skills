# Navigation 3 Wiring for KMP

Reference implementation only. The normative rules — who owns navigation state, where a key lives,
who may trigger a transition — live in `.claude/rules/kmp/navigation.md`. This file does not restate
them; it shows the code that satisfies them.

Navigation 3 is pre-1.0 on the androidx side and names have moved between alphas
(`EntryProviderBuilder` → `EntryProviderScope`, `SavedStateNavEntryDecorator` →
`SaveableStateHolderNavEntryDecorator`). Check the imports below against the version in the
project's version catalog before copying.

## Dependencies

Compose Multiplatform projects take the JetBrains artifacts; the runtime is multiplatform, the UI
artifact ships for Android and the CMP targets.

```toml
# gradle/libs.versions.toml
[versions]
nav3 = "1.1.1"                 # org.jetbrains.androidx.navigation3
lifecycle = "2.10.0"           # org.jetbrains.androidx.lifecycle

[libraries]
navigation3-ui = { module = "org.jetbrains.androidx.navigation3:navigation3-ui", version.ref = "nav3" }
lifecycle-viewmodel-navigation3 = { module = "org.jetbrains.androidx.lifecycle:lifecycle-viewmodel-navigation3", version.ref = "lifecycle" }
```

`navigation3-common` / `navigation3-runtime` arrive transitively. An Android-only project uses the
`androidx.navigation3:*` coordinates instead.

## Keys, in `feature/<name>/api`

```kotlin
// feature/logs/api
@Serializable
@Keep
data object LogsKey : NavKey

@Serializable
@Keep
data class LogDetailKey(val id: String) : NavKey

// Registered by the feature, merged by composeApp. Reflection-based restoration is Android-only;
// iOS, desktop and web need this or the back stack does not survive process death.
val logsSerializers = SerializersModule {
    polymorphic(NavKey::class) {
        subclass(LogsKey::class, LogsKey.serializer())
        subclass(LogDetailKey::class, LogDetailKey.serializer())
    }
}
```

```kotlin
// composeApp
private val navConfig = SavedStateConfiguration {
    serializersModule = logsSerializers + dashboardSerializers + settingsSerializers
}

val backStack = rememberNavBackStack(navConfig, DashboardKey)
```

## The navigator

One owner of the back stack, injected. It is bound in DI at a lifetime that outlives recomposition
— `single` in a Koin app module, or an activity-retained scope on Android. Binding it per-resolution
is the bug this whole design exists to prevent.

```kotlin
class Navigator(startKey: NavKey) {
    val backStack: SnapshotStateList<NavKey> = mutableStateListOf(startKey)

    fun goTo(key: NavKey) { backStack.add(key) }
    fun goBack() { backStack.removeLastOrNull() }
}
```

## Feature entry builders

Each feature declares one extension in its `impl` module. Nothing here is visible to `composeApp`
beyond the function name.

```kotlin
// feature/logs/impl
typealias EntryProviderInstaller = EntryProviderScope<NavKey>.() -> Unit

fun EntryProviderScope<NavKey>.logsEntries(navigator: Navigator) {
    entry<LogsKey> {
        LogsRoute(onOpenDetail = { id -> navigator.goTo(LogDetailKey(id)) })
    }
    entry<LogDetailKey> { key ->
        LogDetailRoute(id = key.id)
    }
}
```

With Koin, the feature contributes the installer to the graph instead and `composeApp` never names
it. `koin-compose-navigation3` also offers a `navigation<T> { }` DSL, but its entry provider is
typed as `Any` (InsertKoinIO/koin#2336), which breaks a typed `SceneStrategy` — prefer the plain
extension below until that is fixed.

```kotlin
// feature/logs/impl — di/LogsModule.kt
val logsModule = module {
    viewModelOf(::LogsViewModel)
    // The qualifier is required: two unqualified `single<EntryProviderInstaller>` definitions have
    // the same type and the second one is a duplicate-definition error, not a second entry.
    single<EntryProviderInstaller>(named("logs")) { { logsEntries(get()) } }
}
```

`composeApp` collects them by type — `getAll` matches every definition of the type regardless of
its qualifier, which is what turns the per-feature singles into one set:

```kotlin
val installers: List<EntryProviderInstaller> = getKoin().getAll()
```

## The display

Called once, above the window-size-class branch. Only the chrome branches.

```kotlin
// composeApp
@Composable
fun AppShell(widthSizeClass: WindowWidthSizeClass) {
    val navigator = koinInject<Navigator>()
    val installers = remember { getKoin().getAll<EntryProviderInstaller>() }

    // Derived, not stored: there is no selectedDestination field anywhere.
    val selected = navigator.backStack.lastOrNull { it in topLevelKeys } ?: DashboardKey

    val display = @Composable { modifier: Modifier ->
        NavDisplay(
            backStack = navigator.backStack,
            modifier = modifier,
            onBack = { navigator.goBack() },
            // Both are required. Without the ViewModel-store decorator every entry resolves the
            // same ViewModel from the host scope, and none is cleared when its entry pops.
            entryDecorators = listOf(
                rememberSaveableStateHolderNavEntryDecorator(),
                rememberViewModelStoreNavEntryDecorator(),
            ),
            entryProvider = entryProvider {
                installers.forEach { install -> install() }
            },
        )
    }

    if (widthSizeClass == WindowWidthSizeClass.Expanded) {
        Row(Modifier.fillMaxSize()) {
            AppNavigationRail(selected = selected, onSelect = navigator::goTo)
            Scaffold(Modifier.weight(1f)) { padding -> display(Modifier.padding(padding)) }
        }
    } else {
        Scaffold(
            bottomBar = { AppNavigationBar(selected = selected, onSelect = navigator::goTo) },
        ) { padding -> display(Modifier.padding(padding)) }
    }
}
```

`selected` is read from the back stack on every recomposition. There is no state holder to fall out
of sync, no effect pushing a selection onto the back stack, and no effect pushing it back.

## Per-tab back stacks

When each top-level destination must keep its own history, the owner holds one stack per tab and
flattens them into the list the display renders — still one owner, still derived.

```kotlin
class TopLevelBackStack(startKey: NavKey) {
    private val stacks = linkedMapOf(startKey to mutableStateListOf(startKey))

    var topLevelKey by mutableStateOf(startKey)
        private set

    val backStack = mutableStateListOf(startKey)

    private fun refresh() = backStack.apply {
        clear()
        addAll(stacks.flatMap { it.value })
    }

    fun switchTo(key: NavKey) {
        stacks.getOrPut(key) { mutableStateListOf(key) }
        topLevelKey = key
        refresh()
    }

    fun add(key: NavKey) { stacks[topLevelKey]?.add(key); refresh() }
    fun removeLast() { stacks[topLevelKey]?.removeLastOrNull(); refresh() }
}
```

`topLevelKey` is a `private set` field of the same object that owns the stacks — one owner, not a
mirror in a different class.

## Navigating from a result

The ViewModel never touches the navigator. It emits an `Effect`; the Route collects it with the
lifecycle-aware collector from `.claude/rules/kmp/feature-structure.md` and calls the lambda its
entry supplied.

```kotlin
entry<LoginKey> {
    LoginRoute(onLoggedIn = {
        navigator.backStack.clear()
        navigator.goTo(DashboardKey)
    })
}
```

## Legacy: the same shape on Navigation 2

A project on `navigation-compose` 2.x keeps the ownership rules and changes only the wiring.

```kotlin
// feature/logs/impl
fun NavGraphBuilder.logsGraph(onOpenDetail: (String) -> Unit) {
    composable<LogsRoute> { LogsRoute(onOpenDetail = onOpenDetail) }
    composable<LogDetailRoute> { entry -> LogDetailRoute(id = entry.toRoute<LogDetailRoute>().id) }
}
```

```kotlin
// composeApp — selection derived, not mirrored
val current by navController.currentBackStackEntryAsState()
val selected = topLevelDestinations.firstOrNull { d ->
    current?.destination?.hasRoute(d::class) == true
} ?: DashboardRoute
```

There is no `LaunchedEffect` writing a stored selection onto the controller, because there is no
stored selection.
