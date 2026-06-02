# Sealed Classes & State Modeling — Kotlin

## Sealed interface (preferred over sealed class)

```kotlin
sealed interface UiState<out T> {
    data object Loading : UiState<Nothing>
    data class Success<T>(val data: T) : UiState<T>
    data class Error(val message: String) : UiState<Nothing>
}
```

Use `sealed interface` over `sealed class` when no shared state across variants is needed.

## Exhaustive when — compiler enforces all branches

```kotlin
fun handle(state: UiState<User>) = when (state) {
    is UiState.Loading  -> showSpinner()
    is UiState.Success  -> render(state.data)
    is UiState.Error    -> showError(state.message)
}
```

No `else` branch — the compiler forces handling of any new variant added later.
If you need a default, use `else` explicitly and document why.

## CommandResponse — Spovishun pattern

```kotlin
sealed interface CommandResponse {
    data class Success(val text: String) : CommandResponse
    data object AccessDenied : CommandResponse
    data class Error(val cause: String) : CommandResponse
    data object NotFound : CommandResponse
}
```

Controllers return `CommandResponse`. Commands handle it with exhaustive `when`.

## ResultContainer — project-wide error type

```kotlin
sealed class ResultContainer<out T> {
    data class Success<T>(val data: T) : ResultContainer<T>()
    data class Failure(val exception: BaseException) : ResultContainer<Nothing>()

    companion object {
        inline fun <T> catching(block: () -> T): ResultContainer<T> = try {
            Success(block())
        } catch (e: BaseException) {
            Failure(e)
        }
    }
}

// Chain
result
    .flatMap { user -> getUserRole(user.id) }
    .fold(
        onSuccess = { role -> render(role) },
        onFailure = { ex -> showError(ex.message) }
    )
```

## data object vs data class

| | `data object` | `data class` |
|---|---|---|
| Has state | No | Yes |
| Equality | Singleton identity | Structural |
| Use for | Singleton variants (Loading, AccessDenied) | Variants that carry data |

## When to use sealed classes vs enums

- Use `sealed class`/`interface` when variants carry different data.
- Use `enum class` when all variants are identical in structure (just labels).

```kotlin
// enum — all variants same structure
enum class MemberRole { MEMBER, MODERATOR, ADMIN }

// sealed — variants differ
sealed interface CommandResponse { ... }
```

## Rules

- Always use `when` as an expression on sealed types — assign the result to a variable.
- Never add `else` to a `when` on a sealed type unless you deliberately want to ignore new variants.
- Use `data object` for singleton variants, `data class` for data-carrying variants.
