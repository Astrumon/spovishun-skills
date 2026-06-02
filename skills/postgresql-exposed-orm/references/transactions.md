# Transactions — Kotlin Exposed ORM

## Spovishun convention: always use `safeDbQuery`

`safeDbQuery` wraps `dbQuery {}` + `ResultContainer.catching` — use it for all DB access:

```kotlin
// CORRECT
suspend fun findMember(chatId: Long, userId: Long): ResultContainer<Member?> =
    safeDbQuery {
        Members.select { (Members.chatId eq chatId) and (Members.userId eq userId) }
               .singleOrNull()?.toMember()
    }

// WRONG — bypassing safeDbQuery
suspend fun findMember(...) = ResultContainer.catching { dbQuery { Members.select { ... } } }

// WRONG — bare transaction
suspend fun findMember(...) = transaction { Members.select { ... } }
```

Both `safeDbQuery` and `safeDbTransaction` are defined in `data/db/DatabaseFactory.kt`.

## `safeDbQuery` vs `safeDbTransaction`

| | `safeDbQuery` | `safeDbTransaction` |
|---|---|---|
| Use for | Reads and single-entity writes | Multi-step writes that must be atomic |
| Returns | `ResultContainer<T>` | `ResultContainer<T>` |
| Wraps | `dbQuery {}` + catching | `newSuspendedTransaction` + catching |

## Raw Exposed transactions (DatabaseFactory.kt only)

```kotlin
// Coroutine context — used internally by safeDbQuery/safeDbTransaction
newSuspendedTransaction(Dispatchers.IO) {
    // multi-step writes
}

// Blocking — for tests or standalone tool scripts only
transaction {
    // blocking DB access
}
```

## Nested transactions

PostgreSQL doesn't support true nested transactions. Use savepoints for partial rollback:

```kotlin
transaction {
    // outer work
    val sp = connection.setSavepoint("sp1")
    try {
        // risky inner work
    } catch (e: Exception) {
        connection.rollback(sp)
    }
}
```

## Retry on deadlock

```kotlin
transaction(repetitionAttempts = 3) {
    // operation prone to concurrent-write deadlocks
}
```

## Rules
- Keep transactions short — no long-running business logic inside.
- Never call a Service from inside a transaction — Services own the transaction boundary.
- Only `DatabaseFactory.kt` may use `Dispatchers.IO`.
- A transaction that throws will be rolled back automatically by PostgreSQL.
