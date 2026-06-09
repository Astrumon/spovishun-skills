# Query Analysis

```sql
-- Capture execution plan with actual timing
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT m.username, g.name
FROM members m
JOIN group_members gm ON gm.member_id = m.id
JOIN groups g ON g.id = gm.group_id
WHERE m.telegram_id = 123456789;

-- Find slow queries (pg_stat_statements)
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;

-- Identify missing indexes (more seq scans than index scans)
SELECT relname, seq_scan, idx_scan
FROM pg_stat_user_tables
WHERE seq_scan > idx_scan
ORDER BY seq_scan DESC;
```

## N+1 Detection & Fix

```kotlin
// Problem: N+1 with Exposed ORM
val members = Members.selectAll()           // 1 query
members.forEach { member ->
    GroupMembers.select { ... }             // N queries
}

// Fix: JOIN in single query
(Members innerJoin GroupMembers)
    .select { GroupMembers.groupId eq groupId }
    .toList()
```
