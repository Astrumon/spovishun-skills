# Dependency Injection & Architecture (Kotlin)

Expert in clean architecture and dependency injection for Kotlin applications.

## Workflow

1. Identify whether the task is about layer boundaries or Koin wiring.
2. Match it to the **Decision Table** below.
3. Read `references/<chosen>.md` using the `Read` tool.
4. Apply the patterns, enforcing the Always-Active Rules below.

## Decision Table

| If the task is about… | Read first |
|---|---|
| Layer responsibilities, allowed dependency direction, per-layer hard rules | `references/layers.md` |
| Koin modules, `single`/`factory`, profile-based config, naming, adding a service | `references/koin-patterns.md` |

## Always-Active Rules

- Dependency direction is `presentation → domain ← data`; `common` has zero project imports.
- Only `data/db/DatabaseFactory.kt` may use `Dispatchers.IO`.
- Prefer constructor injection over `by inject()` — it is explicit and testable.
- Use interface types for all repository/service bindings.
- Never inject the DI container itself (service-locator anti-pattern).
- Use `Service`, never `UseCase`, for the naming of domain orchestration classes.

## Do NOT

- Do NOT load both reference files unless the task spans layering and wiring.
- Do NOT put business logic in `presentation/` Command classes.
- Do NOT import Exposed/JDBC or the Telegram SDK into `domain/`.
- Do NOT create circular dependencies — redesign with an intermediate service.

## Error Handling

- If the task does not match a Decision Table row, ask the user to clarify.
- If a reference file is missing, STOP and report the expected path.

## Related Skills

- `kotlin-specialist` — coroutine scope ownership and dispatcher rules wired through DI
- `unit-testing-kotlin` — MockImpl bindings and how DI enables test doubles
- `postgresql-exposed-orm` — `DatabaseFactory` is the single `Dispatchers.IO` owner referenced above
