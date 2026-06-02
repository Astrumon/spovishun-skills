# Message Handlers — Spovishun Telegram Bot

## Command parsing pattern

```kotlin
class MessageHandler(
    private val commands: Map<String, Command>,
    private val callbackHandlers: Map<String, CallbackHandler>,
) {
    suspend fun handle(update: Update) {
        when {
            update.hasMessage() && update.message.hasText() -> handleMessage(update.message)
            update.hasCallbackQuery() -> handleCallback(update.callbackQuery)
        }
    }

    private suspend fun handleMessage(message: Message) {
        val text = message.text ?: return
        if (!text.startsWith("/")) return
        val command = text.substringBefore(" ").removePrefix("/").lowercase()
        val args = text.substringAfter(" ", "").trim()
        commands[command]?.execute(message, args)
            ?: sendUnknownCommand(message.chatId)
    }
}
```

## Command interface

```kotlin
interface Command {
    suspend fun execute(message: Message, args: String)
}
```

Each command:
1. Parses `args` into typed parameters
2. Calls its injected `Controller`
3. Handles the returned `CommandResponse` via exhaustive `when`
4. Sends text back to Telegram

## CommandResponse → Telegram

```kotlin
class StatsCommand(private val statsController: StatsController) : Command {
    override suspend fun execute(message: Message, args: String) {
        val response = statsController.getStats(message.chatId)
        when (response) {
            is CommandResponse.Success -> bot.sendMessage(message.chatId, "📊 ${response.text}")
            is CommandResponse.AccessDenied -> bot.sendMessage(message.chatId, "🚫 Access denied")
            is CommandResponse.Error -> bot.sendMessage(message.chatId, "❌ Something went wrong")
        }
    }
}
```

`Command` owns the emoji prefix and final text assembly. `Controller` returns only `CommandResponse`.

## Registering a new command

Add the command to `MessageHandler`'s injected map in the Koin module:

```kotlin
single {
    MessageHandler(
        commands = mapOf(
            "start"  to get<StartCommand>(),
            "stats"  to get<StatsCommand>(),   // ← add here
            "help"   to get<HelpCommand>(),
        ),
        callbackHandlers = mapOf(...)
    )
}
```

## Error handling in handlers

```kotlin
private suspend fun handleMessage(message: Message) {
    try {
        // ... dispatch logic
    } catch (e: TelegramApiException) {
        logger.error("Telegram API error for chat ${message.chatId}", e)
        // do not re-throw; bot must keep running
    } catch (e: Exception) {
        logger.error("Unhandled error in message handler", e)
    }
}
```

Never let an exception propagate out of `handle()` — it would kill the polling loop.

## Rules

- Never call a `Service` from a `Command` — always through a `Controller`.
- `Controller` must never reference Telegram types (`Message`, `Update`, etc.).
- Keep `execute()` short: parse → call controller → send response.
- Unknown commands get a user-friendly reply, not silence.
