# KMP Multiplatform Specialist Skill

The build and platform layer of a Kotlin Multiplatform / Compose Multiplatform project: source sets,
`expect`/`actual`, targets, the KMP Gradle DSL, Compose Resources, and per-platform engines.

Architecture, layering and the MVI contract live in `.claude/rules/kmp/architecture.md` — this skill
implements against those rules, it does not restate them. That rule is deliberately free of Kotlin;
the code it describes is here:

| If you need… | Read |
|---|---|
| The `MviViewModel` base class, a screen written against it, the typed-error `load()` helper, the `composeCompiler { }` and `stability.txt` wiring | `references/mvi-and-stability.md` |
| The AGP 9 `androidLibrary { }` DSL — what it has, what it dropped (`BuildConfig`, variants, kapt, NDK), and the `androidResources` trap | `references/agp9-kmp-library.md` |
| Navigation 3 wiring — keys and their `SerializersModule`, the navigator, feature entry builders, `NavDisplay` and its decorators, deriving the selected destination | `references/navigation-3.md` |
| Component architecture — the five infrastructure types, `MviViewModel` as the root owner, the Koin factory-function wiring, previewing and testing a component | `references/component-architecture.md` |
| The normative architecture, MVI and Compose-stability rules | `.claude/rules/kmp/architecture.md` |
| The normative navigation rules | `.claude/rules/kmp/navigation.md` |
| The normative rules for when a screen escalates to components | `.claude/rules/kmp/component-architecture.md` |

## Scope

**In scope**
- Source-set hierarchy and where a file belongs.
- `expect`/`actual` — whether to use it, where to put it, and what to use instead.
- Adding, removing or configuring a target (Android, iOS, JVM Desktop, Wasm).
- KMP Gradle DSL: `kotlin { }` blocks, source-set dependencies, version catalog wiring, convention
  plugins, `composeResources`, Compose compiler options.
- Platform-specific artifacts: HTTP engines, file paths, settings/preferences, platform APIs.
- Diagnosing multiplatform build failures (missing `actual`, wrong source set, JVM-only dependency
  pulled into `commonMain`).

**Out of scope — hand off, do not answer here**
- Coroutines, `Flow`, sealed classes, null safety, general idiomatic Kotlin → **`kotlin-specialist`**
- Koin module design, constructor injection, layer boundaries → **`dependency-injection-architecture`**
- Creating a feature module or a screen → **`new-feature`**
- Test framework choice per source set → `.claude/rules/kmp/testing.md`, then **`unit-testing-kotlin`**
- Compose UI composition, state hoisting, component design → `.claude/rules/kmp/uikit.md`

If the question is a general Kotlin or DI question that merely happens to be asked inside a KMP
project, say which skill owns it and stop.

## Procedure

1. **Read the build files first.** `gradle/libs.versions.toml`, root `build.gradle.kts`,
   `settings.gradle.kts`, the module's `build.gradle.kts`, and any convention plugins in
   `build-logic/`. Report actual versions from the catalog — never state a version from memory.
2. **Identify the target set** the project actually declares. Do not assume iOS exists.
3. **Answer or change against those facts**, reusing the catalog aliases and convention plugins that
   are already there.
4. **Verify.** Run the narrowest useful Gradle task (`:module:compileKotlin<Target>`,
   `:module:allTests`, or `./gradlew build`) and report the real output.

## Source sets

```
commonMain    shared code + every `expect` declaration
androidMain   actual — OkHttp engine, Android APIs
iosMain       actual — Darwin engine, iOS APIs
jvmMain       actual — CIO engine, Desktop APIs

commonTest    kotlin.test + coroutines-test (no MockK — it has no Kotlin/Native support)
jvmTest       Desktop Compose UI tests; MockK allowed
androidHostTest / androidDeviceTest / iosTest
```

- A dependency added to `commonMain` must exist for **every** declared target. A JVM-only library
  there fails the native compilation, often with a confusing "unresolved reference" in shared code.
- Intermediate source sets (e.g. a shared `nonAndroidMain`) are worth it only when two targets share
  a real implementation. Otherwise they add a hierarchy nobody reads.

## expect / actual

Prefer an interface in `commonMain` with a platform implementation supplied through DI. It is
testable, it does not force every target to declare an `actual` at once, and it keeps the platform
seam visible in the dependency graph.

Reach for `expect`/`actual` when there is genuinely one canonical per-platform answer and DI would
be ceremony — a factory, a constant, a single function.

```kotlin
// commonMain — data layer, leaf-level
expect fun httpClientEngine(): HttpClientEngineFactory<*>

// androidMain
actual fun httpClientEngine(): HttpClientEngineFactory<*> = OkHttp

// iosMain
actual fun httpClientEngine(): HttpClientEngineFactory<*> = Darwin

// jvmMain
actual fun httpClientEngine(): HttpClientEngineFactory<*> = CIO
```

Rules:
- The `actual` lives in the same layer as the `expect`. A platform engine belongs to `data`, never `ui`.
- Never an `expect class` that carries business logic — that logic then exists N times and drifts.
- Never an `expect` in `domain`: that layer stays platform-free.
- Adding a target means supplying every missing `actual` in the same change.

## Compose Resources

Each Gradle module generates its **own** `Res` class. Import the one from the module you are in; a
module cannot read another module's `Res`. Placement rules are in
`.claude/rules/kmp/localization.md`.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `Res.*` crashes at runtime, build stayed green | `androidResources { enable = true }` missing under AGP 9 `androidLibrary` | enable it — see `references/agp9-kmp-library.md` |
| An `android { }` option does not resolve | the module uses the AGP 9 KMP-library plugin, not `com.android.library` | `references/agp9-kmp-library.md` |
| Unresolved reference in shared code, only on iOS | JVM-only dependency in `commonMain` | move it to `jvmMain`/`androidMain`, or find a KMP alternative |
| "Expected declaration has no actual" | new target, or a new `expect` | add the `actual` to every declared target |
| `runComposeUiTest` fails on the Android host target | UI test placed in `commonTest` | move it to `jvmTest` + `androidDeviceTest` |
| Effects never arrive on Desktop | `Dispatchers.Main.immediate` unavailable | add `kotlinx-coroutines-swing` |
| Composable recomposes constantly | cross-module type is Unstable | `@Immutable`, or add it to `stability.txt` |

## Do NOT

- Do NOT add a dependency version inline when the version catalog exists — add a catalog entry.
- Do NOT add a target the project has not asked for, or answer as if iOS exists when it does not.
- Do NOT put an `expect` in `domain`, or an `actual` in a different layer than its `expect`.
- Do NOT put MockK or JUnit5 in `commonTest`.
- Do NOT restate architecture or MVI rules — reference `.claude/rules/kmp/architecture.md`.
- Do NOT apply `com.android.library` snippets to a module using the AGP 9 KMP-library plugin.
- Do NOT load a reference during discovery — only when writing that code.
- Do NOT edit generated artifacts or `build/` output.

## Error handling

- **Build files unreadable or the project is not KMP** → say so and stop. Do not answer from
  assumption about the layout.
- **A required version is not in the catalog** → report which one is missing and propose the catalog
  entry; do not silently hardcode it.
- **A Gradle task fails** → paste the real error and diagnose it. Never report success on a red build.
- **The question turns out to be a plain Kotlin or Koin question** → name the owning skill and stop.

## Example

> "Add an iOS target to the shared module."

1. Read `libs.versions.toml` and the module's `build.gradle.kts`; report the current target list.
2. Add `iosX64()`, `iosArm64()`, `iosSimulatorArm64()` with the project's existing framework config.
3. List every `expect` that now lacks an `actual`, create `iosMain` implementations (Ktor `Darwin`
   engine, iOS platform values).
4. Check `commonMain` dependencies for JVM-only artifacts and report anything that must move.
5. Run `./gradlew :shared:compileKotlinIosSimulatorArm64` and report the output.

Expected outcome: the iOS target compiles, and any dependency that had to move out of `commonMain`
is named explicitly in the summary.

## Related Skills

- `new-feature` — scaffolding a feature module pair
- `kotlin-specialist` — coroutines, Flow, sealed classes, idiomatic Kotlin
- `koin-kmp` — Koin modules, `platformModule`, layer boundaries in KMP
- `kmp-testing` — test source sets, Compose test dispatching
- `ktor-client-kmp` — the client the platform engines belong to
- `kmp-persistence` — storage libraries and per-target KSP wiring
- `compose-multiplatform` — Compose state, modifiers and stability
- `kmp-ios-interop` — the Kotlin↔Swift boundary once an iOS target exists
- `ci-cd-pipeline-builder` — building the multiplatform matrix in CI
