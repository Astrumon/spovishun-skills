# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
