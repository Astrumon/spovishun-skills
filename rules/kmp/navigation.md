# KMP Navigation Rules

Navigation 3 is the standard for new KMP projects — Compose Multiplatform 1.10+ ships it for
Android, iOS, desktop and web. A project already on Navigation 2 keeps every rule below except the
wiring; see **Legacy**. Never mix the two.

Wiring code lives in the `kmp-multiplatform-specialist` skill, `references/navigation-3.md`.

## The back stack is the only navigation state

The back stack is where navigation state lives. Anything a screen or the shell needs to know about
"where am I" is **derived** from it, never copied out of it.

- The selected top-level destination (bottom bar, rail) is a **read** of the back stack's current
  top-level key. It is not a second field, not a `StateFlow` in a ViewModel, not a DI singleton.
- Two effects that write to each other — one pushing a stored selection onto the back stack, one
  pushing the back stack into the stored selection — are not synchronisation. They are two sources
  of truth with a race between them, and the guard that stops the loop is the same guard that makes
  a legitimate repeat navigation do nothing.
- A holder that only mirrors the back stack also carries a lifetime bug: bind it per-resolution
  instead of once and the selection silently resets on recomposition. Deriving deletes the class,
  and the whole failure mode with it.

## Where a key lives

A destination key is the feature's public contract, so it lives in `feature/<name>/api` — the only
module another feature may depend on.

- Keys are `@Serializable` and implement `NavKey`: `data object` without arguments, `data class`
  with. Arguments are primitives or `@Serializable` value types — never a domain model, never a
  lambda.
- Every key is also `@Keep`. Type-safe navigation and `kotlinx.serialization` reach keys
  reflectively, so R8 can rename or strip one and break navigation **in release builds only**.
  A key without `@Keep` is a bug.
- The feature registers its keys in a `SerializersModule`. Reflection-based back-stack restoration
  is Android-only; every other target needs an explicit `polymorphic(NavKey::class) { … }`
  contribution. Skipping it compiles and works on Android, then fails to restore state on iOS,
  desktop and web.

## Where the graph lives

A feature owns its entries. `composeApp` composes **features**, never screens.

- Each feature exposes one entry builder — an extension on `EntryProviderScope` declared in
  `feature/<name>/impl` — or contributes it through DI as one element of a set. `composeApp` calls
  the features and knows nothing about how many screens each one has.
- Adding a screen touches its feature and nothing else. If a new screen forces an edit to
  `composeApp`, the graph has become a switchboard: every feature's change lands in one file, and
  that file is the merge conflict.
- An entry hands its screen a navigation lambda or an injected navigator. Extract a feature-level
  builder when screens evolve together (auth, onboarding, checkout); a single independent
  destination does not need one.

## One display, one shell

- The display is created **once**, above any branch on window size class. Only the chrome — rail,
  drawer or bottom bar — branches. Two displays in two layout branches duplicate the entry list and
  re-create the display whenever the window crosses a breakpoint.
- It must carry both the saveable-state and the ViewModel-store entry decorators. Without the
  ViewModel-store decorator a screen's ViewModel is scoped to the host instead of to its entry:
  every screen shares one instance, and none is cleared when its entry pops.
- The shell picks rail or drawer on Expanded and a bottom bar on Compact. It is one component in
  `composeApp`, not a per-screen decision.

## Who triggers navigation

- A tap that only moves the user forward: the composable calls the lambda its entry passed in. The
  ViewModel is not involved.
- Navigation that depends on a result (login succeeded, item saved, retry exhausted): the ViewModel
  emits a navigation `Effect`, the Route collects it and calls the lambda.
- A destination renders its key. It never reads the back stack to decide what to show.

## Do / Don't

- DO keep `feature/<name>/api` limited to keys and their `SerializersModule` contribution.
- DON'T inject a `NavController`, a navigator, or the back stack into a ViewModel, a repository, or
  a `viewcomponents/` view. A ViewModel has none and must not gain one.
- DON'T declare a second display or `NavHost` inside a feature.
- DON'T centralise keys in a shared `core/navigation` module — every new screen would touch a file
  every feature depends on.

## Legacy: Navigation 2

A project on `org.jetbrains.androidx.navigation:navigation-compose` 2.x keeps every rule above on
state ownership, key placement and who triggers navigation. Only the wiring differs: `NavHost`
instead of the Nav 3 display, a `NavGraphBuilder.<name>Graph()` extension per feature instead of an
`EntryProviderScope` one, and `entry.toRoute<T>()` to read arguments.

Migrate wholesale or not at all.

## Related rules

`feature-structure.md` · `architecture.md` · `localization.md`
