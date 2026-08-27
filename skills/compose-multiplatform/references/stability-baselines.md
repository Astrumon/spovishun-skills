# Stability Baselines and Runtime Tracing

Two things the Compose compiler alone does not give you: a **regression gate** — nothing stops a `val`
→ `var` from destabilising a screen between releases — and a **runtime measurement outside Android**,
because Layout Inspector, Macrobenchmark and Baseline Profiles do not exist on iOS, Desktop or Wasm.

[skydoves/compose-stability-analyzer](https://github.com/skydoves/compose-stability-analyzer) covers
both from `commonMain`. It is a Kotlin compiler plugin plus a multiplatform runtime, Apache-2.0, and
still pre-1.0.

Read `performance-and-stability.md` first — the stability model, the five classifications and the
call-site rule live there and are not repeated here. This file is only about the tooling.

## Before recommending it at all

- **It is opt-in.** Nothing in this skill requires it. Propose it when the project already applies it,
  or when a team explicitly wants stability gated. Never as the answer to an unmeasured "it recomposes
  too much" — that still gets the existing answer: ask for the counts or the compiler report first.
- **It pins the Kotlin version exactly.** The compiler plugin extends Kotlin compiler internals, so a
  mismatch fails the build with `This version of the Compose Stability Analyzer compiler plugin
  requires Kotlin version X.X.X but you are using Y.Y.Y`.

  | Analyzer | Kotlin |
  |---|---|
  | 0.13.0 | 2.4.10 |
  | 0.9.0 – 0.12.0 | 2.4.0 |
  | 0.7.5 – 0.8.0 | 2.3.21 |
  | 0.7.4 | 2.3.20 |
  | 0.6.5 – 0.7.0 | 2.3.0 |
  | 0.4.0 – 0.6.4 | 2.2.21 |

  Read `gradle/libs.versions.toml` and name the project's actual Kotlin version before proposing a
  plugin version. Never state one from memory — this table moves every Kotlin release.
- **`org.jetbrains.kotlin.plugin.compose` must be applied to the same module.** Without it there are
  no composables to analyse.

## Setup

```toml
# gradle/libs.versions.toml
[plugins]
stability-analyzer = { id = "com.github.skydoves.compose.stability.analyzer", version = "0.13.0" }
```

```kotlin
// root build.gradle.kts
plugins { alias(libs.plugins.stability.analyzer) apply false }

// the shared / app module
plugins { alias(libs.plugins.stability.analyzer) }
```

In a KMP module the plugin detects the Kotlin Multiplatform plugin and adds
`com.github.skydoves:compose-stability-runtime` to `commonMain` itself — do not declare it by hand.

## The baseline gate

```bash
./gradlew :shared:compileKotlinJvm    # compile first — both tasks read compiled output
./gradlew :shared:stabilityDump       # writes shared/stability/shared.stability
```

The `.stability` file is written to be read in review, and it is **committed**:

```
@Composable
public fun com.example.UserCard(user: com.example.User): kotlin.Unit
  skippable: true
  restartable: true
  params:
    - user: STABLE (marked @Stable or @Immutable)
```

`stabilityCheck` diffs the current compilation against it and fails the build on a difference:

```
~ com.example.UserCard(user): stability changed from STABLE to UNSTABLE
```

| Symbol | Meaning |
|---|---|
| `~` | stability regressed — the one that matters |
| `+` | new composable, absent from the baseline |
| `-` | composable removed |

Re-baselining is deliberate: run `stabilityDump` again, then commit the diff with the reason. That
turns a regression into a documented decision in git history instead of an accident. One `.stability`
per module, updated independently.

## Configuration worth knowing

```kotlin
composeStabilityAnalyzer {
    stabilityValidation {
        failOnStabilityChange.set(System.getenv("CI") == "true")
        ignoreNonRegressiveChanges.set(true)
        ignoredPackages.set(listOf("com.example.internal"))
        ignoredProjects.set(listOf("benchmarks"))
    }
}
```

| Option | Why you would set it |
|---|---|
| `failOnStabilityChange` | Strict on CI, warning-only locally — the adoption path for a codebase with a backlog of unstable types |
| `ignoreNonRegressiveChanges` | Report only `~`, drop `+` and `-`. Worth it where composables are added and removed constantly |
| `ignoredPackages` / `ignoredClasses` / `ignoredProjects` | Keep generated, benchmark and sample code out of the baseline |
| `allowMissingBaseline` | Off by default; leaving it off is what makes a deleted baseline fail loudly |
| `allowIncrementalDisabling` | On by default. Kotlin's incremental compiler can skip a recompile whose stability nevertheless changed (`val` → `var` is binary-compatible), so the plugin turns incremental off for the project whose stability task is in the graph. Setting it `false` trades accuracy for build time |

`@IgnoreStabilityReport` excludes a composable from both the dump and the check — the right place for
preview bodies and debug-only screens.

Stability configuration files are wired at the **top level**, not inside `stabilityValidation` (that
one is deprecated), and take the same file the Compose compiler reads. Syntax and the
`isolated.rootProject` requirement are in the cross-module section of `performance-and-stability.md`:

```kotlin
composeStabilityAnalyzer {
    stabilityConfigurationFiles.add(isolated.rootProject.projectDirectory.file("stability.txt"))
}
```

## CI

The check reads compiled output, so compilation must be ordered before it — in one job, or through a
job dependency, but never as two independent jobs:

```yaml
- name: Compile
  run: ./gradlew :shared:compileKotlinJvm
- name: Stability check
  run: ./gradlew stabilityCheck
```

With `failOnStabilityChange.set(System.getenv("CI") == "true")` the same build warns locally and fails
on CI, because GitHub Actions, GitLab CI and CircleCI all export `CI=true`.

## Runtime tracing

```kotlin
@TraceRecomposition(tag = "product-card", threshold = 3, traceStates = true)
@Composable
fun ProductCard(product: Product, onClick: () -> Unit) { /* … */ }
```

- `tag` — filters the log. Name it after the feature (`checkout-item`), never `card1`.
- `threshold` — logging starts after N recompositions. `3` filters out the one or two recompositions
  every composable does during initial layout; use `10`–`20` inside a lazy list or an animated screen.
- `traceStates` — off by default. Turn it on only when the `[param]` lines show nothing changed, which
  means an internal state or a `CompositionLocal` caused the recomposition. It tracks **delegated**
  state only (`var x by remember { mutableStateOf(…) }`, the primitive variants, `derivedStateOf`);
  `val x = mutableStateOf(…)` is not tracked.

Nothing is logged until the runtime is switched on, once, in shared init:

```kotlin
ComposeStabilityAnalyzer.setEnabled(isDebugBuild)
```

Reading a line:

```
[Recomposition #5] ProductList (tag: products) (3.40ms) (fq: com.example.ProductList)
  ├─ [param] title: String stable (Products)
  ├─ [param] count: Int changed (4 → 5)
  ├─ [param] items: List<Product> unstable (List@abc)
  └─ Unstable parameters: [items]
```

`changed` is the **reason** this recomposition happened. `unstable` is a latent cost that forces
recomposition regardless of whether the value changed — a separate finding, and usually the one worth
fixing. `(3.40ms)` is the body's execution time, which separates "recomposes often" from "recomposes
expensively".

## What each target actually supports

| | Android | JVM | iOS / macOS / Linux / Windows | JS / Wasm |
|---|:---:|:---:|:---:|:---:|
| Stability analysis and the `.stability` baseline | ✓ | ✓ | ✓ | ✓ |
| `@TraceRecomposition` params, tags, thresholds | ✓ | ✓ | ✓ (0.12.0+) | ✓ (0.12.0+) |
| Recomposition duration in the log header | ✓ | ✓ | ✓ (0.12.0+) | ✓ (0.12.0+) |
| State write site — `← onClick (Screen.kt:42)` | ✓ | ✓ | ✗ | ✗ |
| Live heatmap, Reality Check, measured Doctor scores | ✓ | ✗ | ✗ | ✗ |

Write-site attribution needs Compose's Snapshot write observer, which is wired on Android and JVM
only. The IDE plugin's live features read the log off a device over ADB, which means Android. Logs go
to Logcat on Android, stdout on JVM, native and wasmJs, and the console on JS — the line format is
identical everywhere, so one parser covers all of them.

## Two KMP traps

- **`traceAll { variants = listOf("debug") }` does not protect a release build off Android.** Every
  non-Android compilation is named `main`, and `main` is always instrumented; `variants` only matches
  Android's variant names. `ComposeStabilityAnalyzer.setEnabled(false)` is the only switch that works
  there, and on targets with no `BuildConfig.DEBUG` equivalent you have to supply the flag yourself.
- **The baseline comes from one compilation, not a merge across targets.** `commonMain` composables
  are analysed identically per target, so this is invisible for most modules. A platform source set
  that declares its own composables appears in the baseline only when that target's compilation is the
  one the task read — delete `build/stability` and compile only the target you want described.

Task naming follows the same split: a KMP module without `androidTarget` gets one `stabilityDump` and
one `stabilityCheck`; with `androidTarget` it also gets `debugStabilityDump`, `releaseStabilityCheck`
and the rest of the variant-specific pairs.

## Do NOT

- Do NOT propose adopting the plugin *instead of* taking a measurement — it is the measurement, but
  only once the recomposition complaint has been reproduced.
- Do NOT enable `traceAll` for a release build, on any target.
- Do NOT claim a heatmap, a Reality Check or a state write site on a non-Android target.
- Do NOT re-baseline to make a red `stabilityCheck` go away. `~` means a type got worse; fix the type,
  or record in the commit message why the regression is accepted.
- Do NOT quote a plugin version without reading `libs.versions.toml` — the Kotlin coupling is exact.
