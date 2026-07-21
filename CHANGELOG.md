# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
