# Cancellation & Timeouts — Kotlin Coroutines

## withTimeout

```kotlin
// Throws TimeoutCancellationException (subclass of CancellationException)
try {
    val result = withTimeout(5_000L) { fetchData() }
} catch (e: TimeoutCancellationException) {
    logger.warn("Fetch timed out after 5s")
    // Handle gracefully — do NOT rethrow unless the caller must know about the timeout
}
```

`withTimeout` cancels the block and throws when the deadline is exceeded.
`withTimeoutOrNull` returns `null` instead — use it when a timeout is an expected non-exceptional case.

```kotlin
val result: Data? = withTimeoutOrNull(5_000L) { fetchData() }
if (result == null) handleTimeout()
```

## CancellationException rules

```kotlin
// CORRECT — propagate CancellationException
suspend fun doWork() {
    try {
        heavyWork()
    } catch (e: Exception) {
        if (e is CancellationException) throw e   // always rethrow
        logger.error("Error in doWork", e)
    }
}

// WRONG — swallowed CancellationException prevents clean shutdown
catch (e: Exception) {
    logger.error("Error", e)   // never catches CancellationException silently
}
```

Swallowing `CancellationException` breaks structured concurrency — the parent scope will never know the child was cancelled and will wait forever.

## isActive check in long loops

```kotlin
suspend fun processAll(items: List<Item>) {
    for (item in items) {
        ensureActive()   // throws CancellationException if scope is cancelled
        process(item)
    }
}

// Alternative: isActive in a while loop
while (isActive) {
    processNext()
    delay(100)
}
```

`ensureActive()` is preferred in loops — it reads more clearly than `if (!isActive) return`.

## Cooperative cancellation in CPU-bound work

```kotlin
suspend fun heavyCompute(data: List<Int>): Long {
    var sum = 0L
    data.forEachIndexed { i, value ->
        if (i % 1000 == 0) yield()   // cooperative cancellation point
        sum += value
    }
    return sum
}
```

`yield()` suspends and checks for cancellation — use it every N iterations in CPU-bound loops.

## Rules

- `TimeoutCancellationException` is a subclass of `CancellationException` — the same rethrow rule applies.
- Never catch `CancellationException` and swallow it.
- Prefer `withTimeoutOrNull` over `withTimeout` when timeout is a normal (non-error) outcome.
- Always verify that long-running loops have a cancellation check point.
