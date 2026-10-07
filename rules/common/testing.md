# Testing Rules

## Approach
- TDD by default: write the test first, then implement, then refactor
- NEVER write production code to pass a test you haven't run and seen fail first
- Tests are first-class code — same quality standards as production code

## Stack (Kotlin)
> Kotlin Multiplatform projects: this section does **not** apply — JUnit5 and MockK are JVM-only and
> break `commonTest` once a native target exists. See `kmp/testing.md` for the per-source-set stack.
> Everything else on this page still applies.

- Unit tests: JUnit5 + MockK
- Coroutine tests: `runTest {}` from `kotlinx-coroutines-test`
- Mocking: `mockk<Dependency>()`, `coEvery`, `coVerify`
- Reset state: `clearAllMocks()` in `@BeforeTest`

## What to Test
- Domain layer (services): ALWAYS unit tested — mock repositories
- Presentation layer (controllers): ALWAYS unit tested — mock services
- Data layer (repositories): integration tested against real or in-memory DB, not unit mocked
- DI modules: one graph check (Koin `verify()` / `checkModules`, Spring context test) proves the wiring;
  it is a wiring test, not a unit test, and the module needs nothing more. Behaviour is tested on
  the classes it wires
- Framework entry points and database factory classes get no unit tests

## Coverage
- Every public function in a service or controller has at least one test
- Cover both success and failure paths
- When the project measures coverage (Kover, JaCoCo), keep domain and presentation at ≥ 80% line
  coverage. Without a configured tool there is no numeric target — the two rules above are the bar

## Naming
- Pattern: `fun should_doX_when_conditionY()`
- Be descriptive — the name should explain the scenario without reading the body

## Forbidden
- `Thread.sleep()` in tests — use `advanceTimeBy()` or `TestCoroutineScheduler`
- Hardcoded delays or flaky waits
- Tests that never assert anything (no `verify` or `assertEquals`)
- Mocking the class under test
