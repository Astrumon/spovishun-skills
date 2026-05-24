# CLAUDE.md

`spovishun-skills` — portable npm package that distributes Claude Code skills, agents, hooks, and rules to any project. Extracted from the [Spovishun Telegram bot](https://github.com/Astrumon/SpovishunTelegramBotV2). Installs natively into Claude Code (`.claude-plugin/`) and into Codex / Windsurf / Cursor via per-assistant text adapters.

**Stack:** Node.js ≥ 18 · ESM (`type: "module"`) · pure JavaScript (no TypeScript) · Ajv 8 (manifest validation) · js-yaml (YAML parsing) · Mustache (placeholder substitution — added in V1) · GitHub Actions (CI).

## Commands

```bash
node bin/spovishun-skills.js --version                # prints package version
node bin/spovishun-skills.js --help                   # CLI usage
node bin/spovishun-skills.js validate <dir>           # validates a skill's manifest.yaml (#84)
node bin/spovishun-skills.js init                     # init wizard → spovishun-skills.config.yaml (#85)
node bin/spovishun-skills.js install --target=claude  # writes .claude/ + lockfile (#86)
node bin/spovishun-skills.js install --target=codex   # writes AGENTS.md + lockfile (#88)
npm test                                              # node --test test/
npm run lint                                          # syntax check + manifest validation across all skills
```

CLI commands planned for upcoming tasks (none yet wired):

| Command | Task | Description |
|---|---|---|
| `install --target=windsurf\|cursor` | V1 | Generates text-only artefacts for Windsurf/Cursor |
| `sync` | V1 | Re-applies config without wizard |
| `update [--skill X]` | V1 | Three-way merge against upstream |
| `doctor` | V1 | Validates tokens, IDs, git config |

## Source Structure

```
spovishun-skills/
├── .claude-plugin/      — Claude Code native plugin entry (plugin.json, marketplace.json) [#86]
├── skills/              — canonical skill bodies (SKILL.md + manifest.yaml per skill)
├── agents/              — canonical agent bodies (AGENT.md + manifest.yaml per agent)
├── hooks/               — hook scripts + hooks.json (event → script mapping) [Claude-only]
├── rules/               — configurable rule files
├── adapters/            — per-target installers (claude/, codex/, windsurf/, cursor/)
├── scripts/             — utility scripts (validate-all-manifests.js, …)
├── bin/                 — CLI entry (spovishun-skills.js) — only entry point
├── lib/                 — pure modules: config-resolver, skill-loader, lockfile, merge, manifest-validator
├── schema/              — JSON Schema definitions (manifest.schema.json, config.schema.json)
└── test/                — node:test files (mirrors lib/ and adapters/ structure)
```

## Layer Rules

Dependency direction:

```
bin/  →  lib/ + adapters/  →  read skills/, agents/, hooks/, rules/
```

- `lib/` MUST NOT depend on a specific adapter — it exposes primitives any adapter composes.
- `adapters/<target>/` MUST NOT cross-import each other. Each is a closed unit.
- `skills/`, `agents/`, `hooks/`, `rules/` are **data**, not code (markdown + yaml). Loaded at runtime, never `import`-ed.
- `bin/` is the only entry. Never instantiate the CLI from `lib/` or `adapters/`.

## Key Patterns

**Canonical body + manifest.** Every skill / agent / hook has exactly one canonical source (`SKILL.md`, `AGENT.md`, executable script) and one `manifest.yaml`. Adapters generate per-target files — never edit generated output manually.

**Manifest validation.** `lib/manifest-validator.js` uses Ajv 8 against `schema/manifest.schema.json` (JSON Schema 2020-12). Strict mode + `unevaluatedProperties: false` to catch typos. Custom `semver` format. Conditional `requires` rule via `if/then` — required for `category: stack-specific`, forbidden for `universal`.

**Placeholder substitution.** Mustache `{{KEY}}` syntax. Keys come from consumer's `spovishun-skills.config.yaml`. Validator enforces `UPPER_SNAKE_CASE` keys. Tokens that don't match `UPPER_SNAKE_CASE` (e.g. `${{ runner.os }}` from GitHub Actions snippets) are preserved verbatim. Keys declared in a manifest's `placeholders:` list are treated as optional — missing values render to an empty string instead of failing the install.

**Codex adapter (`adapters/codex/`).** Generates a single `AGENTS.md` at the consumer root by inlining filtered skills, agents (with YAML frontmatter stripped), and rule files. ATX headings inside bodies are demoted by 2 levels so they nest under `## Skills` / `## Agents` / `## Rules`. Code-fenced blocks are skipped during demotion. Hooks and other Claude-only artifacts are excluded entirely. If the rendered file exceeds the 32 KiB Codex soft limit, the adapter writes the file but emits a `stderr` warning suggesting a global/project split.

**Stack filtering.** Manifest's `requires:` is an array of stack flags (`kotlin | postgres | telegram | notion`). A skill installs iff all `requires:` ⊆ active flags in `spovishun-skills.config.yaml`.

**Lockfile.** `spovishun-skills.lock.yaml` in the consumer repo. Pins exact versions and checksums per artifact. Re-applied by `sync`, diffed by `update`.

**Three-way merge.** Base = lockfile version · theirs = upstream · ours = local. Unchanged files auto-apply. Changed files emit diff-marker conflicts for manual resolution.

## Testing

- **Unit** — `node --test` runner + `node:assert/strict`. Tests live in `test/<module>.test.js`. Mock filesystem with `node:fs/promises` + `os.tmpdir()` dirs.
- **Integration (snapshot)** — install an adapter into a tmp dir → recursive diff against `test/snapshots/<target>/`.
- **Schema** — every `manifest.yaml` in `skills/`, `agents/`, `hooks/` passes Ajv validation in CI.
- **Smoke** — CLI `--version` runs in CI Install job.
- Do NOT unit-test: `commander`/`inquirer` (assumed-correct deps), CLI argv parsing itself (covered by smoke).

## Configuration (consumer-side)

`spovishun-skills.config.yaml` lives in the **consumer** project — NOT this repo. Schema enforced by `schema/config.schema.json` (added in #85). This repo's `.gitignore` excludes it to prevent accidental commits in tests.

```yaml
project:
  name: "MyProject"
  language: "uk"
stack:
  kotlin: true
  postgres: false
  telegram: true
  notion: true
notion:
  token_env: "NOTION_TOKEN"
  database_id: "..."
git:
  branch_prefix: "feature/myproject"
```

## CI/CD

GitHub Actions: `.github/workflows/ci.yml`. Triggers: push to `main`, PR against `main`.

| Job | Steps |
|---|---|
| Install | checkout → setup-node 20 → `npm install` → smoke-run `--version` |
| Lint | checkout → setup-node 20 → `npm install` → `npm run lint` |
| Test (#84+) | checkout → setup-node 20 → `npm ci` → `npm test` |

**Release (V2):** tag `v*.*.*` triggers `publish` job → `npm publish --access public` (uses `NPM_TOKEN` secret) → `gh release create`.

## Branch / Commit Convention

**Branch:** `feature/<short-slug>` — no `spovishun-N-` prefix; this is a separate repo.
**Commit:** Conventional Commits — `type: short description`, lowercase, imperative mood, ≤72 chars, no trailing period.
**Types:** `feat`, `fix`, `refactor`, `docs`, `chore`, `test`, `ci`, `build`, `perf`.
**PR sections (required):** Goal / Changes / Testing.

**Never:**
- Force-push to `main`
- Skip pre-commit hooks (`--no-verify`)
- Commit `.env`, secrets, or consumer-side `spovishun-skills.config.yaml`
- Edit a published `manifest.yaml` without bumping its `version`

## Security

- No secrets in this repo. Ever.
- Consumer-side `spovishun-skills.config.yaml` lists Notion IDs (not secrets); token values come from env vars referenced by `notion.token_env`.
- `NPM_TOKEN` lives only in GitHub Secrets.
- YAML parsed with `js-yaml`'s `failsafe` or `core` schema — never `default` (which can deserialize unsafe types).
- Generated adapter files MUST NOT embed secrets read from env at install time — only references (`{{NOTION_TOKEN_ENV}}` → `"NOTION_TOKEN"`, not the token value).

## Rules (`.claude/rules/`)

This repo has no `.claude/rules/` directory of its own — it would only appear once the project starts dogfooding the published plugin (V2). Until then, all repo-level rules live directly in this `CLAUDE.md`.

The `rules/` directory at the repo root (NOT `.claude/rules/`) is **data**: canonical `.md` files that ship as part of the package and get installed into a consumer's `.claude/rules/` by the Claude adapter. They are configurable (support Mustache placeholders) but not executed here.

Once we add the first packaged rule (likely in #5 — Migration), update the table below and create the file under `rules/<name>.md` with a corresponding `manifest.yaml`.

| Rule | Source file | Category | Status |
|---|---|---|---|
| _(none yet)_ | — | — | — |

## When to use scripts vs CLI

| Use case | Tool |
|---|---|
| Validate one skill | `node bin/spovishun-skills.js validate skills/<id>` |
| Validate every skill in the repo | `node scripts/validate-all-manifests.js` (also run by CI lint) |
| Inspect package version | `node bin/spovishun-skills.js --version` |
| Add a new skill | Create `skills/<id>/` with `manifest.yaml` + `SKILL.md`, then validate |

## Glossary

- **Canonical body** — single source file for a skill/agent/hook (`SKILL.md`, `AGENT.md`, executable script).
- **Adapter** — code in `adapters/<target>/` that translates canonical bodies into target-specific files.
- **Target** — supported AI assistant: `claude` | `codex` | `windsurf` | `cursor`.
- **Stack flag** — boolean in consumer config (`stack.kotlin`, `stack.notion`, …) that gates which `requires:`-tagged skills install.
- **Placeholder** — Mustache `{{KEY}}` token in canonical bodies, resolved per `placeholders:` array in manifest.
- **Lockfile** — `spovishun-skills.lock.yaml`, committed in consumer repo, pins installed versions for reproducibility.

## Phase roadmap

- **MVP** (#83 → #87): bootstrap · manifest schema · config resolver + init wizard · `install --target=claude` · migrate ~62 artefacts.
- **V1** (#88 → #92): codex / windsurf / cursor adapters · `sync` / `update` with three-way merge · `doctor` command.
- **V2** (#93 → #94): Spovishun dogfoods the published plugin (replaces its inline `.claude/`) · public `npm publish v1.0.0`.

## References

- **Epic (Spovishun Notion):** [Claude Code Skills Plugin](https://www.notion.so/3633462f68a9815184a2dd709ddec10d) — full architecture, decomposition, roadmap
- **Notion docs hub (this project):** [Spovishun Skills](https://www.notion.so/3683462f68a98041a6daccfd9110e566)
- **Originating codebase:** [Spovishun Telegram bot](https://github.com/Astrumon/SpovishunTelegramBotV2) (Kotlin)
- **Claude Code plugins (official):** https://claude.com/claude-code
- **JSON Schema 2020-12:** https://json-schema.org/draft/2020-12
- **AGENTS.md (Codex):** https://github.com/openagentsfoundation
- **Windsurf rules:** https://docs.windsurf.com/windsurf/cascade/rules
- **Cursor rules:** https://docs.cursor.com/context/rules
