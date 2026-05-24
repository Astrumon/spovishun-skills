# Dependency Injection & Architecture (Kotlin)

You are an expert in clean architecture and dependency injection for Kotlin applications.

## Layer Architecture

```
presentation (commands, handlers)  ← handles input
    ↓
domain (services)                  ← business logic, orchestration
    ↓
data (repositories)                ← data access (DB, in-memory)
    ↓
common                             ← pure Kotlin utilities, zero project imports
```

**Rules:**
- `presentation` → `domain` ← `data` (allowed dependency direction)
- `common` is accessible from all layers
- `di` wires everything and knows all layers
- Each layer only knows about the layer directly below it
- Repositories return domain objects, not DB entities

## Hard Rules per Layer
- `domain/` — no Telegram SDK, no Exposed/JDBC, no Koin, no `Dispatchers.IO`
- `data/` — no Telegram SDK, never call services
- `common/` — pure Kotlin only, zero project imports
- `presentation/` — no Exposed/DB imports; no business logic in Command classes
- Only `data/db/DatabaseFactory.kt` may use `Dispatchers.IO`

## Koin Setup Pattern
```kotlin
val appModule = module {
    // Data layer
    single<UserRepository> { UserRepositoryImpl(get()) }

    // Service layer
    single { UserService(get()) }
    single { NotificationService(get(), get()) }

    // Controller layer
    single { BotController(get(), get()) }
}

fun main() {
    startKoin {
        modules(appModule)
    }
}
```

## Profile-Based Configuration
```kotlin
val devModule = module {
    single<MemberRepository> { MemberRepositoryMockImpl() }
}
val prodModule = module {
    single<MemberRepository> { MemberRepositoryImpl() }
}

val profile = System.getenv("PROFILE") ?: "dev"
startKoin { modules(if (profile == "prod") prodModule else devModule) }
```

## DI Best Practices
- Prefer constructor injection — dependencies are explicit and testable
- Use interfaces for all services and repositories — enables mocking
- `single` for stateful/expensive objects (DB connections, services)
- `factory` for lightweight, stateless objects created per request
- Never inject the DI container itself — it's a service locator anti-pattern
- All repository bindings use the interface type: `single<MemberRepository> { MemberRepositoryImpl() }`

## Naming Conventions
- Interface: `UserRepository`
- Implementation: `UserRepositoryImpl` (DB), `UserRepositoryMockImpl` (in-memory)
- Module file: `DevRepositoryModule.kt`, `ProdRepositoryModule.kt`, `ServiceModule.kt`
- Never use `UseCase` — use `Service` instead

## Adding a New Service (Checklist)

1. Define interface in `domain/`
2. Implement in `data/` (or `domain/` if no DB access needed)
3. Register in appropriate Koin module
4. Inject in the consuming class via constructor
5. Add MockImpl in `data/` for unit testing

## Common Pitfalls
- Circular dependencies — Koin will throw at startup; redesign with an intermediate service
- `get()` inside `factory {}` re-resolves every call — use `single {}` for expensive objects
- `by inject()` at field level creates late-init binding — prefer constructor injection for testability
