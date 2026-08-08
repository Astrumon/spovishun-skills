# KMP Component Architecture Rules

The escalation step for the **screen**. MVI stays as `architecture.md` defines it: the ViewModel is
still the screen's only entry point, still the only effect emitter, still what `koinViewModel()`
resolves. A component subdivides that ViewModel; it never replaces it.

## Escalation

- A component is required only when one screen owns **two or more independent state regions** —
  regions that load separately, fail separately, and change for different reasons. One region, or
  two that always change together, stays in the ViewModel.
- A ViewModel past ~300 lines is a symptom, not the trigger. Splitting a screen whose regions are
  coupled produces components that call each other, which is worse than the file it replaced.

## What a component is

A `@Stable` state holder that owns one region of a screen:

- its own `StateFlow` of that region's state, and the only writer of it;
- its own `CoroutineScope` over the **injected** dispatcher and `CoroutineExceptionHandler`, so a
  failure inside one region does not take down its siblings and never reaches the platform's
  last-resort handler;
- its own component store, so a component may own child components the same way a ViewModel does.

A component is plain `commonMain` Kotlin — not a ViewModel: no `SavedStateHandle`, no
`viewModelScope`, no `viewModelOf` binding.

## Ownership and lifetime

- The ViewModel is the root owner. Attaching a component binds its lifetime to the ViewModel;
  clearing the ViewModel cancels every attached scope, recursively.
- `attach` / `detach` are **explicit and manual**. A component created but never attached leaks its
  scope for the ViewModel's whole lifetime; a region replaced without detaching the old component
  leaves two live scopes writing to one screen.
- The store keys by a string that defaults to the component's simple class name, so one owner holds
  at most one component per type. Several instances of one type — one per list row — each declare
  their own key. Anonymous and local classes have no simple name and cannot be components.

## Effects stay with the ViewModel

- A component never owns an effect channel, a `SharedFlow`, or any second event mechanism. This
  extends the rule already stated in `architecture.md`: the ViewModel delegates the collaborator's
  interface and remains the only emitter.
- A component signals an effect through an **emit lambda handed down by its owner** at construction.
  The ViewModel keeps `emitEffect` `protected` and the screen keeps one `Channel(Channel.BUFFERED)`.
- Three event types where one exists is not a design, it is a merge artefact. Do not reintroduce a
  side-effect controller alongside the channel.

## State and the screen

- `UiState` still exists and is still one `@Immutable data class` per screen — it holds what the
  ViewModel itself owns. A component's own state is never copied into it; that would give the region
  two writers. The Route reaches the components through the ViewModel and passes them down.
- A component whose reference is *replaced* at runtime, rather than refreshed, is the exception: it
  lives in the UiState, which then has to be `@Stable` rather than `@Immutable`.
- A component-bound composable takes the component, collects its state lifecycle-aware, and passes
  values and lambdas down to stateless views. It is the **one** carve-out from "state in, lambdas
  out", and it is narrow: it renders and forwards, it holds no logic.
- Component-bound composables live in `ui/components/`, one per file, beside the component.

## Boundary with the other two categories

Three categories, three contracts — do not merge them:

- `ui/components/` — stateful. Takes a component, collects state.
- `ui/viewcomponents/` — stateless, `internal`, screen-specific: value in, events out.
- `core/designsystem` — stateless, domain-agnostic, reused across features. A design system
  component never takes a component and never collects a `Flow`.

A view that starts collecting is a component-bound composable in the wrong folder. Move it, do not
relax the folder's contract.

## Dependency injection

- A component is constructed, not resolved. Its owner receives a **factory function type** by
  constructor injection and calls it; nothing reaches into the Koin container at runtime.
- Never `koinViewModel()`, never `koinInject()` and never `get()` inside a component or a
  component-bound composable. Runtime arguments are the factory's parameters.
- Register the factory in the feature's Koin module next to the ViewModel binding, and declare the
  runtime parameter types in `verify(extraTypes = …)` so module verification still passes.

## Costs

- Lifetime is manual. The compiler will not tell you that an `attach` is missing.
- `@Preview` of a whole screen needs an interface per component and a fake implementation; previews
  of the individual views stay trivial.
- On a screen below the escalation threshold this is complexity with no payoff.

## Do / Don't

- DO give each component a single region and a single reason to change.
- DO test a component directly — no ViewModel, no Compose, no `SavedStateHandle`.
- DON'T let two components talk to each other. Coordination belongs to the owner.
- DON'T give a component an effect channel, a `SavedStateHandle`, or a `single` Koin binding.
- DON'T create a component so that a composable can "have its own ViewModel".

## Related rules

`architecture.md` · `feature-structure.md` · `uikit.md` · `testing.md` · `modularization.md`

This rule stays normative and free of Kotlin. The five infrastructure types, the `MviViewModel`
integration, the Koin factory wiring and the preview and test shapes live in the
`kmp-multiplatform-specialist` skill, `references/component-architecture.md`.
