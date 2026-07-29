# KMP Persistence Skill

Choosing and wiring local storage in a Kotlin Multiplatform project: multiplatform-settings for
flags, DataStore for reactive preferences and small typed documents, Room for anything relational —
plus the per-platform file paths, corruption handling and KSP wiring each of them needs.

Storage selection, where the schema lives, migration policy and the rule that no storage type crosses
into `domain` are normative — see `.claude/rules/kmp/persistence.md`. This skill implements against
that rule; it does not restate it.

## Scope

**In scope**
- Picking between multiplatform-settings, DataStore (Preferences and typed) and Room.
- Per-platform file paths and secure-storage backings.
- Corruption handling and the error traps specific to each store.
- Room-in-`commonMain` setup: `@ConstructedBy`, `BundledSQLiteDriver`, per-target KSP.
- Migrating from an existing store.
- Diagnosing "the value is gone after restart" and "every read fails forever".

**Out of scope — hand off, do not answer here**
- Whether a given piece of data should be persisted at all → `.claude/rules/kmp/persistence.md`
- Binding the store into the graph → **`koin-kmp`**
- Source-set placement and `expect`/`actual` mechanics → **`kmp-multiplatform-specialist`**
- Caching HTTP responses, DTO→domain mapping → **`ktor-client-kmp`**, `.claude/rules/kmp/networking.md`
- `Flow` operators, `.catch` semantics in general → **`kotlin-specialist`**
- Server-side SQL and Exposed → **`postgresql-exposed-orm`**

## Procedure

1. **Read the build files first.** `libs.versions.toml` and the module's `build.gradle.kts` — report
   which storage libraries are already present. Adding a second store for data the existing one can
   hold is the most common wrong answer here.
2. **Classify the data** — flags, one typed document, or relational — and pick from the table below.
3. **Wire the platform piece** behind the DI boundary, not inside the class that uses it.
4. **Verify.** Run the module's tests and report the real output; for a migration, prove the old data
   is still readable.

## Choosing

| The data | Store |
|---|---|
| A handful of flags and scalars — theme, locale, onboarding done, a server profile | multiplatform-settings |
| The same, but you need a `Flow` that emits on every change | DataStore Preferences |
| One typed object with many related fields and a schema that will evolve | DataStore typed + `Serializer<T>` |
| Anything you would write a `WHERE` or `JOIN` for, more than ~100 rows, or paging | Room |
| Payloads above roughly 50 KB per write | Room, or the filesystem |

Two rules of thumb: if a `WHERE` clause would be useful, it is Room; and DataStore rewrites the
**whole file** on every `edit`, so it is the wrong home for anything that grows.

## multiplatform-settings

The smallest option, and enough for most settings screens. `Settings` is an interface in
`commonMain`; each platform supplies the backing store through DI:

```kotlin
// androidMain — encrypted at rest
actual val platformModule = module {
    single<Settings> {
        SharedPreferencesSettings(
            EncryptedSharedPreferences.create(
                "server_profile.encrypted",
                MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
                get<Context>(),
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        )
    }
}

// jvmMain — plaintext, user-scoped
actual val platformModule = module {
    single<Settings> { PreferencesSettings(Preferences.userRoot().node("com.example.app")) }
}
```

Note what this asymmetry means: the Desktop backing is **not** encrypted. If the value is a
credential, say so explicitly rather than letting the Android encryption imply the whole app is
covered.

It has no `Flow` API of its own. When the UI must react to a change, either wrap writes in a
`MutableStateFlow` owned by the storage class, or use DataStore instead — do not poll.

## DataStore

> **Unverified** — no consumer project here uses DataStore; this section is adapted from
> `rcosteira79/android-skills` → `datastore/SKILL.md`.

The same `androidx.datastore:datastore-preferences-core` runs on Android, iOS and JVM; only the file
path is platform-specific.

**Trap 1 — `.catch` must match `IOException` specifically.** A bare `catch` swallows
`CancellationException`, breaking structured concurrency, and hides serializer failures behind a
silently empty state that looks like a first run:

```kotlin
val settings: Flow<UserSettings> = dataStore.data
    .catch { e -> if (e is IOException) emit(emptyPreferences()) else throw e }
    .map { prefs -> UserSettings(prefs[Keys.DARK_MODE] ?: false, prefs[Keys.LOCALE] ?: "en") }
```

**Trap 2 — typed-store corruption recovery keys off `CorruptionException`, not `IOException`.** The
serializer must wrap parse failures itself, and the store needs a handler. Without both, one corrupt
file makes every read fail permanently, for that install, forever:

```kotlin
object AppSettingsSerializer : Serializer<AppSettings> {
    override val defaultValue = AppSettings()

    override suspend fun readFrom(input: InputStream): AppSettings =
        try {
            Json.decodeFromString(input.readBytes().decodeToString())
        } catch (e: SerializationException) {
            throw CorruptionException("Cannot read AppSettings", e)
        }

    override suspend fun writeTo(t: AppSettings, output: OutputStream) =
        output.write(Json.encodeToString(t).encodeToByteArray())
}

val store = DataStoreFactory.create(
    serializer = AppSettingsSerializer,
    corruptionHandler = ReplaceFileCorruptionHandler { AppSettings() },
    produceFile = { File(filesDir, "app_settings.json") },
)
```

**Trap 3 — the path.** Supply it per platform, and never from the temp directory:

```kotlin
// commonMain
fun createPreferencesDataStore(producePath: () -> String): DataStore<Preferences> =
    PreferenceDataStoreFactory.createWithPath(produceFile = { producePath().toPath() })

// android: context.filesDir.resolve(PREFS_FILE).absolutePath
// ios:     NSDocumentDirectory via NSFileManager
// jvm:     File(System.getProperty("user.home"), ".myapp")  — NOT java.io.tmpdir, the OS may wipe it
```

Never `runBlocking` on DataStore inside a composable: it parks the main thread on disk I/O and re-runs
on every recomposition. Expose a `StateFlow` and collect it.

## Room in `commonMain`

> **Unverified** — no consumer project here uses Room; this section is adapted from
> `rcosteira79/android-skills` → `android-data-layer/SKILL.md`.

Room is KMP-capable from 2.7.0. Three things differ from the Android-only setup:

```kotlin
// commonMain
@Database(entities = [ArticleEntity::class], version = 1, exportSchema = true)
@ConstructedBy(AppDatabaseConstructor::class)          // 1. generated per-platform actuals
abstract class AppDatabase : RoomDatabase() {
    abstract fun articleDao(): ArticleDao
}

@Suppress("KotlinNoActualForExpect")
expect object AppDatabaseConstructor : RoomDatabaseConstructor<AppDatabase>

fun buildDatabase(builder: RoomDatabase.Builder<AppDatabase>): AppDatabase = builder
    .setDriver(BundledSQLiteDriver())                  // 2. one SQLite version everywhere
    .setQueryCoroutineContext(Dispatchers.IO)          // 3. Android defaults this; KMP does not
    .build()
```

`BundledSQLiteDriver` matters because Android's system SQLite version drifts across API levels and
vendors — bundling removes a class of "works on my device" bugs.

**KSP must be wired per target.** `ksp(...)` alone is Android-only and produces a database that fails
to build for every other target:

```kotlin
dependencies {
    add("kspAndroid", libs.androidx.room.compiler)
    add("kspJvm", libs.androidx.room.compiler)
    add("kspIosArm64", libs.androidx.room.compiler)
    add("kspIosSimulatorArm64", libs.androidx.room.compiler)
}

room { schemaDirectory("$projectDir/schemas") }
```

The exported schema directory is what makes migrations reviewable — commit it.

## Do NOT

- Do NOT let an `Entity`, `Preferences` or `Settings` type appear in `domain`.
- Do NOT use a bare `.catch { }` on a DataStore flow.
- Do NOT rely on `IOException` for typed-store corruption recovery.
- Do NOT put a DataStore or database file in the temp directory.
- Do NOT `runBlocking` on storage inside a composable.
- Do NOT store more than a few kilobytes in DataStore or multiplatform-settings.
- Do NOT assume a store is encrypted on every platform because it is on one.
- Do NOT bump a Room `version` without an accompanying migration and an updated exported schema.
- Do NOT wire KSP for Android only in a multi-target module.

## Error handling

- **The library is not in the version catalog** → name the missing artifact and propose the entry;
  do not hardcode a version.
- **Reads fail permanently after one bad write** → missing `CorruptionException` wrapping or missing
  `ReplaceFileCorruptionHandler`. Say which, and note that existing installs need the handler to
  recover.
- **Values disappear between runs** → check the path producer first; the temp directory is the usual
  cause.
- **Room fails to build for a non-Android target** → KSP is wired for Android only. Report the
  missing `add("ksp<Target>", …)` lines.
- **The data is relational and the project has none of these libraries** → say that Room is a real
  dependency decision, not a detail, and surface it rather than adding it silently.
- **The question is "should this be persisted"** → point at `.claude/rules/kmp/persistence.md` and
  stop.

## Example

> "Remember the selected server profile, including its API token."

1. Read `libs.versions.toml`; report which storage libraries exist. If multiplatform-settings is
   already there, do not add DataStore for four fields.
2. Classify: a handful of scalars, no queries, no reactivity requirement → multiplatform-settings.
3. Define a `commonMain` interface (`ServerProfileStorage`) over `Settings`; the domain layer sees
   only that interface.
4. Bind the backing per platform: encrypted on Android, `Preferences.userRoot()` on Desktop —
   and **state plainly** that the Desktop side stores the token in plaintext, so the decision is
   made deliberately rather than by default.
5. Write a `commonTest` round-trip test against an in-memory `MapSettings`; run it and report the
   output.

Expected outcome: one storage abstraction, a per-platform binding, and the security asymmetry stated
rather than hidden.

## Related Skills

- `koin-kmp` — binding the store and its platform backing
- `kmp-multiplatform-specialist` — source sets, `expect`/`actual`, KSP per target
- `ktor-client-kmp` — the network side of the same data layer
- `kmp-testing` — round-trip and migration tests
- `kotlin-specialist` — `Flow`, `.catch`, `CancellationException`
- `database-optimizer` — query shape once the data really is relational
