# The 10 Gradle Best Practices — Don't / Do

Full code for every practice. The short normative form lives in
`.claude/rules/kotlin/gradle-build.md`; this file exists because that rule must stay under the
adapter size limits. Load this only when proposing fixes.

---

## 1. Use the Kotlin DSL

**Don't** — Groovy build scripts:

```groovy
// build.gradle
apply plugin: 'org.jetbrains.kotlin.jvm'

dependencies {
    implementation 'io.ktor:ktor-server-core:3.0.0'
}
```

**Do** — Kotlin DSL:

```kotlin
// build.gradle.kts
plugins {
    alias(libs.plugins.kotlin.jvm)
}

dependencies {
    implementation(libs.ktor.server.core)
}
```

**Why:** typed accessors, IDE completion, refactoring and compile-time errors. A typo in Groovy
surfaces at build time; in Kotlin it never compiles.

**Migrating:** rename `build.gradle` → `build.gradle.kts` and convert the whole file. Groovy's
`apply plugin: 'x'` becomes a `plugins {}` entry, single quotes become double, and every method call
needs parentheses. A partially converted module has neither DSL's tooling.

---

## 2. Use the latest minor of Gradle

**Don't** — hand-edit the wrapper properties:

```properties
distributionUrl=https\://services.gradle.org/distributions/gradle-8.5-bin.zip
```

**Do** — let Gradle rewrite it, so the checksum stays consistent:

```bash
./gradlew wrapper --gradle-version=8.14 --distribution-type=bin
./gradlew wrapper --gradle-version=8.14 --distribution-type=bin   # run twice: the first run updates the scripts, the second uses them
```

Resulting file, with the checksum pin kept:

```properties
distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\://services.gradle.org/distributions/gradle-8.14-bin.zip
distributionSha256Sum=<sha from https://gradle.org/release-checksums/>
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
```

**Why:** minor releases are backwards-compatible within a major line and carry performance and
correctness fixes at no migration cost. Staying behind means paying for the eventual major upgrade
all at once.

**Checking the current version:** `https://services.gradle.org/versions/current` returns JSON with a
`version` field. Never answer from memory.

---

## 3. Apply plugins with the `plugins {}` block

**Don't** — the legacy `buildscript` path:

```kotlin
buildscript {
    repositories { mavenCentral() }
    dependencies {
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.1.0")
    }
}

apply(plugin = "org.jetbrains.kotlin.jvm")
```

**Do** — declare once in the root with `apply false`, apply per module:

```kotlin
// root build.gradle.kts
plugins {
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.ktlint) apply false
}

// module build.gradle.kts
plugins {
    alias(libs.plugins.kotlin.jvm)
}
```

**Why:** only `plugins {}` gives Gradle the plugin metadata up front, which is what generates the
typed extension accessors (`kotlin { }`, `java { }`) and lets versions stay consistent across
modules. With `apply()` those accessors do not exist and every configuration block falls back to
untyped `configure<T>`.

---

## 4. Don't depend on `kotlin-stdlib` explicitly

**Don't:**

```kotlin
dependencies {
    implementation("org.jetbrains.kotlin:kotlin-stdlib:2.1.0")
    implementation(libs.kotlin.stdlib)          // same mistake via the catalog
}
```

**Do** — nothing; the Kotlin Gradle plugin adds the stdlib matching the compiler:

```kotlin
plugins {
    alias(libs.plugins.kotlin.jvm)
}

dependencies {
    // no stdlib entry
}
```

**Why:** an explicit pin drifts from the compiler version. When it does, resolution silently picks
the higher of the two and you compile against one stdlib while the plugin expects another.

**Opting out deliberately** (rare — e.g. a platform that supplies its own):

```properties
# gradle.properties
kotlin.stdlib.default.dependency=false
```

---

## 5. Centralize versions in a version catalog

**Don't** — coordinates inline, repeated per module:

```kotlin
dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
    implementation("io.insert-koin:koin-core:4.0.0")
    testImplementation("io.mockk:mockk:1.13.13")
}
```

**Do** — `gradle/libs.versions.toml`:

```toml
[versions]
kotlin      = "2.1.0"
coroutines  = "1.9.0"
koin        = "4.0.0"

[libraries]
kotlinx-coroutines-core = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-core", version.ref = "coroutines" }
koin-core               = { module = "io.insert-koin:koin-core", version.ref = "koin" }
mockk                   = { module = "io.mockk:mockk", version = "1.13.13" }

[bundles]
koin = ["koin-core", "koin-test"]

[plugins]
kotlin-jvm = { id = "org.jetbrains.kotlin.jvm", version.ref = "kotlin" }
```

```kotlin
dependencies {
    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.bundles.koin)
    testImplementation(libs.mockk)
}
```

**Why:** one place to bump a version, applied to every module including `build-logic`. The accessors
are typed, so a removed entry fails the build instead of resolving a stale coordinate.

**Accessor naming:** `-` in the TOML key becomes `.` in Kotlin —
`kotlinx-coroutines-core` → `libs.kotlinx.coroutines.core`.

---

## 6. Declare repositories in `settings.gradle.kts`

**Don't** — per module, in whatever order each file happens to list:

```kotlin
// module build.gradle.kts
repositories {
    mavenCentral()
    maven("https://jitpack.io")
}
```

**Do** — once, centrally, and make violations fail:

```kotlin
// settings.gradle.kts
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
        google()
    }
}

pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}
```

**Why:** repository order decides which artifact wins for a coordinate. Per-module lists mean the
same coordinate can resolve to different bytes in different modules. `FAIL_ON_PROJECT_REPOS` turns a
stray module-level block into a build failure instead of a silent override.

**`PREFER_SETTINGS`** is the softer variant — module repositories are ignored with a warning rather
than failing. Use it only as a migration step, not as the end state.

---

## 7. Modularize the build

**Don't** — one project carrying extra source directories:

```kotlin
// settings.gradle.kts
include(":app")

// app/build.gradle.kts
sourceSets {
    main {
        kotlin.srcDir("src/domain/kotlin")
        kotlin.srcDir("src/data/kotlin")
        kotlin.srcDir("src/feature-orders/kotlin")
    }
}
```

**Do** — real modules:

```kotlin
// settings.gradle.kts
include(":app", ":domain", ":data", ":feature:orders")
```

```kotlin
// app/build.gradle.kts
dependencies {
    implementation(projects.domain)
    implementation(projects.data)
    implementation(projects.feature.orders)
}
```

Enable the typed `projects.*` accessors:

```kotlin
// settings.gradle.kts
enableFeaturePreview("TYPESAFE_PROJECT_ACCESSORS")
```

**Why:** the module is Gradle's unit of parallelism, of up-to-date checking and of the configuration
cache. Extra source dirs in one project are none of those — every change recompiles everything.
Modules also make layer boundaries enforceable at compile time rather than by convention.

**Advisory:** this pays off with real separation. Do not split a two-file project into six modules.

---

## 8. Share logic with convention plugins

**Don't** — copy-paste, or configure children from the root:

```kotlin
// repeated verbatim in every module
kotlin { jvmToolchain(21) }
tasks.withType<Test>().configureEach { useJUnitPlatform() }

// or, worse, in the root build.gradle.kts
subprojects {
    apply(plugin = "org.jetbrains.kotlin.jvm")
    kotlin { jvmToolchain(21) }
}
```

**Do** — a convention plugin in an included build:

```kotlin
// settings.gradle.kts
pluginManagement {
    includeBuild("build-logic")
}
```

```kotlin
// build-logic/settings.gradle.kts
dependencyResolutionManagement {
    versionCatalogs {
        create("libs") { from(files("../gradle/libs.versions.toml")) }
    }
}
```

```kotlin
// build-logic/build.gradle.kts
plugins { `kotlin-dsl` }

dependencies {
    implementation(libs.kotlin.gradle.plugin)
}
```

```kotlin
// build-logic/src/main/kotlin/myproject.kotlin-library.gradle.kts
plugins {
    id("org.jetbrains.kotlin.jvm")
}

kotlin { jvmToolchain(21) }

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
}
```

```kotlin
// any module build.gradle.kts
plugins {
    id("myproject.kotlin-library")
}
```

**Why:** `subprojects {}` / `allprojects {}` is cross-project configuration — it breaks project
isolation, defeats the configuration cache, and means a module's own build file no longer describes
how that module is built.

**`build-logic` over `buildSrc`:** any change inside `buildSrc` invalidates the entire build's
configuration; an included build is treated as a normal dependency and only invalidates consumers.

---

## 9. Turn on the caches

**Don't** — an empty or minimal `gradle.properties`:

```properties
kotlin.code.style=official
```

**Do:**

```properties
kotlin.code.style=official

org.gradle.configuration-cache=true
org.gradle.caching=true
org.gradle.parallel=true

# optional, commonly paired
org.gradle.configureondemand=true
org.gradle.jvmargs=-Xmx4g -XX:+UseParallelGC
```

**Why:** these are the three largest build-time wins available and they cost nothing but keeping
build logic well-behaved.

**Configuration cache compliance** — the usual failures:

```kotlin
// Don't — reads environment and project state at execution time
tasks.register("printVersion") {
    doLast {
        println(System.getenv("BUILD_NUMBER"))
        println(project.version)
    }
}

// Do — capture into providers at configuration time
val buildNumber = providers.environmentVariable("BUILD_NUMBER")
val projectVersion = provider { project.version.toString() }

tasks.register("printVersion") {
    val number = buildNumber
    val version = projectVersion
    doLast {
        println(number.getOrElse("local"))
        println(version.get())
    }
}
```

Custom tasks must declare typed inputs and outputs, or they can never be cached:

```kotlin
abstract class GenerateBuildInfo : DefaultTask() {
    @get:Input abstract val version: Property<String>
    @get:OutputFile abstract val outputFile: RegularFileProperty

    @TaskAction
    fun generate() = outputFile.get().asFile.writeText("version=${version.get()}")
}
```

Verify with `./gradlew help --configuration-cache`, then a second run — the second must report
"Reusing configuration cache".

---

## 10. Validate the Gradle wrapper in CI

**Don't** — build straight from a checkout:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ./gradlew build
```

**Do** — validate first, as its own job that everything else depends on:

```yaml
jobs:
  validation:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: gradle/actions/wrapper-validation@v4

  build:
    needs: validation
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '21'
      - uses: gradle/actions/setup-gradle@v4
      - run: ./gradlew build
```

**Why:** `gradle-wrapper.jar` is a binary committed to the repository, and CI executes it with full
credentials before any other step runs. The action checks it against the known-good checksums of
every published Gradle release, which is what makes a swapped JAR detectable.

Pair it with `distributionSha256Sum` in `gradle-wrapper.properties` — the action validates the JAR,
the checksum validates the distribution it downloads.
