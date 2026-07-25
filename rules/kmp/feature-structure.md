# KMP Feature Structure Rules

How a Compose Multiplatform project is cut into modules and packages. Layer semantics live in
`architecture.md`; this file is about where files go.

## Module layout

```
composeApp/              # thin shell: nav graph assembly + DI aggregation + platform entry points
core/
  designsystem/          # theme, reusable components, shared strings
  network/               # HTTP client factory, platform engines
  <other>/               # added on the second consumer, never in anticipation
feature/
  <name>/
    api/                 # ONLY the route type + navigateTo extension
    impl/                # screens, ViewModels, domain, data, DI
```

- `composeApp` depends on every `feature/*/impl`. A feature depends on another feature's `api` only —
  never on its `impl`. That is the whole point of the split.
- `feature/<name>/api` stays tiny: a `@Serializable` route and its navigation extension. No Compose,
  no ViewModel, no repository. If something else is about to land there, it belongs in `impl`.
- `core/*` never depends on `feature/*`. The arrow only goes one way.
- Two features must not depend on each other's `impl`. Shared logic moves down into `core/`.

## Package layout inside `feature/<name>/impl`

```
<pkg>/feature/<name>/
  ui/
    <Name>Screen.kt        # <Name>Route (DI + state collection) + <Name>Screen (stateless)
    <Name>ViewModel.kt
    <Name>UiState.kt       # UiState + its sealed status/error types
    <Name>Intent.kt
    <Name>Effect.kt
    <Name>Format.kt        # optional: internal non-composable formatting helpers
    viewcomponents/        # ONE composable per file
      <ViewA>.kt
      <ViewB>.kt
  domain/
    model/<Model>.kt
    repository/<Name>Repository.kt   # interface
    usecase/<Verb><Noun>UseCase.kt   # only when escalation applies (see architecture.md)
  data/
    <Name>RepositoryImpl.kt
    remote/<Name>Api.kt
    remote/dto/<Name>Dto.kt
  di/<Name>Module.kt
```

- The three MVI contract types are **three files at the root of `ui/`**. There is no `data/`
  sub-package inside `ui/` — `data` is a layer name and reusing it one level down is ambiguous.
- Domain models live in `domain/model/`, never beside the UiState.
- `viewcomponents/` is a folder and each view is its own file. Never a single `<Name>Components.kt`.
- View-specific formatting stays `private` in the view file. Promote to an `internal` root-level
  helper only when a second view of the same screen needs it, and split those helpers by concern
  (parsing and display formatting are separate files) rather than into one grab-bag.

## Screen composition

- `<Name>Route` is the only place that touches DI: it resolves the ViewModel with `koinViewModel()`,
  collects state, collects effects, and forwards intents.
- `<Name>Screen` is stateless — it `when`-dispatches state to a view in `viewcomponents/` and emits
  lambdas upward. No layout logic beyond the dispatch.
- Views are `internal`, stateless and hoisted: value in, events out. No DI, no ViewModel, no theme
  wrapper inside.
- `@Preview`s live next to the view they preview.

```kotlin
@Composable
fun LogsRoute(onOpenSettings: () -> Unit) {
    val viewModel = koinViewModel<LogsViewModel>()
    val state by viewModel.state.collectAsStateWithLifecycle()

    LogsEffects(viewModel.effect, onOpenSettings)
    LogsScreen(state = state, onIntent = viewModel::onIntent)
}
```

## Collecting effects

The effect channel is consumed in the Route with a lifecycle-aware collector, so an effect emitted
while the screen is backgrounded is delivered when it returns — not fired into a dead composition.

```kotlin
@Composable
private fun LogsEffects(effects: Flow<LogsEffect>, onOpenSettings: () -> Unit) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(effects, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            effects.collect { effect ->
                when (effect) {
                    LogsEffect.OpenSettings -> onOpenSettings()
                    is LogsEffect.ShowMessage -> /* snackbar */ Unit
                }
            }
        }
    }
}
```

Requires `lifecycle-runtime-compose` in `commonMain`. On Desktop, `Lifecycle.coroutineScope` is
bound to `Dispatchers.Main.immediate` — add `kotlinx-coroutines-swing` or the collector never runs.

## Compose side effects — which one, and the key

- `LaunchedEffect(key)` — suspending work tied to the composition. Restarts when `key` changes.
- `DisposableEffect(key)` — callback-based setup that needs teardown in `onDispose`.
- `SideEffect` — publishes composed state to non-Compose code; runs after **every** recomposition.
- The key decides lifetime. A constant key means "live as long as this composition"; a state key
  means "restart whenever that state changes". Passing a value that changes every frame restarts the
  effect every frame — the most common cause of a runaway effect.

## Do / Don't

- DO put a new screen in a new `feature/<name>/{api,impl}` pair; use `/new-feature` to scaffold it.
- DO keep `composeApp` free of feature logic — it wires, it does not implement.
- DON'T let `feature/<a>/impl` import `feature/<b>/impl`.
- DON'T put more than one public or internal composable view in a `viewcomponents/` file.
- DON'T reach for a `domain/` or `logic/` sub-folder under `ui/` — root-level helpers stay flat.

## Related rules

`architecture.md` · `navigation.md` · `uikit.md` · `localization.md` · `testing.md`
