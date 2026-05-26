# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
