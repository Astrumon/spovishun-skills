# PostgreSQL with Kotlin Exposed ORM

## Workflow

1. Identify the task area from the user's request.
2. Match it to the **Decision Table** below.
3. Read `references/<chosen>.md` using the `Read` tool.
4. Apply patterns from that reference, combined with the Always-Active Rules below.

## Decision Table

| If the task involves… | Read first |
|---|---|
| Table design, column types, indexes, composite keys, foreign keys | `references/table-definitions.md` |
| SELECT, JOIN, WHERE, GROUP BY, batchInsert, DSL vs DAO, N+1 | `references/query-patterns.md` |
| `transaction{}`, `newSuspendedTransaction`, rollback, retry on deadlock | `references/transactions.md` |
| Flyway SQL migrations, naming convention, `generateMigration` task | `references/migrations-flyway.md` |
| HikariCP pool sizing, timeouts, Neon/cloud config | `references/hikaricp-config.md` |

## Always-Active Rules

- **Always use `safeDbQuery { }`** — never bare `transaction { }` or manual `ResultContainer.catching { dbQuery { } }`.
- `safeDbQuery` and `safeDbTransaction` live in `data/db/DatabaseFactory.kt`.
- **Only `DatabaseFactory.kt` may use `Dispatchers.IO`.**
- DDL changes require a Flyway migration via `./gradlew generateMigration` — never hand-edit applied files.

## Output Format

When reviewing or designing DB code:
1. **Schema assessment** — table structure, index coverage, constraint correctness
2. **Query analysis** — N+1 risks, missing indexes, transaction boundaries
3. **Migration note** — if DDL changes are needed, generate via `./gradlew generateMigration`
4. **Code issues** — violations of `safeDbQuery` rule or layer boundary (`data → domain`)

## Do NOT

- Do NOT load all reference files at once — pick exactly one per the Decision Table.
- Do NOT bypass `safeDbQuery` by wrapping `dbQuery {}` in `ResultContainer.catching {}` manually.
- Do NOT use bare `transaction {}` directly in repository `data/` layer code.
- Do NOT edit a Flyway migration file that has already been applied to any database.
- Do NOT use `Dispatchers.IO` outside of `DatabaseFactory.kt`.

## Error Handling

- If the task type does not match any Decision Table row, ask the user to clarify before proceeding.
- If a reference file is missing, STOP and report the expected path.

## Related Skills

- `database-optimizer` — query performance, index design, EXPLAIN ANALYZE
- `kotlin-specialist` — Kotlin coroutines and dispatcher rules that apply in DB context
- `unit-testing-kotlin` — how to test repositories with MockImpl (no live DB in unit tests)

## Example Invocation

- User: "Add a unique index to the Members table" → load `references/table-definitions.md`, apply the index pattern.
- User: "Why is my query slow?" → load `references/query-patterns.md`, check N+1 and missing indexes.
