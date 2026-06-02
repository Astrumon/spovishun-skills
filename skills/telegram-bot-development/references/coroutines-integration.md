# Coroutines Integration — Spovishun Telegram Bot

## Suspend handlers

Command and callback handler methods must be `suspend`:

```kotlin
interface Command {
    suspend fun execute(message: Message, args: String)
}

class StatsCommand(private val statsController: StatsController) : Command {
    override suspend fun execute(message: Message, args: String) {
        val response = statsController.getStats(message.chatId)
        // ...
    }
}
```

`Controller` and `Service` methods are also `suspend` — the entire call stack is coroutine-aware.

## Scope ownership

```kotlin
// Application.kt — top-level scope, lives for the process lifetime
val botScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

// MessageHandler receives the scope via Koin injection
class MessageHandler(
    private val scope: CoroutineScope,
    ...
) {
    fun onUpdateReceived(update: Update) {
        scope.launch { handle(update) }
    }
}
```

- Use `SupervisorJob` so a failed handler does not cancel the entire bot scope.
- Never use `GlobalScope` — it has no structured lifetime and cannot be cancelled.
- Never create a raw `CoroutineScope(...)` inside a handler class; inject it.

## Dispatcher rules

| Layer | Allowed dispatcher |
|---|---|
| `MessageHandler`, `Command`, `Controller` | `Dispatchers.Default` (injected scope) |
| `Service` | `Dispatchers.Default` (inherited from caller) |
| DB access via `safeDbQuery` | `Dispatchers.IO` — managed by `DatabaseFactory.kt` |

Only `DatabaseFactory.kt` may reference `Dispatchers.IO` directly. No other class may touch it.

## Error handling in coroutines

```kotlin
// Scope-level handler — catches anything that escapes a launch
val botScope = CoroutineScope(
    SupervisorJob() +
    Dispatchers.Default +
    CoroutineExceptionHandler { _, throwable ->
        logger.error("Unhandled coroutine error", throwable)
    }
)
```

- Never swallow `CancellationException` — always re-throw it.
- Don't wrap `launch { }` in try-catch for structured error handling; use `CoroutineExceptionHandler` at scope level.

## Cancellation safety

```kotlin
suspend fun handleLongOperation(chatId: Long) {
    repeat(100) { i ->
        ensureActive()   // check cancellation at each iteration
        processChunk(i)
    }
}
```

Call `ensureActive()` or `yield()` inside long CPU-bound loops so cancellation is respected.

## Injecting scope via Koin

```kotlin
// di/BotModule.kt
single<CoroutineScope> {
    CoroutineScope(SupervisorJob() + Dispatchers.Default + get<CoroutineExceptionHandler>())
}
single { MessageHandler(scope = get(), commands = get(), ...) }
```

Tests replace the scope with `TestScope` from `kotlinx-coroutines-test`.
