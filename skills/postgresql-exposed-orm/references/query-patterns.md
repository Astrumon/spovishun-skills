# Query Patterns — Kotlin Exposed ORM

## DSL vs DAO

- **DSL**: Use for complex queries, reporting, bulk operations, or when full SQL control is needed.
- **DAO**: Use for CRUD on individual entities with ORM-style access.
- Prefer DSL for read-heavy operations — more explicit and efficient.

```kotlin
// DSL: explicit, composable
fun findActiveInChat(chatId: Long): List<ResultRow> =
    Members.select { (Members.chatId eq chatId) and (Members.isActive eq true) }
           .orderBy(Members.joinedAt)
           .toList()

// DAO: entity-style CRUD
class Member(id: EntityID<Int>) : IntEntity(id) {
    companion object : IntEntityClass<Member>(Members)
    var chatId by Members.chatId
    var userId by Members.userId
}
fun findById(id: Int): Member? = Member.findById(id)
```

## Common DSL Patterns

### SELECT with condition
```kotlin
Users.select { Users.telegramId eq telegramId }.firstOrNull()
```

### SELECT with JOIN
```kotlin
(Members innerJoin Users)
    .select { Members.chatId eq chatId }
    .map { row -> row[Users.username] to row[Members.role] }
```

### Multiple conditions (AND / OR)
```kotlin
Members.select {
    (Members.chatId eq chatId) and (Members.role eq MemberRole.ADMIN)
}.toList()

Members.select {
    (Members.role eq MemberRole.ADMIN) or (Members.role eq MemberRole.MODERATOR)
}.toList()
```

### ORDER and LIMIT
```kotlin
Posts.select { Posts.chatId eq chatId }
     .orderBy(Posts.createdAt to SortOrder.DESC)
     .limit(10)
```

### COUNT / aggregate
```kotlin
Members.select { Members.chatId eq chatId }.count()
```

### INSERT single row
```kotlin
Members.insert {
    it[chatId] = newChatId
    it[userId] = newUserId
    it[role] = MemberRole.MEMBER
}
```

### BATCH INSERT
```kotlin
Members.batchInsert(items) { item ->
    this[Members.chatId] = item.chatId
    this[Members.userId] = item.userId
}
```

### UPDATE with WHERE
```kotlin
Members.update({ (Members.chatId eq chatId) and (Members.userId eq userId) }) {
    it[role] = MemberRole.MODERATOR
}
```

### DELETE with WHERE
```kotlin
Members.deleteWhere { (Members.chatId eq chatId) and (Members.userId eq userId) }
```

### UPSERT (Exposed 0.47+)
```kotlin
Members.upsert {
    it[chatId] = newChatId
    it[userId] = newUserId
    it[role] = MemberRole.MEMBER
}
```

## N+1 Detection and Prevention

**Symptom:** 1 query to load entities + N queries to load each related entity.

```kotlin
// BAD — N+1: loads each user in a separate query
val userIds = Members.selectAll().map { it[Members.userId] }
val users = userIds.map { id -> User.findById(id) }   // N additional queries

// GOOD — single JOIN
val result = (Members innerJoin Users)
    .selectAll()
    .map { row -> row[Users.username] to row[Members.role] }
```

For DAO-style access, use `with()` for eager loading:
```kotlin
Member.all().with(Member::user)   // resolves to a single SQL query with JOIN
```
