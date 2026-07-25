# KMP Testing Rules

**These rules supersede the Stack section of `common/testing.md` for this project.** The approach,
coverage and naming rules there still apply; the tooling does not — JUnit 5 and MockK are JVM-only
and cannot run in `commonTest` once iOS is a target.

## Which source set

| Source set | Framework | What goes here |
|---|---|---|
| `commonTest` | `kotlin.test` + `kotlinx-coroutines-test` | ViewModels, use cases, repositories, mappers — everything platform-independent |
| `jvmTest` | `kotlin.test` (+ MockK allowed) | Desktop Compose UI tests, JVM-only integration |
| `androidHostTest` | JUnit + MockK allowed | Android host-side tests |
| `androidDeviceTest` | Compose UI test | instrumented UI tests on an emulator/device |
| `iosTest` | `kotlin.test` | iOS-specific behaviour |

- **Default to `commonTest`.** A test lands in a platform source set only when it genuinely needs
  that platform.
- **No MockK in `commonTest`.** It does not support Kotlin/Native, so one such test breaks the iOS
  target for the whole module. Write a hand-rolled fake implementing the domain interface instead —
  it is faster, refactor-safe and readable.
- **Compose UI tests never live in `commonTest`.** `runComposeUiTest` cannot run on the Android host
  target, so a UI test there breaks `allTests`. Put the Desktop suite in `jvmTest` and mirror the
  instrumented one in `androidDeviceTest`.

## Fakes over mocks

```kotlin
// commonTest — a fake, not a mock
class FakeLogsRepository(
    private var result: Result<List<LogEntry>> = Result.success(emptyList()),
) : LogsRepository {
    var loadCount = 0
        private set

    fun returns(value: Result<List<LogEntry>>) { result = value }

    override suspend fun load(): Result<List<LogEntry>> {
        loadCount++
        return result
    }
}
```

## Testing an MVI ViewModel

The dispatcher is a constructor parameter (see `architecture.md`), so the test injects a test
dispatcher instead of mutating global state.

```kotlin
class LogsViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val repository = FakeLogsRepository()

    private fun viewModel() = LogsViewModel(repository, dispatcher, CoroutineExceptionHandler { _, _ -> })

    @Test
    fun should_expose_entries_when_load_succeeds() = runTest(dispatcher) {
        repository.returns(Result.success(listOf(logEntry())))
        val vm = viewModel()

        vm.onIntent(LogsIntent.Refresh)
        advanceUntilIdle()

        assertEquals(1, vm.state.value.entries.size)
        assertFalse(vm.state.value.isRefreshing)
    }
}
```

- Drive the ViewModel only through `onIntent` — that is its whole public surface.
- Assert on `state.value` after `advanceUntilIdle()`.
- A ViewModel test that needs `Dispatchers.Main` means the dispatcher was not injected — fix the
  ViewModel, not the test.

**Asserting an effect.** Await it with `async { … .first() }` started *before* the intent, and use
`runCurrent()` to let the collector subscribe:

```kotlin
@Test
fun should_emit_effect_when_detail_intent_received() = runTest(dispatcher) {
    val vm = viewModel()
    advanceUntilIdle()

    val effect = async { vm.effect.first() }
    runCurrent() // subscribe before emitting

    vm.onIntent(LogsIntent.OpenDetail("42"))
    advanceUntilIdle()

    assertEquals(LogsEffect.OpenDetail("42"), effect.await())
}
```

Do **not** assert effects with `backgroundScope.launch { vm.effect.collect { … } }` +
`advanceUntilIdle()`. The collector subscribes and the value is sent, but the collector is not
resumed before `advanceUntilIdle()` returns, so the list is still empty and the test fails for a
reason that has nothing to do with the code under test. For several effects in sequence, use
`async { vm.effect.take(n).toList() }` with the same `runCurrent()` placement.

## Network

Never mock the HTTP client. Use Ktor's `MockEngine` and assert against real serialization — that is
what catches a wrong DTO field name, which a mocked client never will.

```kotlin
fun mockApi(status: HttpStatusCode = HttpStatusCode.OK, body: String) = HttpClient(MockEngine { request ->
    respond(
        content = body,
        status = status,
        headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()),
    )
}) { install(ContentNegotiation) { json() } }
```

Keep the mock API and its fixtures in a `testkit` package, mirrored in each suite that needs it.

## Compose UI tests

- Desktop suite in `jvmTest`, runs headless as part of `allTests`.
- Android instrumented mirror in `androidDeviceTest`, runs on an emulator.
- Find nodes by semantics (test tag, content description, text) — never by index or position.
- An end-to-end test that boots the whole app freezes the clock (`autoAdvance = false`) so infinite
  animations do not stall it. On Android a paused clock is **not** advanced by `waitUntil`, so pump
  it explicitly with `mainClock.advanceTimeBy(...)`; the Desktop suite advances it for free. Getting
  this wrong produces a test that passes on Desktop and hangs on the emulator.

## Do / Don't

- DO test the failure paths — offline, unauthorized, empty — as typed states.
- DO name tests `should_doX_when_conditionY()`.
- DON'T unit test DI modules, generated resource accessors, or platform entry points.
- DON'T use `Thread.sleep` or `delay` to wait for a result; advance the test scheduler.
- DON'T add MockK to `commonTest` "just for this one test".

## Related rules

`common/testing.md` (approach, coverage, naming) · `architecture.md` · `feature-structure.md`
