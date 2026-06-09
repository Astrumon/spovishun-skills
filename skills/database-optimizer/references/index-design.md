# Index Design

```sql
-- Single column
CREATE INDEX CONCURRENTLY idx_members_telegram_id ON members(telegram_id);

-- Composite index (order matters: most selective first)
CREATE INDEX CONCURRENTLY idx_group_members_group_chat
  ON group_members(group_id, chat_id);

-- Partial index for filtered queries
CREATE INDEX CONCURRENTLY idx_members_active
  ON members(username) WHERE is_active = true;

-- Covering index to avoid heap fetches
CREATE INDEX CONCURRENTLY idx_messages_covering
  ON messages(chat_id, created_at) INCLUDE (content);
```

Rules:
- Always use `CREATE INDEX CONCURRENTLY` to avoid table locks.
- Composite index column order: most selective column first.
- Indexes slow down writes — do not create redundant ones; check write amplification.
- `ANALYZE` after bulk inserts to refresh planner statistics.
- Before dropping an index, check all dependent queries.
