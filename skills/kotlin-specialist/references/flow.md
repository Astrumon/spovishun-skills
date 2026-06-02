# Flow — Kotlin Coroutines

## Cold flow

Cold: each collector gets its own execution. No state is shared between collectors.

```kotlin
fun userUpdates(): Flow<User> = flow {
    while (true) {
        emit(fetchUser())
        delay(5_000)
    }
}

// Collecting
scope.launch {
    userUpdates().collect { user -> render(user) }
}
```

## StateFlow — hot, single shared state

`StateFlow` always has a current value. New collectors immediately receive the latest state.

```kotlin
private val _state = MutableStateFlow<UiState<User>>(UiState.Loading)
val state: StateFlow<UiState<User>> = _state.asStateFlow()

// Update
_state.value = UiState.Success(user)
// or
_state.update { current -> current.copy(isLoading = false) }
```

`StateFlow` replaces `LiveData` — use it for observable mutable state in services.

## SharedFlow — hot, event broadcast

`SharedFlow` does not hold a current value. Use for fire-and-forget events.

```kotlin
private val _events = MutableSharedFlow<BotEvent>(replay = 0, extraBufferCapacity = 64)
val events: SharedFlow<BotEvent> = _events.asSharedFlow()

suspend fun emit(event: BotEvent) = _events.emit(event)
```

`replay = 0` means late subscribers miss past events — suitable for one-shot commands.

## Transformations

```kotlin
val activeUsers: Flow<List<User>> = allUsers
    .filter { it.isActive }
    .map { user -> user.toDisplayModel() }
    .distinctUntilChanged()

// Combine two flows
val combined: Flow<Pair<A, B>> = flowA.combine(flowB) { a, b -> Pair(a, b) }

// Conflate: keep only latest if collector is slow
val throttled = updates.conflate()
```

## flowOn — change upstream context

```kotlin
val processed: Flow<Data> = rawFlow
    .map { heavyTransform(it) }
    .flowOn(Dispatchers.Default)   // only the map runs on Default; collect runs in caller's context
```

Do not use `flowOn(Dispatchers.IO)` — in Spovishun, IO is only allowed inside `DatabaseFactory.kt`.

## Testing with Turbine

```kotlin
@Test
fun `state emits success after load`() = runTest {
    service.state.test {
        assertEquals(UiState.Loading, awaitItem())
        service.load()
        assertEquals(UiState.Success(mockUser), awaitItem())
        cancelAndConsumeRemainingEvents()
    }
}
```

## Rules

- Expose `Flow`, `StateFlow`, or `SharedFlow` from the public API — never `MutableStateFlow`.
- Prefer `StateFlow` for state; `SharedFlow` for events; cold `flow {}` for on-demand data streams.
- Always cancel or complete a `Flow` — dangling collectors are memory leaks.
