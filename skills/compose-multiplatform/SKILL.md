# Compose Multiplatform Skill

The mechanics of Compose Multiplatform UI: where state lives and how it is keyed, how the modifier
parameter forms a component's public contract, how lazy lists stay cheap, and why a composable
recomposes when it should skip.

Design-system boundaries, component contracts and theme usage are normative — see
`.claude/rules/kmp/uikit.md`. Screen composition, effect collection and the MVI wiring are in
`.claude/rules/kmp/feature-structure.md` and `.claude/rules/kmp/architecture.md`. This skill
implements against those rules; it does not restate them.

| If you need… | Read |
|---|---|
| `remember` keying, `derivedStateOf`, hoisting boundaries, cross-phase back-writing | `references/state-management.md` |
| The `modifier` parameter contract and chain ordering | `references/modifiers-and-layout.md` |
| `LazyColumn` keys, `contentType`, prefetch, the O(n²) trap | `references/lists-and-scrolling.md` |
| Stability classes, strong skipping, compiler reports, phase deferral | `references/performance-and-stability.md` |
| Gating stability in CI against a committed baseline; runtime recomposition counts on non-Android targets | `references/stability-baselines.md` |
| Where a component belongs and what its contract must be | `.claude/rules/kmp/uikit.md` |

Do not load a reference during discovery — open it when writing or diagnosing that specific thing.

## Scope

**In scope**
- State: `remember` and its keys, `rememberSaveable`, `derivedStateOf`, hoisting decisions.
- Effects: which one, keyed how, and what invalidates what.
- Modifier API contract, chain order, custom layout.
- Lazy list correctness and cost.
- Recomposition diagnosis: stability, strong skipping, phase.
- Gating stability against a committed baseline, and measuring recomposition at runtime.
- Compose Multiplatform specifics — what is Android-only and what runs in `commonMain`.

**Out of scope — hand off, do not answer here**
- Whether a component belongs in the design system → `.claude/rules/kmp/uikit.md`
- Screen/feature package layout, effect collection shape → `.claude/rules/kmp/feature-structure.md`
- ViewModel contract, `UiState`/`Intent`/`Effect` → `.claude/rules/kmp/architecture.md`
- Obtaining a ViewModel in a composable → **`koin-kmp`**
- Navigation and routes → `.claude/rules/kmp/navigation.md`
- Strings and resources → `.claude/rules/kmp/localization.md`
- Compose UI test authoring → **`kmp-testing`**
- Compose compiler Gradle wiring → **`kmp-multiplatform-specialist`**
- iOS-embedded views → **`kmp-ios-interop`**

## Procedure

1. **Read the surrounding code first** — the screen, its state holder, and one neighbouring component.
   Match the conventions already in use before introducing any.
2. **Name the axis before optimising.** A recomposition complaint is either a *stability* problem (the
   composable runs although inputs did not change) or a *phase* problem (a state read happened in
   composition that belonged in layout or draw). Applying the wrong fix costs time and adds noise.
3. **Change the smallest surface.** Prefer deriving over caching, hoisting over annotating.
4. **Verify.** Run the UI tests for the affected screen and report the real output.

## Composition, layout, draw

Three phases, in order. State written in a phase invalidates that phase and everything after it —
never before it. Almost every "jittery scroll", "ghost layout" or "recomposition loop" is a **backward
write**: layout or draw writing state that composition reads. The cure is a layout-phase API
(`Modifier.layout { }`, `Modifier.offset { }`, `Modifier.graphicsLayer { }`), not a `MutableState`
bridging the value back into composition. `references/state-management.md` has the shapes.

## Compose Multiplatform vs Android

Several things carried over from Android tutorials do not exist or do not behave the same in
`commonMain`:

| Android | Compose Multiplatform |
|---|---|
| `rememberSaveable` with `Bundle` / `@Parcelize` | `@Serializable` + a kotlinx-serialization-based `Saver` |
| `collectAsStateWithLifecycle()` | `collectAsState()` — it does **not** stop collecting in the background unless a lifecycle-aware variant is available in `commonMain` |
| `LocalConfiguration` | not available; use `BoxWithConstraints` or the window-size-class APIs |
| Layout Inspector, Macrobenchmark, Baseline Profiles | Android-only. Desktop profiles with JVM tooling; iOS with Instruments |
| `painterResource(R.drawable.x)` | Compose Resources `Res.drawable.x`, per-module — see `.claude/rules/kmp/localization.md` |

The stability and phase model itself is identical across platforms; only the tooling differs.

## Do NOT

- Do NOT add `@Immutable` / `@Stable` speculatively — under strong skipping, same-module classes with
  stable properties are inferred stable already, and a false promise produces stale UI.
- Do NOT `rememberSaveable` a runtime object (`LazyListState`, `FocusRequester`, a callback).
- Do NOT build `Flow` pipelines (`stateIn`, `combine`, `flatMapLatest`) inside a composable body.
- Do NOT run a scroll or animation suspend function from `viewModelScope`.
- Do NOT hardcode placement (`fillMaxWidth`, fixed height, outer padding) on a reusable component's
  root.
- Do NOT nest a scrolling container inside a lazy list item.
- Do NOT optimise without a measurement that names the axis.
- Do NOT reach for `derivedStateOf` when the block reads no Compose `State` — it is pure overhead.

## Error handling

- **"It recomposes too much" with no measurement** → say so, and ask for the recomposition counts or
  the compiler report first. Do not start annotating.
- **A composable is reported skippable but still recomposes** → the defect is at the **call site**, not
  the callee. Name the allocation (a fresh `List`, `Modifier` chain, or ad-hoc object per frame).
- **The fix would be an `@Immutable` on a type with mutable non-snapshot fields** → refuse and fix the
  type; that annotation causes silent stale UI.
- **The behaviour depends on Compose version** → read `libs.versions.toml` and say which version the
  answer assumes. Prefetch and cache-window APIs in particular moved recently.
- **"Gate stability in CI", or a red `stabilityCheck`** → `references/stability-baselines.md`. Do not
  hand this to `gradle-build-auditor` (it audits build structure, not Compose semantics) or to
  `ci-cd-pipeline-builder` (it writes the pipeline; the compile-before-check ordering and the plugin's
  Kotlin-version coupling are answered here).
- **The question is really about layering or where the component lives** → point at
  `.claude/rules/kmp/uikit.md` or `feature-structure.md` and stop.

## Example

> "The list stutters while scrolling and the row recomposes constantly."

1. Read the screen and the row component; report how `items` is keyed and what the row's parameters
   are.
2. Name the axis. Fresh lambda or list allocated per scroll → stability. Animated or scroll-derived
   value read in composition → phase.
3. Check the item factory for an `indexOf` call — an O(n) lookup per item is O(n²) per scroll pass and
   looks exactly like a recomposition problem.
4. Apply the one matching fix — stable `key` + `contentType`, `remember(item.id)` for the per-item
   lambda, or moving the read into `graphicsLayer { }`.
5. Re-measure and report the before/after numbers, not just "it feels smoother".

Expected outcome: one named cause, one fix, and a measurement that shows the change.

## Related Skills

- `kmp-multiplatform-specialist` — Compose compiler config, resources, source sets
- `kmp-testing` — Compose test dispatching, selectors, determinism
- `koin-kmp` — obtaining the ViewModel a screen renders
- `kotlin-specialist` — `Flow`, `StateFlow`, coroutine scope ownership
- `kmp-ios-interop` — embedding UIKit/SwiftUI inside Compose
- `new-feature` — scaffolding the screen this UI lives in
