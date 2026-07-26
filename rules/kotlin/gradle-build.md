# Gradle Build Rules

Applies whenever a build file is written or edited: `settings.gradle.kts`, any module
`build.gradle.kts`, `gradle/libs.versions.toml`, `gradle.properties`, `gradle-wrapper.properties`,
`buildSrc/`, `build-logic/`.

## Build language
- Write build logic in **Kotlin DSL** — `.gradle.kts`, never a Groovy `.gradle` file
- Why: typed accessors, IDE completion and refactoring; Groovy build scripts fail at runtime, Kotlin ones at compile time
- Converting a module? Convert the whole file — a half-migrated build has neither DSL's tooling

## Wrapper
- Always build through `./gradlew`, never a locally installed `gradle`
- Keep the wrapper on the **latest minor** of its major line
- Upgrade with `./gradlew wrapper --gradle-version=X.Y` — never hand-edit `distributionUrl`, it leaves the checksum stale
- Why: minors are backwards-compatible and carry the performance and correctness fixes for free
- Keep `distributionSha256Sum` in `gradle-wrapper.properties` — an unverified wrapper JAR is arbitrary code in CI

## Plugins
- Apply plugins in the `plugins {}` block: `alias(libs.plugins.kotlin.jvm)`
- NEVER use `buildscript { classpath(...) }` + `apply(plugin = "…")` — the legacy path
- Why: only `plugins {}` gives typed extension accessors and lets Gradle resolve plugin versions consistently across modules
- Declare a plugin version once (root or catalog); sub-modules apply it with `apply false` inherited from the root

## Dependencies
- NEVER declare `kotlin-stdlib` explicitly — the Kotlin plugin adds the matching version itself
- Why: an explicit stdlib pin drifts from the compiler version and produces confusing resolution conflicts
- Use `implementation` by default; `api` only when a type genuinely leaks through your public API
- No dynamic versions (`1.+`, `latest.release`) and no snapshots in a release build — they make builds unreproducible

## Version catalog
- Every version lives in `gradle/libs.versions.toml` — `[versions]`, `[libraries]`, `[plugins]`, `[bundles]`
- NEVER hardcode a coordinate string like `"group:artifact:1.2.3"` in a `dependencies {}` block
- Reference via the generated accessor: `implementation(libs.kotlinx.coroutines.core)` (`-` in the TOML key becomes `.`)
- Why: one place to bump a version, and the catalog is shared by every module including `build-logic`

## Repositories
- Declare repositories **once**, in `settings.gradle.kts` under `dependencyResolutionManagement`
- Set `repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)` so a stray module-level `repositories {}` fails the build instead of being silently ignored
- NEVER put a `repositories {}` block in a module `build.gradle.kts`
- Why: per-module repositories change resolution order per module — the same coordinate can resolve to different artifacts

## Build structure
- Split into modules with `include(":core", ":feature-x")` instead of one project holding many `srcDir(...)` entries
- Why: modules are the unit of parallelism, of up-to-date checks and of the configuration cache — extra source dirs in one project are none of those
- A module boundary should follow a dependency boundary, not a folder preference

## Convention plugins
- Shared configuration goes into a **convention plugin** in a `build-logic` included build, applied as `id("myproject.kotlin-library")`
- NEVER copy-paste the same `kotlin {}` / `tasks.test {}` / publishing block across modules
- Prefer `build-logic` (an included build) over `buildSrc` — a `buildSrc` change invalidates the whole build's configuration
- NEVER use cross-project configuration (`subprojects {}`, `allprojects {}`) — it breaks project isolation and the configuration cache

## Performance flags
- `gradle.properties` MUST enable all three: `org.gradle.configuration-cache=true`, `org.gradle.caching=true`, `org.gradle.parallel=true`
- Why: they are the largest build-time wins available and cost nothing but correctness discipline
- Configuration cache forbids reading `System.getenv`, project state or files at execution time — use a `Provider` / `ValueSource` instead
- Custom tasks declare typed `@Input` / `@OutputFile` properties — a task without declared outputs can never be cached

## CI
- Run `gradle/actions/wrapper-validation` as its own step **before** any build job
- Why: it verifies `gradle-wrapper.jar` against known-good checksums — a tampered wrapper otherwise executes with full CI credentials
- Use `gradle/actions/setup-gradle` for remote build caching rather than hand-rolled cache steps

## Deep audit

This rule prevents violations while build files are being written. To audit an **existing** build
end-to-end against all ten practices — including the wrapper-version lookup and cross-module
duplication analysis — run `/gradle-build-auditor`.

## Related rules

`kotlin-style.md` · `kmp/feature-structure.md` and `kmp/architecture.md` when the KMP track is active
