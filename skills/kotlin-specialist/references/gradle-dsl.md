# Gradle Kotlin DSL & Version Catalog — Spovishun

## Version catalog structure (libs.versions.toml)

```toml
[versions]
kotlin        = "2.3.0"
coroutines    = "1.9.0"
exposed       = "0.55.0"
flyway        = "10.0.0"
koin          = "3.5.0"
telegrambots  = "7.0.0"

[libraries]
kotlinx-coroutines-core = { group = "org.jetbrains.kotlinx", name = "kotlinx-coroutines-core", version.ref = "coroutines" }
exposed-core            = { group = "org.jetbrains.exposed", name = "exposed-core", version.ref = "exposed" }
exposed-jdbc            = { group = "org.jetbrains.exposed", name = "exposed-jdbc", version.ref = "exposed" }
koin-core               = { group = "io.insert-koin", name = "koin-core", version.ref = "koin" }
telegrambots-longpolling = { group = "org.telegram", name = "telegrambots-longpolling", version.ref = "telegrambots" }

[plugins]
kotlin-jvm = { id = "org.jetbrains.kotlin.jvm", version.ref = "kotlin" }
```

## build.gradle.kts — adding a dependency

```kotlin
dependencies {
    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.exposed.core)
    implementation(libs.exposed.jdbc)
    implementation(libs.koin.core)

    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.mockk)
}
```

Access catalog entries via `libs.<group>.<name>` — replace `.` with `-` in the TOML key.

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

## Custom Gradle task

```kotlin
tasks.register("generateMigration") {
    group = "database"
    description = "Interactively create a new Flyway migration file"
    doLast {
        // interactive prompt logic
    }
}
```

Run with: `./gradlew generateMigration`

## Test source sets

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
}
```

## Rules

- All dependency versions live in `libs.versions.toml` — never hardcode a version string in `build.gradle.kts`.
- Add new libraries via catalog first; reference via `libs.*` accessor.
- Keep plugin declarations in the `[plugins]` block with version refs.
- Target: Kotlin 2.3.0, JVM 21.
