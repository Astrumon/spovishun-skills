# Transactions — Kotlin Exposed ORM

## Convention: `safeDbQuery` is the only DB entry point

`safeDbQuery` is defined in `data/db/DatabaseFactory.kt` and does the whole job itself —
`withContext(Dispatchers.IO)` → `transaction { }` → `ResultContainer.catching`. There is no
intermediate `dbQuery` helper to compose with, so use it for all DB access:

```kotlin
// CORRECT
suspend fun findMember(chatId: Long, userId: Long): ResultContainer<Member?> =
    safeDbQuery {
        Members.select { (Members.chatId eq chatId) and (Members.userId eq userId) }
               .singleOrNull()?.toMember()
    }

// WRONG — hand-rolling what safeDbQuery already does
suspend fun findMember(...) = ResultContainer.catching { transaction { Members.select { ... } } }

// WRONG — bare transaction, blocks the caller's dispatcher
suspend fun findMember(...) = transaction { Members.select { ... } }
```

## Multi-step writes are already atomic

One `safeDbQuery` block is one transaction, so several statements inside a single block commit
or roll back together. There is no separate helper for atomic writes — putting the steps in one
block is the mechanism:

```kotlin
// CORRECT — one transaction, both updates or neither
suspend fun transferOwnership(chatId: Long, newOwnerId: Long): ResultContainer<Unit> =
    safeDbQuery {
        Members.update({ Members.chatId eq chatId }) { it[role] = Role.MEMBER }
        Members.update({ (Members.chatId eq chatId) and (Members.userId eq newOwnerId) }) {
            it[role] = Role.OWNER
        }
    }

// WRONG — two transactions, the first one stays committed if the second throws
suspend fun transferOwnership(chatId: Long, newOwnerId: Long) {
    safeDbQuery { Members.update(...) }
    safeDbQuery { Members.update(...) }
}
```

## Raw Exposed transactions (DatabaseFactory.kt only)

The primitives below are Exposed APIs, not repository-layer patterns. Repository code never
reaches for them — it calls `safeDbQuery`.

```kotlin
// Blocking — this is what safeDbQuery opens, already inside its Dispatchers.IO hop.
// Outside DatabaseFactory.kt it is legal only in tests or standalone tool scripts.
transaction {
    // blocking DB access
}

// Suspending alternative. safeDbQuery does NOT use it — it runs the blocking `transaction {}`
// on Dispatchers.IO instead. Do not introduce it in `data/` code.
newSuspendedTransaction(Dispatchers.IO) {
    // multi-step writes
}
```

## Nested transactions

PostgreSQL doesn't support true nested transactions. Use savepoints for partial rollback — inside a
`safeDbQuery` block the savepoint is taken on the transaction that block already opened:

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

`safeDbQuery` takes no retry parameter, so this belongs in `DatabaseFactory.kt` (or a tool script) —
not in repository code:

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
