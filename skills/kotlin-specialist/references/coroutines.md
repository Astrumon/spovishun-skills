# Coroutines & Structured Concurrency — Kotlin

The traps, not the catalogue. `launch`, `async`/`await` and `withContext` behave as documented; what
follows is what actually goes wrong.

## Prefer a `suspend fun`; the caller owns the scope

The default shape for anything that does work is a `suspend fun` that returns a value. It composes,
it is cancelled by whoever called it, and it needs no scope of its own:

```kotlin
class UserRepository(private val api: UserApi, private val dispatcher: CoroutineDispatcher) {
    suspend fun load(id: String): User = withContext(dispatcher) { api.fetch(id).toDomain() }
}
```

A class only needs an injected `CoroutineScope` when it genuinely outlives its callers — a background
service, a long-lived poller. A class that takes a scope purely to `launch` work its caller is already
waiting for has made cancellation someone else's problem and made itself hard to test.

```kotlin
// A scope is injected, never constructed inside a feature class
single<CoroutineScope> {
    CoroutineScope(SupervisorJob() + Dispatchers.Default + get<CoroutineExceptionHandler>())
}
```

- A scope context carries all three: dispatcher + job + `CoroutineExceptionHandler`. Drop any one and
  the scope is broken — most dangerously the handler, whose absence is invisible.
- `SupervisorJob` isolates a failing child from its siblings. It does **not** catch, log, or surface
  anything.
- `CoroutineScope(Job())` — one child's failure cancels every sibling. Use only when that is intended.
- Never `GlobalScope`: no structured lifetime, no cancellation, guaranteed leak.
- Never start a coroutine in a scope wider than the component that owns the work.

## The dispatcher is a parameter

```kotlin
class Repository(private val dispatcher: CoroutineDispatcher) {
    suspend fun load() = withContext(dispatcher) { … }
}
```

Hardcoding a dispatcher inside a class makes it untestable — a test cannot substitute a test
dispatcher — and unportable: `Dispatchers.IO` does not exist on native or wasm targets. Inject it and
bind it per platform.

## `CancellationException` is control flow, not an error

Cancellation is delivered by throwing `CancellationException` inside the coroutine. Catching it and
carrying on tells the runtime the coroutine is still alive when it has been cancelled — the work keeps
running, and structured concurrency stops holding.

```kotlin
// WRONG — swallows cancellation along with everything else
try { load() } catch (e: Exception) { showError() }

// RIGHT — let cancellation through
try {
    load()
} catch (e: CancellationException) {
    throw e
} catch (e: IOException) {
    showError()
}
```

`runCatching` has the same defect: it catches `Throwable`, cancellation included. Inside a coroutine,
either re-throw explicitly or catch the specific types you can name.

Cancellation is also **cooperative**: a tight computational loop is never interrupted on its own. Call
`ensureActive()` or a suspending function periodically, or the coroutine keeps burning CPU after its
scope is gone.

## `coroutineScope` vs `supervisorScope`

```kotlin
// All-or-nothing: either failure cancels the other and propagates
suspend fun fetchBoth(): Pair<A, B> = coroutineScope {
    val a = async { fetchA() }
    val b = async { fetchB() }
    a.await() to b.await()
}

// Partial results acceptable: one failure does not cancel the other
suspend fun fetchBothIsolated(): Pair<Result<A>, Result<B>> = supervisorScope {
    val a = async { runCatching { fetchA() } }
    val b = async { runCatching { fetchB() } }
    a.await() to b.await()
}
```

The trap with `async`: an exception is thrown at **`await()`**, not where it happened. An `async`
whose result is never awaited inside a `supervisorScope` swallows its failure entirely. Never launch
an `async` you do not await.

## Exception handling

```kotlin
// WRONG — no handler. An uncaught throw reaches the platform's last-resort handler and
// disappears: no crash, no log, and a feature that silently stopped working.
val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

// RIGHT — the handler logs AND reports, so the failure is visible
val handler = CoroutineExceptionHandler { _, throwable ->
    if (throwable is CancellationException) throw throwable
    logger.error("Unhandled coroutine error", throwable)
    observability.report(throwable)
}

val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default + handler)
```

- The handler goes on the **scope**, not inside individual `launch { }` blocks — a handler passed to
  `launch` under a non-supervisor job is ignored.
- A handler that only logs still leaves production failures invisible. It must reach an observability
  sink.
- Inject the handler as its own dependency with a typed qualifier and compose it into the scope.

## `withContext` does not add concurrency

`withContext` switches thread and **suspends until the block completes**. Two sequential
`withContext` calls run sequentially. For concurrency use `async` inside a `coroutineScope`.

It is also not free: switching for a few microseconds of work costs more than the work. Switch around
genuinely blocking or genuinely expensive operations, not around every function.

## Rules

- Prefer `suspend fun` returning a value; inject a scope only for work that outlives the caller.
- Inject the dispatcher; never hardcode one inside a class.
- Always re-throw `CancellationException`; never `runCatching` around suspending work.
- Every scope carries dispatcher + job + handler, and the handler logs *and* reports.
- Never `GlobalScope`; never an `async` that is not awaited.
- Cancellation is cooperative — check `ensureActive()` in long computational loops.
