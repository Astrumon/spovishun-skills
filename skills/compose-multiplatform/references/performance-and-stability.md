# Compose Performance and Stability

Read this when a measurement says a composable recomposes more than it should — not before. Premature
stability annotations and speculative `remember` wrapping cost more than they save, and a wrong
annotation produces stale UI that is far harder to find than a wasted recomposition.

## Two axes — name one before fixing anything

| Axis | Symptom | Diagnose with | Fixes |
|---|---|---|---|
| **Stability** | the composable runs although its inputs did not change | compiler reports (`*_composables.txt`, `*_classes.txt`) | stable types, `@Immutable`/`@Stable`, `stabilityConfigurationFiles`, immutable collections |
| **Phase** | it runs because a state read happened in composition that belonged in layout or draw | recomposition counts | provider lambdas, `Modifier.offset { }`, `Modifier.graphicsLayer { }`, `derivedStateOf` |

The three phases: **composition** (runs composables; a state read here invalidates the whole scope),
**layout** (`measure`/`layout`; reads here do not trigger recomposition), **draw** (`DrawScope`).

Do not apply any of this when the recomposition tracks a real data change — that is correctness, not
cost.

## Strong skipping (default since Kotlin 2.0.20)

The old mental model — "no `skippable` in the report means it cannot skip" — is wrong now. Almost
everything is skippable. The rules that actually matter:

- **Stable parameters** compare with `equals()`. Two equal instances skip.
- **Unstable parameters** compare with `===`. The *same instance* skips; a new instance recomposes
  even when `equals()` would say they are equal.
- **Lambdas inside `@Composable` functions are auto-remembered** from their captures. `remember { { … } }`
  around an `onClick` is no longer needed.

So a composable the report calls skippable that still recomposes is almost always a **call-site**
problem: the parent allocates a fresh `List`, `Modifier` chain or ad-hoc object every frame. Fix the
allocation, not the callee.

Verify the toolchain first — read `libs.versions.toml`. On Kotlin older than 2.0.20 the legacy
diagnosis still applies, and the right answer is to plan the upgrade rather than work around it.

### Where auto-memoization does not reach

Only lambdas inside `@Composable` functions are memoized. These scopes are not composable, so each
allocates a fresh instance per parent recomposition:

| Scope | Why |
|---|---|
| `LazyListScope.items { … }` | `items` is a plain Kotlin extension |
| `Modifier.pointerInput(key) { … }` | a suspend lambda |
| `Modifier.drawBehind { }`, `drawWithCache { }`, `drawWithContent { }` | plain `DrawScope` lambdas |
| `object : Foo { … }` | anonymous object literal |

Hoist these to a stable reference — usually a method reference or a `remember`:

```kotlin
@Composable
fun ItemList(items: List<Item>, onItemClick: (Item) -> Unit) {
    LazyColumn {
        items(items, key = { it.id }) { item ->
            // this lambda IS inside a @Composable item block, so it is memoized
            ItemRow(item, onClick = { onItemClick(item) })
        }
    }
}
```

### Inline layouts are never skippable

`Row`, `Column`, `Box` and the other inline-marked composables are not restartable or skippable.
Wrapping a `Row` "so it skips" does nothing — the compiler inlines its body into the parent's
recomposition scope. The fix for a wasteful `Row` body is making the **parent** skippable.

## The five stability classifications

The report emits five, not two — and `runtime stable` is **not** a defect:

| Classification | Meaning | Skipping |
|---|---|---|
| **Certain (stable)** | every property known stable at compile time | `equals()` |
| **Runtime (stable)** | depends on an inner type the compiler defers; a per-instance `$stable: Int` field is checked at runtime | `equals()` if the check passes, else `===` |
| **Unknown** | interface-typed parameter, concrete implementation not visible | `===` |
| **Parameter** | a generic type parameter | resolved per call site |
| **Unstable** | proven unstable — a mutable field outside snapshots | never skips |

The common mistake is annotating **runtime stable** away. If its runtime check produces too many false
negatives, the right diagnostic is the *inner* type, not an annotation on the wrapper.

## `@Immutable` vs `@Stable`

- **`@Immutable`** — every property is effectively immutable and `equals()` describes all observable
  state. The stronger promise; allows the most aggressive skipping.
- **`@Stable`** — the type's mutable state is observable to Compose (typically through
  `MutableState`). You promise that *any* observable change is flagged through a snapshot. Correct for
  state holders and snapshot-backed types.

Never annotate to silence a report. A false promise produces **skipped recompositions and stale UI** —
silent, intermittent, and hard to reproduce. Never `@Stable` on a data class with mutable
non-snapshot fields.

Under strong skipping, same-module classes whose properties are all stable are inferred stable
automatically. Reach for an annotation only when inference cannot see the type — across a module
boundary, or through a generic wrapper — and only when the contract genuinely holds.

## Cross-module stability

The compiler cannot infer stability for types from other modules or libraries
(`kotlinx.datetime.Instant`, `BigDecimal`, and friends). Declare them in one reviewable file:

```kotlin
// build.gradle.kts
composeCompiler {
    stabilityConfigurationFiles.add(
        isolated.rootProject.projectDirectory.file("compose_stability.conf")
    )
}
```

**`isolated.rootProject`, not `rootProject.layout`.** The latter reads another project's mutable state
and fails under Gradle Isolated Projects (incubating since 9.7) with *"Project ':app' cannot access
'Project.layout' functionality on another project ':'"*. `layout.settingsDirectory` also works on
Gradle 8.13+. A file inside the module itself needs neither — plain `layout.projectDirectory`.

```
# compose_stability.conf
// lines starting with // are comments
kotlinx.datetime.Instant
com.example.generated.*      // * matches one package segment
com.example.models.**        // ** matches across package boundaries
```

Safer than scattered `@Suppress`; more dangerous than an annotation, because nothing checks the claim.
List only types you are willing to promise are immutable — never anything backed by mutable state.

## Compiler reports

Generate them on demand, not on every build:

```kotlin
composeCompiler {
    if (project.findProperty("composeReports") == "true") {
        reportsDestination = layout.buildDirectory.dir("compose_reports")
        metricsDestination = layout.buildDirectory.dir("compose_metrics")
    }
}
```

Run with `-PcomposeReports=true`. What the files say:

- **`*_composables.txt`** — per composable: `restartable skippable fun MyComponent(name: String, …)`.
- **`*_classes.txt`** — per class: `stable class User { stable val name: String }`.
- **`*-composables.csv`** — programmatic. When computing a module-wide `skippable%`, **filter out rows
  where `isLambda == "1"`**: zero-argument lambdas cannot skip structurally, so they drag the number
  down even when every named composable is skippable.

The reports are a snapshot on demand, not a gate — nothing fails when a type regresses between
releases, and they say nothing about how often a composable actually ran. For a committed baseline, a
build-failing check and runtime recomposition counts on targets that have no Layout Inspector, see
`stability-baselines.md`.

## Deferring reads to a later phase

Reading state in composition triggers recomposition. Push the read later:

```kotlin
// BAD — read in composition; recomposes on every offset change
val x = offsetX.value
Box(Modifier.offset(x.dp, 0.dp))

// GOOD — read deferred to the layout phase
Box(Modifier.offset { IntOffset(offsetX.value.toInt(), 0) })
```

**Across a composable boundary, pass a provider lambda, not a value.** Reading at the call site
recomposes the parent on every change:

```kotlin
// WRONG — the snapshot value crosses the boundary; the parent recomposes every frame
@Composable fun HomeScreen(scrollOffset: Int) { HeroImage(scrollOffset) }

// RIGHT — the provider crosses; HeroImage reads inside the draw phase
@Composable fun HomeScreen(scrollOffset: () -> Int) { HeroImage(scrollOffset) }

@Composable
fun HeroImage(scrollOffset: () -> Int) {
    Image(
        painter = painterResource(Res.drawable.hero),
        contentDescription = null,
        modifier = Modifier.graphicsLayer { translationY = -scrollOffset() / 2f },
    )
}
```

**The `by` delegate is the smell.** `val offset by scrollOffsetState` unwraps the snapshot at the read
site; once unwrapped, the only remaining fix is re-wrapping it.

Deferral sites, cheapest last-phase first: `Modifier.graphicsLayer { }` (draw — translation, rotation,
alpha, no relayout) · `Modifier.offset { }` / `Modifier.layout { }` (layout) · `drawBehind` /
`drawWithCache` / `drawWithContent` (draw).

## `remember` keys and configuration

If a `remember { }` body reads something that changes with the window — size class, density, layout
direction — that value **must** be in the key list, or the cached result silently goes stale on
rotation, a font-scale change, a foldable posture change, or an RTL flip.

```kotlin
// WRONG — cached at first composition, wrong forever after
val columns = remember { if (windowWidthDp >= 840) 3 else if (windowWidthDp >= 600) 2 else 1 }

// RIGHT
val columns = remember(windowWidthDp) { if (windowWidthDp >= 840) 3 else if (windowWidthDp >= 600) 2 else 1 }
```

## Subcomposition

`SubcomposeLayout`, `BoxWithConstraints` and `Scaffold` run a composition pass **during the measure
phase**. Powerful when needed, expensive when stacked.

The worst shape is `BoxWithConstraints` inside a lazy item — every visible item subcomposes during
measurement, on every scroll. Hoist the constraint decision to the screen:

```kotlin
// RIGHT — subcomposed once per screen size, plain conditional per item
BoxWithConstraints {
    val compact = maxWidth < 320.dp
    LazyColumn {
        items(items, key = { it.id }) { item -> if (compact) CompactRow(item) else WideRow(item) }
    }
}
```

`Scaffold` is also a `SubcomposeLayout`. Nesting one inside another's content slot doubles the work
and produces inset bugs that look like spacing-arithmetic errors. One `Scaffold` per route; build
nested sections from `Column` + a top bar.

## Symptom → diagnosis → fix

| Symptom | Diagnosis | Fix |
|---|---|---|
| Skips poorly despite strong skipping | a new unstable instance per recomposition | remember, hoist, or make the type stable |
| A draw block recomposes every frame | the value was read before the draw block | move the read inside; use a provider lambda across boundaries |
| Regression after adding a field to a data class | the new cross-module type is unstable | `stabilityConfigurationFiles`, or annotate if the contract holds |
| A lazy item recomposes on every scroll | a lambda captured from the parent | `remember(item.id)`, or hoist the source out of the item |
| An animation recomposes per frame | the animated state is read in composition | read inside `graphicsLayer { }` or `offset { }` |

## Compose Multiplatform note

The stability and phase model, and every fix above, are identical on all platforms — the composable
logic is shared. Only the **tooling** differs: Layout Inspector, Macrobenchmark and Baseline Profiles
are Android-only. On Desktop profile with JVM tooling, on iOS with Instruments. Never claim a
measurement from a tool the target platform does not have.
