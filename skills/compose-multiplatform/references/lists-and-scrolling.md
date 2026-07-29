# Lists and Scrolling

The performance traps and hardening details of lazy layouts — not the basics of `LazyColumn`,
`LazyRow`, the `items` DSL, or grids.

## The `indexOf`-in-the-item-factory O(n²) trap

Calling `indexOf`, `lastIndexOf` or `indexOfFirst { }` on the source list **inside** the item lambda
is O(n) per item, so one scroll pass costs O(n²). It is a convincing trap because the lookup is
usually genuinely needed — "highlight the active row".

```kotlin
// WRONG — every item rescans the whole list for its own position, on every scroll recomposition
items(items, key = { it.id }) { item ->
    val isActive = items.indexOf(item) == activeIndex
    ItemRow(item, isActive)
}

// RIGHT — itemsIndexed hands you the index for free
itemsIndexed(items, key = { _, it -> it.id }) { position, item ->
    ItemRow(item, isActive = position == activeIndex)
}

// RIGHT — when the lookup is by id rather than position, build the map once, outside the lambda
val byId = remember(items) { items.associateBy { it.id } }
items(items, key = { it.id }) { item -> ItemRow(item, isActive = byId[activeId] === item) }
```

The same call is also a crash source: `indexOf` returning `-1` for an item that was just removed feeds
`-1` into an indexed access.

## Keys: never allocate in the key lambda

A stable id is the easy part. The trap is computing a **new object** in the key lambda, which defeats
the key entirely — it changes on every recomposition:

```kotlin
items(users, key = { User(it.id, it.name) }) { … }   // WRONG — a new object each time
items(users, key = { it.id }) { … }                  // RIGHT — a stable primitive id
```

Duplicate keys are worse than no keys: colliding ids throw at runtime rather than degrading. If the
source can genuinely contain duplicates, de-duplicate before the list, not inside the key lambda.

## `contentType` for heterogeneous lists

Without it, every item shape competes for a single reuse pool, so a header and a row keep evicting
each other:

```kotlin
LazyColumn {
    items(items, key = { it.id }, contentType = { it.type }) { item -> Row(item) }
}
```

## Stable keys are what make `animateItem()` work

Keys give each item an identity across recompositions, which is precisely what per-item add/remove/move
animation, efficient diffing and per-item state preservation depend on:

```kotlin
items(items, key = { it.id }) { item ->
    ItemRow(
        item,
        modifier = Modifier.animateItem(
            fadeInSpec = tween(250),
            placementSpec = spring(Spring.DampingRatioLowBouncy, Spring.StiffnessMediumLow),
            fadeOutSpec = tween(150),
        ),
    )
}
```

Reach for `itemsIndexed` only when the index is genuinely needed for display.

## Per-item lambdas

An item lambda that captures a per-item value is allocated fresh on every scroll, which defeats strong
skipping for the row. Key it by the stable id when the row is expensive:

```kotlin
items(items, key = { it.id }) { item ->
    val onClick = remember(item.id) { { onItemClick(item) } }
    ItemRow(item, onClick = onClick)
}
```

Do this when a measurement shows the row recomposing during scroll — not by default.

## Infinite scroll — derive the trigger

```kotlin
val shouldLoadMore by remember {
    derivedStateOf {
        val last = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
        last >= listState.layoutInfo.totalItemsCount - PREFETCH_THRESHOLD
    }
}

LaunchedEffect(shouldLoadMore) { if (shouldLoadMore) viewModel.loadNextPage() }
```

Deriving the boolean means the effect fires when the *answer* changes, not on every scroll pixel.
Keep `PREFETCH_THRESHOLD` configurable: scroll-event delivery differs between platforms and OEMs, so a
threshold tuned on one device triggers too early or too late on another.

## Prefetch and the cache window

Lazy layouts compose just outside the viewport to keep the frame budget steady. Where the API is
available, the window is tunable:

```kotlin
val state = rememberLazyListState(cacheWindow = LazyLayoutCacheWindow(ahead = 2, behind = 1))
```

Raise `ahead` for tall items with slow images; lower it when items are cheap and prefetching only
costs memory. Touch this **only** when a profile shows item composition spiking under scroll — and
check the Foundation version in `libs.versions.toml` first, because these APIs moved recently and are
still marked experimental in some releases.

## Two scroll containers fighting

Do not wrap a lazy child in a `verticalScroll` modifier, and do not nest a `Column(verticalScroll)`
inside a `LazyColumn` item. A lazy layout inside an infinitely-tall scroll parent loses its whole
reason to exist: it is asked to measure every item at once. Use nested lazy composables, or a
`nestedScroll` connection when the two really must coordinate.
