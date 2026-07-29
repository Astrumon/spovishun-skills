# Compose State Management

The state traps and boundaries — not the basics of `mutableStateOf`, `remember`, hoisting or
`derivedStateOf`. Read this when writing or debugging state, not during discovery.

## The unified keying rule

`remember`, `LaunchedEffect`, `DisposableEffect`, `produceState`, and the `remember { }` wrapping a
`derivedStateOf` all obey one rule:

> Any changing value the body reads must either be in the key list, be a constant, be a call-site-owned
> stable object, or be read through `rememberUpdatedState`.

Three legitimate carve-outs:

1. **Constants** — `MAX_RETRY`, `Color.Red`.
2. **Call-site-owned stable objects the call site never replaces** — `rememberCoroutineScope()`,
   `remember { Animatable(0f) }`. A key would be redundant.
3. **Initial-only capture is the point** — `val firstSeenAt = remember { Clock.System.now() }`. Mark it
   `// initial-only` so the missing key does not read as a bug to the next person.

When an effect must keep **running** across a change but call the **latest** callback, wrap the
callback in `rememberUpdatedState(value)` and read it inside the effect. Adding it to the key list
would restart the effect; this tracks the latest value without restarting.

## Do not `rememberSaveable` a runtime object

`rememberSaveable` serializes *data*. Runtime references — `LazyListState`, `FocusRequester`,
`CoroutineScope`, callbacks — cannot survive process death. Persist the data and rebuild the object:

```kotlin
// WRONG — a runtime object with no meaningful serialization
val listState = rememberSaveable { LazyListState() }

// RIGHT — save the index, recreate the state from it
var savedIndex by rememberSaveable { mutableIntStateOf(0) }
val listState = rememberLazyListState(initialFirstVisibleItemIndex = savedIndex)
LaunchedEffect(listState) {
    snapshotFlow { listState.firstVisibleItemIndex }.collect { savedIndex = it }
}
```

On Compose Multiplatform `rememberSaveable` cannot lean on `Bundle`/`@Parcelize` — supply a
kotlinx-serialization-based `Saver` for anything that is not a primitive.

## A UI value that drives business logic belongs in the state holder

The hoisting question is not "is this UI state?" but **"does the repository or the navigation graph
depend on this value?"** A search query is the canonical case:

```kotlin
// WRONG — the query is UI-local, so every keystroke hits the repository.
// Nothing can debounce, restore or test it.
var query by remember { mutableStateOf("") }
LaunchedEffect(query) { viewModel.search(query) }

// RIGHT — the query lives in the state holder, which owns debouncing and the repository call
class SearchViewModel(repository: SearchRepository, dispatcher: CoroutineDispatcher) : ViewModel() {
    private val _query = MutableStateFlow("")

    val results = _query
        .debounce(300)
        .flatMapLatest { repository.search(it) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun onQueryChange(value: String) { _query.value = value }
}
```

## `derivedStateOf` and the surrounding `remember`

`derivedStateOf` tracks the **`State<T>` reads inside its lambda**. Plain values the lambda captures
are captured **once**, when the surrounding `remember { }` runs. If such a value changes later and is
not in the `remember` key list, the derived state keeps using the original forever — silently.

```kotlin
// WRONG — `threshold` captured at first composition; later changes are invisible
val isPast by remember { derivedStateOf { listState.firstVisibleItemIndex > threshold } }

// RIGHT — key the surrounding remember on the captured value
val isPast by remember(threshold) { derivedStateOf { listState.firstVisibleItemIndex > threshold } }
```

The block must read at least one Compose `State` to ever re-evaluate. `derivedStateOf { a + b }` over
two plain values pays the overhead and gains nothing — use `remember { a + b }`.

`SnapshotStateList` and `SnapshotStateMap` recompose on **structural** change only:
`items[0].name = "x"` does not recompose; `items[0] = items[0].copy(name = "x")` does.

## Cross-phase back-writing

**Back-writing** is writing observable state in a phase that invalidates an *earlier* phase. Nothing
flags it. The symptom is jittery scrolling, ghost layouts, or recomposition looping between two
states.

**Composition → composition.** Rebuilding a `mutableStateMapOf`/`mutableStateListOf` inside a
composable body writes observable state *during* composition, invalidating the scope that is running:

```kotlin
// WRONG — composition rebuilds the map → invalidates composition → rebuilds the map…
val grouped = remember { mutableStateMapOf<String, List<Item>>() }
grouped.clear()
grouped.putAll(items.groupBy { it.category })

// RIGHT — derive, do not rebuild
val grouped = remember(items) { items.groupBy { it.category } }
```

`mutableStateMapOf` / `mutableStateListOf` are for state that **mutates in response to events**, not
for caches. A cache is `remember(key) { compute() }`.

**Layout → composition.** `onSizeChanged` fires *after* layout. Writing a `MutableState` there that
composition reads invalidates composition with the new size, which lays out again, which fires again:

```kotlin
// WRONG — feedback loop
var widthPx by remember { mutableIntStateOf(0) }
Box(Modifier.fillMaxWidth().onSizeChanged { widthPx = it.width }) {
    Text(title, Modifier.padding(start = (widthPx / 4).dp))    // composition read
}

// RIGHT — defer the read to the layout phase
Box(Modifier.fillMaxWidth().onSizeChanged { widthPx = it.width }) {
    Text(
        title,
        Modifier.layout { measurable, constraints ->
            val placeable = measurable.measure(constraints)
            layout(placeable.width, placeable.height) { placeable.place(widthPx / 4, 0) }
        },
    )
}
```

**Draw → composition** is the same shape and vanishingly rare.

General rule: state writes go forward — composition → layout → draw — never backward. When a backward
write is genuinely the right shape (a sticky header that needs its own measured height), the cure is a
layout-phase API, not a `MutableState` bridging back into composition.

## `@ReadOnlyComposable` is a two-way contract

Mark a `@Composable` getter `@ReadOnlyComposable` only when it is a pure reader: no `Box`/`Text`
emission, no `remember`, no effects. It then takes a faster runtime path.

**Remove it the moment the function emits UI or calls `remember`** — including inside a content
lambda. A `@ReadOnlyComposable` that emits corrupts the slot table, and the crash surfaces deeper in
the tree, far from the call site.

```kotlin
val AppTheme.spacing: Spacing
    @Composable @ReadOnlyComposable get() = LocalSpacing.current
```

## Anti-patterns worth naming

**Animation suspend from `viewModelScope`.** `animateScrollToItem` and `Animatable.animateTo` need a
composition-scoped coroutine. `viewModelScope` outlives the composition, so the animation runs against
state whose UI no longer exists — stale writes, a leaked frame-clock subscription, and animation that
stops working after a configuration change. The state holder emits an *intent*; the composition
decides how to render it.

```kotlin
// WRONG
viewModelScope.launch { listState.animateScrollToItem(0) }

// RIGHT
LaunchedEffect(Unit) {
    viewModel.effect.collect {
        if (it is ScrollToTop) scope.launch { listState.animateScrollToItem(0) }
    }
}
```

**`var` without `remember` resets — positionally, not lexically.** Every `Row { }`, `Column { }`,
`Box { }` and `items { }` body is its own composable block. A plain `var count = 0` declared there
re-runs on every recomposition. If the enclosing code is `@Composable`, a plain `var` resets.

**Mutating a list held by `mutableStateOf`** bypasses the `.value` setter, so nothing recomposes. Use
`mutableStateListOf`, or replace the reference.

## Durable state over ephemeral events

Before reaching for `Channel`/`SharedFlow`, ask: *would losing this signal desynchronize what the user
believes happened from what actually happened?* If yes, model it as a field on `UiState` that the UI
clears after consuming it. A buffered `Channel`'s queue dies with the process; `SharedFlow(replay = 0)`
drops with no collector; a `UiState` field survives both.

```kotlin
data class CheckoutUiState(val isPaying: Boolean = false, val pendingResult: PaymentResult? = null)

fun pay() = viewModelScope.launch {
    _state.update { it.copy(isPaying = true) }
    val result = paymentApi.charge()
    _state.update { it.copy(isPaying = false, pendingResult = result) }
}

fun resultAcknowledged() = _state.update { it.copy(pendingResult = null) }
```

Reserve ephemeral effects for genuinely fire-and-forget commands where dropping is acceptable — a
transient snackbar, a haptic tick, scroll-to-top after a refresh. The effect contract itself is
normative: see `.claude/rules/kmp/architecture.md`.

## Do not build `Flow` pipelines in a composable body

`stateIn`, `shareIn`, `combine` and `flatMapLatest` belong in the state holder's scope. A pipeline
built in composition is rebuilt on every recomposition, lives in the wrong layer, and is torn down on
disposal without surviving a configuration change. `stateIn(rememberCoroutineScope(), …)` inside a
composable is always a sign the pipeline is in the wrong place.
