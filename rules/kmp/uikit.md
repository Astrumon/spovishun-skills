# KMP Design System Rules

Reusable visual building blocks live in `core/designsystem`. Screen-specific composition lives in
that screen's `viewcomponents/` folder (see `feature-structure.md`).

## What belongs in `core/designsystem`

- The theme: color scheme, typography, shapes, spacing tokens.
- Components used by two or more features: buttons, inputs, cards, chips, icons, loaders, empty and
  error placeholders.
- Strings shared across the whole app (OK, Cancel, Retry, app name).

## What does not

- A composable used by exactly one screen — that is `viewcomponents/`.
- Anything that reads a `UiState`, resolves DI, or knows a route. The design system is
  domain-agnostic: it renders what it is given.

## Extraction rule

Extract on the **second** usage, not the first and not the third.

- First usage: write it inside the screen's `viewcomponents/`.
- Second usage in another feature: move it to `core/designsystem`, generalise the parameters, delete
  both copies.
- Never copy-paste a styled Compose block between features. A duplicated modifier chain is the
  signal that the component already exists.

## Component contract

- Stateless and hoisted: value in, events out. No `remember`ed business state, no DI, no ViewModel.
- Every component takes `modifier: Modifier = Modifier` as its first optional parameter and applies
  it to its outermost node.
- Colors, sizes and typography come from the theme — never a hardcoded `Color(0xFF…)` or a magic
  `20.dp` inside a component.
- Text comes in as a `String` or a resource reference. A design system component does not resolve
  strings from a feature's resources.
- `@Preview` in light and dark next to every non-trivial component.

```kotlin
@Composable
fun AppPrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Button(
        onClick = onClick,
        modifier = modifier,
        enabled = enabled,
        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
    ) {
        Text(text = text, style = MaterialTheme.typography.labelLarge)
    }
}
```

## Theme usage

- Every screen renders inside the single app theme applied once in `composeApp`. A screen or a
  component never wraps itself in the theme — that breaks previews and nests the theme twice.
- Use the `on…` color pairs as pairs: content placed on `primaryContainer` uses `onPrimaryContainer`.
  Picking a contrast color by hand is how a design survives light mode and fails dark mode.
- Compose has no margin. All spacing is `padding` on the child or an `Arrangement` on the parent.

## Stability

Design system components are consumed across module boundaries, so their parameter types are
Unstable by default. Keep parameters primitive or `@Immutable`, and prefer `() -> List<T>` over
`List<T>`. See the Compose stability section in `architecture.md`.

## Do / Don't

- DO delete the local copy when you promote a component — two sources of truth is worse than one
  duplicate.
- DON'T let a design system component depend on `feature/*` or on `domain`.
- DON'T add a component "for later". Ship it when the second caller exists.

## Related rules

`feature-structure.md` · `localization.md` · `architecture.md`
