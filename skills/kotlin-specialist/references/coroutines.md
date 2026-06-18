# Coroutines & Structured Concurrency — Kotlin

## Scope ownership

```kotlin
// Inject the scope — never create one inside a class
class BotService(private val scope: CoroutineScope) {
    fun start() = scope.launch { processUpdates() }
}

// Module wiring (Koin)
single<CoroutineScope> {
    CoroutineScope(SupervisorJob() + Dispatchers.Default + get<CoroutineExceptionHandler>())
}
```

- The scope context MUST carry all three elements: Dispatcher + Job + `CoroutineExceptionHandler`. Drop any one and the scope is broken — most dangerously, a missing handler silently swallows uncaught exceptions.
- `SupervisorJob`: child failures do not cancel siblings or the parent. It only isolates siblings — it does NOT catch, log, or surface the exception.
- `CoroutineScope(Job())`: one child failure cancels all siblings — use only when that's intentional.
- Never use `GlobalScope` — it has no structured lifetime and leaks.

## Parallel execution

```kotlin
// Both run concurrently; either failure cancels the other (coroutineScope)
suspend fun fetchBoth(): Pair<A, B> = coroutineScope {
    val a = async { fetchA() }
    val b = async { fetchB() }
    Pair(a.await(), b.await())
}

// Failure isolation — one async failure does not cancel the other
suspend fun fetchBothIsolated(): Pair<Result<A>, Result<B>> = supervisorScope {
    val a = async { runCatching { fetchA() } }
    val b = async { runCatching { fetchB() } }
    Pair(a.await(), b.await())
}
```

Use `coroutineScope` when all sub-operations must succeed together.
Use `supervisorScope` when partial results are acceptable.

## Switching context

```kotlin
// Move to IO only inside DatabaseFactory.kt
// For CPU-bound work, switch to Default if needed
withContext(Dispatchers.Default) {
    heavyComputation()
}
```

In Spovishun, `Dispatchers.IO` usage is forbidden outside `DatabaseFactory.kt`.

## Exception handling

```kotlin
// WRONG — no handler: an uncaught throw reaches the default
// Thread.UncaughtExceptionHandler and disappears. No crash, no log, no alert.
// SupervisorJob does NOT help here — it only isolates siblings.
val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

// CORRECT — handler logs AND reports to observability, so the failure is visible.
val handler = CoroutineExceptionHandler { _, throwable ->
    if (throwable is CancellationException) throw throwable  // never swallow cancellation
    logger.error("Unhandled coroutine error", throwable)     // SLF4J
    Sentry.captureException(throwable)                       // observability sink (Sentry/Crashlytics)
}

val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default + handler)
```

- Set `CoroutineExceptionHandler` at scope level, not inside individual `launch {}` blocks.
- The handler body MUST log (SLF4J) AND report to an observability sink — a logging-only or empty handler still leaves failures invisible in production.
- In a DI app, provide the handler as its own dependency with a typed qualifier and compose it into the scope — see the `dependency-injection-architecture` skill.

## Rules

- Inject `CoroutineScope` via Koin — never instantiate it inside a feature class.
- Prefer `async`/`await` over sequential `launch` for parallel work.
- `launch` returns `Job`; use it to cancel or `join` the child if needed.
- Never start a coroutine with a wider scope than the component that owns it.
