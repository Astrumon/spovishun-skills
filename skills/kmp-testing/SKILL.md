# KMP Testing Skill

Writing tests in a Kotlin Multiplatform project: the test-first loop, Compose-test dispatching and
its two-schedulers trap, semantics-first selectors, choosing the smallest shape that proves a
behaviour, and keeping clocks and animations deterministic.

Source-set placement, the no-MockK-in-`commonTest` rule, the fake-over-mock shape, MVI ViewModel and
effect assertions, and `MockEngine` are normative — they live in `.claude/rules/kmp/testing.md`. This
skill implements against that rule and does not restate it.

## Supersedes `unit-testing-kotlin` in KMP projects

`unit-testing-kotlin` is gated `requires: [kotlin]`, so it installs here too, but it is written for a
JVM backend: JUnit 5, MockK, `mockk<UserRepository>()`, Kotest. None of that runs in `commonTest` —
MockK has no Kotlin/Native support, and one such import breaks the native compilation for the whole
module. In a KMP project use `kotlin.test` + `kotlinx-coroutines-test` and hand-written fakes; see
`.claude/rules/kmp/testing.md` for the source-set table. Its non-tooling advice — AAA structure,
naming, what not to test — still holds.

## Scope

**In scope**
- The RED-GREEN-REFACTOR loop and what counts as proof.
- Choosing the test shape: state-holder unit test, plain UI test, integration test, screenshot.
- Compose test dispatching, the test clock, and why a test passes on Desktop and hangs on Android.
- Node selectors and what they cost during refactors.
- Determinism: clocks, animations, image loading, random seeds.
- Diagnosing a flaky or hanging test.

**Out of scope — hand off, do not answer here**
- Which source set a test belongs in, MockK policy, fake shape → `.claude/rules/kmp/testing.md`
- Test dependencies per target, `allTests` wiring → **`kmp-multiplatform-specialist`**
- `MockEngine` handler setup and request assertions → **`ktor-client-kmp`**
- Overriding bindings / `checkModules()` → **`koin-kmp`**
- `runTest`, `Flow` operators, scope ownership in general → **`kotlin-specialist`**
- Backend (JVM-only) testing with JUnit 5 / MockK → **`unit-testing-kotlin`**

## Procedure

1. **Read the build files first.** The module's `build.gradle.kts` test source sets and
   `libs.versions.toml` — report which test artifacts each target actually has. `compose.uiTest`
   present or absent changes the answer.
2. **Read a neighbouring test** in the same source set and match its shape. Consistency beats a
   better idea applied to one file.
3. **Write the test and watch it fail** for the reason you expect, before writing the code.
4. **Verify.** Run the narrowest task (`:module:jvmTest`, `:module:allTests`) and report the real
   output — including which tests ran, not just that it was green.

## Test-first

- No production code without a failing test first. A behaviour you never watched fail is not proven —
  a test that passes before the change is testing something else.
- A bug is not fixed until a test that was **red because of that bug** is green. Reproduce first.
- The minimum to get to green, then refactor with the test as the safety net.

## Compose test dispatching

Compose tests run on a `StandardTestDispatcher`, matching `kotlinx.coroutines.test.runTest`. Work
queued by a `LaunchedEffect` therefore does **not** run eagerly: it waits for the scheduler to be
advanced. A test that sets content and immediately asserts sees the pre-effect state and fails with a
message that points at the assertion rather than the cause. Drain queued work explicitly before
asserting.

> **Package name.** Compose Multiplatform exposes this as
> `androidx.compose.ui.test.v2.runComposeUiTest`, with `@OptIn(ExperimentalTestApi::class)` — verified
> against Compose MP 1.11.1 in a consumer project. Android's own androidx artifact has no `v2`
> package; the upstream source this skill was adapted from states the Android form. Read the imports
> in a neighbouring test rather than assuming either.

**The two-schedulers trap.** A `TestDispatcher` installed as `Dispatchers.Main` and the dispatcher
`runTest { }` creates have **separate** `TestCoroutineScheduler`s. `advanceUntilIdle()` then flushes
only one of them, and the assertion races the ViewModel — intermittently, on a machine other than
yours. Pass the same dispatcher into both so they share one scheduler:

```kotlin
private val dispatcher = StandardTestDispatcher()

@Test
fun should_expose_entries_when_load_succeeds() = runTest(dispatcher) { … }
```

**Test clock vs wall clock.** For anything observable through Compose state, drive the test clock —
it is deterministic and instant:

```kotlin
mainClock.advanceTimeUntil(timeoutMillis = 1_000) { state.value == Loaded }
```

Use `waitUntil { … }` only for conditions Compose cannot see (a `Job` completing, an external
counter). Mixing both in one test is a reliable flake source.

**Paused clocks behave differently per platform.** With `mainClock.autoAdvance = false`, Desktop
advances the clock for `waitUntil` for free; Android does **not** — it must be pumped explicitly with
`mainClock.advanceTimeBy(...)`. This is the concrete mechanism behind the rule "a test that passes on
Desktop and hangs on the emulator".

## Selectors: semantics first

Priority order:

1. `onNodeWithText` — survives refactors and exercises what a user actually reads.
2. `onNodeWithContentDescription` — for icons and images that carry meaning.
3. Role and state matchers — `hasClickAction()`, `isSelected()`, `isEnabled()`, `isFocused()`.
4. `onNodeWithTag` — **only** when there is no stable user-visible text: identical rows in a list, a
   `Canvas`-drawn glyph that text queries cannot see, or copy that changes per locale.

A text assertion catches an accessibility regression; a tag assertion cannot, and breaks the moment
someone renames the tag. When a test must be locale-independent, prefer passing test-controlled
labels into the component over reaching for a tag.

## Callbacks are the contract

A composable's contract is "render this state, emit these callbacks". Assert exactly that — do not
route the assertion through a ViewModel:

```kotlin
@Test
fun should_emitId_when_rowClicked() = runComposeUiTest {
    var clicked: String? = null
    setContent { ArticleRow(article = Article(id = "42", title = "Hello"), onClick = { clicked = it }) }

    onNodeWithText("Hello").performClick()

    assertEquals("42", clicked)
}
```

## Choosing the shape

| Proving | Shape |
|---|---|
| Text rendered, loading/error branches, callback wiring | plain UI test — state in, callbacks out, no DI graph |
| A state holder updates correctly | state-holder unit test in `commonTest`, plus **one** wiring smoke test |
| Spacing, themed colour, typography, elevation — things semantics cannot express | screenshot test, one per meaningful state |
| Navigation, DI or lifecycle integration itself | integration test with the real graph |

Pick the smallest shape that can fail for the right reason. A full-graph test that proves a label is
rendered costs minutes of CI to catch what a plain UI test catches in milliseconds.

## Determinism

- **Animations:** set `mainClock.autoAdvance = false` **before** `setContent`. Otherwise an
  indeterminate animation trips the framework's infinite-animation policy, and a finite one completes
  in a single burst with no observable intermediate state. Then drive frames: `advanceTimeByFrame()`
  to kick off, `advanceTimeBy(durationMillis)` to land.
- **Clocks:** inject a fixed clock. A test that reads the current time fails at midnight, once.
- **Screenshots:** fixed state data — no current time, no random seed, no remote image URL in the
  screenshot path. A fake image loader for image-heavy screens. One shot per meaningful state
  (loading / error / empty / success), not one per element.
- **Never** `Thread.sleep` or `delay` to wait for a result. Advance the scheduler.

## Do NOT

- Do NOT put MockK, JUnit 5 or a Compose UI test in `commonTest`.
- Do NOT assert without draining queued effect work first.
- Do NOT let `runTest` and the main dispatcher use different schedulers.
- Do NOT reach for `onNodeWithTag` before checking whether stable text exists.
- Do NOT assert a composable's behaviour through a mocked ViewModel.
- Do NOT mix `mainClock.advanceTimeUntil` and `waitUntil` in one test.
- Do NOT write the test after the code and call it test-first.
- Do NOT report a suite green without saying which tests actually ran.

## Error handling

- **A test hangs on Android but passes on Desktop** → paused clock not being pumped. Add
  `mainClock.advanceTimeBy(...)`; do not raise the timeout.
- **A test passes alone and fails in the suite** → shared mutable state or two schedulers. Name which
  one before changing anything.
- **`runComposeUiTest` unresolved** → the target is missing `compose.uiTest`, or the test is in the
  wrong source set. Report which; hand the build wiring to **`kmp-multiplatform-specialist`**.
- **A native target fails to compile after a test was added** → a JVM-only test dependency reached
  `commonTest`. Name the import.
- **A test is flaky** → do not retry it. Find the nondeterminism (clock, scheduler, ordering,
  network) and say which it was.

## Example

> "The dashboard sometimes shows the spinner in the test even though the data loaded."

1. Read the test and the ViewModel; report which dispatcher each uses.
2. Check whether `runTest` receives the same `TestDispatcher` that is installed as `Dispatchers.Main`
   — separate schedulers are the usual cause of exactly this symptom.
3. Fix the wiring, not the assertion: `runTest(dispatcher)` with the shared instance.
4. Confirm the assertion is made after `advanceUntilIdle()`.
5. Run the suite 3× and report the output each time; a fix for a flake is unproven on one green run.

Expected outcome: the cause is named as a scheduler split, not "flaky", and the test is stable across
repeated runs.

## Related Skills

- `kmp-multiplatform-specialist` — test source sets, per-target test dependencies
- `ktor-client-kmp` — `MockEngine` request assertions
- `koin-kmp` — graph verification, overriding bindings in tests
- `compose-multiplatform` — the state and stability behaviour being tested
- `kotlin-specialist` — `runTest`, `Flow`, coroutine scope ownership
- `unit-testing-kotlin` — the JVM backend counterpart
