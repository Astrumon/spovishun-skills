# KMP iOS Interop Skill

The Kotlin↔Swift boundary of a Kotlin Multiplatform module: how declarations are named in Swift, how
types and nullability bridge, how `suspend` and `Flow` reach Swift concurrency through SKIE, how
sealed classes become exhaustive `switch`es, and how to embed SwiftUI inside Compose.

> **Unverified in this project.** No consumer project available here declares an iOS target, so
> nothing below has been checked against a real build. It is adapted from
> `rcosteira79/android-skills` → `kmp-boundaries/references/ios-interop.md`. Treat every claim as a
> starting point to verify against the project's own SKIE and Kotlin versions, not as a settled fact.

## Procedure

1. **Check that an iOS target exists — before anything else.** Read `shared/build.gradle.kts` (or the
   equivalent module) and look for `iosX64()`, `iosArm64()`, `iosSimulatorArm64()`, or an
   `iosMain` source set.
   **If none is declared, say so and stop.** This skill installs into every KMP project because there
   is no `ios` stack flag; answering as though an iOS target exists would produce advice about a
   framework the project never builds. Offer to hand adding the target to
   **`kmp-multiplatform-specialist`**.
2. **Read the framework configuration** — `binaries.framework { }`, whether SKIE is applied, and
   which version. The SKIE-vs-manual answer depends entirely on this.
3. **Answer or change against those facts**, keeping the boundary surface as small as it already is.
4. **Verify.** Build the framework (`./gradlew :shared:linkDebugFrameworkIosSimulatorArm64`) and
   report the real output. On a non-macOS machine, say plainly that the build could not be run here.

## Scope

**In scope**
- Kotlin→Swift naming, nullability and type-width bridging.
- `suspend` → Swift `async`, `Flow` → `AsyncSequence`, with and without SKIE.
- Sealed-class exhaustiveness in Swift.
- Keeping the ObjC header surface small (`internal`, `@HiddenFromObjC`).
- Embedding SwiftUI or UIKit views inside Compose Multiplatform.

**Out of scope — hand off, do not answer here**
- Adding or configuring the iOS target itself → **`kmp-multiplatform-specialist`**
- Which layer a boundary type belongs to → `.claude/rules/kmp/architecture.md`
- Koin startup from Swift → **`koin-kmp`**
- The Compose side of an embedded view's layout → **`compose-multiplatform`**
- Swift application code beyond the call site — that is outside this plugin entirely

## Naming

| Kotlin | Swift |
|---|---|
| top-level `fun foo()` in `Bar.kt` | `BarKt.foo()` — file name + `Kt` |
| `object AppInit` | `AppInit.shared` |
| `companion object` member | directly on the class, no `Companion` namespace |
| `suspend fun load()` | `async func load()` with SKIE |
| generic types | erased or boxed unpredictably — use concrete types at the boundary |

Swift reserves `init`, so a Kotlin `initKoin()` called from `iOSApp.init()` is normally renamed
(`doInitKoin`) rather than fought with.

## Type bridging

| Kotlin | Swift | Watch for |
|---|---|---|
| `String` / `String?` | `String` / `String?` | bridges cleanly |
| `Int` / `Long` | `Int32` / `Int64` | **not** Swift `Int`, which is platform-sized. Cross-boundary arithmetic needs explicit casts |
| `Unit` | `KotlinUnit` | the caller must discard it explicitly — avoid in public API |
| `List<T>` / `Map<K, V>` | `[T]` / `[K: V]`, read-only **copies** | structural sharing is lost; batch, never iterate across the boundary in a hot path |

The `Int` width mismatch is the most common defect here, and it is silent until a value exceeds 32
bits or a Swift API refuses the type.

## Coroutines and Flow

SKIE is the default for a new project: it converts `suspend` to Swift `async` and `Flow` to
`AsyncSequence` with no annotations on the Kotlin side, at the cost of a build plugin.
KMP-NativeCoroutines (`@NativeCoroutines`) is the annotation-driven alternative — keep it if the
project already uses it, do not introduce it alongside SKIE.

```kotlin
// commonMain — nothing iOS-specific
suspend fun loadItems(): List<Item> = repository.getAll()
```

```swift
let items = try await viewModel.loadItems()

// StateFlow<UiState> — the MVI bridge
for await state in viewModel.state {
    self.uiState = state
}
```

Without SKIE, expose a callback-based observer from `iosMain` that returns a cancel closure, and call
it from Swift `deinit`:

```kotlin
// iosMain
class IosStateCollector<T>(private val flow: StateFlow<T>, private val scope: CoroutineScope) {
    private var job: Job? = null

    fun observe(onChange: (T) -> Unit): () -> Unit {
        job = scope.launch(Dispatchers.Main) { flow.collect { onChange(it) } }
        return { job?.cancel() }
    }
}
```

A collector whose cancel closure Swift never calls is a leak that no Kotlin test will find.

## Sealed classes

Without SKIE, Swift sees a class hierarchy and `as?` casts — **no exhaustiveness check**, so adding a
sealed subclass silently breaks the iOS UI while everything still compiles. With SKIE:

```swift
switch onEnum(of: state) {
case .loading: showSpinner()
case .success(let s): render(items: s.items)
case .error(let e): showError(e.message)
}   // now a compiler error when a new subclass appears
```

Edge cases: SKIE cannot convert **generic** sealed classes — use a concrete `ItemListState`, not
`ListState<Item>`. Nested hierarchies flatten (`UiState.Error.Network` → `.errorNetwork`).
`@SealedInterop.Disabled` opts a single class out.

## Keeping the surface small

- `internal` plus `@HiddenFromObjC` keeps Kotlin internals out of the generated ObjC header.
- No generics in iOS-facing public API.
- Data classes over deep hierarchies at the boundary.
- `isStatic = true` in the framework config — smaller binary, faster startup.

## Embedding SwiftUI in Compose

SwiftUI views cannot be passed to Compose directly; wrap them in a `UIHostingController` on the Swift
side and hand the controller to a Kotlin factory:

```kotlin
// iosMain
@OptIn(ExperimentalForeignApi::class)
fun ComposeWithSwiftUI(createViewController: () -> UIViewController): UIViewController =
    ComposeUIViewController {
        Column(Modifier.fillMaxSize()) {
            Text("Compose content above")
            UIKitViewController(factory = createViewController, modifier = Modifier.size(300.dp))
        }
    }
```

```swift
MainViewControllerKt.ComposeWithSwiftUI {
    UIHostingController(rootView: MySwiftUIMapView())
}
```

Plain UIKit views (`MKMapView`, `WKWebView`, `AVCaptureSession`) need no Swift bridge — use
`UIKitView(factory = { … })` from Kotlin.

## Do NOT

- Do NOT answer any of this for a project with no iOS target — check first, then stop.
- Do NOT expose generics across the boundary.
- Do NOT return `Unit` from a `suspend` function that Swift calls.
- Do NOT assume Kotlin `Int` and Swift `Int` are the same width.
- Do NOT pass large collections across the boundary repeatedly — batch.
- Do NOT rely on `as?` chains for sealed state; they are silently non-exhaustive.
- Do NOT add both SKIE and KMP-NativeCoroutines.
- Do NOT claim a framework build passed if it was not run.

## Error handling

- **No iOS target declared** → say so, name what you looked at, and stop.
- **SKIE not applied but `async`/`AsyncSequence` is expected** → report the missing plugin and the
  manual-collector alternative; do not silently write SKIE-only Swift.
- **A generic sealed class must cross the boundary** → propose the concrete replacement type rather
  than disabling exhaustiveness.
- **The framework build cannot run here (non-macOS host)** → state that plainly and mark the change
  unverified. Never report a green iOS build you did not execute.
- **The question is about the Compose side of an embedded view** → hand it to
  **`compose-multiplatform`**.

## Example

> "Expose the dashboard state to SwiftUI."

1. Read the module's build file; report the declared targets. **If there is no iOS target, stop here
   and say so.**
2. Report whether SKIE is applied and at which version.
3. Check the state type: if it is `UiState<T>`, propose a concrete `DashboardUiState` — SKIE cannot
   make a generic sealed class exhaustive in Swift.
4. Confirm `StateFlow` exposure (not `MutableStateFlow`) and that `Int` fields crossing the boundary
   are handled.
5. Build the framework and report the real output, or state that the host cannot build it.

Expected outcome: a concrete, non-generic state type at the boundary and an explicit statement of
what was and was not verified.

## Related Skills

- `kmp-multiplatform-specialist` — adding the iOS target, `expect`/`actual`, source sets
- `compose-multiplatform` — the Compose side of embedded views
- `koin-kmp` — DI startup from Swift
- `kotlin-specialist` — `StateFlow`, scope ownership, cancellation
- `kmp-testing` — what can and cannot be covered by tests here
