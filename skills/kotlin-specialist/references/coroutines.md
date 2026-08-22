# Coroutines & Structured Concurrency — Kotlin

The traps, not the catalogue: what actually goes wrong, not what the docs already say.

## Prefer a `suspend fun`; the caller owns the scope

The default shape for anything that does work is a `suspend fun` that returns a value. It composes,
it is cancelled by whoever called it, and it needs no scope of its own:

```kotlin
class UserRepository(private val api: UserApi, private val dispatcher: CoroutineDispatcher) {
    suspend fun load(id: String): User = withContext(dispatcher) { api.fetch(id).toDomain() }
}
```

A class needs an injected `CoroutineScope` only when it genuinely outlives its callers — a background
service, a long-lived poller. Taking a scope to `launch` work the caller already awaits makes
cancellation someone else's problem, and the class hard to test.

```kotlin
// A scope is injected, never constructed inside a feature class
single<CoroutineScope> {
    CoroutineScope(SupervisorJob() + Dispatchers.Default + get<CoroutineExceptionHandler>())
}
```

- A scope context carries all three: dispatcher + job + `CoroutineExceptionHandler`. Drop any one and
  the scope is broken — most dangerously the handler, whose absence is silent.
- `SupervisorJob` isolates a failing child from its siblings. It does **not** catch, log, or surface
  anything.
- `CoroutineScope(Job())` — one child's failure cancels every sibling. Use only when intended.
- Never `GlobalScope`: no structured lifetime, no cancellation, guaranteed leak.
- Never start a coroutine in a scope wider than the component owning the work.

## The dispatcher is a parameter

```kotlin
class Repository(private val dispatcher: CoroutineDispatcher) {
    suspend fun load() = withContext(dispatcher) { … }
}
```

Hardcoding a dispatcher makes a class untestable (no test dispatcher can be substituted) and
unportable (`Dispatchers.IO` does not exist on native or wasm). Inject it, bind it per platform.

## `CancellationException` is control flow, not an error

Cancellation is delivered by throwing `CancellationException` inside the coroutine. Catching it and
carrying on tells the runtime the coroutine is still alive when it is not — the work keeps running and
structured concurrency stops holding.

```kotlin
// WRONG — swallows cancellation along with everything else
try { load() } catch (e: Exception) { showError() }

// RIGHT — let cancellation through
try { load() }
catch (e: CancellationException) { throw e }
catch (e: IOException) { showError() }
```

`runCatching` has the same defect: it catches `Throwable`, cancellation included. Inside a coroutine,
either re-throw explicitly or catch the specific types you can name.

Cancellation is also **cooperative** — a tight computational loop is never interrupted on its own; see
`references/cancellation-timeouts.md`.

## `coroutineScope` vs `supervisorScope`

```kotlin
// All-or-nothing: either failure cancels the other and propagates
suspend fun fetchBoth(): Pair<A, B> = coroutineScope {
    val a = async { fetchA() }
    val b = async { fetchB() }
    a.await() to b.await()
}

// Partial results acceptable: one failure does not cancel the other.
// Isolate with a typed try/catch, never runCatching — runCatching turns a
// *cancelled* fetch into a Result.failure and lets the sibling run on.
suspend fun fetchBothIsolated(): Pair<A?, B?> = supervisorScope {
    val a = async { orNull { fetchA() } }
    val b = async { orNull { fetchB() } }
    a.await() to b.await()
}

private suspend fun <T> orNull(block: suspend () -> T): T? =
    try { block() }
    catch (e: CancellationException) { throw e }
    catch (e: IOException) { logger.warn("fetch failed", e); null }
```

The trap with `async` is *where* the failure surfaces — at **`await()`**, not where it happened:

- An `async` never awaited inside a `supervisorScope` swallows its failure entirely.
- Under a plain `coroutineScope` the child failure cancels the parent **before `await()` is reached**,
  so a `try/catch` around `await()` may never run. Catching there means something only under
  `supervisorScope`.

## Exception handling

```kotlin
// WRONG — no handler. An uncaught throw reaches the platform's last-resort handler and
// disappears: no crash, no log, a feature that silently stopped working.
val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

// RIGHT — the handler logs AND reports, so the failure is visible
val handler = CoroutineExceptionHandler { _, throwable ->
    if (throwable is CancellationException) throw throwable
    logger.error("Unhandled coroutine error", throwable)
    observability.report(throwable)
}

val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default + handler)
```

- The handler goes on the **scope**, not inside a `launch { }` — one passed to `launch` under a
  non-supervisor job is ignored.
- A handler that only logs still leaves production failures invisible. It must reach an observability
  sink.
- Inject the handler as its own dependency with a typed qualifier and compose it into the scope.

## `withContext` does not add concurrency

`withContext` switches thread and **suspends until the block completes**. Two sequential
`withContext` calls run sequentially. For concurrency use `async` inside a `coroutineScope`.

It is also not free: switching for a few microseconds of work costs more than the work. Switch around
genuinely blocking operations, never once per loop iteration — for that case and for capping fan-out
see `references/concurrency-limits.md`.

## Rules

- Prefer `suspend fun` returning a value; inject a scope only for work that outlives the caller.
- Inject the dispatcher; never hardcode one inside a class.
- Always re-throw `CancellationException`; never `runCatching` around suspending work. Cancellation is
  cooperative — check `ensureActive()` in long loops.
- Every scope carries dispatcher + job + handler, and the handler logs *and* reports.
- Never `GlobalScope`; never an `async` that is not awaited.
