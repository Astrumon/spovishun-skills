# KMP Modularization Rules

Applies to Kotlin Multiplatform projects (`stack.kmp: true`). Governs visibility and module
boundaries. Module and package layout itself is in `feature-structure.md`.

## Declare at the lowest visibility that still compiles

Every declaration starts at the narrowest visibility and widens only when something forces it:

```
private  →  internal  →  public
```

- `private` — used only inside the file or the class.
- `internal` — used across files within the same Gradle module. **This is the default for
  implementation code**, not `public`.
- `public` — part of the module's API, consumed by another module.

Kotlin's default is `public`, which is the wrong default for implementation code: it silently makes
every class part of the module's surface. Writing `internal` is not ceremony — it is the difference
between a module you can refactor and one you cannot.

## Widening requires a real consumer

A declaration becomes `public` when another module actually imports it — not because it might one day,
not because a test in the same module reads it (tests in the same module see `internal`), and not to
silence a warning.

The same rule applies to modules themselves: a `core/` module is created on the **second** consumer,
never in anticipation of one (`architecture.md`).

## Implementations stay `internal` behind `public` interfaces

The canonical shape for anything bound through DI:

- The **interface** is `public`, in the layer that owns the contract (`domain` for repositories).
- The **implementation** is `internal`, in the layer that implements it (`data`).
- The DI declaration binds the two. A DI module can see `internal` types within its own module, so
  nothing has to widen for wiring.

If an implementation class has to become `public` for the graph to compile, the DI declaration is in
the wrong module — move the declaration, do not widen the class.

Consumers depend on the interface. A caller that names the implementation type has bypassed the
boundary, and no compiler check will notice.

## A module's API is what it exports, not what it contains

- Every `public` declaration is a promise: renaming or removing it breaks another module.
- A module with no `internal` declarations at all has no boundary — its entire contents are its API.
- Prefer few, deliberate entry points over many incidentally-public helpers.

## Layer visibility

- `domain` exposes interfaces, models and use cases as `public` — that is its purpose.
- `data` exposes **nothing but** the DI declaration. DTOs, mappers, sources and implementations are
  all `internal`. A DTO cannot cross out of `data` anyway (`networking.md`); `internal` is what
  enforces it rather than trusting review.
- `ui` exposes the screen entry point and, for a design-system module, its components. State holders
  and internal composables stay `internal`.

## `expect`/`actual` and visibility

An `actual` must match its `expect` in visibility. An `internal expect` is the right choice for a
platform seam that only its own module uses — widening both sides to `public` just to place an
`actual` exposes a platform detail to every consumer.

## Do / Don't

- DO write `internal` by default in implementation code, and let review question a `public`.
- DO keep the DI declaration in the same module as the implementation it binds.
- DON'T widen visibility to make a test pass — same-module tests already see `internal`; a test that
  needs `public` is testing across a boundary it should be respecting.
- DON'T add a module to "keep things organised". A module is a compilation and dependency boundary;
  packages are for organisation.
- DON'T create a `common`/`shared`/`utils` module as a home for anything that does not fit — it
  becomes a dependency every module has and nobody can remove.
- DON'T let a cycle form. Two modules needing each other means the shared part belongs in a third, or
  the boundary is drawn in the wrong place.

## Related rules

`feature-structure.md` (module and package layout) · `architecture.md` (layers and escalation) ·
`networking.md` · `persistence.md` · `uikit.md`
