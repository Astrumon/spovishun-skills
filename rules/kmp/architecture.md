# KMP Architecture Rules

Applies to Kotlin Multiplatform / Compose Multiplatform projects (`stack.kmp: true`).
Supersedes generic single-module layering guidance wherever the two disagree.

## Layers

```
ui        (Compose + MVI state holder)
   ↓
domain    (UseCase + Repository interface + model)
   ↑
data      (RepositoryImpl + remote/local sources + DTO)
```

- Dependencies point **inward**. `ui` never imports from `data`; `data` never imports from `ui`.
- `domain` is pure Kotlin — no Compose, no Ktor, no Android/iOS types, no framework annotations.
- A DTO never crosses out of `data`. Map it to a `domain` model at the repository boundary.
- A `domain` model never gains Compose or serialization annotations to save a mapper.
- All three layers live in `commonMain`. A layer only reaches into a platform source set through `expect`/`actual`.
- An `actual` stays in the same layer as its `expect`: a platform HTTP engine belongs to `data`, never to `ui`.

## MVI contract

Every screen exposes exactly three types and one entry point.

- **Intent** — a `sealed interface` of everything the UI can ask for. The ViewModel exposes
  `onIntent(I)` and nothing else; no public `refresh()` / `onClick…()` methods.
- **UiState** — one `@Immutable data class` per screen holding everything rendered. Loading and
  error are states, not separate flags scattered across the class.
- **Effect** — a `sealed interface` of one-shot outcomes only: navigation and transient messages.
  Anything the screen still shows after a rotation is state, not an effect.

The shared `MviViewModel<S, I, E>` base is written **once per project** in `commonMain`, not once
per screen: `StateFlow` for state, `Channel(Channel.BUFFERED)` for effects, and a `launch` helper
over an injected `CoroutineDispatcher` + `CoroutineExceptionHandler`.

- It extends `androidx.lifecycle.ViewModel` (the multiplatform artifact) — that is what gives
  `viewModelScope` cancellation on `onCleared`, destination-scoped lifetime through
  `koinViewModel()`, and access to `SavedStateHandle`.
- The dispatcher is injected so tests can pass a test dispatcher instead of mutating global state.

## Error handling

- Every coroutine scope carries a `CoroutineExceptionHandler`. `SupervisorJob` isolates a failed
  child from its siblings — it does **not** catch, log, or report anything. Without a handler the
  exception reaches the platform's last-resort handler and disappears: no crash, no log, and a
  feature that silently stopped working.
- The handler reports to the project's observability sink. It is injected, never constructed inline.
- **Forbidden:** `catch (t: Throwable) { }` and any catch that neither re-throws, nor reports, nor
  produces a typed state.
- Always re-throw `CancellationException` — swallowing it breaks structured concurrency.
- Expected failures (offline, unauthorized, empty) are **typed states** in `UiState`, not exceptions.

## Compose stability

Non-skippable composables recompose on every parent recomposition. In a multi-module project this
is the default failure mode, because **a class from another module is treated as Unstable** unless
told otherwise.

- Mark every `UiState` and every model it holds `@Immutable` (or `@Stable` when it holds observable
  state internally).
- Types you do not own, or that come from a module without the Compose compiler, go into a
  `stability.txt` at the repo root — wildcards are supported.
- Prefer `() -> List<T>` over `List<T>` as a composable parameter: the collection interfaces are
  unstable, a lambda is not.
- Verify with the compiler reports rather than by eye: a screen-level composable should read
  `restartable skippable`.

## Escalation

- A UseCase is required only when logic spans two or more repositories, or when the same logic is
  needed by two or more screens. Do not add a pass-through UseCase that only forwards one call.
- A shared `core/` module is created on the second consumer, not in anticipation of one.

## Don't

- DON'T expose `MutableStateFlow` or the raw `Channel` from a ViewModel.
- DON'T use `MutableSharedFlow` for one-shot effects: with `replay = 0` and no active collector the
  event is dropped silently, and with `replay = 1` it is re-delivered to the next collector.
- DON'T put an `expect` declaration in `domain` — it makes the pure layer platform-aware.
- DON'T let a composable take a `ViewModel` parameter; state in, lambdas out.

## Related rules

`feature-structure.md` (module and package layout) · `navigation.md` · `testing.md` · `uikit.md` · `localization.md`

This rule stays normative and free of Kotlin. Its implementations live in the
`kmp-multiplatform-specialist` skill: the `MviViewModel` base class, a screen written against it,
the typed-error `load()` helper and the `composeCompiler { }` / `stability.txt` wiring are in
`references/mvi-and-stability.md`; source sets, targets and `expect`/`actual` are in the skill body.
