# New Feature Skill

Scaffolds a feature for a Kotlin Multiplatform / Compose Multiplatform project as an `api` + `impl`
Gradle module pair, wired into the nav graph and DI.

Before generating, read `.claude/rules/kmp/feature-structure.md` (layout),
`.claude/rules/kmp/architecture.md` (MVI contract, error handling),
`.claude/rules/kmp/navigation.md` and `.claude/rules/kmp/localization.md`. If an existing feature is
already in the repo, read it and match it exactly — the rules describe the shape, the existing
feature is the ground truth for this project's package names and Gradle conventions.

## When NOT to use this skill

This skill writes files. It runs only when the user wants a feature **scaffolded** and has a name for
it. If they are still deciding what to build, hand off and stop:

- Exploring what the feature should be → `idea-brainstormer`
- Choosing an approach or comparing designs → `solution-designer`
- Splitting a feature into tasks → `task-decomposer`
- Only asking how KMP source sets or `expect`/`actual` work → `kmp-multiplatform-specialist`

## Inputs

- **Feature name** in PascalCase (`Logs`, `Settings`, `OrderDetail`). The module path is the
  lowercase name (`feature/logs/`), the package is the lowercase name.
- If the user gave no name, ask for it and stop until provided. Do not invent one.

## Mode

Decide before writing anything:

- **New feature** (default) — create the `api` + `impl` module pair.
- **Extra screen in an existing feature** — the user named a feature that already exists. Create only
  the screen package inside that feature's `impl`, plus its route in that feature's `api`, its Koin
  registration and its test. Create **no** new Gradle modules, edit **no** `settings.gradle.kts`.

If it is ambiguous which mode applies, ask. Do not guess.

## Procedure

1. **Confirm scope.** Restate the feature name, the mode, and the exact list of files you will create
   or edit. Wait for confirmation. Create nothing outside that list.

2. **Locate the conventions.** Read `settings.gradle.kts`, `gradle/libs.versions.toml`, one existing
   `feature/*/impl/build.gradle.kts` (if any) and `composeApp` DI + nav files. Reuse the project's
   existing plugin aliases, convention plugins and version-catalog entries. Never introduce a new
   dependency or a hardcoded version when the catalog already has one. If the project has no feature
   module yet, say so and derive the build files from `composeApp` — do not copy them blindly.

3. **Create `feature/<name>/api`** (new-feature mode only):
   - `build.gradle.kts` — KMP + serialization only. No Compose, no Koin, no Ktor.
   - `<Name>Key.kt` — `@Serializable @Keep data object <Name>Key : NavKey` (or a `data class` when
     the screen takes arguments). Both annotations are required: R8 reaches keys reflectively and
     drops an unmarked one in release builds only.
   - The feature's `SerializersModule` contribution —
     `polymorphic(NavKey::class) { subclass(<Name>Key::class, <Name>Key.serializer()) }`. Without it
     the back stack does not restore on iOS, desktop or web; Android is the only target that can
     fall back to reflection, so omitting it passes every Android test.
   - Nothing else goes in `api`.
   - **Navigation 2 project** (the repo uses `NavHost` / `navigation-compose` 2.x): name the file
     `<Name>Route.kt`, write `@Serializable @Keep data object <Name>Route` with no `NavKey`
     supertype and no `SerializersModule`, and add a `fun NavController.navigateTo<Name>(...)`
     extension. Match what step 2 found — never introduce Nav 3 into a Nav 2 project.

4. **Create `feature/<name>/impl`** (new-feature mode only):
   - `build.gradle.kts` — depends on `feature/<name>/api`, `core/designsystem` and whatever `core/*`
     it needs; Compose Multiplatform, Koin, ViewModel, coroutines.
   - Declare the resources package explicitly, or every generated import will be wrong — the default
     is derived from the root project name and the module path, not from your Kotlin package:
     ```kotlin
     compose.resources {
         packageOfResClass = "<pkg>.feature.<name>.impl.generated.resources"
     }
     ```

5. **Write the screen package** under `impl/src/commonMain/kotlin/<pkg>/feature/<name>/ui/`:
   - `<Name>UiState.kt` — one `@Immutable data class` plus its sealed status/error types. No Compose
     imports beyond the stability annotation.
   - `<Name>Intent.kt` — `sealed interface <Name>Intent` covering every user action.
   - `<Name>Effect.kt` — `sealed interface <Name>Effect` for one-shot outcomes only (navigation,
     transient messages). Omit the file entirely if the screen has none; do not create an empty type.
   - `<Name>ViewModel.kt` — extends the project's `MviViewModel<State, Intent, Effect>` base. If the
     project has no base class yet, create it once in `core/` exactly as specified in
     `architecture.md` and say so in your summary. Constructor takes its dependencies plus the
     injected dispatcher and `CoroutineExceptionHandler`. Implements `onIntent` with an exhaustive
     `when`. No public method other than `onIntent`.
   - `<Name>Screen.kt` — `<Name>Route` (resolves the ViewModel with `koinViewModel()`, collects state
     with `collectAsStateWithLifecycle`, collects effects lifecycle-aware) plus a stateless
     `<Name>Screen(state, onIntent)` that only `when`-dispatches to `viewcomponents/`.
   - `viewcomponents/` — one `internal` composable per file, stateless and hoisted. At minimum a
     loading, an error and a content view. Light + dark `@Preview` next to each non-trivial view.

6. **Write the domain and data layers** under `impl/src/commonMain/kotlin/<pkg>/feature/<name>/`
   only for what the screen actually needs:
   - `domain/model/`, `domain/repository/<Name>Repository.kt` (interface).
   - `data/<Name>RepositoryImpl.kt`, `data/remote/dto/` with the DTO→model mapping at the boundary.
   - Add a UseCase **only** if the escalation trigger in `architecture.md` applies. A pass-through
     UseCase is a violation, not a placeholder.

7. **Add strings** to `impl/src/commonMain/composeResources/values/strings.xml` and to every other
   locale folder the project ships (e.g. `values-uk/`). Every user-facing string goes here — no
   literal in a composable. Error text stays a sealed type mapped to a resource by a `@Composable`
   label function at the screen root.

8. **Register DI** — `impl/.../di/<Name>Module.kt`:
   ```kotlin
   val <name>Module = module {
       // constructor DSL: bind<T>() inside the lambda, from org.koin.core.module.dsl
       singleOf(::<Name>RepositoryImpl) { bind<<Name>Repository>() }
       viewModelOf(::<Name>ViewModel)
       // Nav 3: the feature contributes its entry builder here, so composeApp never names it.
       single<EntryProviderInstaller>(named("<name>")) { { <name>Entries(get()) } }
   }
   ```
   Then add `<name>Module` to the aggregated module list in `composeApp`. Plain Koin DSL — do not
   introduce Koin Annotations or KSP.

9. **Wire navigation** — the feature owns its entries; `composeApp` composes features, not screens.
   Write `fun EntryProviderScope<NavKey>.<name>Entries(navigator: Navigator)` in
   `impl/.../ui/<Name>Navigation.kt` with one `entry<<Name>Key> { }` per screen of this feature,
   passing navigation lambdas down. Adding a screen must not require an edit to `composeApp` — if it
   does, the graph has become a switchboard (see `navigation.md`). If it is a top-level destination,
   register it in the destination list and add its label to every locale file.

   **Navigation 2 project:** the same shape one level down — write
   `fun NavGraphBuilder.<name>Graph(...)` with `composable<<Name>Route> { }` entries and call it from
   the existing `NavHost`. Never create a second `NavHost` or a second `NavDisplay`.

   Either way: do not add a `selectedDestination` field, a navigation state holder, or an effect that
   mirrors a stored selection onto the back stack. Selection is derived from the back stack.

10. **Register the modules** (new-feature mode only) — add
    `include(":feature:<name>:api")` and `include(":feature:<name>:impl")` to `settings.gradle.kts`,
    and add the `impl` dependency to `composeApp/build.gradle.kts`.

11. **Add the test** — `impl/src/commonTest/.../<Name>ViewModelTest.kt`: hand-written fakes (no
    MockK in `commonTest`), injected test dispatcher, `runTest`, `advanceUntilIdle`, driven only
    through `onIntent`. Cover the success path and each error branch.

12. **Build and verify** — run the project's build and test commands (typically
    `./gradlew build` and `./gradlew :feature:<name>:impl:allTests`). Report the real output. Fix
    compile and test failures before finishing.

## Do NOT

- Do NOT put anything except the destination key and its `SerializersModule` contribution (Nav 2:
  the route and its navigation extension) in `feature/<name>/api`.
- Do NOT store the selected destination anywhere. It is derived from the back stack.
- Do NOT make one feature's `impl` depend on another feature's `impl`.
- Do NOT expose `MutableStateFlow`, the raw effect `Channel`, or any public method besides
  `onIntent` from the ViewModel.
- Do NOT use `MutableSharedFlow` for effects, or swallow exceptions in an empty `catch`.
- Do NOT add a dependency that is not in the version catalog without telling the user first.
- Do NOT touch files outside the confirmed list — no drive-by refactors of existing features.
- Do NOT commit. Leave that to the user or the `commit` / `finish-task` skills.

## Error handling

- **Feature name missing or not PascalCase** → ask for it and stop.
- **Module path already exists** → stop and report. Ask whether the user meant the extra-screen mode.
- **No `settings.gradle.kts`, or the project is not KMP** → stop and report; this skill does not
  bootstrap a project.
- **The project has no `core/designsystem` or no MVI base class** → say exactly what is missing and
  what you propose to create, then wait. Do not silently invent a parallel convention.
- **Build or tests fail** → report the actual error output. Never claim success on a red build.

## Example

`/new-feature Logs` on a project whose package is `com.example.app` creates:

```
settings.gradle.kts                       + include(":feature:logs:api"), (":feature:logs:impl")
feature/logs/api/build.gradle.kts
feature/logs/api/src/commonMain/kotlin/com/example/app/feature/logs/api/LogsKey.kt
feature/logs/impl/build.gradle.kts
feature/logs/impl/src/commonMain/kotlin/com/example/app/feature/logs/
  ui/LogsScreen.kt  ui/LogsViewModel.kt  ui/LogsUiState.kt  ui/LogsIntent.kt  ui/LogsEffect.kt
  ui/LogsNavigation.kt
  ui/viewcomponents/LogsLoading.kt  LogsErrorState.kt  LogsContent.kt
  domain/model/LogEntry.kt  domain/repository/LogsRepository.kt
  data/LogsRepositoryImpl.kt
  di/LogsModule.kt
feature/logs/impl/src/commonMain/composeResources/values/strings.xml
feature/logs/impl/src/commonMain/composeResources/values-uk/strings.xml
feature/logs/impl/src/commonTest/kotlin/com/example/app/feature/logs/ui/LogsViewModelTest.kt
composeApp/…                              + composable<LogsRoute> entry, + logsModule
```

Expected outcome: `./gradlew build` succeeds and `:feature:logs:impl:allTests` passes with the new
ViewModel test green.

## Related Skills

- `kmp-multiplatform-specialist` — `expect`/`actual`, source sets, target configuration, KMP Gradle DSL
- `kotlin-specialist` — coroutines, Flow, sealed classes, idiomatic Kotlin
- `dependency-injection-architecture` — Koin fundamentals and layer boundaries
- `unit-testing-kotlin` — general Kotlin testing practice
- `commit` / `finish-task` — committing the result
