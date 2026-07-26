# Gradle Kotlin DSL — build script authoring

Scope: writing Kotlin DSL inside a `build.gradle.kts` — compiler options, custom tasks, extra source
sets.

Build *structure* is not covered here and lives in one place:

- `.claude/rules/kotlin/gradle-build.md` — version catalog, dependency declaration, repositories,
  wrapper, plugins block, convention plugins, cache flags, CI wrapper validation
- `/gradle-build-auditor` — deep audit of an existing build against all ten of those practices

## Kotlin compiler options

```kotlin
kotlin {
    jvmToolchain(21)
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
        freeCompilerArgs.addAll("-opt-in=kotlinx.coroutines.ExperimentalCoroutinesApi")
    }
}
```

`jvmToolchain` makes Gradle provision the JDK, so the build does not depend on whichever JDK the
developer happens to have on `PATH`. Set `jvmTarget` as well when the toolchain and the bytecode
target must differ.

Opt-ins belong in `freeCompilerArgs` at the module level rather than as `@OptIn` on every call site —
but only for APIs the whole module genuinely relies on.

## Custom Gradle task

```kotlin
tasks.register("generateMigration") {
    group = "database"
    description = "Creates a new timestamped migration file"
    doLast {
        // generation logic
    }
}
```

Run with `./gradlew generateMigration`.

Use `register` (lazy), not `create` (eager) — an eagerly created task is configured on every build,
including builds that never run it.

For anything with real inputs and outputs, write a typed task class instead. Without declared
`@Input` / `@OutputFile` properties the task can never be up-to-date or cached, and it breaks the
configuration cache:

```kotlin
abstract class GenerateBuildInfo : DefaultTask() {
    @get:Input abstract val version: Property<String>
    @get:OutputFile abstract val outputFile: RegularFileProperty

    @TaskAction
    fun generate() = outputFile.get().asFile.writeText("version=${version.get()}")
}

tasks.register<GenerateBuildInfo>("generateBuildInfo") {
    version.set(providers.provider { project.version.toString() })
    outputFile.set(layout.buildDirectory.file("generated/build-info.properties"))
}
```

## Extra test source sets

An `integrationTest` source set separate from `test`, so slow tests can be run independently:

```kotlin
sourceSets {
    create("integrationTest") {
        kotlin.srcDir("src/integrationTest/kotlin")
        resources.srcDir("src/integrationTest/resources")
        compileClasspath += sourceSets["main"].output + configurations["testRuntimeClasspath"]
        runtimeClasspath += output + compileClasspath
    }
}

tasks.register<Test>("integrationTest") {
    description = "Runs integration tests"
    group = "verification"
    testClassesDirs = sourceSets["integrationTest"].output.classesDirs
    classpath = sourceSets["integrationTest"].runtimeClasspath
    useJUnitPlatform()
    shouldRunAfter(tasks.test)
}
```

`shouldRunAfter` orders the two without creating a dependency, so `integrationTest` still runs when
unit tests are skipped.

Extra source sets are for extra *test* dimensions only. Do not use `srcDir` to bolt production
layers onto a single project — that is what modules are for (see the rule, practice 7).

## JVM toolchain vs. multiplatform

The `kotlin { }` block above is the JVM plugin's. On a Kotlin Multiplatform project the same settings
are configured per target — see `kmp-multiplatform-specialist`.
