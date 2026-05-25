# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
