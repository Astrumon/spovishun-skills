# Flyway Migrations — Spovishun

## Naming convention

```
V{version}__{description}.sql
```
- `{version}` — incrementing integer (1, 2, 3, …)
- `{description}` — snake_case, brief, no spaces
- Double underscore `__` separator is required

Examples:
```
V1__create_users.sql
V2__add_members_table.sql
V3__add_role_to_members.sql
V4__add_index_members_chat_id.sql
```

## Location

```
src/main/resources/db/migration/postgresql/
```

Both dev and prod use the same migration path. Dev → local PostgreSQL. Prod → Neon PostgreSQL.

## Creating a migration

**Always use the Gradle task — never create migration files by hand:**

```bash
./gradlew generateMigration
```

The interactive tool prompts for a description and creates a correctly-named file with the next version number.

## Rules

- **Never edit a migration file that has been applied to any database.** Flyway tracks checksums; editing causes startup failure.
- **Always commit the Exposed `Table` object and the migration SQL together** in a single commit.
- For rollback: write a new `V{n}__rollback_<description>.sql` migration — never delete or modify the original.
- Keep migrations idempotent where possible: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`.
- For large tables: prefer `CREATE INDEX CONCURRENTLY` in a separate migration to avoid table locks.

## Flyway startup

Flyway runs automatically on bot startup via `DatabaseFactory.init()`:

```kotlin
Flyway.configure()
    .dataSource(jdbcUrl, user, password)
    .locations("classpath:db/migration/postgresql")
    .load()
    .migrate()
```

## Common SQL patterns

### Add a NOT NULL column with a default
```sql
ALTER TABLE members ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
```

### Add an index
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_members_chat_id ON members (chat_id);
```

### Add a unique constraint
```sql
ALTER TABLE members ADD CONSTRAINT uq_members_chat_user UNIQUE (chat_id, user_id);
```

### Rename a column
```sql
ALTER TABLE members RENAME COLUMN username TO display_name;
```
