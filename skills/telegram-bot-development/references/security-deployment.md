# Security & Deployment — Spovishun Telegram Bot

## Bot token

```kotlin
// AppConfig.kt — loads from environment, fails fast if missing
val botToken: String = requireNotNull(System.getenv("BOT_TOKEN")) {
    "BOT_TOKEN environment variable is required"
}
```

- Never hardcode the token in source code, config files, or comments.
- Never log the token — not even partially.
- Rotate immediately if accidentally committed.

## Input validation

Validate all user-supplied text before acting on it:

```kotlin
fun parsePositiveInt(input: String): Int? =
    input.trim().toIntOrNull()?.takeIf { it > 0 }

fun sanitizeUsername(input: String): String =
    input.trim().take(64).filter { it.isLetterOrDigit() || it == '_' }
```

- Never pass raw user text to SQL or shell commands.
- Length-limit all string inputs before storing.
- Reject non-printable characters from display names.

## Admin access

```kotlin
// Role checks — from the domain layer
memberService.hasAdminAccess(chatId, userId)   // DB-based check
BotAdminUtils.isAdmin(bot, chatId, userId)     // Telegram API check (registration only)
```

Use `BotAdminUtils` only when a user first registers; for ongoing checks use `MemberService`.

## Rate limiting

Telegram hard limits: 30 messages/second per bot, 20 messages/minute per chat.

```kotlin
// Simple delay between bulk sends
suspend fun sendToMany(chatIds: List<Long>, text: String) {
    chatIds.forEachIndexed { i, chatId ->
        bot.execute(SendMessage(chatId.toString(), text))
        if (i % 25 == 24) delay(1_000)   // pause after every 25 messages
    }
}
```

## Deployment mode

| Mode | Use | Config |
|---|---|---|
| Long-polling | Dev + Prod (current) | No extra config needed |
| Webhook | Not used | — |

Spovishun uses long-polling in both environments. No webhook setup required.

## Graceful shutdown

```kotlin
Runtime.getRuntime().addShutdownHook(Thread {
    logger.info("Shutting down bot…")
    bot.clearWebhook()
    coroutineScope.cancel()
})
```

Cancel the coroutine scope before process exit so in-flight handlers complete or are cancelled cleanly.

## Logging rules

- Log command name and chat ID (anonymized identifier), not user content.
- Log errors with chat ID for traceability.
- Never log `userId`, message text, or any user-identifiable data.

```kotlin
// CORRECT
logger.info("Command /stats received in chat $chatId")

// WRONG — logs user text
logger.info("Received: ${message.text}")
```
