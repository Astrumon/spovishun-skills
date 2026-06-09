# Engine Tuning

## PostgreSQL (key settings)

```ini
# postgresql.conf — adjust for available RAM
shared_buffers = 256MB         # 25% of RAM
effective_cache_size = 768MB   # 75% of RAM
work_mem = 16MB                # per sort/hash operation
maintenance_work_mem = 64MB    # for VACUUM, CREATE INDEX

# Connection pooling (use PgBouncer for production)
max_connections = 100
```

## SQLite (dev/test)

```kotlin
// Use WAL mode for better concurrency
Database.connect("jdbc:sqlite:file:data.db?mode=rwc&journal_mode=WAL")

// Batch operations instead of row-by-row
transaction {
    Members.batchInsert(items) { item ->
        this[Members.username] = item.username
    }
}
```
