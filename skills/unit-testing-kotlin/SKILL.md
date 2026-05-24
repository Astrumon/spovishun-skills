# Unit Testing in Kotlin

You are an expert in testing Kotlin code using JUnit 5, MockK, and Kotest. You produce clean, readable tests that document behavior and catch regressions.

## Test Structure (AAA Pattern)
```kotlin
@Test
fun `should return user when found by telegram id`() {
    // Arrange
    val telegramId = 123456L
    val expected = User(id = 1, telegramId = telegramId, username = "testuser")
    every { userRepository.findByTelegramId(telegramId) } returns expected

    // Act
    val result = userService.findByTelegramId(telegramId)

    // Assert
    assertEquals(expected, result)
    verify(exactly = 1) { userRepository.findByTelegramId(telegramId) }
}
```

## Naming Conventions
- Use backtick function names: `` `should do X when Y` ``
- Be descriptive: what is expected and under what condition
- Group by class: `UserServiceTest`, `GroupRepositoryTest`

## MockK Patterns
```kotlin
// Basic mock
val repo = mockk<UserRepository>()
every { repo.findById(any()) } returns null

// Verify calls
verify { repo.save(withArg { it.username == "john" }) }

// Mock suspend functions
coEvery { repo.findAsync(any()) } returns user
coVerify { repo.findAsync(123L) }

// Spy on real object
val service = spyk(UserService(repo))
```

## Testing Coroutines
```kotlin
@Test
fun `should process notifications asynchronously`() = runTest {
    // Use runTest from kotlinx-coroutines-test
    coEvery { notificationService.send(any()) } returns Unit
    service.notifyAll(listOf("user1", "user2"))
    coVerify(exactly = 2) { notificationService.send(any()) }
}
```

## Rules
- Always use `runTest { }` for `suspend fun` tests
- Use `coEvery` / `coVerify` for suspending mocks
- Test names use backtick format
- `@BeforeTest` to `clearAllMocks()` between tests
- No real DB connections in unit tests — use MockImpl repos or H2 for integration tests
- Test success and failure paths explicitly for result containers

## What to Test
- Happy path — main use case works correctly
- Edge cases — empty input, null, boundary values
- Error cases — exceptions are thrown/handled correctly
- Behavior — verify interactions with dependencies

## What NOT to Test
- Private methods directly — test through public API
- Framework code — trust the library
- Trivial getters/setters — no business logic = no test needed
- DI container wiring, bot entry point, `DatabaseFactory`
