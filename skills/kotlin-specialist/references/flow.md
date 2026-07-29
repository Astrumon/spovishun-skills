# Flow — Kotlin Coroutines

The traps, not the catalogue. Cold `flow { }`, `map`/`filter`, `combine` and `conflate` behave as
documented; what follows is what goes wrong in real code.

## Cold, hot, and which to expose

- **Cold `flow { }`** — each collector runs its own execution, nothing shared. On-demand data.
- **`StateFlow`** — always has a current value; a new collector gets the latest immediately.
  Conflated by design: fast successive values may be skipped, and **an equal value is not re-emitted**.
- **`SharedFlow`** — no current value, broadcast to whoever is listening at the time.

Expose `Flow`, `StateFlow` or `SharedFlow` from a public API — never the `Mutable*` type.

```kotlin
private val _state = MutableStateFlow<UiState>(UiState.Loading)
val state: StateFlow<UiState> = _state.asStateFlow()

_state.update { it.copy(isLoading = false) }   // atomic; prefer over .value = on a read-modify-write
```

Use `update { }` rather than reading `.value` and assigning it back: the read-modify-write pair is not
atomic and silently loses concurrent updates.

## One-shot events: `Channel`, not `SharedFlow`

This is the trap that produces "the navigation sometimes doesn't happen" — intermittently, usually on
a slow device.

| Shape | What happens with no active collector | Late collector |
|---|---|---|
| `MutableSharedFlow(replay = 0)` | the event is **dropped silently** | receives nothing |
| `MutableSharedFlow(replay = 1)` | retained | **re-delivered** — the action fires twice |
| `Channel(Channel.BUFFERED)` | **buffered** until someone collects | receives it once |

For a one-shot outcome — navigate, show a snackbar — use a `Channel` and expose it as a flow:

```kotlin
private val _effect = Channel<Effect>(Channel.BUFFERED)
val effect: Flow<Effect> = _effect.receiveAsFlow()
```

`receiveAsFlow` gives single-consumer semantics: each event is delivered exactly once, to exactly one
collector. `SharedFlow` with `replay = 1` is the worst of both — it re-fires the event for every new
collector, which is how a screen navigates twice after a configuration change.

If losing the signal would desynchronize what the user believes happened from what did, it is not an
event at all — it is state.

## `callbackFlow` and `awaitClose`

Wrapping a callback API requires `awaitClose`, and it is not optional: without it, `callbackFlow`
throws at runtime. Its job is to unregister the listener when the collector goes away.

```kotlin
fun connectionUpdates(client: Client): Flow<Status> = callbackFlow {
    val listener = object : Client.Listener {
        override fun onStatus(status: Status) { trySend(status) }
    }
    client.addListener(listener)

    awaitClose { client.removeListener(listener) }   // runs on cancellation — this is the leak fix
}
```

- Use `trySend` from a non-suspending callback; `send` suspends and callbacks usually cannot.
- `trySend` fails silently when the buffer is full — pass an explicit buffer or `.buffer(…)` when
  drops matter, and decide deliberately rather than by default.
- Anything registered inside `callbackFlow` must be unregistered inside `awaitClose`, including
  timers and platform observers.

## `.catch` only sees upstream

`.catch` is positional: it catches exceptions from operators **above** it, never from the collector
below. A failure in `collect { }` is not caught by a `.catch` placed before it.

```kotlin
flow.map { transform(it) }
    .catch { e -> emit(fallback) }        // catches transform, NOT the collector
    .collect { render(it) }               // a throw here propagates to the caller
```

And `.catch` **re-throws `CancellationException` by design** — do not "fix" that. A `.catch` that
swallows everything, including cancellation, breaks structured concurrency: the collector keeps
running after its scope was cancelled.

Catch what you can name:

```kotlin
.catch { e -> if (e is IOException) emit(cached) else throw e }
```

## Retry with a guard

`retry` without a predicate retries forever, including on failures that will never succeed — a 401, a
parse error, a bad request. Bound the attempts and the cause:

```kotlin
flow
    .retryWhen { cause, attempt -> cause is IOException && attempt < 3 }
    .catch { emit(fallback) }
```

`retry` re-runs the **upstream flow from the start**, so anything above it with a side effect runs
again. Put `retry` directly above the operator whose failure is retryable, not at the end of a long
chain.

## `flowOn` changes upstream context only

```kotlin
val processed = rawFlow
    .map { heavyTransform(it) }
    .flowOn(dispatcher)        // only what is ABOVE it moves; collect stays in the caller's context
```

The dispatcher is injected, not hardcoded — `Dispatchers.IO` does not exist on native or wasm
targets.

## `stateIn` and `shareIn` need a scope you own

Both convert a cold flow into a hot one, which means starting a coroutine — so the scope's lifetime
becomes the flow's lifetime.

```kotlin
val results = query
    .flatMapLatest { repository.search(it) }
    .stateIn(scope, SharingStarted.WhileSubscribed(5_000), emptyList())
```

`WhileSubscribed(5_000)` stops the upstream 5 s after the last collector leaves — long enough to
survive a configuration change, short enough not to run forever. `SharingStarted.Eagerly` keeps it
running for the scope's whole life, which is rarely what is wanted.

## `flatMapLatest` vs `flatMapMerge` vs `flatMapConcat`

- **`flatMapLatest`** — cancel the previous inner flow when a new value arrives. Correct for search,
  filters, and anything where only the newest result matters.
- **`flatMapConcat`** — run them in order, one after another. Correct when order matters.
- **`flatMapMerge`** — run concurrently, results interleaved. Correct only when order does not matter
  and concurrency is wanted; bound it with `concurrency =`.

Using `flatMapMerge` where `flatMapLatest` belongs is how a stale response overwrites a fresh one.

## Testing

```kotlin
@Test
fun should_emitSuccess_when_loadCompletes() = runTest(dispatcher) {
    service.state.test {
        assertEquals(UiState.Loading, awaitItem())
        service.load()
        assertEquals(UiState.Success(user), awaitItem())
        cancelAndConsumeRemainingEvents()
    }
}
```

Turbine is JVM-only. In a multiplatform `commonTest`, collect into a list inside `backgroundScope`, or
assert on `state.value` after advancing the scheduler — see the KMP testing rule.

## Rules

- Expose the read-only type; keep the mutable one private.
- `StateFlow` for state, `Channel` + `receiveAsFlow` for one-shot events, cold `flow { }` for
  on-demand data. `SharedFlow` only for genuine multi-subscriber broadcast where dropping is fine.
- Every `.catch` names what it catches and re-throws the rest.
- Every `callbackFlow` unregisters in `awaitClose`.
- Every `retry` has an attempt bound and a cause predicate.
- A dangling collector is a leak — the scope that starts a collection must be cancelled.
