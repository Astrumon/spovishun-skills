# Inline Keyboards — Spovishun Telegram Bot

## Callback data format

Always use a colon-delimited format: `action:param1:param2`

```kotlin
// Examples
"confirm_delete:member:42"
"set_role:moderator:99"
"page:members:3"
```

## Building an inline keyboard

```kotlin
fun buildKeyboard(buttons: List<Pair<String, String>>): InlineKeyboardMarkup {
    val rows = buttons.map { (label, callbackData) ->
        listOf(InlineKeyboardButton(label).apply { this.callbackData = callbackData })
    }
    return InlineKeyboardMarkup(rows)
}

// Multi-column: wrap each row manually
fun buildTwoColumnKeyboard(pairs: List<Pair<String, String>>): InlineKeyboardMarkup {
    val rows = pairs.chunked(2).map { row ->
        row.map { (label, data) -> InlineKeyboardButton(label).apply { callbackData = data } }
    }
    return InlineKeyboardMarkup(rows)
}
```

## Sending a message with keyboard

```kotlin
bot.execute(
    SendMessage(chatId.toString(), "Choose an action:").apply {
        replyMarkup = buildKeyboard(
            listOf(
                "Confirm" to "confirm_delete:member:$memberId",
                "Cancel"  to "cancel:delete",
            )
        )
    }
)
```

## Handling callback queries

```kotlin
private suspend fun handleCallback(query: CallbackQuery) {
    val parts = query.data.split(":")
    val action = parts.firstOrNull() ?: return
    answerCallbackQuery(query.id)   // always answer — must happen within 10 seconds

    when (action) {
        "confirm_delete" -> handleConfirmDelete(query, parts)
        "set_role"       -> handleSetRole(query, parts)
        "cancel"         -> deleteMessage(query.message)
        else             -> logger.warn("Unknown callback action: $action")
    }
}

private fun answerCallbackQuery(queryId: String, text: String? = null) {
    bot.execute(AnswerCallbackQuery(queryId).apply { if (text != null) this.text = text })
}
```

## Editing a keyboard after action

```kotlin
bot.execute(
    EditMessageReplyMarkup().apply {
        chatId = query.message.chatId.toString()
        messageId = query.message.messageId
        replyMarkup = null   // removes keyboard after selection
    }
)
```

## Rules

- Always call `answerCallbackQuery` within 10 seconds — even if no popup is shown.
- Parse callback data defensively: `parts.getOrNull(1)` not `parts[1]`.
- Callback data max length is 64 bytes — keep identifiers short.
- Delete or edit the original message after a destructive action (confirm/cancel flow).
- Never store business state in callback data — use IDs and look up from DB.
