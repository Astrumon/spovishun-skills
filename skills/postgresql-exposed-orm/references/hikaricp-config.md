# HikariCP Connection Pool — Spovishun

## Basic configuration

```kotlin
val config = HikariConfig().apply {
    jdbcUrl         = "jdbc:postgresql://host:5432/dbname"
    driverClassName = "org.postgresql.Driver"
    username        = System.getenv("DB_USER")
    password        = System.getenv("DB_PASSWORD")
    maximumPoolSize = 10
    minimumIdle     = 2
    connectionTimeout       = 30_000    // ms — throw if no connection available
    idleTimeout             = 600_000   // ms — close idle connections after 10 min
    maxLifetime             = 1_800_000 // ms — recycle connections after 30 min
}
Database.connect(HikariDataSource(config))
```

## Pool sizing guidelines

| Environment | `maximumPoolSize` | `minimumIdle` |
|---|---|---|
| Dev (local) | 5 | 1 |
| Prod (Neon) | 10 | 2 |
| Test | 2 | 1 |

Formula: `pool_size ≈ (num_cores × 2) + disk_count`. For a 2-core host → 5–10 is typical.

## Neon (cloud PostgreSQL) specifics

- Neon uses server-side connection pooling (PgBouncer). Keep HikariCP pool smaller (5–10) to avoid saturating Neon's connection limit.
- Enable `connectionTestQuery = "SELECT 1"` if Neon recycles idle connections aggressively.
- Set `maxLifetime` below Neon's idle connection timeout to avoid stale connection errors.

## Timeout tuning

```kotlin
connectionTimeout      = 30_000   // fail fast if pool is exhausted
validationTimeout      = 5_000    // time limit for a test connection query
leakDetectionThreshold = 60_000   // warn if a connection is held > 60s (dev only)
```

## Where it lives

`DatabaseFactory.kt` in `data/db/` is the only class that creates and holds the `HikariDataSource`.
No other class may instantiate a data source or reference `Dispatchers.IO`.
