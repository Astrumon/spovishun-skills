# Telegram Bot API Basics — Spovishun

## Library

```kotlin
// build.gradle.kts
implementation(libs.telegrambots.longpolling)
```

Dependency: `org.telegram:telegrambots-longpolling`. Long-polling only — no webhook in this project.

## Bot class

```kotlin
class TelegramBot(
    private val messageHandler: MessageHandler,
) : TelegramBotsLongPollingApplication() {

    fun start(token: String) {
        registerBot(token, LongPollingTelegramBot(token, messageHandler))
    }
}
```

`TelegramBotsLongPollingApplication` manages the polling loop. Register one bot per token.

## Registration at startup

```kotlin
// Application.kt — called by main()
fun startBot(token: String) {
    val bot = get<TelegramBot>()   // injected via Koin
    bot.start(token)
}
```

Token is loaded from `AppConfig.botToken` which reads `BOT_TOKEN` env var.

## Update dispatch flow

```
TelegramBot.onUpdateReceived(update)
  └─ MessageHandler.handle(update)
       ├─ isCommand → dispatch to Command
       └─ isCallbackQuery → dispatch to CallbackHandler
```

`MessageHandler` is the single entry point. All routing happens there.

## Graceful shutdown

```kotlin
// Application.kt shutdown hook
Runtime.getRuntime().addShutdownHook(Thread {
    bot.clearWebhook()
    bot.exe.shutdownNow()
})
```

## Rules

- Only one `TelegramBotsLongPollingApplication` instance per process.
- Never instantiate `TelegramBot` manually — always inject via Koin.
- `BOT_TOKEN` must be validated non-blank at startup; fail fast if missing.
