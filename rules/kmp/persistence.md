# KMP Persistence Rules

Applies to Kotlin Multiplatform projects (`stack.kmp: true`). Governs what may be stored, where the
storage type may appear, and how schemas change. Library choice mechanics and setup live in the
`kmp-persistence` skill.

## Storage selection

Pick by the shape of the data, not by familiarity:

| The data | Store |
|---|---|
| A handful of flags and scalars | key-value settings |
| The same, but the UI must react to changes | a reactive preferences store |
| One typed document with an evolving schema | a typed document store with a serializer |
| Anything queried, joined, or beyond a few dozen rows | a local database |

Introducing a second storage library for data the existing one already holds is a dependency
decision, not a detail — it has to be justified in the change that adds it.

## Storage types stop at the data layer

- An `Entity`, a preferences key, a settings handle, or a DAO **never** appears in `domain` or `ui`.
- The repository maps storage types to `domain` models at the boundary — the same rule the network
  side follows (`networking.md`), for the same reason.
- A `domain` model never gains a persistence annotation to avoid writing a mapper. The moment it does,
  the schema and the domain change together forever.
- The storage handle is injected, never constructed inside a repository and never held in a global.

## The schema lives with the data layer, in version control

- The schema definition, and its exported history where the library produces one, are committed. A
  schema that exists only inside a built artifact cannot be reviewed or migrated against.
- A schema change and its migration land in the **same** change. A version bump without a migration is
  a data-loss bug that only appears on upgrade, never on a fresh install — which is exactly what local
  development does.
- Destructive fallback (dropping and recreating on a version mismatch) is acceptable **only** for data
  the app can re-fetch, and must be stated explicitly rather than left as a default.

## Persist only what must survive

- Anything derivable from persisted data is derived, not stored. Two copies of the same fact drift.
- Transient UI state is not persisted. Screen state that must survive process death belongs in the
  state holder's saved state, not in the app's storage.
- Cached remote data carries the information needed to invalidate it. A cache with no expiry or
  version is a permanent stale-data source.

## Security

- Credentials, tokens and personal data are stored in the platform's secure store where one exists.
- Platform coverage is **asymmetric**: a secure store on one target does not imply one on another.
  When a target stores a secret in plaintext, that must be stated in the change, not discovered later.
- Secrets are never written to a plain preferences file, a log, or an exported schema.
- Clearing user data must actually clear it — signing out removes the stored credential rather than
  only the in-memory copy.

## Access is off the main thread and non-blocking

- Storage reads and writes are `suspend` functions or flows. A blocking read on the UI thread is a
  frame drop at best and an unresponsive app at worst.
- The dispatcher is injected, not hardcoded — `Dispatchers.IO` does not exist on native or wasm
  targets (`architecture.md`).
- Never block a composable on storage. Expose state and collect it.

## Failure is expected, not exceptional

- A read failure is a typed state, the same as a network failure. An empty result and a failed read
  are different things and must not collapse into the same value.
- Corruption recovery is designed deliberately: decide whether a corrupt store resets to defaults or
  surfaces an error, and implement it. Without an explicit decision, one bad write can make every
  subsequent read fail for the lifetime of the install.
- File locations are chosen per platform and are never temporary directories — the OS may clear those.

## Do / Don't

- DO keep one storage abstraction per concern, defined in `domain` and implemented in `data`.
- DO test round-trips and migrations against a real store, not a mock.
- DON'T store large payloads in a key-value or document store — many rewrite the whole file per write.
- DON'T expose the storage library's types through a repository interface.
- DON'T let a migration depend on application code that can change; migrations are frozen history.
- DON'T assume a fresh install exercises the migration path. It does not.

## Related rules

`architecture.md` (layers, typed states, dispatchers) · `networking.md` (the remote half of the data
layer) · `modularization.md` (implementations stay `internal`) · `testing.md` · `security.md` in
`common/`

Library choice and setup live in the `kmp-persistence` skill.
