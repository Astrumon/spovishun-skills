# Kotlin Idioms — Null Safety, Extensions, Data Classes

## Null safety operators

```kotlin
// Safe call — returns null if user is null
val name: String? = user?.name

// Elvis — provide a default or throw
val display: String = user?.name ?: "Anonymous"
val id: Long = user?.id ?: throw IllegalStateException("User must have ID")

// requireNotNull / checkNotNull — contract-enforced non-null
val token: String = requireNotNull(System.getenv("BOT_TOKEN")) { "BOT_TOKEN is required" }
val id: Long = checkNotNull(user.id) { "User.id must not be null" }
```

- Never use `!!` — use `requireNotNull` or `checkNotNull` with a descriptive message instead.
- `requireNotNull` throws `IllegalArgumentException`; `checkNotNull` throws `IllegalStateException`.

## Scope functions

| Function | Receiver (`this`) | It param | Returns | Use for |
|---|---|---|---|---|
| `let` | — | `it` | lambda result | null-safety chains, transformations |
| `run` | `this` | — | lambda result | compute a value using `this` |
| `also` | — | `it` | original object | side effects (logging, assertions) |
| `apply` | `this` | — | original object | builder-style initialization |
| `with` | `this` | — | lambda result | grouping operations on an object |

```kotlin
// let — null-safety chain
user?.let { render(it.name) }

// apply — builder style
val config = HikariConfig().apply {
    jdbcUrl = "jdbc:postgresql://..."
    maximumPoolSize = 10
}

// also — side effect without changing the object
return result.also { logger.info("Result: $it") }
```

## Extension functions

```kotlin
fun String.toSlug(): String = lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-')
fun Long.toChatId(): String = toString()
fun ResultContainer<*>.isSuccess(): Boolean = this is ResultContainer.Success
```

- Add behavior to existing types without inheritance.
- Keep extensions close to the type they extend — in the same package or a dedicated `extensions.kt`.

## data class

```kotlin
data class Member(
    val chatId: Long,
    val userId: Long,
    val role: MemberRole,
    val joinedAt: Instant,
)
```

- Generates `equals`, `hashCode`, `toString`, `copy`, and `componentN` functions automatically.
- Use for value objects, DTOs, and domain models.
- Prefer `val` properties; use `var` only when mutability is required.

## object — singletons and companions

```kotlin
// Singleton
object BotAdminUtils {
    fun isAdmin(bot: Bot, chatId: Long, userId: Long): Boolean = TODO()
}

// Companion — factory methods on a class
class Member private constructor(...) {
    companion object {
        fun create(chatId: Long, userId: Long): Member = Member(...)
    }
}
```

## when as expression

```kotlin
// Preferred: when as expression, result assigned
val label: String = when (role) {
    MemberRole.ADMIN     -> "Admin"
    MemberRole.MODERATOR -> "Moderator"
    MemberRole.MEMBER    -> "Member"
}

// Avoid when as statement with no result — harder to miss branches
```

## Prefer val and immutability

```kotlin
// CORRECT
val items: List<Member> = fetchMembers()

// WRONG — unnecessary mutability
var items: List<Member> = fetchMembers()
items = items.filter { it.isActive }   // use val + transform instead
val activeItems = items.filter { it.isActive }
```

Use `var` only when a variable truly needs reassignment (e.g., loop accumulators).
