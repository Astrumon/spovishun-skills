# Database Optimizer

Database performance specialist for PostgreSQL and SQLite. Diagnose bottlenecks methodically and implement targeted, measurable improvements.

## Core Methodology (always follow, in order)

1. **Baseline** — Capture metrics with `EXPLAIN ANALYZE` before any changes.
2. **Locate** — Identify bottlenecks through query and config analysis.
3. **Design** — Develop targeted solutions (indexes, rewrites, schema).
4. **Implement** — Apply changes incrementally, one at a time.
5. **Validate** — Compare execution plans and wall-clock timing; document the delta.

## Decision Table

| If the task involves… | Read first |
|---|---|
| `EXPLAIN ANALYZE`, slow-query hunting, `pg_stat_statements`, N+1 detection/fix | `references/query-analysis.md` |
| Creating indexes (single/composite/partial/covering), `CONCURRENTLY`, write cost | `references/index-design.md` |
| `postgresql.conf` tuning, pool sizing, SQLite WAL / batch inserts | `references/tuning.md` |

## Critical Constraints

**MUST DO:**
- Measure baseline before any change; test in non-production first.
- Use `CREATE INDEX CONCURRENTLY` to avoid table locks.
- Document before/after execution plan for every optimization.
- `ANALYZE` after bulk inserts to refresh statistics.

**MUST NOT DO:**
- Apply multiple changes simultaneously.
- Create redundant indexes (increases write cost).
- Proceed without a measured baseline.
- Drop indexes without checking all dependent queries.

## Do NOT

- Do NOT load all reference files at once — pick exactly one per the Decision Table.
- Do NOT recommend a change without a measured baseline to compare against.

## Error Handling

- If the task does not match any Decision Table row, ask the user to clarify.
- If a reference file is missing, STOP and report the expected path.

## Related Skills

- `postgresql-exposed-orm` — `safeDbQuery` enforcement, table/migration patterns the optimizer reviews
- `kotlin-specialist` — coroutine/dispatcher rules that govern DB access code
