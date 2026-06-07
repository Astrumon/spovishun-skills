# spovishun-skills

[![npm version](https://img.shields.io/npm/v/spovishun-skills.svg)](https://www.npmjs.com/package/spovishun-skills)
[![license](https://img.shields.io/npm/l/spovishun-skills.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/spovishun-skills.svg)](https://nodejs.org)

Portable [Claude Code](https://claude.com/claude-code) skills, agents, hooks and rules — extracted from the [Spovishun](https://github.com/Astrumon/SpovishunTelegramBotV2) project, packaged for reuse in any project.

One canonical source. Multiple AI assistants. Configurable per project.

## What you get

A single `npx` command installs a curated set of:

- **36 skills** — task decomposition, code review, Notion workflows, Kotlin/Postgres helpers, etc.
- **9 agents** — specialized reviewers (architecture, refactor, docs, …)
- **6 hooks** *(Claude only)* — session start/end, learning capture, Notion task injection
- **6 rules** — design principles, git workflow, security, testing, Kotlin style

Artifacts are filtered by your stack flags (kotlin / postgres / telegram / notion / docker) — you get only what's relevant to your project.

## Supported targets

| Target       | Status | Notes                                                              |
|--------------|--------|--------------------------------------------------------------------|
| Claude Code  | ✅     | Native plugin via `.claude-plugin/` + `.claude/`                   |
| Codex        | ✅     | Single `AGENTS.md` at project root (≤ 32 KiB)                      |
| Windsurf     | ✅     | One file per skill/rule under `.windsurf/rules/` (≤ 6 000 chars)   |
| Cursor       | 🚧     | Planned for 1.1                                                    |

## Quickstart

```bash
# 1. Generate your project config (interactive wizard)
npx spovishun-skills@latest init

# 2. Install artifacts for your target AI assistant
npx spovishun-skills@latest install --target=claude

# 3. Verify installation integrity
npx spovishun-skills@latest doctor
```

After `install`, commit the generated `spovishun-skills.lock.yaml` to lock versions. Re-run `sync` on any machine to reproduce the exact same install.

## Configuration

`init` creates `spovishun-skills.config.yaml` in your project root:

```yaml
project:
  name: "MyProject"
  language: "uk"           # uk | en

stack:
  kotlin: true
  postgres: false
  telegram: true
  notion: true
  docker: false

git:
  branch_prefix: "feature/myproject"
  main_branch: "main"
  dev_branch: "develop"

# Required only if stack.notion: true
notion:
  token_env: "NOTION_TOKEN"      # env var name, NOT the token value
  database_id: "<32-hex-chars>"
  epics_database_id: "<32-hex-chars>"
  # Optional — Notion documentation category page IDs (notion-navigator, doc-updater).
  # Each id also derives a zone URL https://www.notion.so/<id>.
  categories:
    architecture: "<32-hex-chars>"
    database: "<32-hex-chars>"
    testing: "<32-hex-chars>"
    cicd: "<32-hex-chars>"
    features: "<32-hex-chars>"
    aitools: "<32-hex-chars>"
    epics: "<32-hex-chars>"
```

Schema is validated against [`schema/config.schema.json`](./schema/config.schema.json). Edit by hand or re-run `init` to overwrite.

**Gitignore `spovishun-skills.config.yaml`** — it holds your Notion IDs, so it should not be committed (`doctor` checks this). Commit a sanitized `spovishun-skills.config.example.yaml` instead, plus the generated `spovishun-skills.lock.yaml`.

## Bootstrapping a new project's Notion docs

Filling the `notion:` block by hand means copying ~13 page/database IDs out of Notion — tedious and error-prone. Instead, duplicate the **Notion project template** and let `bootstrap-config.js` harvest the IDs for you.

The template is a single Notion page tree (a row in your Projects DB) holding the full doc skeleton: a `CLAUDE.md` page, a Board (Tasks DB with Status/Stage/Priority, an Epic relation and a Blocked-by self-relation), an Epics DB, and the 7 documentation category DBs — with per-stage board views and placeholder records.

1. **Duplicate** the template page in Notion. Notion remaps every relation and view onto the copy.
2. **Before renaming anything**, run from your new project's repo root:
   ```bash
   node .claude/scripts/notion/bootstrap-config.js <new-page-url> --write
   ```
   It walks the copy by its fixed English anchor titles and writes `database_id`, `epics_database_id`, `epics_group_page_id`, `claude_md_page_id`, `root_page_id`, `docs_root_id` and every `categories.*` into `spovishun-skills.config.yaml` (existing comments preserved). Omit `--write` to print the resolved `notion:` block instead (`--format json` for JSON).
3. Rename the page, fill the placeholders, and delete the `🔧 PLACEHOLDER` seed records.
4. If a CLI script later returns **404**, share the new project's pages with your Notion integration (duplicates normally inherit access from the Projects DB).

> Run the extractor **before** renaming — it identifies anchors by their English titles, which only survive duplication intact until you edit them.

## Commands

| Command | Purpose |
|---|---|
| `init` | Interactive wizard → `spovishun-skills.config.yaml` |
| `install --target=<t>` | Generate target-specific files + write lockfile |
| `sync` | Re-apply install from existing config + lockfile (no wizard, no merge) |
| `update --upstream=<dir>` | Three-way merge against a fresh upstream copy of `spovishun-skills` |
| `doctor` | Validate installation integrity (config, lockfile, Notion ids, `.gitignore`, `settings.json`) |
| `validate <skill-dir>` | Validate a single skill's `manifest.yaml` against the JSON schema |

Run `npx spovishun-skills --help` for full options.

### `update` flags

```bash
npx spovishun-skills update --upstream=./node_modules/spovishun-skills
# [--skill <id>]   limit to one artifact
# [--dry-run]      print planned actions, write nothing
```

> **Codex limitation:** `update --target=codex` is a no-op (the monolithic `AGENTS.md` doesn't support per-artifact merge). Regenerate with `install --target=codex` instead.

## How stack filtering works

Each artifact's `manifest.yaml` declares which stack flags it needs:

```yaml
id: postgresql-exposed-orm
category: stack-specific
requires:
  - kotlin
  - postgres
```

An artifact installs **iff all `requires:` flags are `true`** in your `spovishun-skills.config.yaml`. Universal artifacts (no `requires:`) install for everyone.

## Reproducible installs (lockfile)

After `install`, `spovishun-skills.lock.yaml` is written to your project root. It pins exact versions + checksums of every installed artifact. **Commit this file** — `sync` and `update` both rely on it.

```yaml
version: 1
generated_at: "2026-05-25T17:00:00Z"
target: claude
artifacts:
  - id: code-reviewer
    type: skill
    version: 1.2.0
    checksum: "sha256:…"
  - …
```

## Placeholders

Canonical artifact bodies use Mustache `{{KEY}}` placeholders for project-specific values (project name, language, Notion DB ids, etc.). Keys must be `UPPER_SNAKE_CASE`. Resolved at install time from your config.

Tokens that don't match the pattern (e.g. GitHub Actions `${{ runner.os }}`) are preserved verbatim.

## Requirements

- Node.js ≥ 18
- For Notion-tagged artifacts: a `NOTION_TOKEN` env var (or whatever name you set in `notion.token_env`)

## Project structure (after install into a Claude project)

```
your-project/
├── .claude-plugin/                  ← native plugin entry
├── .claude/
│   ├── skills/
│   ├── agents/
│   ├── hooks/
│   ├── rules/
│   └── settings.json
├── spovishun-skills.config.yaml     ← editable; gitignore it (holds Notion IDs)
└── spovishun-skills.lock.yaml       ← generated, commit it
```

For Codex: a single `AGENTS.md` at project root. For Windsurf: `.windsurf/rules/*.md`.

## Contributing

PRs welcome. See [`CLAUDE.md`](./CLAUDE.md) for architecture, layer rules, manifest schema, and commit convention.

Branch: `feature/<short-slug>` · Commits: Conventional Commits (`feat:`, `fix:`, `refactor:`, …).

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](./LICENSE) © Danylo Bidnyk
