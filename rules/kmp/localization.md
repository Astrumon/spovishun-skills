# KMP Localization Rules

Compose Resources (`org.jetbrains.compose.components.resources`) across feature modules.

## Where strings live

Compose Resources generates a **separate `Res` class per Gradle module**. That decides the layout:

```
core/designsystem/src/commonMain/composeResources/
  values/strings.xml            # default locale (English)
  values-uk/strings.xml
    → app name, OK, Cancel, Retry — anything two features both need

feature/logs/impl/src/commonMain/composeResources/
  values/strings.xml
  values-uk/strings.xml
    → strings belonging to this feature only
```

- A feature's strings live in that feature's module. A new screen never edits a shared strings file,
  so it never rebuilds every module that depends on it.
- A string moves to `core/designsystem` on its **second** consumer, not before.
- Import the `Res` of the module you are in. A feature cannot read another feature's `Res` — if it
  needs the string, the string belongs one level down. `Res` is `internal` by default, which
  enforces exactly that; leave it internal.

**Every module with resources must declare its `Res` package.** Without it the package is derived
from the root project name and the Gradle module path (`kmpprobe.feature.logs.impl.generated.resources`)
— which does not match your Kotlin package, is not stable across a rename, and produces import
errors that look like a missing dependency.

```kotlin
// feature/logs/impl/build.gradle.kts
compose.resources {
    packageOfResClass = "com.example.app.feature.logs.impl.generated.resources"
}
```

```kotlin
import com.example.app.feature.logs.impl.generated.resources.Res
import com.example.app.feature.logs.impl.generated.resources.logs_title

Text(text = stringResource(Res.string.logs_title))
```

## The rule

- **No hardcoded user-facing text.** Every string a user reads comes from `stringResource(...)`.
- Every key exists in **all** locale folders of its module. A key present in `values/` but missing in
  `values-uk/` silently falls back to English at runtime — no build error.
- Key naming: `<screen>_<element>` (`logs_title`, `logs_empty_message`, `logs_retry_action`).
  Prefix with the feature name in the shared module (`common_ok`, `common_cancel`).
- Plurals go through plural resources, never string concatenation.
- Values interpolate through format arguments — `stringResource(Res.string.logs_count, n)` — never
  Kotlin string templates around a resource.

## Errors and status text

Text that depends on a result is a **typed state**, not a string produced in the ViewModel.

- The ViewModel emits a sealed error/status type.
- A `@Composable` mapper at the screen root turns that type into a `stringResource`.
- This keeps the ViewModel free of Compose imports and keeps every user-visible string in resources.

```kotlin
// LogsErrorLabel.kt — screen root, not viewcomponents/
@Composable
internal fun LogsError.label(): String = when (this) {
    LogsError.Offline -> stringResource(Res.string.logs_error_offline)
    LogsError.Unauthorized -> stringResource(Res.string.logs_error_unauthorized)
    is LogsError.Unknown -> stringResource(Res.string.logs_error_unknown)
}
```

## Non-string resources

Drawables, fonts and raw files follow the same per-module rule and the same promotion rule: they
start in the feature that uses them and move to `core/designsystem` on the second consumer.

## Do / Don't

- DO add every new key to all locale folders in the same commit.
- DO keep an error message out of the ViewModel — emit the type, render the string.
- DON'T build a sentence by concatenating two resources; word order differs per language.
- DON'T put a feature's strings in `core/designsystem` "so they are all in one place".
- DON'T ship a string that only exists in the non-default locale — the default is the fallback.

## Related rules

`uikit.md` · `feature-structure.md` · `architecture.md`
