# KMP Navigation Rules

Type-safe Navigation Compose (`org.jetbrains.androidx.navigation:navigation-compose`) across
feature modules.

## Where a route lives

A route is the feature's public contract, so it lives in `feature/<name>/api` — the only module
another feature is allowed to depend on.

```kotlin
// feature/logs/api
@Serializable
data object LogsRoute

@Serializable
data class LogDetailRoute(val id: String)

fun NavController.navigateToLogDetail(id: String) = navigate(LogDetailRoute(id))
```

- Routes are `@Serializable` — `data object` when there are no arguments, `data class` when there are.
- Arguments are primitives or `@Serializable` value types. Never pass a domain model or a lambda
  through a route.
- The `navigateTo…` extension ships next to the route so callers never construct the route inline.

## Where the graph lives

The graph is assembled once, in `composeApp`. A feature never creates its own `NavHost`.

```kotlin
// composeApp
NavHost(navController = navController, startDestination = DashboardRoute) {
    composable<DashboardRoute> {
        DashboardRoute(onOpenLogs = { navController.navigate(LogsRoute) })
    }
    composable<LogsRoute> {
        LogsRoute(onOpenDetail = { id -> navController.navigateToLogDetail(id) })
    }
    composable<LogDetailRoute> { entry ->
        LogDetailRoute(id = entry.toRoute<LogDetailRoute>().id)
    }
}
```

- Adding a screen = one route in `api` + one `composable<Route>` entry in `composeApp`. Nothing else.
- Read arguments with `entry.toRoute<T>()`; never parse a string route by hand.

## Who triggers navigation

- A tap that only moves the user forward: the composable calls the lambda the graph passed in. The
  ViewModel is not involved.
- Navigation that depends on a result (login succeeded, item saved, retry exhausted): the ViewModel
  emits a **navigation Effect**, the Route collects it and calls the lambda. Nothing navigates from
  inside the ViewModel — it has no `NavController` and must not gain one.
- Top-level destination selection (bottom bar, rail) is state in a navigation state holder, synced
  with the real back stack.

```kotlin
// syncing a selected top-level destination with the back stack
LaunchedEffect(selected) {
    // guard: navigating before the graph is set crashes on the first frame
    if (currentDestination == null || currentDestination.matches(selected)) return@LaunchedEffect
    navController.navigate(selected) {
        popUpTo(startDestination) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}
```

## Adaptive shell

The navigation shell picks its presentation from the window size class — rail or drawer on Expanded,
bottom bar on Compact. It is one component in `composeApp`, not a per-screen decision.

## Do / Don't

- DO keep `feature/<name>/api` limited to routes and their navigation extensions.
- DO use `launchSingleTop` for top-level destinations so repeated taps do not stack duplicates.
- DON'T inject a `NavController` into a ViewModel, a repository, or a `viewcomponents/` view.
- DON'T declare a second `NavHost` inside a feature.
- DON'T centralise every route in a shared `core/navigation` module — that makes each new screen
  touch a file every feature depends on and rebuilds the whole graph.

## Migration note

Navigation 3 (`NavKey` + an explicit back stack + a `Navigator` abstraction) is the direction the
ecosystem is moving and is supported by Compose Multiplatform 1.10+. It is not the standard here
yet: the surrounding KMP tooling is still built around Navigation 2. Do not mix the two in one
project — migrate wholesale or not at all.

## Related rules

`feature-structure.md` · `architecture.md` · `localization.md`
