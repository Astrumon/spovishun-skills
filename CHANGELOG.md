# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.24.0] — 2026-08-21

Two files inside this package disagreed with each other, and the disagreement reached the agent as
a task with no prompt in it. `scripts/notion/lib/markdown-to-blocks.js` writes headings,
paragraphs, lists, to_do, code, quote, callout, divider, table and toggle;
`scripts/notion/lib/format-task.js` read back five of those. Everything else was dropped without a
word, and block children were never fetched at all — `get-task.js` asked for one level of
`/v1/blocks/{id}/children` and stopped there.

That mattered because of a rule the package sets for itself. The `newtask` skill mandates that the
AI agent prompt live inside a toggle titled 🤖 prompt; `notion-task-to-code` builds its prompt from
what the reader returns. The reader returned the word "🤖 prompt" and nothing under it. Callouts
carrying context were lost the same way, and numbered steps came back as dashes, so the Steps
section lost its order in exactly the place order matters.

The same hole existed on the second, more travelled path: `notion-task-to-code` reads the cached
`.dev-context/<branch>/task.json` before it touches Notion, and that cache is written by
`hooks/notion-blocks.js`, which also rendered only the top level. Fixing the CLI alone would have
changed nothing for the ordinary "start new task" flow, so both renderers are fixed here.

Minor rather than patch: `get-task.js` output gains block types it never emitted, and hooks/ gains
a module.

### Added

- **`hooks/block-tree.js`** (re-exported by `scripts/notion/lib/block-tree.js`) — one
  transport-agnostic walk that paginates a block level and recurses into `has_children`, attaching
  results as `block.children`. It takes the caller's page-fetch as a callback rather than importing
  an HTTP layer, which is what lets hooks/ and scripts/notion/ share it: the two transports differ
  on purpose (different headers, different 401 handling) and a hook may never require out of
  `scripts/`. Depth is a hard budget (`MAX_BLOCK_DEPTH = 3`) — at 0 a block's children are left
  unfetched rather than half-attached. Siblings are fetched in parallel; a page with four toggles
  should not cost four sequential round-trips.

  The pagination is also a fix in its own right. Neither call site followed `has_more`, so a page
  past 100 top-level blocks was silently truncated.

### Fixed

- **`scripts/notion/lib/format-task.js`** — now renders `toggle`, `callout`, `code`, `table`,
  `divider` and `to_do`, and recurses into `block.children`. `numbered_list_item` is split from
  `bulleted_list_item` and carries a real ordinal that restarts on the first non-numbered sibling,
  the way Notion scopes a run.

  A toggle renders as `<details>` / `<summary>`, which is the shape `markdown-to-blocks.js` already
  parses back into a toggle block. That choice is the point: reader output can be fed to the writer
  and produce the same page, and `test/scripts-notion-format-task.test.js` asserts the round trip
  so the two halves cannot drift apart again. Fences, HTML blocks, tables and thematic breaks are
  emitted with blank lines around them, without which a re-parse would swallow the following block
  (or read the preceding paragraph as a setext heading).

  The renderer stays pure and synchronous — it walks a tree someone else hydrated. That is what
  keeps it unit-testable on plain fixtures, and what lets `get-claude-md.js` keep calling it with a
  flat one-level list.

- **`scripts/notion/lib/section-parser.js`** — heading detection now tracks code fences. Once the
  reader started emitting fenced blocks, a shell snippet whose first line is `# install deps` would
  have registered as a heading and cut `get-claude-md.js --section` short. `extractSection` reuses
  the (already fence-filtered) index to find a section's end instead of re-scanning raw lines.

- **`scripts/notion/lib/markdown-to-blocks.js`** — two nested-content defects observed in
  production, both on pages this package created itself.

  `extractAlert` took a blockquote paragraph's `.text`, which is **raw markdown**, and wrapped it in
  a synthetic text token that went to `textSegment()` verbatim. Inline code, bold and backslash
  escapes therefore reached Notion as literal characters — a callout rendered with visible
  backslashes. The remainder is re-lexed now, so the callout body gets a real inline tree.

  Separately, a tab-indented `<details>` body was read by marked as an indented code block before
  the `<details>` state machine ever ran, so an entire agent prompt arrived as one grey
  `plain text` block — and the body line glued directly under `</summary>` was swallowed into the
  opening HTML token and lost outright. A new pre-lexer pass, `normalizeDetailsBlocks`, removes one
  level of indentation from toggle bodies and inserts the blank lines marked needs, while tracking
  fences so a literal `<details>` in a code sample is not mistaken for a toggle.

- **`hooks/notion-blocks.js`**, **`hooks/apply-pick.js`**, **`hooks/context-inject.js`** — the
  cache path gets the same treatment: both call sites hydrate through `fetchBlockTree`, and
  `blockToMd` renders toggle, callout, quote and table plus nested children. `visibleBlocks` is
  unchanged and still strips toggles from the *injected* context — that filter is deliberate
  (collapsed template scaffolding is noise in a prompt) and applies to the injection only, not to
  the `task.json` copy that `notion-task-to-code` reads.

### Known issue

The two renderers now differ only in the blank line before a heading and the separators around
standalone blocks. Keeping them apart is still the documented decision — merging them changes CLI
output — but the duplication is real and larger than it was. Collapsing them behind one renderer
with options is worth its own task rather than a silent ride-along here.

## [1.23.1] — 2026-08-08

The Kotlin/Postgres skills stop recommending a function that no longer exists. Downstream
(`spovishun-173`) deleted `safeDbTransaction` from `data/db/DatabaseFactory.kt` and folded `dbQuery`
into `safeDbQuery`, which now is the single public DB entry point and does
`withContext(Dispatchers.IO)` + `transaction { }` + `ResultContainer.catching` on its own. Four
skills still described the old two-helper world, and a skill that names a removed API is worse than
one that says nothing: the reader trusts it and writes code that will not compile.

Patch rather than minor: no artifact is added and no rule changes normatively — the guidance already
said "always `safeDbQuery`", and this only removes the alternatives that stopped existing.

### Fixed

- **`skills/postgresql-exposed-orm/references/transactions.md`** (skill 1.0.0 → 1.0.1) — the
  `safeDbQuery` vs `safeDbTransaction` section and its comparison table are deleted outright rather
  than trimmed; a comparison with one side removed is not a comparison. The column it carried
  ("multi-step writes that must be atomic") is replaced by a **Multi-step writes are already atomic**
  section stating the mechanism that took its place: one `safeDbQuery` block is one transaction, so
  the steps commit or roll back together, and the failure mode is splitting them across two calls.

  The raw-Exposed section was also factually wrong on two counts — it presented
  `newSuspendedTransaction(Dispatchers.IO)` as what `safeDbQuery` "uses internally", when
  `safeDbQuery` runs the *blocking* `transaction { }` inside its own IO hop. Both primitives are now
  framed as Exposed APIs that repository code never reaches for, with `newSuspendedTransaction`
  explicitly marked as not what `safeDbQuery` does.

  The heading lost its hardcoded project name (`## Spovishun convention:` → `## Convention:`). This
  package ships to any consumer and has `{{PROJECT_NAME}}` for that purpose; dropping the name is
  cheaper than declaring a placeholder for one heading.

- **`skills/postgresql-exposed-orm/SKILL.md`** — the Always-Active Rule no longer claims
  `safeDbTransaction` lives in `DatabaseFactory.kt`, and states what `safeDbQuery` actually does. The
  "Do NOT" entry about wrapping `dbQuery {}` in `ResultContainer.catching {}` now names
  `transaction {}`, which is the bypass that is still reachable.

- **`skills/kotlin-specialist/SKILL.md`** (2.3.0 → 2.3.1) and
  **`skills/solution-designer/SKILL.md`** (1.0.0 → 1.0.1) — cross-references to
  "`safeDbQuery` / `safeDbTransaction` patterns" reduced to the one pattern that exists.

- **`skills/debugging-wizard/SKILL.md`** (1.1.0 → 1.1.1) — the "No transaction in context" fix said
  "wrap with `transaction { }` or `dbQuery { }`", offering a deleted function and a bare
  `transaction {}` that the Postgres skill forbids. It now points at `safeDbQuery { }`.

## [1.23.0] — 2026-08-08

The KMP rules gain the escalation step they were missing. Ladders existed for the UseCase ("two or
more repositories or two or more screens") and for a `core/` module ("on the second consumer"); for
the screen itself there was none. `architecture.md` defined `UiState` as one class per screen holding
everything rendered, `feature-structure.md` and `uikit.md` required every view to be stateless with
"no DI, no ViewModel", and `architecture.md` forbade a composable taking a `ViewModel` — so every
piece of a screen was forced to be inert and all logic funnelled into a single ViewModel. That is the
1000+ line failure mode, prescribed rather than prevented.

Minor rather than patch: `rules/kmp/feature-structure.md` and `rules/kmp/uikit.md` change normatively
for consumers that already have them on disk. Under `ownership: 'checksum'` a locally edited copy is
skipped with a warning on the next `install` — run `install --force` to take the new rules, and
re-apply local edits on top.

### Added

- **`rules/kmp/component-architecture.md`** — a screen may be split into components, but only past an
  explicit threshold: **two or more independent state regions**, regions that load separately, fail
  separately and change for different reasons. A ViewModel's line count is named as a symptom, not a
  trigger, because splitting coupled regions produces components that call each other. The rule fixes
  ownership (the ViewModel is the root owner, `attach`/`detach` are manual, clearing is recursive),
  keeps effects on the existing `Channel(Channel.BUFFERED)` — a component receives an emit lambda and
  never owns a channel, extending the "the ViewModel remains the only emitter" rule already in
  `architecture.md` — and states the approach's costs as normative text: manual lifetime, harder
  whole-screen `@Preview`, overkill below the threshold.

  Deliberately **not** Decompose or Essenty: `ChildStack` is a second navigation model competing with
  Navigation 3, standardised in 1.22.0. The infrastructure is ~95 lines with no third-party
  dependency.

- **`skills/kmp-multiplatform-specialist/references/component-architecture.md`** (skill 1.3.0 →
  1.4.0) — the Kotlin the rule stays free of: `Component`, `ComponentStoreOwner`, `ComponentStore`,
  `BaseComponent`, `StateComponent<S>`, `MviViewModel` gaining `ComponentStoreOwner` and
  `clearComponents()` in `onCleared()`, a two-region screen, the Koin wiring, and the preview and
  test shapes. Adapted from [`Nerushok/ComArch`](https://github.com/Nerushok/ComArch) (MIT) with
  three changes it needs to be usable here: the store key stops going through
  `this::class.java.canonicalName` (absent in `commonMain`, and `qualifiedName` throws on JS/Wasm) in
  favour of a declared key defaulting to `simpleName`; the component scope takes an injected
  dispatcher and `CoroutineExceptionHandler` instead of a hardcoded `Dispatchers.Main.immediate`; and
  Hilt `@AssistedFactory` becomes a Koin factory-function binding injected into the owner's
  constructor, so nothing reaches into the container at runtime. Attributed in `NOTICE.md` and pinned
  in the skill's `source:` block, so `npm run check:drift` covers it.

### Changed

- **`rules/kmp/feature-structure.md`** gains `ui/components/` beside `ui/viewcomponents/` and
  qualifies "Views are `internal`, stateless and hoisted … No DI, no ViewModel": that sentence
  governs `viewcomponents/`, and a composable that collects a component's state is a separate
  category with its own folder. The contradiction is removed in text rather than left to be
  discovered.

- **`rules/kmp/uikit.md`** states that "component" in that file means a visual building block and
  never the state holder, and that a design system component never takes one nor collects a `Flow`.

`rules/kmp/architecture.md` is untouched: it has 26 characters of headroom before the 6 000-char
windsurf split threshold, and nothing in it contradicts the new rule — a component is not a
ViewModel.

## [1.22.0] — 2026-08-08

Navigation 3 becomes the standard for KMP projects, and the KMP navigation rule stops prescribing
the defect it was written around.

Minor rather than patch: `rules/kmp/navigation.md` changes normatively for consumers that already
have it on disk. Under `ownership: 'checksum'` a locally edited copy is skipped with a warning on
the next `install` — run `install --force` to take the new rule, and re-apply local edits on top.

### Changed

- **`rules/kmp/navigation.md` rewritten around Navigation 3.** The rule previously required a
  navigation state holder that owns the selected top-level destination while the graph mirrors it
  onto the back stack, and shipped the `LaunchedEffect(selected) { navController.navigate(…) }`
  snippet that implements it. That is two sources of truth for one value, and it is the origin of
  the navigation defects observed downstream: the guard that stops the feedback loop is the same
  guard that makes a legitimate repeat navigation a no-op, and binding the holder per-resolution
  silently resets the selection.

  The back stack is now the only navigation state and the selected destination is **derived** from
  it — the holder disappears, and the failure mode with it. Also new or restored: `@Keep` on every
  key (dropped when the rule moved from `rules/common/` to `rules/kmp/`; without it R8 breaks
  navigation in release builds only), the `SerializersModule` obligation that non-Android targets
  need for back-stack restoration, the requirement that the display is created once above any
  window-size-class branch, and the requirement that it carries both the saveable-state and
  ViewModel-store entry decorators.

  Features now own their entries (`EntryProviderScope` extension per feature) instead of every
  screen being registered in `composeApp`, which also resolves the rule's own contradiction between
  "add a `composable<Route>` entry in `composeApp`" and "DON'T centralise every route". Navigation 2
  keeps every ownership rule and gets a short Legacy section for the wiring differences.

- **`rules/kmp/architecture.md` gained a state-ownership boundary.** The MVI contract read as
  "everything goes through Intent → UiState"; it now states what does not — ephemeral UI state stays
  in the composition (`remember` / `rememberSaveable`), navigation state belongs to the back stack.
  Also documents why an event modelled as a `UiState` field re-fires on back navigation, why the
  effect channel is `BUFFERED` rather than a `SharedFlow`, and that a non-ViewModel collaborator
  never gets its own effect channel.

- **`skills/new-feature` (1.0.0 → 1.1.0)** scaffolds a `NavKey` plus its `SerializersModule`
  contribution and a feature-owned entry builder, and detects a Navigation 2 project to fall back to
  a `NavGraphBuilder` extension. It no longer instructs an edit to `composeApp` per screen.

### Added

- **`skills/kmp-multiplatform-specialist/references/navigation-3.md`** (skill 1.2.0 → 1.3.0) — the
  Kotlin that moved out of the rule: artifacts, keys and `SavedStateConfiguration`, the navigator,
  feature entry builders (plain and Koin, with the `entryProvider`-typed-as-`Any` caveat from
  InsertKoinIO/koin#2336), `NavDisplay` with both decorators called once above the layout branch,
  deriving the selection, per-tab back stacks, and the Navigation 2 equivalents.

## [1.21.0] — 2026-08-02

Closes both Critical findings of the thermo-nuclear review, in the only order they can land: C-2
first, because C-1 depends on it. The ownership model was presented in `CLAUDE.md` as a cross-cutting
guarantee of the plugin and implemented in exactly one adapter of three — and for windsurf it was not
merely unimplemented but impossible by construction, since the loader and the lockfile keyed the same
files in namespaces that could never meet.

Minor rather than patch: a consumer's `.windsurf/rules/` gains a generated `.spovishun-manifest.json`,
and `install` / `update` on windsurf and codex behave differently than before.

### Changed

- **The ownership model now covers all three adapters** (#162, thermo-nuclear finding C-1). It was
  presented in `CLAUDE.md` as a cross-cutting guarantee of the plugin and implemented in exactly one
  adapter: `adapters/claude/index.js` had 22 references to it, windsurf and codex had zero. Every
  `install --target=windsurf` overwrote `.windsurf/rules/*.md` unconditionally and deleted files by
  filename pattern without asking whether their content was ours — a windsurf consumer lost local
  edits silently, on every run.

  `planInstall` + `INSTALL_HANDLERS` moved out of the claude adapter into **`lib/install-planner.js`**,
  unchanged (`test/install-claude.test.js` passes unedited, which is the proof). Windsurf now
  classifies every artifact and rule through it with `ownership: 'checksum'` — its bodies carry no
  `x-spovishun` marker, so content alone decides ownership, exactly as for rules. A locally edited
  file is skipped with a warning, `install --force` resets ours, and a file at an id we never locked
  is untouched even under `--force`. The stale-file pass follows the same rule: proof of ownership
  before deletion, a warning otherwise.

  **Behaviour change for windsurf `update`:** the target moved from `ownership: 'assume-owned'`
  (every file is ours) to `'checksum'`, so an unlocked id occupied by an existing file is now a
  `COLLISION` rather than an `ADOPT`. `assume-owned` is retired; an unknown model no longer degrades
  to "everything is ours".

- **Codex declares the overwrite it has always performed.** It keeps `ownership: 'none'` — `AGENTS.md`
  inlines every body, so there is no per-artifact file to own or merge — but a regeneration that
  would discard local content now warns instead of doing it silently. Conditional on the content
  actually differing, so an idempotent re-install stays quiet.

### Fixed

- **`update --target=windsurf` re-points the provenance manifest** at the chunking it just wrote.
  A stale manifest would leave the id looking `MISSING_ON_DISK` to the next `install`, which would
  overwrite it — silently discarding a conflict resolution in progress.

- **`update --target=windsurf` writes templates to the right filename.** It derived the flattened
  stem itself and skipped the `templates--` prefix, writing `epic-page.md` alongside the
  `templates--epic-page.md` that `install` had written. Both now go through `windsurfBaseId`.

- **The windsurf adapter now records what it wrote instead of making the reader guess** (#163,
  thermo-nuclear finding C-2). `.windsurf/rules/` is a flat directory, so the adapter flattens three
  id namespaces into one filename space — `common/git-workflow` → `common--git-workflow.md`,
  `<id>/references/x.md` → `<id>--references--x.md`, anything over 6 000 chars → `-part-N.md`. That
  mapping is lossy, and `loadInstalledFiles(cwd, 'windsurf')` used to invert it by parsing filenames:
  on a clean install it mislabelled 18 of 39 files, announcing every rule and every supporting file
  as a `skill:`. The lockfile wrote `rule:common/git-workflow`, the loader claimed
  `skill:common--git-workflow`, and those namespaces could never meet — which made an ownership
  model for this target impossible **by construction**, not merely unimplemented.

  `install --target=windsurf` now emits `.windsurf/rules/.spovishun-manifest.json`, a real
  `filename → {kind, id, role, part}` map generated while writing. The loader reads it and returns
  exactly the keys the lockfile contains. Supporting files carry no id of their own — they follow
  their body, as on claude, where they have never had a lock entry either.

  Installs made before this release have no manifest and fall back to filename parsing, now
  disambiguated by the lockfile: `foo-part-1.md` is chunk 1 of `foo` unless `foo-part-1` is itself a
  locked id, which is the case the greedy pattern always got wrong. The fallback can be dropped one
  minor release from now.

- **A filename collision between two artifacts warns.** `--` stands for both a path separator and
  an id, so the rule `common/style` and a skill named `common--style` write the same file. The
  second write used to win silently; it still wins, but says so.

## [1.20.0] — 2026-08-02

Closes the thermo-nuclear review's last open Major finding. #166 landed eight of the nine in 1.19.0;
M-8 was held back because it is the only L-sized one, it needed tests before it could be measured,
and its premise in the umbrella turned out to be wrong (see below).

Behaviour-preserving apart from one bug fix (`toDashed`). The mode-level tests were written against
the pre-refactor 919-line hook and pass unchanged after the split.

### Changed

- **`hooks/notion-task-inject.js` decomposed** (#167, the last open item of the #166 umbrella —
  finding M-8). 919 lines carrying six responsibilities and three runtime modes are now ~150 lines
  of dispatch plus twelve focused modules under `hooks/`: `hook-config` · `notion-api` ·
  `notion-constants` · `notion-blocks` · `branch-name` · `page-id` · `git-ops` · `dev-context` ·
  `hook-output` · `task-picker` · `apply-pick` · `context-inject`. No function in the tree exceeds
  40 lines. Behaviour-preserving: the mode-level tests were written **first**, against the 919-line
  file, and pass unchanged after the split.

  The umbrella's premise for this finding was wrong and is corrected here. It assumed three of the
  responsibilities "already exist separately in `scripts/notion/lib/`" and that the hook should
  import them — it cannot. `installHooks()` copies `hooks/` unconditionally while `installScripts()`
  skips `scripts/notion/` when `stack.notion: false`, so a hook requiring out of `scripts/` is a
  guaranteed `MODULE_NOT_FOUND` for every consumer without Notion. The direction is the other way
  round: the modules moved **into** `hooks/`, and `scripts/notion/` re-exports them. There is now a
  test asserting no file under `hooks/` requires into `scripts/`.

- **`scripts/notion/lib/page-id.js` is a re-export** of `hooks/page-id.js`, the same collapse
  `config-reader.js` went through in #164. The two copies had drifted: the hook's `toDashed` sliced
  *any* string into `8-4-4-4-12`, fabricating a plausible-looking page id out of a typo. The
  guarded version (pass through anything that is not 32 chars) won, so a bad `--apply-pick` argument
  now produces a clear "not found" from Notion instead of a confusing one.

- **`NOTION_VERSION`, `PRIORITY_TIERS` and `PICKER_TIER_LIMIT` have a single declaration**
  (`hooks/notion-constants.js`), re-exported by `scripts/notion/lib/constants.js` and
  `query-tasks.js`. This removes the "MUST stay in sync" comment that guarded the duplicated tier
  list — a guard that had already earned its keep once, when the hook grew a phantom `Normal` tier.
  `test/notion-version-parity.test.js` now compares values instead of regexing the hook's source.

### Added

- ~90 tests for hook paths that had none: `main()`'s stdin dispatch, `--apply-pick` (including
  parallel-branch conflict detection against a real git repo), `--post-exit-plan`, the task picker's
  directive generation, and `notionRequest`'s transport contract. `test/helpers/` gains a harness
  that drives the real hook as a subprocess with `https` scripted by a preload — which is what makes
  exit codes and the stdout directive assertable, and what keeps those tests indifferent to how the
  hook is split up internally.

## [1.19.0] — 2026-08-01

A maintainability release: three tasks land together — #164 (one config reader), #165 (`runUpdate`
decomposed, `MISSING_ON_DISK` unified) and #166, the umbrella covering nine Major findings from the
thermo-nuclear review.

The one deliberate behaviour change is `MISSING_ON_DISK` (#165) — see below. Everything in #166 is a
behaviour-preserving refactor on top of that, verified by installing the pre-#166 tree and this build
into the same consumer fixture and diffing recursively: for all three targets, every generated file,
the full `doctor` output and the lockfile are identical.

### Added

- **Target registry — `adapters/registry.js` (M-0).** One row per target, carrying
  `{ install, update, readInstalled, hint, ownership, supportsUpdate }`. `claude | codex | windsurf`
  used to be re-branched by hand in seven places, with three drifted adapter signatures
  (`installCodex` needed `pluginVersion`, `installClaude` needed `force`, `installWindsurf`
  neither), so adding a target meant editing `bin/`. It no longer does: a new target is one row
  plus one `adapters/<target>/` directory. The registry is the composition root — nothing in `lib/`
  or `adapters/<target>/` may import it.
- **`lib/render-artifact.js` (M-4).** The `placeholders → renderTemplate → sha256` triplet was
  duplicated verbatim in five places, where a change to one silently desynchronised the checksums
  the lockfile compares.
- **`collectAllRules(pkgRoot, stackFlags)` (M-5).** Returns every rule flagged with whether the
  active stack selects it. `collectRules` is now the active half of it.

### Changed

- **`MISSING_ON_DISK` now means the same thing in `install` and `update` (#165).** A lockfile entry
  whose file is gone is **restored** from the current render, in both commands. Previously `install`
  rewrote the file while `update` did nothing — one classifier state, two opposite behaviours. The
  lockfile is the record of what the plugin owns, so a locked id with no file on disk is an
  inconsistent state, not a request to keep it deleted; and since `sync` *is* `install`, any other
  choice made the two commands disagree on the very next run. To stop shipping an artifact, turn its
  stack flag off — install then deletes it. The contract is documented in `lib/update-classifier.js`.
- **`runUpdate` decomposed** from a single 242-line body into named units — `validateUpdatePreconditions`,
  `buildContext`, `buildUpstreamMap`, `selectKeys`, an `ACTION_HANDLERS` table of pure per-action
  planners, `processKey`, `applyPlan` and `formatSummary`. No function in `bin/update.js` exceeds
  35 lines. The 10-branch `switch` is gone: each action is a 3–6 line arrow returning
  `{ counter, lock, effect?, note? }`, so the decision table carries no IO and the writes happen at
  one site. Behaviour is otherwise unchanged — every pre-existing test passes untouched.
- **One config reader, one file (#164).** `hooks/config-reader.js` is now the single implementation;
  `scripts/notion/lib/config-reader.js` re-exports it (the `../../../hooks/` hop resolves
  identically in the repo and in an installed `.claude/`), and the ~63-line copy inside
  `hooks/notion-task-inject.js` is gone. It lives under `hooks/` because `hooks/` installs
  unconditionally while `scripts/notion/` ships only when `stack.notion: true` — scripts may
  depend on hooks, never the reverse. Still dependency-free by necessity: consumers get
  `.claude/` without a `node_modules`, so `require('js-yaml')` there is `MODULE_NOT_FOUND`.
  `lib/config-loader.js` is unchanged and stays the plugin-side js-yaml + Ajv loader.
- **Config fallbacks no longer degrade in silence (#164).** `readConfigValueOrWarn()` distinguishes
  "no config file" (a supported env-only setup) from "config file present but the key is
  unreadable" (a broken config), and warns on stderr with the file and key names for the latter.
  Wired into `PROJECT_PREFIX`, `git.dev_branch` and `notion.database_id` in the hook, and into
  `projectPrefix()` in the notion scripts. `notion.database_id` only demands a value when
  `stack.notion` is on; `notion.picker.stage_filter` stays silently optional (empty is a
  legitimate Board-v1 value). The hook still exits 0 throughout — it must never brick a session.
- `slugify()` moved to the shared reader, replacing the three near-identical copies that turned
  `project.name` into a branch prefix (#164).


- **`install` classifies artifacts and rules through one path (M-3).** `classifyArtifact` takes the
  ownership *model* (`marker` | `checksum` | `assume-owned`) instead of a caller-computed boolean,
  and both loops share a `planInstall` + `INSTALL_HANDLERS` table mirroring `ACTION_HANDLERS` in
  `bin/update.js`. `installClaude` drops from 90 lines to 33.
- **`doctor`'s checks are declared, not orchestrated (M-1).** A `{ name, run, when, dependsOn,
  skipDetail }` list replaces 87 lines of nested `if/else` with seven duplicated skip literals. The
  claude-only gate now reads `ownership === 'marker'` — what those checks actually require — rather
  than naming one target. The on-disk scan that two checks each performed is memoised and lazy.
- **Rules are rendered once per install (M-5).** `reconcileStaleRules` used to walk `rules/` a second
  time with all stack flags on and re-render the whole package, purely to build its ownership oracle.
  `ruleLockEntry(rule, rendered)` now takes the rendered body instead of the config map, which also
  removes windsurf's render-twice-per-rule.
- **`mergeSettings` merges in one pass (M-10).** The third of three passes existed to delete the empty
  arrays the first had created. 41 lines → 25; `structuredClone` replaces the JSON round-trip.

### Fixed

- **A config with a UTF-8 BOM silently sent the task hook to the wrong branch prefix (#164).**
  `spovishun-skills.config.yaml` was read by three separate implementations, two of which were
  hand-written line scanners that had already drifted: only `scripts/notion/lib/config-reader.js`
  stripped the BOM. JavaScript counts `U+FEFF` as `\s`, so in the hook's copy a BOM'd `project:`
  failed the top-level-section regex and *every* lookup returned `''`. `PROJECT_PREFIX` then fell
  through to the literal `project`, and the hook queried the board for tasks that cannot exist —
  reporting "No Tasks Available" instead of an error. Windows editors add the BOM unprompted, so
  this fired on a real consumer.
- **`update` reported a vanished file as a local edit (#165).** `MISSING_ON_DISK` incremented the
  `localOnly` counter — the opposite meaning. It now has its own `restored` counter, surfaced in the
  closing summary line.
- **Windsurf `AUTO_APPLY` leaked stale `-part-N.md` chunk files (#165).** `applyArtifact` destructured
  three fields while its call sites passed five, silently dropping `installedEntry` — the value
  `updateWindsurf` needs to delete the previous render's chunks. An artifact that shrank below the
  6 000-character limit left its old `-part-2.md` on disk, which Windsurf then loaded as an
  independent rule. The signature now matches the call.


- **Placeholder substitution no longer runs through Mustache (M-2).** The renderer drove Mustache
  through a custom `escapedValue` hook, which only intercepts interpolation — so every other Mustache
  syntax routed around it and silently destroyed content: `${{{ runner.os }}}` became `$`,
  `{{#X}}a{{/X}}`, `{{>partial}}` and `{{! comment }}` all rendered empty. No shipped artifact
  contained one, so nothing was lost in practice, but the first GitHub Actions snippet to reach an
  artifact body would have been mangled with no error and no diff. Replaced with a two-pass
  `String.replace`; the `mustache` dependency is gone (5 → 4 runtime deps).
- **Every missing config key is reported at once (M-7).** `validateConfig` threw on the first Ajv
  `required` violation although Ajv had collected them all — a config missing three `git.*` keys cost
  three sequential `install` runs to diagnose. The reported path also read `/git.main_branch`, a
  string matching nothing in the file it tells you to edit; it now reads `git.main_branch`.
- **`update` no longer reports work it did not do (M-9).** `applyArtifact` and `applyConflict` were
  two-branch dispatchers with no `else`, so a target outside that pair wrote nothing while the summary
  still counted it as auto-applied. Both are deleted; `applyPlan` calls the registry's `update`.

### Removed

- **The unreachable `hook` and `rule` artifact kinds (M-6).** `loadArtifacts` declared four kinds and
  could only ever yield three: `hooks/` is flat `.js` (the loader descends into subdirectories only)
  and `rule` was never in the kind map at all, yet still had a `BODY_FILES` entry pointing at a
  `RULE.md` that exists nowhere. Both directories keep shipping through their own paths.

## [1.18.0] — 2026-07-29

### Added

- **Six new KMP skills, all gated `requires: [kotlin, kmp]` (#157).** `ktor-client-kmp`,
  `compose-multiplatform` (+ four references), `kmp-persistence`, `kmp-ios-interop`, `koin-kmp` and
  `kmp-testing`. They close the gaps the existing KMP layer never covered: Ktor client configuration,
  Compose state and performance mechanics, local storage, the Kotlin↔Swift boundary, and KMP-shaped
  Koin and testing. Adapted from [`rcosteira79/android-skills`](https://github.com/rcosteira79/android-skills)
  (MIT) — see `NOTICE.md`.
- **Three new rules:** `rules/kmp/networking.md` (the repository is the error boundary; no HTTP type
  leaves `data`; one `expectSuccess` model), `rules/kmp/modularization.md` (lowest visibility that
  compiles; DI-bound implementations stay `internal` behind `public` interfaces) and
  `rules/kmp/persistence.md` (storage selection, schema history, migrations, security asymmetry).
- **`source:` in the manifest schema** — `{ repo, ref?, files: [{ path, sha }] }`, optional, pinning
  every upstream file a derived artifact was adapted from. It pins *all* of them rather than one
  primary path, because four of the six new skills derive from more than one upstream file and a
  single pin would leave the rest undetected.
- **`NOTICE.md`** — the MIT notice plus an artifact→source table. `scripts/validate-all-manifests.js`
  now checks it against every `source:` block **in both directions**: a manifest missing from the
  table fails, and so does a table row with no such manifest. Neither registry is generated from the
  other, so comparing them is what keeps them honest. The same predicate runs in `npm test`
  (`test/attribution.test.js`) — a forgotten attribution row is a licensing defect, not just a lint
  nit.
- **`npm run check:drift`** (`scripts/check-upstream-drift.js`) — asks the GitHub API for the current
  blob SHA of every pinned path and reports what has moved. **Report-only: always exits 0**, including
  on network failure or rate limiting. Deliberately *not* wired into `lint`, which `ci.yml` and
  `release.yml` both run — publishing to npm must not depend on `api.github.com` being reachable or on
  a 60 req/h anonymous limit.
- **`references/agp9-kmp-library.md`** in `kmp-multiplatform-specialist` — the AGP 9
  `com.android.kotlin.multiplatform.library` constraints, including `androidResources { enable = true }`,
  whose absence lets a Compose Resources module build green and crash at runtime.

### Changed

- **`kotlin-specialist` 2.2.0 → 2.3.0.** The Always-Active rule *"Only `data/db/DatabaseFactory.kt` may
  use `Dispatchers.IO`"* is now *"Inject `CoroutineDispatcher` via DI; never hardcode a dispatcher
  inside a class."* The file-specific form was wrong in a stack-generic skill, and `Dispatchers.IO`
  does not exist on native or wasm targets at all. `references/flow.md` and `references/coroutines.md`
  were rewritten around the actual traps — `Channel` vs `SharedFlow` for one-shot events (which is
  what the MVI effect contract rests on), `callbackFlow` + `awaitClose`, `.catch` scope and
  `CancellationException`, retry guards, and scope ownership.
- **`kmp-multiplatform-specialist` 1.1.0 → 1.2.0** — the AGP 9 reference above, two new rows in the
  failure table, and cross-links to the new skills.
- **`rules/kmp/uikit.md`** gained Material 3 tokens (contrast levels, motion tokens, reduced motion)
  and adaptive layout (window size classes, foldable postures). 3 286 → 5 410 chars, still inside the
  6 000-char Windsurf split threshold.
- **`package.json` `files`** now includes `NOTICE.md`, so the notice ships in the npm tarball and not
  only in git.

### Notes

- **The backend skills were deliberately not touched.** `dependency-injection-architecture` and
  `unit-testing-kotlin` are gated `requires: [kotlin]` only, so they still install into KMP projects
  carrying backend-specific Always-Active Rules (`Use Service, never UseCase`;
  `presentation → domain ← data`; `mockk<UserRepository>()`). The Spovishun backend consumer depends
  on them as they are. `koin-kmp` and `kmp-testing` each carry an explicit
  `## Supersedes <X> in KMP projects` block and triggers narrowed to KMP-only terms so the two never
  compete for the same prompt. **The underlying gating defect remains open** — the real fix is moving
  backend specifics out of `[kotlin]`-gated skills into a `postgres`/`telegram`-gated rules group.
- **Roughly a third of the new content is unverified** and says so inline. Ktor plugin ordering, auth
  refresh, Room, DataStore and everything iOS have no consumer project to check against; those
  sections carry an explicit `Unverified` marker naming the upstream file they came from. What *was*
  verified — against Kotlin 2.4.0 / AGP 9.0.1 / Ktor 3.5.1 / Koin 4.2.2 / Compose MP 1.11.1 — is the
  AGP 9 `androidLibrary` DSL, the `koinInject`-vs-`koinViewModel` trap, multiplatform-settings
  backings, and the `androidx.compose.ui.test.v2.runComposeUiTest` package (which differs from the
  Android-only form the upstream source states).
- **These skills have no consumer yet.** The reference project is frozen and will not sync to this
  version, so this is work ahead of demand — accepted deliberately when the task was scoped.

### Known follow-ups

- **The codex `AGENTS.md` is now 298 KiB**, against a 32 KiB Codex soft limit. The adapter warns and
  writes it anyway, as before. This is not new — `main` already produced 181 KiB — but this release
  makes it ~65 % worse, and Codex may truncate. The fix is the split the warning already suggests
  (universal content to `~/.codex/AGENTS.md`, project-specific to `./AGENTS.md`), or per-target
  artifact filtering; both are out of scope here.
- **Six of the new skills exceed the Windsurf 6 000-char file limit** and are installed as
  `-part-N.md` fragments, which Windsurf then reads as independent rules. `gradle-build-auditor` and
  `new-feature` already behaved this way, so the shape is pre-existing — but the enforced budget still
  covers `rules/**` only (`test/rules-stack-gating.test.js`). Verified in this release: **no rule file
  splits**; all nine `rules/kmp/*.md` install whole.

### Manifests bumped

`kotlin-specialist` 2.3.0 · `kmp-multiplatform-specialist` 1.2.0

## [1.17.0] — 2026-07-28

### Added

- **Rules are now first-class lockfile artifacts (#148).** Every installed rule gets a
  `kind: rule` entry in `spovishun-skills.lock.yaml` on all three targets. Codex and Windsurf
  already emitted them; the Claude adapter wrote `.claude/rules/*.md` with no record at all, which
  left `doctor` blind to rules and made a de-selected stack flag leave orphaned files on disk
  forever. Rule entries carry `version: 0.0.0` — a sentinel meaning "unversioned data artifact;
  the checksum is the identity". Deliberately not the plugin version: that would flip every rule
  to `AUTO_APPLY` on each release even when its body is byte-identical.
- **`doctor` checks rules.** The `installed-artifacts` check now covers `kind: rule`: a missing
  rule file fails the check with a `sync` hint, a drifted one is annotated `locally modified`
  (local edits are a supported workflow, same contract as skills and agents).
- **Stale rules are removed when their group's flag goes off.** Flipping `kmp: true → false` and
  running `install` / `sync` deletes the `rules/kmp/` files the plugin owns and prunes the emptied
  group directory. Candidates are plugin-known ids only — prior `rule:` lock entries plus every
  rule the package ships with all flags on. The second source is what lets a consumer upgrading
  from an older version shed its de-selected rules instead of stranding them.

### Changed

- **Rules follow the ownership model (#148).** `install` no longer overwrites `.claude/rules/*.md`
  unconditionally. Rules have no YAML frontmatter, so the `x-spovishun` provenance marker does not
  apply and ownership falls back to checksum equality alone: a rule whose on-disk body matches
  either the locked checksum or the current render is ours. Anything else is owner-authored —
  `install` skips it with a warning and the stale-rule pass leaves it on disk. `--force` resets a
  *locked* local edit; a file at an id the plugin never locked stays sacred even then. Consumers
  upgrading from `≤ 1.16.0` have rules on disk and no `rule:` entries — those adopt silently on the
  first `install`, because the on-disk body already equals the render.
- **`lib/rules-loader.js`** exports `ruleLockEntry()` / `renderRule()` / `RULE_LOCK_VERSION`; all
  three adapters build rule lock entries through it instead of repeating the render+hash
  expression. Codex and Windsurf output is unchanged (verified byte-identical against `main`).
- **`lib/installed-files-loader.js`** walks `.claude/rules/**.md` for the claude target, keyed
  `rule:<id>`. Checksums are taken over the raw body, not the marker-stripped one, because rules
  are written without a marker.

`update` needed no change: it already skips `rule:` keys (rules have no manifest, so they never
appear in the upstream artifact map) and preserves their entries — rules are regenerated wholesale
by `install` / `sync`.

## [1.16.0] — 2026-07-27

### Changed

- **`rules/kmp/architecture.md` trimmed from 7 398 to 4 934 characters (#150)** so it fits in a
  single Windsurf rule file. Past `CHAR_LIMIT = 6000` the Windsurf adapter split it into
  `kmp--architecture-part-1.md` / `-part-2.md`, which Windsurf then read as two independent
  rules — the MVI contract, error handling and Compose stability were severed from the layer
  rules that frame them. The rule is now normative and free of Kotlin, matching the shape
  `rules/kotlin/gradle-build.md` already uses. Three cuts: the `MviViewModel<S, I, E>` base class,
  the `composeCompiler { }` / `stability.txt` wiring, and the typed-error `load()` helper all moved
  to the skill; the `Source sets and expect/actual` section was removed as a near-verbatim duplicate
  of `kmp-multiplatform-specialist` (source sets and `expect`/`actual` are the build layer, which
  the skill owns). No guidance was lost — every normative statement stayed, as prose.
- **`test/rules-stack-gating.test.js`** — `gradle-build fits in one windsurf file` became
  `every shipped rule fits in one windsurf file`, looping over `collectRules()` with every
  `STACK_FLAGS` entry enabled. The old test was deliberately narrowed to one rule in #144 because
  `kmp/architecture.md` already exceeded the threshold; that carve-out and its comment are gone.
  Flags are derived from `STACK_FLAGS`, so a future `rules/<flag>/` group is covered automatically.

### Added

- **`skills/kmp-multiplatform-specialist/references/mvi-and-stability.md`** — the first `references/`
  file for this skill: the full `MviViewModel<S, I, E>` base class, a screen written against it
  (Intent / UiState / Effect / ViewModel), the `load()` helper that re-throws `CancellationException`
  before mapping an expected failure to a typed state, the `composeCompiler { }` block and
  `stability.txt`, plus how to read the generated `*-composables.txt` reports. Skill bumped to
  `1.1.0`.

## [1.15.0] — 2026-07-26

### Added

- **Gradle build best practices (#144)**, shipped as two complementary artifacts on the
  same split as ktlint/detekt: a short always-active rule that prevents violations while
  build files are written, and a user-invocable skill that audits a build already written.
- **`rules/kotlin/gradle-build.md`** (gated on `stack.kotlin`) — the ten practices as
  `Don't → Do → why`: Kotlin DSL only, wrapper on the latest minor via
  `./gradlew wrapper` (never a hand-edited `distributionUrl`), plugins through `plugins {}`
  instead of `buildscript {}` + `apply()`, no explicit `kotlin-stdlib`, every version in
  `gradle/libs.versions.toml`, repositories declared once in `settings.gradle.kts` under
  `dependencyResolutionManagement` with `RepositoriesMode.FAIL_ON_PROJECT_REPOS`, real
  modules over extra `srcDir(...)` entries, convention plugins in a `build-logic` included
  build rather than `subprojects {}`, all three of
  `org.gradle.configuration-cache` / `caching` / `parallel`, and
  `gradle/actions/wrapper-validation` in CI. Deliberately kept to 4.9 KB with single-line
  code spans so it survives both adapter size limits intact.
- **`gradle-build-auditor` skill** (`requires: [kotlin]`, user-invocable via
  `/gradle-build-auditor`) — discovers the whole build surface, evaluates all ten practices
  across modules rather than file-by-file, reports a
  `practice | verdict | file:line | why` table, then proposes diffs and applies them **only**
  on explicit confirmation, verifying with `./gradlew help --configuration-cache`. The
  wrapper-version check resolves `services.gradle.org/versions/current` at run time and
  degrades to `cannot verify — pinned version is X` on any network failure instead of
  aborting the audit — the model must never answer that one from memory.
- **`references/gradle-best-practices.md`** — the full Don't/Do code for all ten practices,
  including configuration-cache-safe task authoring, loaded on demand at the fix step only.

### Changed

- **`kotlin-specialist` 2.1.0 → 2.2.0.** `references/gradle-dsl.md` no longer duplicates the
  new rule: the version-catalog, dependency-declaration and "Rules" sections are gone, and
  what remains (compiler options, custom tasks, extra test source sets) is now generic
  instead of hardcoding Spovishun's Exposed / Koin / telegrambots / Kotlin 2.3.0 into a
  portable package. Its Decision Table row was split — build *structure* now routes to the
  rule and the auditor, build *script authoring* stays in the reference.

## [1.14.0] — 2026-07-25

### Added

- **KMP track (#142):** a second stack track for Kotlin Multiplatform / Compose
  Multiplatform projects, gated on a new `stack.kmp` flag. `kmp: true` requires
  `kotlin: true` — enforced by `schema/config.schema.json` via `if/then`. The `init`
  wizard asks for it, but only when the project is Kotlin.
- **Six `rules/kmp/` rules:** `architecture` (strict `ui → domain ← data`, the
  `MviViewModel<S, I, E>` contract — `StateFlow` + `onIntent` +
  `Channel(BUFFERED).receiveAsFlow()` with an injected dispatcher **and**
  `CoroutineExceptionHandler`, empty `catch (Throwable)` forbidden — source sets for
  Android/iOS/Desktop, and Compose stability), `feature-structure`
  (`composeApp` + `core/*` + `feature/<name>/{api,impl}`), `navigation` (type-safe
  Navigation 2, route in `api`, graph in `composeApp`), `uikit`, `localization`
  (per-module `composeResources`, explicit `packageOfResClass`) and `testing`
  (`kotlin.test` + fakes in `commonTest`; MockK only in JVM/Android source sets).
- **Two skills** (`requires: [kotlin, kmp]`): `new-feature` — scaffolds the `api`/`impl`
  module pair with an MVI screen, Koin module, localized strings and a ViewModel test,
  then wires navigation and DI (user-invocable via `/new-feature <Name>`); and
  `kmp-multiplatform-specialist` — source sets, `expect`/`actual`, targets, KMP Gradle
  DSL, Compose Resources and platform HTTP engines.
- `STACK_FLAGS` is now exported from `lib/stack-filter.js` as the single JS-side source
  of truth for the flag list.

### Changed

- **Rules are now gated by directory name.** `rules/` files carry no manifest, so the
  top-level group name is the gate: `rules/<stack-flag>/` installs only when that flag is
  active, and any other group (`rules/common/`) always does. `collectRules()` takes a
  second `stackFlags` argument and fails closed — no flags means ungated groups only.
  All three adapters pass the consumer's `config.stack`.
- **`rules/kotlin/kotlin-style.md` is now gated on `stack.kotlin`.** Previously every
  consumer received it regardless of stack. Projects with `kotlin: true` are unaffected;
  a non-Kotlin consumer will stop receiving it on the next install.
- `rules/common/testing.md` now states that its JUnit 5 / MockK stack section does not
  apply to KMP projects and points at `rules/kmp/testing.md`.

### Notes

- Rules are still absent from the lockfile, so `doctor` does not see them and turning a
  stack flag off leaves the previously installed rule files on disk. Pre-existing
  behaviour, unchanged by this release.

## [1.13.0] — 2026-07-23

### Added

- **New skill `two-axis-code-review` (#140):** adaptation of Matt Pocock's `code-review`
  skill for the spovishun stack. Reviews the diff against `develop` (auto-detected via
  merge-base, no prompting) along two axes via two parallel sub-agents with separate,
  never-merged Ukrainian reports: **Standards** (consumer `CLAUDE.md` +
  `.claude/rules/kotlin/*.md` + design principles + the full Fowler 12-smell baseline
  extended with a Kotlin/Clean-Architecture checklist) and **Spec** (the originating
  Notion task resolved from the `feature/{{PROJECT_PREFIX}}-N` branch name via
  `get-task.js`, checked for missing requirements, scope creep, and wrong
  implementations). Stack-gated on `kotlin` + `notion`. Scope is deliberately limited to
  spec conformance + architectural/style standards — bugs, tests, types, and DB stay with
  the existing reviewer agents.

## [1.12.1] — 2026-07-21

### Fixed

- **`bootstrap-config.js` corrupted page ids from slugged URLs (#139):** `parsePageId`
  stripped every dash from the whole URL before matching a 32-hex run, so a slug ending in a
  hex letter fused into the id — `.../Board-<id>` absorbed the trailing `d` of "Board" and
  produced an off-by-one invalid id (Notion 400). It now peels the id off the URL tail
  without touching dashes (drop query string → last path segment → substring after the last
  `-`) and accepts either a dashed uuid or a bare 32-hex run.
- **`bootstrap-config.js` failed on drifted anchor titles (#139):** `extractAnchors` matched
  structural anchors by exact title and threw on the first mismatch. It now matches
  tolerantly — titles are normalized (markdown-link syntax stripped, whitespace collapsed,
  case-insensitive) and matched by prefix/alias, so `Tasks (v2)` and a decorated
  `CLAUDE.md — …` link resolve. All unresolved anchors are now collected and reported in a
  single error instead of one failed run at a time.
- **`doctor` ignored `.env` for the Notion token (#139):** `notion-token-env` read only the
  process environment, while the generated scripts read `.env` via `load-token.js`, causing a
  false failure when the token lived only in `.env`. The check now falls back to `<cwd>/.env`
  (keyed on the configured `notion.token_env`).

## [1.12.0] — 2026-06-21

### Added

- **Optional "with grill" modifier for "start new task" (#135):** saying "start new
  task with grill" (or a Ukrainian equivalent — "з грилем" / "з допитом" /
  "з прожаркою") makes the `notion-task-inject` picker tell the agent to run the
  `grill-me` skill on the loaded task and stress-test the plan **before** entering
  Plan Mode, instead of jumping straight there. Plain "start new task" (no
  modifier) is unchanged. Implemented via a new `GRILL_MODIFIER_TRIGGERS` check in
  the hook, threaded through the picker's REQUIRED-NEXT-ACTIONS directive and into
  `notion-task-to-code`'s new optional `grillFirst` invocation arg (Step 6).
  `START_TASK_TRIGGERS` also gained the imperative form "почни нову задачу".

## [1.11.1] — 2026-06-20

### Fixed

- **Emitted command templates no longer assume `$CLAUDE_PROJECT_DIR` in the agent
  shell (#132):** the Task Picker's REQUIRED-NEXT-ACTIONS printed
  `node "$CLAUDE_PROJECT_DIR/.claude/hooks/notion-task-inject.js" --apply-pick ...`,
  but the harness sets `$CLAUDE_PROJECT_DIR` only for hook subprocesses — not the
  agent's Bash tool shell. There it expanded empty, collapsing the path to
  `/.claude/...`, which Git Bash on Windows remaps to the Git install root
  (`C:/Program Files/Git/.claude/...`), so Node exited with `MODULE_NOT_FOUND` and
  `--apply-pick` failed. Emitted lines now use
  `${CLAUDE_PROJECT_DIR:-<resolved-abs-path>}` (forward slashes), resolved at emit
  time from the hook's own env — it still honors the variable if ever set, and
  falls back to the concrete project path otherwise. The harness-run commands in
  `hooks.json` are unchanged (the variable is valid there). Follows #129.

## [1.11.0] — 2026-06-19

### Added

- **`finish-task` skill + hook flow (#130):** a "finish task" trigger
  (`finish task` / `complete task` / `завершити задачу` / `закінчити задачу`)
  symmetric to "start new task". On an active task branch with cached
  `.dev-context/`, the `notion-task-inject` hook injects a REQUIRED-NEXT-ACTIONS
  directive that invokes the new universal `finish-task` skill. The skill reads
  the build/test/lint commands from the consumer's `CLAUDE.md` `## Commands`,
  runs a **blocking** gate (tests → build → lint), a **non-blocking**
  static-analysis pass, then the existing `code-reviewer` skill on
  `git diff <develop>...HEAD` as an **advisory** report — never auto-merging and
  never setting Notion `Done` automatically.

### Fixed

- **Branch base no longer stale (#130):** `gitSetupBranch` and
  `gitCreateBranchOnly` in the hook now create a new branch from the
  freshly-fetched `origin/<base>` instead of a possibly-stale local ref (a bare
  `git fetch` updates only the remote-tracking ref). Offline → falls back to the
  local base with a stderr warning.
- **CRLF `.env` + token precedence (#129):** `loadEnv()` in the hook and the
  `.env` file-read path in `scripts/notion/lib/load-token.js` now parse CRLF
  files (Windows) instead of silently setting no variables. Token precedence is
  unified to `NOTION_TOKEN` first, then `NOTION_SKILLS_TOKEN`, across both, so a
  stale global `NOTION_SKILLS_TOKEN` no longer silently shadows a working `.env`
  `NOTION_TOKEN`. `notionRequest` now surfaces an explicit error on HTTP 401/403
  (naming the token source) instead of resolving an empty result that looked
  like an empty board.

## [1.10.0] — 2026-06-18

### Added

- **Scope-level `CoroutineExceptionHandler` pattern in the coroutine skills:**
  a background `CoroutineScope(SupervisorJob() + dispatcher)` without a
  `CoroutineExceptionHandler` silently swallows uncaught exceptions — no crash,
  no log, no alert — so features stop working invisibly. Two skills now emit
  guidance against this. `kotlin-specialist` mandates that every `CoroutineScope`
  context carries three elements (Dispatcher + Job + `CoroutineExceptionHandler`)
  and clarifies that `SupervisorJob` only isolates siblings — it does not catch,
  log, or surface the exception; its `references/coroutines.md` gains a WRONG/CORRECT
  pair where the handler logs (SLF4J) **and** reports to observability.
  `dependency-injection-architecture` adds a `Coroutine Scope Provider` section
  (`references/koin-patterns.md`) showing a Koin Annotations example that provides
  the handler as its own dependency keyed by a typed qualifier (annotation class,
  not string `@Named`) and composes `SupervisorJob() + dispatcher + handler` into
  the scope. (#25)

## [1.9.1] — 2026-06-18

### Fixed

- **Send a `User-Agent` header on Notion requests to avoid Cloudflare 403:**
  Cloudflare in front of `api.notion.com` rejects requests with no `User-Agent`
  by returning an HTML `403` page (not a JSON error body), which surfaced as
  `Notion API returned non-JSON response`. Both HTTP layers now always send an
  explicit `User-Agent` — `scripts/notion/lib/notion-http.js` (raw `https`, the
  Notion CLI helpers) and `lib/notion-client.js` (the `fetch`-based client used by
  `init`/bootstrap and `doctor`).

## [1.9.0] — 2026-06-17

### Added

- **Ownership model — never overwrite owner-authored skills on install/update:**
  plugin-generated skills and agents now carry an identity-only provenance
  marker (`x-spovishun: <id>`) in their frontmatter, so `install`/`update` can
  tell their own artifacts from owner-authored ones. The marker is excluded
  from every checksum (a shared `stripMarker()` runs before `sha256`), keeping
  checksums invariant and pre-marker installs migration-safe. The update
  classifier gains three states — **COLLISION** (an owner-authored file occupies
  a plugin id → skip, never locked), **ADOPT** (a marked file with no lock entry
  → registered as baseline, not overwritten), and **DISOWNED** (a locked id now
  holds an unowned, drifted file → left untouched, dropped from the lockfile).
  `install` is non-destructive by default (local edits are skipped with a
  warning) and gains `--force` to reset *your own* edited files — unmarked
  owner files stay sacred even under `--force`. `doctor` adds a read-only
  ownership report (collisions, disowned files, orphaned markers, renamed
  folders). Wired up for the `claude` target; windsurf/codex deferred.

## [1.8.1] — 2026-06-13

### Fixed

- **`get-board.js` `--epic` status filter (#118):** `--epic` now lists an epic's
  tasks across all statuses unless `--status` is given explicitly, so a Backlog
  epic is no longer falsely shown empty. `parseArgs` returns `statusExplicit`
  and a pure `buildListFilter` helper assembles the query filter; `--status` and
  `--stage` still compose. `notion-spovishun-task-manager` documents the new
  behavior.

### Changed

- **CI:** bumped `actions/checkout` and `actions/setup-node` from `@v4` to `@v5`
  in `ci.yml` and `release.yml` — `@v4` runs on the Node 20 action runtime that
  GitHub is sunsetting. `node-version` stays `20`: the bump moves only the action
  runtime, not the Node version the package is tested against (targets Node ≥ 18).

## [1.8.0] — 2026-06-11

### Added

- **Stage support in board scripts (#107):** the Board v2 (Scrum) `Stage`
  select is now first-class across the Notion CLI toolchain.
  `get-board.js` gains a `--stage <Backlog|Sprint|Archive>` filter (AND-combined
  with the Status filter, including the `--priority-tier` and `--latest` paths)
  and maps `stage` into the task JSON; `get-task.js` includes `stage` in
  json/md/text output; `update-status.js` gains `--stage` (positional status is
  now optional — update status, stage, or both in one PATCH) for promoting
  Backlog → Sprint and archiving at sprint close. `lib/query-tasks.js` accepts
  an optional extra filter. Board v1 degrades gracefully: `stage = null` in
  JSON, no Stage column in md/text output, no Stage filter.
- **Stage workflows in task skills (#107):** `notion-spovishun-task-manager`
  documents promote-to-Sprint / archive-on-completion CLI flows;
  `notion-task-to-code` warns when generating a prompt for a task whose Stage
  is not `Sprint`; `task-decomposer` states that decomposed tasks land in
  Backlog and offers promoting the first unblocked task; `newtask` asks
  Backlog (default) vs Sprint and passes `stage` explicitly.

- **Doctor `installed-artifacts` check:** verifies that every artifact pinned
  in the lockfile still has its body file on disk (fail + sync hint when
  missing); checksum drift from local edits is annotated, not failed.
- **Hook unit tests:** first test coverage for `hooks/notion-task-inject.js`
  pure helpers (stage filter shapes, branch derivation, config reader, git-ref
  sanitizer) plus parity guards that pin the hook's priority tiers and the
  `Notion-Version` header to the scripts/lib copies.

### Changed

- **`newtask` branch creation is opt-in (#107):** a git branch is created only
  when the task goes straight to Sprint and the user confirms starting now, or
  when explicitly requested — Backlog tasks no longer spawn branches.
- **Notion HTTP transport (scripts + hook):** non-JSON responses and hung
  sockets now reject with a descriptive error (30 s timeout) instead of
  resolving `null` — an API outage no longer masquerades as an empty board or
  "No Tasks Available" in the picker.
- **Codex lockfile checksums** now cover the rendered body (placeholders
  resolved), matching the claude/windsurf semantics; rules are checksummed
  rendered as well.
- **CLI:** unknown flags print a usage line instead of an unhandled
  `parseArgs` stack trace; async subcommand dispatch deduplicated.
- **Shared rules collector:** the three per-adapter `rules/` walkers merged
  into `lib/rules-loader.js`.

### Fixed

- **`update` dropped rule/template lock entries:** rules never appear in the
  upstream artifact map, so every `rule:` lockfile entry was misclassified as
  REMOVED and silently dropped (windsurf installs); windsurf template files
  (`templates--<id>.md`) were keyed under the wrong kind and never matched
  their lock entries. Update now preserves rule entries (`RULE_SKIP`) and keys
  templates correctly.
- **Claude install deleted user files:** the legacy flat-file cleanup removed
  ANY `.md` in `.claude/skills|agents|_templates/` — it now touches only ids
  known from the current artifact set or the prior lockfile.
- **Hooks broke in ESM consumers:** `.claude/hooks/` now ships a
  `package.json` with `"type": "commonjs"`, so the CJS hooks keep working when
  the consumer's root package.json declares `"type": "module"`.
- **Windsurf stale files:** reinstall now removes plugin-generated files that
  the run did not rewrite (removed artifacts, leftover `-part-N.md` chunks
  after content shrank) while preserving user-authored files.
- **Task hook hardening:** git branch names from config/Notion are validated
  against `[\w./-]` before interpolation into `execSync` (double quotes alone
  do not stop `$(...)`); the base branch is quoted; a failed
  `Status=In progress` PATCH in apply-pick now emits a warning; the phantom
  `Normal` priority tier (diverged from `query-tasks.js`) is gone.
- **Broken `hooks/hooks.json`** during install now emits a warning instead of
  silently skipping hook installation; `settings.json` is written once per
  install instead of twice.

- **`create-task.js` Status default (#107):** the script hardcoded
  `Status = "To do"` while the `newtask` skill declared `Not started`. New
  tasks now land as `Not started` (override via the optional `status` stdin
  field) and appear in the Backlog view.
- **`notion-task-board-manager` status list (#107):** removed `Backlog` from
  the Status values — it is a Stage, not a Status (stage/status conflation).

## [1.7.0] — 2026-06-10

### Added

- **Rules (kotlin-style, #99):** ported the four unique clean-code rules from the
  orphaned `code-decomposition` skill into `rules/kotlin/kotlin-style.md` so they
  regenerate into consumer projects on every install instead of living in a dead,
  non-loaded skill. New **Functions** rules: max 3 parameters (bundle more into a
  `data class`; framework/DSL callbacks exempted inline), nesting depth ≤ 2 via
  guard clauses, no output arguments, and `require()`/`check()` argument
  validation. New **Naming** rule: boolean `is`/`has`/`can`/`should` prefix and
  banned standalone names (`manager`, `helper`, `util`, `data`, `info`).
  Additionally hardened the rule set while in this file: new **Visibility** and
  **Collections** sections (narrowest visibility by default, `internal` for
  module APIs, read-only collection returns, `emptyList()` over `null`,
  functional operators over mutating loops) and **Idiomatic Kotlin** rules for
  top-level functions / `object` over static-helper classes and disciplined
  `companion object` use.

## [1.6.0] — 2026-06-09

### Added

- **Schema:** optional `user_invocable` and `disable-model-invocation` boolean
  fields in `manifest.yaml` (`schema/manifest.schema.json`). The Claude adapter
  (`lib/skill-frontmatter.js`) synthesizes them into the generated `SKILL.md`
  frontmatter, emitting a line only when the value diverges from Claude Code's
  default (`user_invocable: true`, `disable-model-invocation: false`). This lets
  invocation flags live in the canonical manifest instead of an inline
  frontmatter block.

### Changed

- **Skill authoring (Anthropic guidelines, #97):** removed duplicated inline
  YAML frontmatter from 12 skill bodies so `manifest.yaml` is the single source
  of metadata, matching the package's "canonical body + manifest" pattern. The
  adapter now synthesizes a trigger-rich `description` from `manifest.triggers`
  for these skills (previously the hand-written inline block won and the
  manifest triggers were ignored). `commit` gained an explicit
  `user_invocable: true` in its manifest.
- **Progressive disclosure:** refactored four reference-style skills
  (`docker-deployment`, `ci-cd-pipeline-builder`, `database-optimizer`,
  `dependency-injection-architecture`) to the Decision Table + `references/*.md`
  layout already used by `kotlin-specialist` / `postgresql-exposed-orm`. Heavy
  inline code blocks moved into nested reference files; each `SKILL.md` is now a
  thin router. Procedural workflow skills were intentionally left intact.

## [1.5.0] — 2026-06-07

### Added

- **`scripts/notion/bootstrap-config.js`** — config extractor for the Notion
  project template. Given a freshly duplicated template page URL, it walks the
  copy by its fixed English anchor titles and resolves all six anchor IDs
  (`database_id`, `epics_database_id`, `epics_group_page_id`,
  `claude_md_page_id`, `root_page_id`, `docs_root_id`) plus the seven
  `categories.*` IDs. Prints a ready `notion:` YAML block (or JSON), or patches
  `spovishun-skills.config.yaml` in place with `--write` (line-based, comments
  preserved — no YAML dependency, consistent with `lib/config-reader.js`).
  Delivered into consumer `.claude/scripts/notion/` when `stack.notion: true`.
  See the "Bootstrapping a new project's Notion docs" section in the README.

## [1.4.0] — 2026-06-07

Minor release. Two independent fixes that surfaced during Spovishun dogfooding:

1. The CLI's single-paragraph fallback for page content is replaced by a proper
   markdown → Notion blocks parser. Closes the gap where `create-task.js`
   flattened the 5-section newtask template into one paragraph and hit the
   2000-char `rich_text` limit on any non-trivial task body.
2. Claude Code hook commands are now anchored on `$CLAUDE_PROJECT_DIR` instead
   of the bare relative `.claude/hooks/...` form. The Stop / SessionStart /
   UserPromptSubmit / PreCompact / PostToolUse hooks no longer fail with
   `MODULE_NOT_FOUND` when the user's working directory differs from the
   project root (e.g. another repo opened in the same Claude session).

### Added

- **`scripts/notion/lib/markdown-to-blocks.js`** — new pure module that takes a
  markdown string and returns an array of Notion API block objects. Backed by
  `marked@15` (CommonJS-compatible, zero runtime dependencies). Covered block
  types:
  - `heading_1` / `heading_2` / `heading_3` (depth 4+ collapses to 3 — Notion
    does not expose deeper levels)
  - `paragraph` with inline `bold` / `italic` / `code` / `strikethrough` /
    `link` annotations
  - `bulleted_list_item` / `numbered_list_item` with recursive `children` for
    nested lists
  - `to_do` for GFM task lists (`- [ ]` / `- [x]`)
  - `code` with language normalization (`js` → `javascript`, `kt` → `kotlin`,
    unknown → `plain text` so the API never rejects on language)
  - `quote` with inline + block children flattened correctly
  - `callout` for GitHub-style alerts (`> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]`
    / `[!WARNING]` / `[!CAUTION]`) with matching emoji + colored background
  - `divider` for `---`
  - `table` with header row + correct `table_width`
  - `toggle` for `<details><summary>...</summary>…</details>` HTML, with the
    inner block tokens nested as `children`
- **Auto-chunking** of any `rich_text` segment longer than 2000 chars (Notion's
  per-text-run hard limit) into multiple sibling segments preserving
  annotations + link. Emits a `stderr` warning when the produced block array
  exceeds 100 (Notion's per-create-request children limit).
- **`marked@15`** added to `dependencies` and **vendored** under
  `scripts/notion/lib/vendor/marked.cjs` (73 KiB single file, byte-identical
  to `node_modules/marked/lib/marked.cjs`). Consumer projects do not run
  `npm install` on the installed `.claude/scripts/` tree, so a bare
  `require('marked')` would fail with `MODULE_NOT_FOUND` after a fresh
  install. The vendored copy is what the installed parser actually requires;
  `npm run lint` runs `scripts/check-vendored-marked.js` to catch drift, and
  `scripts/vendor-marked.js` regenerates the bundle after `npm update marked`.
  Pinned to the last CommonJS-compatible major (>=v16 is ESM-only,
  incompatible with the `scripts/notion/` CJS package).

### Changed

- **`scripts/notion/create-task.js`** and **`scripts/notion/create-epic.js`**
  now pipe the stdin `content` field through `markdownToBlocks()` instead of
  inlining one paragraph block. No backward-compatibility flag: a plain-text
  body still produces a single paragraph block via the same parser.
- **`skills/newepic/SKILL.md`** — the "Fallback (CLI — only for short /
  programmatic creates)" section is renamed to "Alternative path — CLI (since
  v1.4.0)" with the limitation note replaced by the 100-blocks-per-request
  cap reminder.
- **`skills/newtask/SKILL.md`** — the create-task example now mentions that
  the CLI parses full markdown (since v1.4.0), aligning the doc with reality.

### Manifests bumped

- `newtask` 1.0.1 → 1.0.2
- `newepic` 1.0.1 → 1.0.2
- `scripts/notion/package.json` 1.1.0 → 1.2.0

### Why a new dep

`CLAUDE.md` documents "minimum deps" as the policy. `marked` adds one
high-quality dependency that replaces ~400 lines of hand-rolled markdown
parser + ~300 lines of edge-case tests. It has 0 runtime deps, 33 k★, a
public security policy, and a release cadence of ~3 per month. We treat it
the same way we treat `ajv` or `js-yaml`: a single quality dep is preferred
over equivalent in-tree code we'd have to maintain forever.

### Fixed — hook commands anchored on $CLAUDE_PROJECT_DIR

- **`hooks/hooks.json`** — every `command` string is rewritten from the bare
  relative form `node .claude/hooks/<script>.js` to
  `node "$CLAUDE_PROJECT_DIR/.claude/hooks/<script>.js"` (double-quoted so
  paths with spaces survive). Claude Code resolves a hook `command` against
  the current working directory of the hook process, not the project root;
  any user who opened a second repo in the same Claude session before this
  release saw the Stop hook fail with `MODULE_NOT_FOUND` against the wrong
  cwd. `$CLAUDE_PROJECT_DIR` is set by Claude Code itself, so the form is
  cwd-independent.
- **`hooks/notion-task-inject.js`** — the two prompt strings that tell Claude
  to run `node .claude/hooks/notion-task-inject.js --apply-pick <pageId>` use
  the same `$CLAUDE_PROJECT_DIR`-anchored form. Those commands are executed
  by Claude via `Bash`, not by the hook subsystem, but the cwd-drift problem
  is identical.
- **`bin/doctor.js resolveHookScript()`** — extended to recognise both the
  legacy bare `.claude/hooks/...` token and the new
  `$CLAUDE_PROJECT_DIR/.claude/hooks/...` token (with or without surrounding
  double quotes). Doctor's "missing hook script" check now works on
  pre-1.4.0 settings.json files and on settings.json regenerated by 1.4.0
  alike.
- Codex / Windsurf adapters are untouched — they do not consume
  `hooks/hooks.json`.

## [1.3.0] — 2026-06-06

Minor release. Adds a new Notion CLI helper for archive/restore — closes the
"create + update but can't clean up" gap in the script set surfaced while
smoke-testing the Notion workflow.

### Added

- **`scripts/notion/archive-task.js`** — new CLI that PATCHes
  `/v1/pages/{id}` with `archived: true` (default) or `archived: false`
  (`--unarchive` flag) to move a page to / restore from Notion Trash. Accepts
  a page id only (compact or dashed UUID) — usage string documents this
  explicitly so the caller doesn't expect the `<prefix>-N` shorthand that
  `get-task.js` resolves. Mirrors `update-status.js` in size and style: same
  shebang, `'use strict'`, the same `loadToken` / `notion-http` / `page-id`
  lib reuse, the same stderr-on-error + JSON-on-stdout convention.
- **Test wiring:** `scripts-notion-delivery.test.js` now asserts that
  `archive-task.js` is installed under `.claude/scripts/notion/` (with the
  `#!/usr/bin/env node` shebang) and is included in the
  "no hard-coded UUIDs / no `spovishun-<N>` literals" sweep.

### Changed

- **`skills/notion-spovishun-task-manager/SKILL.md`** — the I/O rule now
  documents `archive-task.js` as the cleanup partner of `create-task.js` /
  `update-status.js` (no MCP equivalent at the moment).
- **`skills/notion-workflow-spovishun/SKILL.md`** — added an
  "Archive / restore a throwaway page (cleanup)" row to the MCP vs REST
  decision matrix.

### Manifests bumped

- `notion-spovishun-task-manager` 1.0.1 → 1.0.2
- `notion-workflow-spovishun` 1.0.1 → 1.0.2
- `scripts/notion/package.json` 1.0.1 → 1.1.0

## [1.2.3] — 2026-06-05

Patch release. Fixes a contract drift between `scripts/notion/get-task.js` and the
`notion-task-to-code` skill surfaced during Spovishun dogfooding: the skill documented
a `<N-or-pageId>` shorthand that the script never actually supported.

### Fixed

- **`scripts/notion/get-task.js`** now accepts a bare numeric arg (`get-task.js 93`) and
  normalizes it to `<projectPrefix()>-93` before resolving via the board query. Previously
  a bare number fell through to `toDashed()` and Notion rejected it with
  `path.page_id should be a valid uuid`.
- **`scripts/notion/get-task.js`** gains the `text` output format (`--format=text`), matching
  the parity already offered by `get-board.js` and `list-epics.js`. Default remains `json`.
- **`skills/notion-task-to-code/SKILL.md`** Step 1d now spells out the three accepted forms
  (`<prefix>-N` / `N` / `pageId`) and the available formats. The misleading `<N-or-pageId>`
  shorthand is gone.

### Changed

- **`scripts/notion/get-task.js`** is now a dual CLI + module: it exports
  `normalizeTaskArg`, `renderText`, `renderMd`, `resolvePageId`, and `VALID_FORMATS` for
  unit testing while keeping its `main()` entrypoint behind a `require.main === module`
  guard.

### Added

- **`test/scripts-notion-get-task.test.js`** — unit coverage for `normalizeTaskArg`
  (bare-number rewrite, prefixed pass-through, pageId untouched, config-derived prefix),
  for the regex contract with `lib/project-prefix.js`, for the new `text` format, and for
  `renderText` body shape (with and without optional fields).

### Manifests bumped

- `notion-task-to-code` 1.0.1 → 1.0.2
- `scripts/notion/package.json` 1.0.0 → 1.0.1

## [1.2.2] — 2026-06-04

Patch release with two breaking-but-necessary changes:

1. Fixes a runtime-breaking confusion between Notion `database_id` and
   `data_source_id` in five bundled skills (4xx from the Notion API).
2. Closes a long-standing self-inconsistency: skills referenced
   `scripts/notion/*.js` CLI helpers that **did not ship with the plugin**, so
   every freshly-installed consumer hit `MODULE_NOT_FOUND` the moment a skill
   tried to read the board. The scripts are now part of the plugin and the
   Claude adapter installs them into `.claude/scripts/notion/`.

### Fixed

- **`lib/placeholder-map.js`** — removed two false aliases that mapped the configured
  `database_id` / `epics_database_id` under `*_COLLECTION_ID` / `*_DATA_SOURCE_ID` names.
  In Notion's data-sources model a database id and its data_source (collection) id are
  different UUIDs. Skills that interpolated those aliases into MCP
  `parent: { type: "data_source_id", data_source_id: "<value>" }` parents failed at
  runtime with `404 object_not_found` — proven against the live Notion API during the
  spovishun-93 dogfooding.
- **`skills/newtask`**, **`skills/newepic`**, **`skills/notion-spovishun-task-manager`**,
  **`skills/task-decomposer`** — the MCP create-page examples now use
  `parent: { type: "database_id", database_id: "{{NOTION_DATABASE_ID}}" }` (or
  `{{NOTION_EPICS_DATABASE_ID}}` for epics). Inline notes flag the single-data-source
  prerequisite of the `database_id` parent and point to `notion-task-board-manager`
  for the multi-source / live-fetched `data_source_id` pattern.
- **`skills/task-decomposer`** — Step 0 board lookup no longer constructs a broken
  `data_source_url: "collection://<database_id>"` URL; switched to
  `node scripts/notion/get-board.js`, which uses the REST `/databases/{id}/query`
  endpoint that is consistent with the rest of the consumer-side tooling.
- **`skills/notion-navigator`** — prose now references `{{NOTION_DATABASE_ID}}` /
  `{{NOTION_EPICS_DATABASE_ID}}` and clarifies they are database_ids, not collection
  ids, with a pointer to live-fetching the data_source_id when MCP needs it.
- **`hooks/notion-task-inject.js`** — renamed the misleading `NOTION_BOARD_COLLECTION_ID`
  env-var reference to `NOTION_DATABASE_ID` (the value was always a `database_id`; the
  hook calls `/v1/databases/{id}/query`). The old name is still accepted as a
  deprecated alias so existing consumer `.env` files keep working.

### Changed

- **Board v2 (Scrum) Stage default flipped to explicit `Backlog`.** Pre-v1.2.2, the
  `notion-spovishun-task-manager/references/board-v2-stages.md` doc told `newtask` to
  leave `Stage` empty — that left new tasks invisible to the `Stage = Backlog` Backlog
  view filter unless you also kept the `Stage is empty` clause around forever. New tasks
  now set `Stage: "Backlog"` explicitly in the MCP create body (omit the property
  entirely on Board v1 / when `notion.picker.stage_filter` is unset). Doc and skill
  guidance updated together; the Backlog view filter clause is unchanged for
  backward compatibility with pre-v1.2.2 tasks.

### Removed

- **Placeholders `NOTION_BOARD_COLLECTION_ID` and `NOTION_EPICS_DATA_SOURCE_ID`** —
  no longer surfaced by the placeholder map; dropped from every manifest that declared
  them (`newtask`, `newepic`, `notion-navigator`, `notion-spovishun-task-manager`,
  `task-decomposer`). Any skill body still referencing one will fail install with a
  clear `UNKNOWN_PLACEHOLDER` error — intended, surfaces the bug.

### Added — Notion CLI scripts now ship with the plugin

- **`scripts/notion/`** — 7 CLI helpers (`get-board.js`, `get-task.js`,
  `get-claude-md.js`, `create-task.js`, `create-epic.js`, `list-epics.js`,
  `update-status.js`) plus 12 shared `lib/` modules. Ported from the Spovishun
  project and generalized: no hard-coded Notion UUIDs, no hard-coded
  `spovishun-` task-id prefix. All values resolve at run time:
  - `NOTION_DATABASE_ID` / `NOTION_EPICS_DATABASE_ID` / `NOTION_CLAUDE_MD_PAGE_ID`
    env vars take precedence; otherwise read from `spovishun-skills.config.yaml`.
  - `PROJECT_PREFIX` env var or a slugified `project.name` drives the task-id
    regex (e.g. `myapp-42` for `project.name: "MyApp"`).
- **`adapters/claude/index.js`** — new `installScripts()` step that mirrors
  `scripts/notion/` into the consumer's `.claude/scripts/notion/` when
  `stack.notion` is true. No-op otherwise. Codex / Windsurf targets do not
  receive scripts (those adapters surface skills as inline text).
- **`scripts/notion/create-task.js`** — supports a new `stage` field on stdin
  for Board v2 (Scrum). Default `"Backlog"`; pass `null` to omit the Stage
  column entirely on Board v1.
- **`scripts/notion/lib/config-reader.js`** — strips a UTF-8 BOM before
  scanning the consumer config so `Out-File -Encoding utf8` (PowerShell 5.1)
  configs don't silently parse to empty.

### Changed — skill bodies use installed script path

- All eight skills that invoke a Notion CLI helper (`newtask`, `newepic`,
  `task-decomposer`, `notion-spovishun-task-manager`, `notion-task-to-code`,
  `notion-workflow-spovishun`, `notion-content-reader`) now reference
  `node .claude/scripts/notion/<script>.js` instead of the un-prefixed
  `node scripts/notion/<script>.js` that pointed nowhere on a fresh install.

### Manifests bumped

- `newtask` 1.0.0 → 1.0.1
- `newepic` 1.0.0 → 1.0.1
- `notion-navigator` 1.0.0 → 1.0.1
- `notion-spovishun-task-manager` 1.0.0 → 1.0.1
- `task-decomposer` 1.0.0 → 1.0.1
- `notion-task-to-code` 1.0.0 → 1.0.1
- `notion-workflow-spovishun` 1.0.0 → 1.0.1
- `notion-content-reader` 1.0.0 → 1.0.1

### Migration notes for consumers

1. Re-run `npx spovishun-skills install --target=<target>` after upgrading.
2. The `NOTION_BOARD_COLLECTION_ID` env var in `.env` keeps working but is deprecated;
   rename it to `NOTION_DATABASE_ID` at your convenience.
3. Board v2 users on Notion: new tasks created via these skills will explicitly land
   in `Stage = "Backlog"` (was: empty). If you have a Backlog view filtering on
   `Stage is empty` only, broaden it to `Stage = Backlog OR Stage is empty`.

### Known follow-ups (not addressed in this patch)

- First-install pruning over hand-authored `.claude/` (carried over from v1.2.1). A
  deprecated `diagram-design/` skill folder and a legacy `.claude/skills/_templates/`
  directory are not removed because the pre-existing install has no provenance.

## [1.2.1] — 2026-06-03

Patch release. Fixes a Claude-adapter bug surfaced by dogfooding the published plugin in the
Spovishun project: the Claude install was writing 24 of 36 skills without any YAML frontmatter,
which silently degraded Claude Code's skill triggering (it fell back to the body's first H1
instead of the manifest's `description`).

### Fixed

- **`adapters/claude/index.js`** now synthesizes a `---\nname: <id>\ndescription: ...\n---`
  frontmatter block at the top of every `.claude/skills/<id>/SKILL.md` when the canonical body
  does not already start with one. Bodies that ship with their own inline frontmatter (e.g.
  `code-reviewer`) are written verbatim — no double-wrap. Agents and templates are unchanged.
- **`adapters/claude/update.js`** mirrors the install behavior so `update --target=claude` and
  `sync` produce byte-identical output to a fresh install for the same upstream commit.
- **`bin/update.js`** prepends the same synthesized frontmatter when building its upstream
  checksum map, so the three-way classifier sees AUTO_APPLY (not "drifted") once a re-install
  with the new adapter has run.

### Added

- **`lib/skill-frontmatter.js`** — small pure helper module. `composeSkillDescription(manifest)`
  appends a `Triggers: <en+uk joined>.` suffix to the manifest's `description` so triggering
  matches the convention used by hand-authored inline-frontmatter skills like `code-reviewer`.
  `ensureSkillFrontmatter(body, manifest)` is the no-op-if-present write-side guard.
- Tests: `test/skill-frontmatter.test.js` (unit) + new `manifest-only` / `inline-frontmatter`
  / `agent-unchanged` cases in `test/install-claude.test.js`. New fixture
  `test/fixtures/source/skills/inline-frontmatter-skill/` covers the no-double-wrap path.

### Known follow-ups (not addressed in this patch)

- Pruning hand-authored artifacts the lockfile never owned. A first install over a hand-authored
  `.claude/` cannot remove pre-existing files (e.g. a deprecated `diagram-design/` skill folder,
  or a legacy `.claude/skills/_templates/` directory) because they have no provenance. Likely
  fix: teach `install` to prune known-removed skill ids and detect the legacy template location.

## [1.2.0] — 2026-06-02

Folder-layout supporting files across all adapters, templates as a first-class artifact kind,
Board v2 (Scrum) config-driven picker support, removal of the deprecated `diagram-design` skill,
and consumer-side reconciliation of legacy layouts on re-install.

### Added

- **Folder-layout supporting files.** Skills, agents, and templates may now ship `references/`,
  `assets/`, and other supporting subdirectories alongside their canonical body. The loader walks
  the artifact directory and surfaces every non-manifest file as `artifact.files[]` with utf8/base64
  encoding. All three adapters render this content:
  - **Claude:** writes `.claude/<subdir>/{id}/<BODY>.md` plus each supporting file, preserving the
    relative path. Text files are Mustache-rendered (`.md`, `.txt`, `.json`, `.yaml`, `.yml`,
    `.html`); binary files are copied verbatim.
  - **Codex:** inlines each text supporting file under the parent artifact as a `#### {id} — {relpath}`
    sub-heading (heading-demoted to nest correctly under `## Skills` / `## Agents` / `## Templates`).
    Binary files are skipped with a stderr warning.
  - **Windsurf:** writes each supporting file as a separate rule named
    `{id}--{relpath-with-double-dash}.md` (and `templates--{id}--…` for templates). Auto-split at
    6 000 chars applies per file. Binary files are skipped with a stderr warning.
- **Multi-file skill fidelity restored.** The `kotlin-specialist`, `postgresql-exposed-orm`, and
  `telegram-bot-development` skills again ship with their full `references/` directories (17 files)
  that the SKILL.md bodies link to.
- **Templates as a first-class kind (`template`).** New `templates/<id>/` directory with
  `manifest.yaml` + `TEMPLATE.md`. Stack filtering, Mustache rendering, and supporting files behave
  identically to skills. Bundled: `epic-page`, `task-to-code-prompt` (generalized from the original
  Spovishun-specific bodies — placeholders carry the project context).
- **Board v2 (Scrum) picker.** New optional `notion.picker.stage_filter` config field (e.g.
  `"Sprint"`). When set, the `notion-task-inject` hook adds a `Stage = <value>` constraint to every
  task-board query (priority tier, fallback, orphaned-in-progress, main active-task). Unset =
  Board v1 behavior (backward compatible). Env var `NOTION_PICKER_STAGE_FILTER` overrides config.
- **Board v2 stage reference.** New
  `skills/notion-spovishun-task-manager/references/board-v2-stages.md` documenting the 3-stage
  lifecycle (Backlog / Sprint / Archive), board views, query shape, and a Board v1 → v2 migration
  recipe. Referenced from the parent SKILL.md.
- **`NOTION_PICKER_STAGE_FILTER` placeholder.** Surfaced by `lib/placeholder-map.js` when
  `stack.notion=true` and `notion.picker.stage_filter` is set.

### Changed

- **`adapters/claude/index.js`** now writes the folder layout `.claude/<subdir>/{id}/<BODY>.md`
  (was flat `.claude/<subdir>/{id}.md`). On every install/sync, legacy flat `.md` files are removed
  and stale artifact folders whose lockfile entry is no longer in the filtered set are pruned.
- **`adapters/claude/update.js`** writes the new folder layout for three-way merge output.
- **`lib/artifact-loader.js`** — `KIND_MAP` switched from `_templates` → `templates`; template
  body now resolved as `TEMPLATE.md`. Artifact objects gain `artifactDir` and `files[]`.
- **`lib/installed-files-loader.js`** for the claude target reads from both the new folder layout
  and the legacy flat layout so `sync` / `update` keep working through the migration.
- **`adapters/codex/build-agents-md.js`** adds a `## Templates` section; supporting files are
  inlined under each artifact (skipping binaries with stderr warning).
- **`adapters/windsurf/index.js`** includes templates (`templates--{id}.md`) and supporting files.
- **`hooks/notion-task-inject.js`** — `readConfigValue()` extended to accept 2-level dotted keys
  (`'picker.stage_filter'`). 1-level lookups (`'database_id'`) unchanged.
- **`schema/config.schema.json`** — added optional `notion.picker.stage_filter` field.
- **`scripts/validate-all-manifests.js`** — `templates/` included in the lint sweep.
- **README** — bundled-skill count updated from 37 → 36.

### Removed

- **`skills/diagram-design/`** — the standalone diagram-design skill is deleted. Cross-references
  in `architecture-designer`, `technical-documentation-writer`, and README have been replaced with
  direct guidance to use Mermaid (inline) or Excalidraw / draw.io (external) per scenario. Consumer
  installations with the old layout will have the legacy file/folder removed on next install/sync
  via the reconciliation pass.

### Migration notes for consumers

1. Re-run `npx spovishun-skills install --target=<claude|codex|windsurf>` after upgrading.
2. The Claude install removes any pre-v1.2.0 flat `.claude/<subdir>/{id}.md` files automatically.
   Custom content inside `.claude/<subdir>/{id}/` (e.g. local notes) is preserved.
3. `diagram-design` artifacts are removed on the next install.
4. To opt into Board v2, add to `spovishun-skills.config.yaml`:
   ```yaml
   notion:
     picker:
       stage_filter: "Sprint"
   ```
   Leaving the field absent keeps Board v1 behavior — the hook never touches Stage.

## [1.1.0] — 2026-05-26

Surfaced by dogfooding the published plugin in the Spovishun project (spovishun-93): bug fixes plus
an additive `notion.categories` config field (hence a minor bump).

### Fixed

- **Claude adapter now renders rule files** instead of copying them verbatim. Mustache placeholders
  in `rules/` (e.g. `git-workflow.md`) previously landed in `.claude/rules/` as literal `{{…}}`.
  Now consistent with the Codex and Windsurf adapters.
- **`rules/common/git-workflow.md`** branch-naming template no longer double-prefixes the branch
  (`{{GIT_BRANCH_PREFIX}}{{PROJECT_PREFIX}}` → `{{GIT_BRANCH_PREFIX}}`).
- **`notion-task-inject.js` hook** now resolves the task board ID, project prefix, and dev branch
  from `spovishun-skills.config.yaml` when the corresponding env vars are unset, so a plain
  `install` yields a working task picker without extra environment setup. Env vars still take precedence.
- **README** corrected: `spovishun-skills.config.yaml` should be **gitignored** (holds Notion IDs),
  not committed — matching the `doctor` check.

### Added

- **`notion.categories`** config block — documentation category page IDs (`architecture`, `database`,
  `testing`, `cicd`, `features`, `aitools`, `epics`). Each derives `NOTION_CATEGORY_<KEY>_ID` and
  `NOTION_ZONE_<KEY>_URL` (`https://www.notion.so/<id>`) placeholders used by `notion-navigator` and
  `doc-updater`. Optional `init` wizard prompts added.

## [1.0.0] — 2026-05-25

First public release on npm.

### Added

- **CLI commands**
  - `validate <skill-dir>` — validates a skill's `manifest.yaml` against the JSON Schema
  - `init` — interactive wizard that generates `spovishun-skills.config.yaml`
  - `install --target=<claude|codex|windsurf>` — installs filtered artefacts and writes the lockfile
  - `sync` — re-applies the install from existing config + lockfile (no wizard)
  - `update --upstream=<dir>` — three-way merge against an upstream copy (`--skill <id>`, `--dry-run`)
  - `doctor` — validates installation integrity (config, lockfile, Notion ids, `.gitignore`, `settings.json`)
- **Target adapters**
  - Claude Code (native plugin via `.claude-plugin/` + `.claude/`)
  - Codex (single `AGENTS.md` ≤ 32 KiB)
  - Windsurf (one file per artifact under `.windsurf/rules/`, auto-split at 6 000 chars)
- **Validation & schema**
  - Manifest validation with Ajv 8 and JSON Schema 2020-12
  - Consumer config schema (`schema/config.schema.json`)
  - Conditional `requires:` rule (mandatory for `category: stack-specific`, forbidden for `universal`)
- **Placeholders** — Mustache `{{KEY}}` substitution with `UPPER_SNAKE_CASE` key validation; non-matching tokens (e.g. `${{ runner.os }}`) preserved verbatim
- **Stack filtering** — install only artifacts whose `requires:` flags are all enabled in the consumer config
- **Lockfile** (`spovishun-skills.lock.yaml`) — pinned versions and SHA-256 checksums for reproducible installs

### Bundled artifacts

- 37 skills · 9 agents · 6 hooks (Claude only) · 6 rules

### Known limitations

- **Cursor adapter** — planned for 1.1
- **`update --target=codex`** is a no-op. The monolithic `AGENTS.md` doesn't support per-artifact three-way merge; regenerate with `install --target=codex` instead.

[1.0.0]: https://github.com/Astrumon/spovishun-skills/releases/tag/v1.0.0
