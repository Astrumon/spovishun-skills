# Table Definitions — Kotlin Exposed ORM

## Base Table Types

```kotlin
object Users : LongIdTable("users") {          // auto-increment BIGINT id
    val username   = varchar("username", 50).uniqueIndex()
    val telegramId = long("telegram_id").uniqueIndex()
    val createdAt  = timestamp("created_at").defaultExpression(CurrentTimestamp)
    val isActive   = bool("is_active").default(true)
}

object Members : IntIdTable("members") {       // auto-increment INT id
    val chatId   = long("chat_id")
    val userId   = long("user_id")
    val role     = enumerationByName("role", 50, MemberRole::class)
    val joinedAt = timestamp("joined_at").defaultExpression(CurrentTimestamp)
    init {
        uniqueIndex(chatId, userId)            // composite unique constraint
        index(false, chatId)                   // non-unique index
    }
}

object Sessions : UUIDTable("sessions") {      // UUID primary key
    val userId    = reference("user_id", Users)
    val expiresAt = timestamp("expires_at")
}
```

## Column Types Reference

| Kotlin | PostgreSQL |
|---|---|
| `varchar(name, n)` | `VARCHAR(n)` |
| `text(name)` | `TEXT` |
| `long(name)` | `BIGINT` |
| `integer(name)` | `INT` |
| `bool(name)` | `BOOLEAN` |
| `timestamp(name)` | `TIMESTAMP` |
| `uuid(name)` | `UUID` |
| `decimal(name, p, s)` | `DECIMAL(p,s)` |
| `enumeration(name, klass)` | `INT` (ordinal) |
| `enumerationByName(name, len, klass)` | `VARCHAR(len)` (name) |

## Nullable columns

```kotlin
val deletedAt = timestamp("deleted_at").nullable()   // returns Instant?
```

## Indexes and Constraints

```kotlin
// Unique single column
val email = varchar("email", 255).uniqueIndex()

// Composite unique
init { uniqueIndex(chatId, userId) }

// Non-unique index
init { index(false, chatId) }

// Custom name
init { index("idx_chat_active", false, chatId, isActive) }
```

## Foreign Keys

```kotlin
val userId = reference("user_id", Users)             // ON DELETE RESTRICT (default)
val chatId = reference("chat_id", Chats, onDelete = ReferenceOption.CASCADE)
```

## Default Values

```kotlin
val createdAt = timestamp("created_at").defaultExpression(CurrentTimestamp)
val count     = integer("count").default(0)
val label     = varchar("label", 50).default("member")
```

## Spovishun Conventions
- All tables scoped by `chatId` — composite PKs or composite unique indexes always include `chatId`.
- Use `enumerationByName` for roles — safer than ordinal if enum member order changes.
- Never let `SchemaUtils.create()` handle DDL in production; always use Flyway migrations.
- Pair every new `Table` object with a `V{N}__<description>.sql` migration file in a single commit.
