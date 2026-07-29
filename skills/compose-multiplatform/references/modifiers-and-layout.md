# Modifiers and Layout

The `modifier` parameter and the content slots together are a reusable composable's **public API**.
The caller owns *placement*; the component owns *its own internals*. This file covers the modifier
half of that contract plus chain ordering.

The component contract itself — stateless, hoisted, theme colours, preview — is normative in
`.claude/rules/kmp/uikit.md`. These are the mechanics that implement it.

## Rule 1 — the parameter is named `modifier`, exactly

Any composable that emits layout declares `modifier: Modifier = Modifier`. Not `mod`, not `m`, not
`wrapperModifier`. It goes after the required parameters and before the content lambdas.

```kotlin
// WRONG
@Composable fun Avatar(url: String, m: Modifier = Modifier) { … }

// RIGHT
@Composable fun Avatar(url: String, modifier: Modifier = Modifier) { … }
@Composable fun Card(modifier: Modifier = Modifier, content: @Composable () -> Unit) { … }
```

Lint rules, IDE inspections and every reader's expectation assume this exact name and position. The
default `= Modifier` lets callers omit it; the name is not negotiable.

## Rule 2 — apply the caller's modifier to the root

Caller-supplied `.size(…)`, `.padding(…)` and `.weight(…)` must reach the **outermost** emitted node.

```kotlin
// WRONG — the caller's .size(120.dp) lands on the inner Image; the Box still measures
// intrinsically, so the Avatar is the wrong size from its parent's perspective
@Composable
fun Avatar(url: String, modifier: Modifier = Modifier) {
    Box {
        Image(painter = rememberAsyncImagePainter(url), contentDescription = null, modifier = modifier)
    }
}

// RIGHT
@Composable
fun Avatar(url: String, modifier: Modifier = Modifier) {
    Box(modifier = modifier) {
        Image(painter = rememberAsyncImagePainter(url), contentDescription = null)
    }
}
```

Layout modifiers measure the node they are attached to. Routing the caller's modifier to a child
silently drops sizing, weight and padding from the parent's point of view.

## Rule 3 — the caller's modifier comes first in the chain

```kotlin
// WRONG — the hardcoded chain is first, so the caller's .size(120.dp) is a no-op for the outer size
Box(modifier = Modifier.size(48.dp).clip(CircleShape).then(modifier))

// RIGHT — caller first; the identity modifier follows
Box(modifier = modifier.clip(CircleShape))
```

Whichever `.size(…)` comes first wins for the measurement the parent sees. The only modifiers that
legitimately follow the caller's are those defining what the component *is* — `Avatar`'s circular
crop.

## Rule 4 — no hardcoded placement on a reusable root

A reusable component's root must not carry `.fillMaxWidth()`, a fixed height, or outer padding.
Placement is the parent's decision — that is what the `modifier` parameter is for. This is the rule
most often broken.

```kotlin
// WRONG — usable only in the screen it was extracted from
@Composable
fun ListItem(text: String, modifier: Modifier = Modifier) {
    Row(modifier = modifier.fillMaxWidth().height(56.dp).padding(horizontal = 16.dp)) { Text(text) }
}

// RIGHT — internals only; the caller places it
@Composable
fun ListItem(text: String, modifier: Modifier = Modifier) {
    Row(modifier = modifier) { Text(text, Modifier.padding(horizontal = 16.dp)) }
}
// ListItem("Hello", modifier = Modifier.fillMaxWidth().height(56.dp))
```

**Identity carve-out:** visual-identity modifiers — without which the component would not be that
component — may stay on the root, applied *after* the caller's (Rule 3).

## Rule 5 — one fluent `val`, never reassignment

```kotlin
// WRONG — readers must replay each statement to recover the final order
var m = modifier
m = m.fillMaxWidth()
if (isError) m = m.background(Color.Red)

// RIGHT — one expression; conditionals inline
Box(
    modifier = modifier
        .fillMaxWidth()
        .then(if (isError) Modifier.background(MaterialTheme.colorScheme.errorContainer) else Modifier)
        .padding(16.dp)
)
```

`Modifier` is an immutable ordered chain. Reassignment scatters it across lines that look like state
mutation and hides the order, which is load-bearing.

## Rule 6 — multiline from three calls up

One or two calls inline; three or more multiline, each on its own line. Ordering bugs are invisible in
a long one-liner, and a diff that adds one modifier should not touch the whole line.

## Rule 7 — hoist a lone `if` out of a layout

```kotlin
// WRONG — the Box exists only to host an if, and allocates a layout node every recomposition
Box { if (showBanner) Banner() }

// RIGHT
if (showBanner) Banner()
```

Keep the wrapper when it carries real semantics (a modifier, alignment or arrangement doing work),
when the `if` has siblings sharing that layout, or when both branches of an `if/else` need it.

## Chain ordering

Modifiers apply left to right in the DSL and conceptually wrap bottom to top — each wraps what
follows. Order **outer (layout, sizing) → inner (styling, interaction)**.

```kotlin
Modifier.background(Color.Red).padding(16.dp).size(100.dp)   // red wraps the padded 100dp box
Modifier.size(100.dp).padding(16.dp).background(Color.Red)   // the 100dp box is padded; red covers the total
```

`.size` after `.padding` excludes the padding from the final outer size. `.clip` before `.background`
clips the background to the shape; after it, it does not.

## Custom modifiers, semantics, test tags

- **Custom modifiers:** use the `Modifier.Node` / `ModifierNodeElement` API, not the deprecated
  `composed { }`, which creates a composition scope per use and captures composition locals.
- **Semantics** (`contentDescription`, `role`, `mergeDescendants`, `clearAndSetSemantics`) are how the
  component is reachable to both accessibility services and tests. Setting them is part of the
  component contract, not a testing afterthought.
- **`testTag`** is a last resort for selection — see **`kmp-testing`** for the priority order.
