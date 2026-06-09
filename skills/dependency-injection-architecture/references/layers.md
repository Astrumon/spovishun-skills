# Layer Architecture

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
