# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
