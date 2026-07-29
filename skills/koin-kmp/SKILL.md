# Koin for KMP Skill

Koin wiring in a Kotlin Multiplatform project: what belongs in `commonMain` versus behind
`expect val platformModule: Module`, obtaining a ViewModel in a Compose Multiplatform screen, scopes,
Classic DSL versus KSP annotations, and turning a missing binding into a failing test rather than a
runtime crash.

Layer boundaries and the dependency direction are normative — see `.claude/rules/kmp/architecture.md`
and `.claude/rules/kmp/modularization.md`. This skill wires against those rules; it does not restate
them.

## Supersedes `dependency-injection-architecture` in KMP projects

`dependency-injection-architecture` is gated `requires: [kotlin]`, so it installs here too, but three
of its Always-Active Rules are backend-specific and **wrong for KMP**. In a KMP project this skill
wins on exactly these points:

| `dependency-injection-architecture` says | In a KMP project |
|---|---|
| `Dependency direction is presentation → domain ← data` | `ui → domain ← data` — see `.claude/rules/kmp/architecture.md` |
| `Only data/db/DatabaseFactory.kt may use Dispatchers.IO` | there is no such file, and `Dispatchers.IO` **does not exist** on native or wasm. Inject a `CoroutineDispatcher` |
| `Use Service, never UseCase` | the KMP layer rules name the domain orchestration class `UseCase` |

Everything else it says — constructor injection over `by inject()`, interface types for bindings,
never inject the container, `CoroutineExceptionHandler` as its own keyed dependency — still holds.

## Scope

**In scope**
- Module layout across source sets; `expect val platformModule: Module` and its `actual`s.
- Binding platform-typed dependencies (HTTP engine, `Context`, settings/keychain backing).
- Obtaining a ViewModel or a service inside a `@Composable`.
- Scopes and when a scope is the wrong tool.
- Classic DSL versus `koin-annotations` + KSP, and the generated-module accessor.
- `checkModules()` / `verify()` as a test.
- Diagnosing `NoDefinitionFoundException` and "compiles but fails at the call site".

**Out of scope — hand off, do not answer here**
- Which layer a class belongs to → `.claude/rules/kmp/architecture.md`
- Visibility of a DI-bound implementation → `.claude/rules/kmp/modularization.md`
- Building the `HttpClient` that gets bound → **`ktor-client-kmp`**
- Choosing and configuring the storage that gets bound → **`kmp-persistence`**
- Source-set mechanics and `expect`/`actual` in general → **`kmp-multiplatform-specialist`**
- Writing the tests → **`kmp-testing`**
- Backend (JVM-only, Exposed/Ktor-server) DI → **`dependency-injection-architecture`**

## Procedure

1. **Read the build files first.** `gradle/libs.versions.toml` and the module's `build.gradle.kts` —
   report the Koin version **and which `koin-*` artifacts are actually on the classpath**. This is
   not optional: half of the failures below are a missing artifact, not wrong code.
2. **Find the existing modules** (`di/` package, `initKoin`/`startKoin` call site) and the current
   style. Do not introduce a second style.
3. **Add the binding at the lowest layer that owns the type**, `internal` unless another module
   consumes it.
4. **Verify.** Run the module-verification test (below). A binding added without it is unproven.

## Source-set layout

Most bindings are platform-free and belong in `commonMain`. Only genuinely platform-typed ones go
behind the platform module:

```kotlin
// commonMain
expect val platformModule: Module

val appModule = module {
    single { createHttpClient(get(), BASE_URL) }
    singleOf(::UserRepositoryImpl) bind UserRepository::class
    factoryOf(::LoadUserUseCase)
    viewModelOf(::UserViewModel)
}

// androidMain
actual val platformModule = module {
    single<HttpClientEngine> { OkHttp.create() }
    single<CoroutineDispatcher> { Dispatchers.IO }
}

// iosMain
actual val platformModule = module {
    single<HttpClientEngine> { Darwin.create() }
    single<CoroutineDispatcher> { Dispatchers.Default }   // no Dispatchers.IO on native
}
```

The dispatcher binding is the KMP-specific one: `Dispatchers.IO` exists only on JVM/Android, so a
class that hardcodes it does not compile for native or wasm. Bind it per platform and inject it.

**iOS startup.** Swift reserves `init`, so the shared entry point is normally named `doInitKoin` and
called from `iOSApp.init()` as `InitKoinKt.doInitKoin(config: nil)`.

> **Unverified** — no consumer project here declares an iOS target; the iOS lines above are adapted
> from `rcosteira79/android-skills` → `koin/SKILL.md`.

## Compose: `koinViewModel`, not `koinInject`

`koinInject<T>()` resolves through the ordinary graph and returns a `single`/`factory` instance. Used
for a ViewModel it produces one with **no `ViewModelStoreOwner`**: it is not scoped to the navigation
entry, `onCleared()` never runs at the right moment, and a `single` binding makes the "ViewModel"
outlive the screen entirely, carrying stale state back on re-entry.

```kotlin
// wrong — no ViewModel store, no lifecycle
val viewModel: UserViewModel = koinInject()

// right — scoped to the nav entry
val viewModel: UserViewModel = koinViewModel()
val detail: DetailViewModel = koinViewModel { parametersOf(userId) }
```

`koinViewModel` lives in **`koin-compose-viewmodel`** (KMP) or `koin-androidx-compose` (Android-only).
`koin-core` and `koin-compose` alone do not provide it — which is why a project missing that artifact
"has to" use `koinInject`. That is a missing dependency, not a style choice: add the artifact.
Without the right artifact `koinViewModel` fails at the call site rather than at compile time.

For plain services, defaulting the parameter keeps the composable testable:

```kotlin
@Composable
fun UserScreen(analytics: AnalyticsService = koinInject()) { … }
```

## Classic DSL vs KSP annotations

Pick one per module; mixing inside a single module is what breaks. The accessor most often missed is
that `@Module @ComponentScan class UserModule` is passed as **`UserModule().module`**:

```kotlin
@Single class UserRepositoryImpl(private val service: UserService) : UserRepository
@Factory class UserFormValidator
@KoinViewModel class UserDetailViewModel(
    @InjectedParam private val userId: String,
    private val repository: UserRepository,
) : ViewModel()

@Module @ComponentScan("com.example.feature.user") class UserModule
// startKoin { modules(UserModule().module) }
```

Annotations need `koin-annotations` + the `koin-ksp-compiler` wired per target. Classic DSL needs no
codegen and stays readable in a small graph — prefer it unless the module is large enough that the
boilerplate is the actual problem.

## Scopes

A scope is for state with a lifetime **between** "one call" and "the whole app" — a multi-step flow
keyed by an id, for example. Own it explicitly and close it:

```kotlin
val scope = getKoin().createScope<CheckoutFlow>("checkout-$orderId")
val cart: CheckoutCart = scope.get()
// …
scope.close()
```

A scope that is never closed is a leak that no test catches. If the lifetime you want is "this
screen", that is what `koinViewModel` already gives you — use it instead.

## Verification as a test

`checkModules()` walks every declaration's constructor and fails when a dependency is not declared,
turning a runtime `NoDefinitionFoundException` into a red test.

```kotlin
// commonTest
class ModuleVerificationTest {
    @Test
    fun should_resolve_every_declaration() {
        koinApplication { modules(appModule, platformModule) }.checkModules()
    }
}
```

For constructor parameters supplied at runtime (`SavedStateHandle`, a `parametersOf` value), declare
them with `verify(extraTypes = listOf(SavedStateHandle::class))` — otherwise verification fails on a
binding that is actually correct.

## Do NOT

- Do NOT use `koinInject()` for a ViewModel — use `koinViewModel()` and add the artifact.
- Do NOT bind a ViewModel as `single`; it then survives navigation with stale state.
- Do NOT hardcode `Dispatchers.IO` inside a class — it does not exist on native/wasm. Inject it.
- Do NOT put a platform type in `commonMain` bindings; that is what `platformModule` is for.
- Do NOT inject `Koin`, `Scope` or `KoinComponent` into a class — that is the service-locator
  anti-pattern back in disguise.
- Do NOT mix Classic DSL and annotations inside one module.
- Do NOT widen a binding's implementation class to `public` just to declare it — declarations see
  `internal` types within the same module.
- Do NOT create a scope you have no code path to close.

## Error handling

- **`NoDefinitionFoundException` at runtime** → the graph is unverified. Add `checkModules()` first,
  then fix the binding it names.
- **`koinViewModel` unresolved or failing at the call site** → report the missing artifact
  (`koin-compose-viewmodel`) and its catalog entry; do not work around it with `koinInject`.
- **`checkModules()` fails on a runtime-supplied parameter** → add `extraTypes`; do not delete the
  test.
- **An `actual platformModule` is missing for a declared target** → name the target and the missing
  bindings, and hand source-set mechanics to **`kmp-multiplatform-specialist`**.
- **The question is about layering, not wiring** → point at `.claude/rules/kmp/architecture.md` and
  stop.

## Example

> "Add a settings screen backed by a repository that reads from encrypted storage."

1. Read `libs.versions.toml`; report the Koin version and whether `koin-compose-viewmodel` is
   present. If it is not, propose the catalog entry before writing any Compose code.
2. Bind the storage in `platformModule` per target (encrypted on Android, keychain on iOS, plain on
   Desktop) — the choice itself belongs to **`kmp-persistence`**.
3. Bind `SettingsRepositoryImpl` as `internal` behind the `public` `SettingsRepository` interface in
   `commonMain`.
4. Declare `viewModelOf(::SettingsViewModel)` and obtain it in the screen with `koinViewModel()`.
5. Extend the module-verification test to include the new module; run it and report the output.

Expected outcome: the graph verifies in `commonTest`, and no platform type appears in `commonMain`.

## Related Skills

- `kmp-multiplatform-specialist` — source sets, `expect`/`actual`, targets
- `ktor-client-kmp` — the client and engine that get bound
- `kmp-persistence` — choosing the storage behind the binding
- `kmp-testing` — fakes, `commonTest` placement, overriding bindings in tests
- `kotlin-specialist` — dispatchers, scopes, `CoroutineExceptionHandler`
- `dependency-injection-architecture` — the backend (JVM-only) counterpart
