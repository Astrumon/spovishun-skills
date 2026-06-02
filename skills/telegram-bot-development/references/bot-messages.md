# Bot Messages Reference

All user-facing strings live in `src/main/resources/messages.properties`.
Access them exclusively via `BotMessages` (`presentation/bot/BotMessages.kt`).
Never hardcode strings in commands or controllers.

## Structure

`BotMessages` is a singleton `object` with nested objects per domain area:

```
BotMessages
├── Error      — error messages (prefixed, not-found, access-denied, …)
├── Success    — success/delete prefixes
├── Member     — member list headers and items
├── Ping       — ping icons, headers, usage
├── Group      — group CRUD messages
├── Registration
└── Welcome
```

### Two internal primitives

```kotlin
private fun get(key: String): String = bundle.getString(key)
private fun format(key: String, vararg args: Any?): String =
    MessageFormat.format(bundle.getString(key), *args)
```

- Use `get()` for static strings (no placeholders).
- Use `format()` for strings with `{0}`, `{1}`, … placeholders (MessageFormat syntax).

## Adding a new string

1. Add a key in `messages.properties`:
   ```properties
   my.feature.success=Операція успішна: {0}
   ```

2. Add a `val` or `fun` in the matching nested object in `BotMessages.kt`:
   ```kotlin
   // Static
   val someLabel: String get() = get("my.feature.label")

   // Parameterized
   fun success(name: String): String = format("my.feature.success", name)
   ```

3. Call it from the controller or command:
   ```kotlin
   return CommandResponse.Success(BotMessages.MyFeature.success(name))
   ```

## MessageFormat rules

- Placeholders are positional: `{0}`, `{1}`, `{2}`, …
- A literal single-quote `'` must be doubled: `''` (e.g. `Групу ''{0}'' не знайдено.`)
- Do **not** use named placeholders — MessageFormat does not support them.

### Example

```properties
ping.header.group_with_extra=📣 {0} {1} {2}
ping.header.group_no_extra=📣 {0} {1}
```

```kotlin
fun headerGroup(groupName: String, icons: String, extra: String): String =
    if (extra.isEmpty()) format("ping.header.group_no_extra", groupName, icons)
    else format("ping.header.group_with_extra", groupName, icons, extra)
```

## HTML-escaping contract

`BotMessages` does **not** escape any values — it passes them straight into `MessageFormat`.
The **caller** is responsible for escaping dynamic values before passing them in:

```kotlin
// Correct — escape before passing
return CommandResponse.Success(BotMessages.Group.created(name.escapeHtml()))

// Wrong — raw user input, may break HTML parse mode
return CommandResponse.Success(BotMessages.Group.created(name))
```

`String.escapeHtml()` is an extension in `common/` — escapes `<`, `>`, `&`, `"`.

Static strings in `messages.properties` that contain HTML tags (e.g. `<b>`, `<code>`) are
safe as-is; only *dynamic* values (user-supplied names, usernames, etc.) need escaping.

## Static vs computed property

Prefer `val ... get() = get(...)` (property with getter) over `val ... = get(...)` (field
initialized at class load time). The getter re-reads the bundle on each access, which is
safe and keeps the API consistent.

```kotlin
// Correct
val noRegistered: String get() = get("ping.no_registered")

// Avoid — initialized once at object construction
val noRegistered: String = get("ping.no_registered")
```

## Common mistakes

| Mistake | Fix |
|---|---|
| `CommandResponse.Success("Групу не знайдено")` | `CommandResponse.Success(BotMessages.Error.notFound)` |
| `format("ping.header.group_no_extra", icons)` | Include `groupName` as first arg: `format("ping.header.group_no_extra", groupName, icons)` |
| Passing raw user input to `BotMessages.Group.created(name)` | `BotMessages.Group.created(name.escapeHtml())` |
| Adding a new string directly in a controller | Add to `messages.properties` + expose via `BotMessages` first |
