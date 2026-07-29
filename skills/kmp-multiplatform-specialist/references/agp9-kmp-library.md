# AGP 9 — `com.android.kotlin.multiplatform.library`

The Android target of a KMP module declared through AGP 9's KMP-library plugin, rather than the
classic `com.android.library` + `android { }` block. It is a different plugin with a smaller feature
set, and most Android build snippets found online do not apply to it.

Read this when adding or changing the Android target of a multiplatform module. The shape below is
verified against **AGP 9.0.1 / Kotlin 2.4.0** in a real consumer project; the sections marked
*unverified* were not exercised there.

## The shape

```kotlin
plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.androidMultiplatformLibrary)   // com.android.kotlin.multiplatform.library
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
}

kotlin {
    jvm()

    androidLibrary {
        namespace = "com.example.shared"
        compileSdk = libs.versions.android.compileSdk.get().toInt()
        minSdk = libs.versions.android.minSdk.get().toInt()

        compilerOptions { jvmTarget = JvmTarget.JVM_11 }

        androidResources { enable = true }

        withHostTest { isIncludeAndroidResources = true }
        withDeviceTest { instrumentationRunner = "androidx.test.runner.AndroidJUnitRunner" }
    }
}
```

There is **no `android { }` block**. The Android configuration lives inside `kotlin { androidLibrary { } }`,
and options are set there or not at all.

## `androidResources { enable = true }` — the silent one

This is off by default. Without it, a module that uses Compose Resources **builds green and crashes at
runtime** when the generated `Res.*` accessor tries to read a resource that was never packaged. The
build log says nothing, because nothing failed at build time.

Enable it in any module that ships resources — which, for a Compose Multiplatform module with strings
or drawables, is every one of them.

## Test source sets are created by the DSL

`withHostTest { }` and `withDeviceTest { }` create `androidHostTest` and `androidDeviceTest`. Two
consequences that cost time when missed:

- The source sets created this way have **no typed accessor** — reference them by name:
  `getByName("androidDeviceTest").dependencies { … }`.
- `androidDeviceTest` does **not** inherit `commonTest`. Every test dependency it needs must be
  declared again on it, even one already present in `commonTest`.
- `isIncludeAndroidResources = true` on the host test is what lets host-side tests read resources.

## No build variants

The plugin has no `buildTypes` and no `productFlavors`. Anything that used to be a per-variant value
is either a single value for the module, or comes in from outside — an injected configuration object,
or a generated constants file.

## No `BuildConfig`

> **Unverified** — not exercised in the reference project.

There is no generated `BuildConfig` class. Where an Android-only module would read
`BuildConfig.VERSION_NAME` or a flavour flag, a KMP module needs a different source: a code-generation
plugin such as BuildKonfig, or — usually better — a plain configuration interface implemented per
platform and supplied through DI. The DI route keeps the value testable and avoids adding a codegen
step to every target.

## Other gaps

> **Unverified** — not exercised in the reference project.

- **No NDK / JNI configuration.** A module needing native Android code has to stay on
  `com.android.library`, or move the native part into a separate module.
- **`consumerProguardFiles`** is not configured the same way. A published library that shipped consumer
  rules from the classic plugin needs that path re-established before the migration is complete —
  check it explicitly rather than assuming the rules carried over.
- **kapt is not supported.** Annotation processors must be on KSP. This affects Room, and any DI
  library used in annotation mode.

## Dependencies that are Android-runtime-only

Artifacts that must be on the Android runtime classpath without becoming an API dependency of the
shared code go on the dedicated configuration, outside the `kotlin { }` block:

```kotlin
dependencies {
    androidRuntimeClasspath(libs.compose.uiTooling)
}
```

Putting such an artifact in `androidMain.dependencies` instead leaks it into the module's Android
consumers.

## When something does not work

1. Check whether the snippet you are copying targets `com.android.library`. Most do. Its options do
   not exist here, and the failure mode is an unresolved DSL member rather than a helpful message.
2. Check whether the feature exists in this plugin at all before working around it — several do not,
   and the correct answer is a different module layout, not a hack.
3. Report the AGP version from the catalog with the answer. This plugin is young and its DSL is still
   moving between AGP releases.
