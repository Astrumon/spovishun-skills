# Kotlin Specialist

## Workflow

1. **Analyze** — Understand platform, coroutine strategy, and module structure.
2. **Design** — Model state with sealed classes and data structures.
3. **Implement** — Apply null safety, extension functions, coroutines, and the reference patterns below.
4. **Validate** — Run `detekt` and `ktlint`; verify coroutine cancellation on teardown.
5. **Optimize** — Consider inline classes, sequences, and compile-time optimizations.
6. **Test** — Use `runTest` and Turbine for Flow assertions.

## Decision Table

| If the task is about… | Read first |
|---|---|
| Structured concurrency, scope ownership, `SupervisorJob`, suspend functions | `references/coroutines.md` |
| `withTimeout`, `TimeoutCancellationException`, cancellation propagation | `references/cancellation-timeouts.md` |
| Cold/hot Flow, `StateFlow`, `SharedFlow`, collect and transform | `references/flow.md` |
| `sealed interface`, exhaustive `when`, state/response modeling | `references/sealed-classes.md` |
| Null safety, extension functions, `data class`, Kotlin idioms | `references/kotlin-idioms.md` |
| Kotlin compiler options, custom Gradle tasks, extra test source sets | `references/gradle-dsl.md` |
| Version catalog, repositories, wrapper, cache flags — anything about build *structure* | `.claude/rules/kotlin/gradle-build.md`; for a full audit run `/gradle-build-auditor` |

## Always-Active Rules

- Inject `CoroutineDispatcher` via DI; never hardcode a dispatcher inside a class. `Dispatchers.IO` does not exist on native/wasm targets, so a hardcoded reference is both untestable and unportable.
- Never use `runBlocking` in production coroutine context — causes deadlock.
- Never use `GlobalScope.launch` — breaks structured concurrency and causes memory leaks.
- Never swallow `CancellationException` — always rethrow or propagate it.
- Every `CoroutineScope` context MUST carry three elements: Dispatcher + Job + `CoroutineExceptionHandler` — a scope without a handler silently swallows uncaught exceptions.
- `SupervisorJob` only isolates a failing child from its siblings — it does NOT catch, log, or surface the exception. An uncaught throw reaches the default `Thread.UncaughtExceptionHandler` and disappears, so the bot keeps running but the feature stops working invisibly.

## Do NOT

- Do NOT load all references at once — pick exactly one based on the Decision Table.
- Do NOT use `!!` without a documented invariant that guarantees non-null at that point.
- Do NOT use `runBlocking`, `GlobalScope`, or undocumented `!!` — hard bans.
- Do NOT hardcode any dispatcher inside a class — take it as a constructor parameter.

## Error Handling

- If no Decision Table row matches, ask the user to clarify before proceeding.
- If a reference file is missing, stop and report the exact path.
- Coroutine errors: set `CoroutineExceptionHandler` at scope level, not inside `launch {}`. The handler must log (SLF4J) AND report to observability — never leave it empty. Inject it via DI with a typed qualifier (see `dependency-injection-architecture`).

## Related Skills

- `telegram-bot-development` — coroutine scope wiring for bot handlers
- `postgresql-exposed-orm` — the `safeDbQuery` pattern built on coroutines (`withContext(Dispatchers.IO)` + `transaction {}`)
- `unit-testing-kotlin` — `runTest`, `StandardTestDispatcher`, Turbine for Flow assertions
- `gradle-build-auditor` — whole-build audit: version catalog, repositories, wrapper, caches, CI

## Example Invocation

- User: "How do I run two fetches concurrently in a service?" → load `references/coroutines.md`, apply `supervisorScope` + `async` pattern.
- User: "Model bot command results with sealed classes" → load `references/sealed-classes.md`, apply sealed interface + exhaustive `when`.
