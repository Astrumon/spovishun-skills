# CLAUDE.md

`spovishun-skills` — portable npm package that distributes Claude Code skills, agents, hooks, and rules to any project. Extracted from the [Spovishun Telegram bot](https://github.com/Astrumon/SpovishunTelegramBotV2). Installs natively into Claude Code (`.claude-plugin/`) and into Codex / Windsurf / Cursor via per-assistant text adapters.

**Stack:** Node.js ≥ 18 · ESM (`type: "module"`) · pure JavaScript (no TypeScript) · Ajv 8 (manifest validation) · js-yaml (YAML parsing) · GitHub Actions (CI).

## Commands

```bash
node bin/spovishun-skills.js --version                # prints package version
node bin/spovishun-skills.js --help                   # CLI usage
node bin/spovishun-skills.js validate <dir>           # validates a skill's manifest.yaml (#84)
node bin/spovishun-skills.js init                     # init wizard → spovishun-skills.config.yaml (#85)
node bin/spovishun-skills.js install --target=claude  # writes .claude/ + lockfile (#86)
node bin/spovishun-skills.js install --target=codex   # writes AGENTS.md + lockfile (#88)
node bin/spovishun-skills.js install --target=windsurf # writes .windsurf/rules/*.md + lockfile (#89)
node bin/spovishun-skills.js sync                     # re-applies install from existing config + lockfile (#91)
node bin/spovishun-skills.js update --upstream=<dir>  # 3-way merge against upstream copy (#91)
  # [--skill <id>]   limit to one artifact
  # [--dry-run]      print planned actions, write nothing
node bin/spovishun-skills.js doctor                   # validate installation integrity (#92)
npm test                                              # node --test test/
npm run lint                                          # syntax check + manifest validation across all skills
```

CLI commands planned for upcoming tasks:

| Command | Task | Description |
|---|---|---|
| `install --target=cursor` | V1 | Generates text-only artefacts for Cursor |

**`update` codex limitation (V1):** `AGENTS.md` is a monolithic file that inlines all artifacts — per-artifact 3-way merge requires boundary reconstruction that is not implemented. Running `update --target=codex` (derived from the lockfile) will print a warning and exit 0 without changes. Workaround: edit `AGENTS.md` by hand, then run `install --target=codex` to regenerate.

## Source Structure

```
spovishun-skills/
├── .claude-plugin/      — Claude Code native plugin entry (plugin.json, marketplace.json) [#86]
├── skills/              — canonical skill bodies (SKILL.md + manifest.yaml per skill)
├── agents/              — canonical agent bodies (AGENT.md + manifest.yaml per agent)
├── hooks/               — hook scripts + hooks.json (event → script mapping) [Claude-only]
├── rules/               — configurable rule files
├── adapters/            — registry.js (target table) + per-target installers (claude/, codex/, windsurf/)
├── scripts/             — utility scripts (validate-all-manifests.js, …)
├── bin/                 — CLI entry (spovishun-skills.js) — only entry point
├── lib/                 — pure modules: config-loader, artifact-loader, render-artifact, lockfile, merge, manifest-validator
├── schema/              — JSON Schema definitions (manifest.schema.json, config.schema.json)
└── test/                — node:test files (mirrors lib/ and adapters/ structure)
```

## Layer Rules

Dependency direction:

```
bin/  →  adapters/registry.js  →  adapters/<target>/  →  lib/  →  read skills/, agents/, hooks/, rules/
```

- `lib/` MUST NOT depend on a specific adapter — it exposes primitives any adapter composes.
- `adapters/<target>/` MUST NOT cross-import each other. Each is a closed unit.
- `adapters/registry.js` is the ONLY module that imports adapters. Nothing in `lib/` or `adapters/<target>/` may import it — the registry imports them, so reaching back closes a cycle. An adapter needing a `lib/` helper that the registry also references (`loadClaudeFiles`, `loadWindsurfFiles`, `loadCodexFiles`) imports it straight from `lib/`.
- `skills/`, `agents/`, `hooks/`, `rules/` are **data**, not code (markdown + yaml). Loaded at runtime, never `import`-ed.
- `bin/` is the only entry. Never instantiate the CLI from `lib/` or `adapters/`.

## Key Patterns

**Target registry (`adapters/registry.js`).** One row per target — `{ install, update, readInstalled, hint, ownership, supportsUpdate }` — and the only place that knows which targets exist. Adding a target is one row plus one `adapters/<target>/` directory; **no edit to `bin/` is expected**, and a PR that needs one is a signal the registry is missing a column. All three `install` functions take the same argument object (`{ consumerCwd, pkgRoot, config, artifacts, pluginVersion, force, warn }`) and destructure what they use — the uniformity is what makes the table callable, so do not trim a signature back down to "only what this adapter needs". `getTarget(name)` throws an actionable error for an unknown target; `findTarget(name)` returns `null` for read paths like `doctor`, which must report on a lockfile naming a target it does not know rather than crash. `supportsUpdate` must always equal `update !== null` (asserted in `test/registry.test.js`).

**Canonical body + manifest.** Every skill / agent / hook has exactly one canonical source (`SKILL.md`, `AGENT.md`, executable script) and one `manifest.yaml`. Adapters generate per-target files — never edit generated output manually.

**Manifest validation.** `lib/manifest-validator.js` uses Ajv 8 against `schema/manifest.schema.json` (JSON Schema 2020-12). Strict mode + `unevaluatedProperties: false` to catch typos. Custom `semver` format. Conditional `requires` rule via `if/then` — required for `category: stack-specific`, forbidden for `universal`.

**Placeholder substitution.** Mustache-style `{{KEY}}` syntax, resolved by a dependency-free two-pass `String.replace` in `lib/template-renderer.js` — not by Mustache itself, whose sections / partials / comments would silently swallow content the renderer never intends to interpret. Keys come from consumer's `spovishun-skills.config.yaml`. Validator enforces `UPPER_SNAKE_CASE` keys. Tokens that don't match `UPPER_SNAKE_CASE` (e.g. `${{ runner.os }}` from GitHub Actions snippets) are preserved verbatim. Keys declared in a manifest's `placeholders:` list are treated as optional — missing values render to an empty string instead of failing the install.

**Single config reader.** `spovishun-skills.config.yaml` is read by exactly two things, and the split is deliberate: `lib/config-loader.js` (plugin-side, js-yaml + Ajv, validates the whole file) and `hooks/config-reader.js` (consumer-side, hand-written scalar scanner, 1-level and 2-level dotted lookups only). `scripts/notion/lib/config-reader.js` is a re-export of the latter, not a second implementation — `../../../hooks/` resolves identically in the repo and in an installed `.claude/`. `page-id.js`, `block-tree.js` and the shared Notion constants (`NOTION_VERSION`, `PRIORITY_TIERS`, `PICKER_TIER_LIMIT`, in `hooks/notion-constants.js`) went through the same collapse and re-export the same way; `format-task.js` went through it too but could not become a bare re-export (see *One renderer, two bindings* below). `notion-http.js` and `extract-branch.js` deliberately did **not** — they are not duplicates of their hook counterparts (different headers, different branch-derivation slug rules), and merging them would change CLI output. The canonical file lives under `hooks/` because `installHooks()` runs unconditionally while `installScripts()` skips `scripts/notion/` unless `stack.notion: true`: **scripts may depend on hooks, never the reverse.** It stays dependency-free by necessity — consumers get `.claude/` without a `node_modules`, so `require('js-yaml')` there is `MODULE_NOT_FOUND` (this is also why `marked` is vendored). Never re-inline a scanner into a hook or a script; `test/config-reader-parity.test.js` asserts module identity and fails if one comes back.

**Hook module layout (flat, under `hooks/`).** `hooks/` holds two kinds of file: executable hooks (shebang + exec bit, named in `hooks.json`) and the CommonJS modules they compose — `hook-config` · `notion-api` · `notion-constants` · `notion-render` · `notion-blocks` · `block-tree` · `branch-name` · `page-id` · `git-ops` · `dev-context` · `hook-output` · `task-picker` · `apply-pick` · `context-inject` · `config-reader`. They sit **flat, not in `hooks/lib/`**, because `installHooks()` copies `hooks/*.js` with a non-recursive `readdirSync` — a subdirectory would need an adapter change that buys nothing. `hooks/notion-task-inject.js` is dispatch only (~150 lines): stdin → `classifyPrompt` → one mode module. Two rules, both asserted by `test/config-reader-parity.test.js`: **nothing under `hooks/` may `require` out of `scripts/`** (hooks install unconditionally, `scripts/notion/` only when `stack.notion: true`, so that require is a `MODULE_NOT_FOUND` for every consumer without Notion), and the tree stays **dependency-free** (no `node_modules` under a consumer's `.claude/`). `hook-config.js` resolves `.env` + every config scalar at **require time** — tests that vary env or cwd must purge the whole `hooks/` subtree from the require cache, not just the entry file (`purgeHookModules` in `test/helpers/hook-harness.js`).

**Config fallbacks must be loud.** A missing config file is a supported state (env-only setups) and resolves defaults silently. A config file that *exists* but cannot answer a required key is a broken config: `readConfigValueOrWarn(section, key, { fallback, label })` names the file and the key on stderr before returning the fallback. Required because a wrong `PROJECT_PREFIX` is invisible — it just makes every board lookup miss and reports "No Tasks Available". Hooks warn and still exit 0; they must never brick a session.

**Block tree is fetched once, hydrated once.** `hooks/block-tree.js` (re-exported by `scripts/notion/lib/block-tree.js`) owns the only walk that paginates a block level and recurses into `has_children`, attaching results as `block.children`. It takes the caller's page-fetch as a **callback**, not an HTTP module — that is what lets both trees share it while their transports stay deliberately different. Depth is a hard budget (`MAX_BLOCK_DEPTH = 3`): at 0 a block's children are left unfetched rather than half-attached. The renderer downstream is **pure and synchronous** over an already-hydrated tree; do not move a fetch into it. Hydration is not optional decoration: `newtask` puts the agent prompt inside a toggle and `notion-task-to-code` reads it back, so a renderer that ignores children hands the agent a task with no prompt (spovishun-185). **Every** Notion read goes through it — `get-task.js` and `get-claude-md.js` on the CLI side, `apply-pick.js` and `context-inject.js` on the hook side. A call site left on a bare `GET /v1/blocks/{id}/children` is a defect, not a shortcut: it drops the body of every table, toggle and callout on the page (`renderTable` returns `''` for a table with no rows) and truncates silently at 100 top-level blocks, because nothing follows `has_more` (spovishun-189). The transport adapter both CLI scripts pass in is `childrenPageFetcher`, exported from `scripts/notion/lib/notion-http.js`; `hooks/notion-api.js` carries the mirror for its own transport.

**One renderer, two bindings.** `hooks/notion-render.js` owns the only blocks → markdown walk. `createRenderer(options)` returns `{ extractBlocks, renderBlock }`, and **exactly two** things are options, both of them compactness: `headingLead` (a blank line before every ATX heading — load-bearing for the CLI, where `section-parser.js` indexes on it and `get-claude-md.js --section` slices by it) and `standalone` (blank lines around a fence / `<details>` / table / thematic break, without which the CLI output stops round-tripping through `markdown-to-blocks.js`). Everything else — ordinals, multi-line prefixes, the fence info string, the table separator row, `to_do` children — is one behaviour. It is not a knob per caller: the two call sites never *wanted* to differ there, one of them was simply behind, which is how spovishun-185's class of bug got in twice (spovishun-188). `scripts/notion/lib/format-task.js` binds `{ headingLead: '\n', standalone: true }` and `hooks/notion-blocks.js` binds `{ headingLead: '', standalone: false }`. Neither can be a bare re-export the way `block-tree.js` is — the options differ, `richText` differs (the CLI one trims for titles and property values; the hook one must not, `branch-name.js` regex-matches raw text), and `visibleBlocks` exists only on the hook side — so both re-export `createRenderer` and `test/config-reader-parity.test.js` asserts the two resolve to the same function. `test/notion-render.test.js` pins both columns over one fixture set; treat every string there as an output contract.

**Codex adapter (`adapters/codex/`).** Generates a single `AGENTS.md` at the consumer root by inlining filtered skills, agents (with YAML frontmatter stripped), and rule files. ATX headings inside bodies are demoted by 2 levels so they nest under `## Skills` / `## Agents` / `## Rules`. Code-fenced blocks are skipped during demotion. Hooks and other Claude-only artifacts are excluded entirely. If the rendered file exceeds the 32 KiB Codex soft limit, the adapter writes the file but emits a `stderr` warning suggesting a global/project split.

**Windsurf adapter (`adapters/windsurf/`).** Runs the full ownership model (`ownership: 'checksum'`, via `lib/install-planner.js`) — a local edit survives `install` with a warning, `--force` resets ours, an unlocked id is sacred. Generates one `.md` file per skill and per rule under `.windsurf/rules/` in the consumer project. Agents and hooks are excluded (Windsurf has no agent concept). Files exceeding 6 000 characters are automatically split into `<id>-part-1.md`, `<id>-part-2.md`, ... (char split, prefers newline boundary past the halfway mark). Rule files from `rules/` use `--` as path separator in their filename (e.g. `common/git-workflow.md` → `common--git-workflow.md`).

**Windsurf provenance manifest (`lib/windsurf-manifest.js`).** `.windsurf/rules/` is flat, so the adapter flattens three id namespaces (`skill`, `rule`, supporting file) into one filename space, and `--` does double duty as path separator and id character. That mapping is **lossy and not injective** — the rule `common/style` and a skill named `common--style` produce the same filename (the adapter warns; last write wins). The reader must therefore never invert it by parsing: `install` emits `.windsurf/rules/.spovishun-manifest.json` mapping `filename → {kind, id, role: 'body'|'support', part?}` while writing, and `loadWindsurfFiles` reads that. Leading dot on purpose — Windsurf reads only `*.md` and every rule walker here skips dot-entries. Supporting files are recorded with `role: 'support'` and deliberately excluded from the ownership map: they carry no lock entry on any target and follow their body, exactly as in `installArtifact`. Installs predating the manifest fall back to filename parsing, disambiguated by the lockfile (`foo-part-1.md` is chunk 1 of `foo` unless `foo-part-1` is itself a locked id); drop that branch one minor release after 1.21.0.

**Stack filtering.** Manifest's `requires:` is an array of stack flags (`kotlin | postgres | telegram | notion | docker | kmp`). A skill installs iff all `requires:` ⊆ active flags in `spovishun-skills.config.yaml`. The flag list lives in three places that must stay in sync: `STACK_FLAGS` in `lib/stack-filter.js`, the `requires` enum in `schema/manifest.schema.json`, and `stack` properties in `schema/config.schema.json`.

**Rules stack gating (directory = flag).** `rules/` files carry no manifest, so the top-level group name *is* the gate: `rules/<group>/` installs only when `<group>` is an active stack flag (`rules/kotlin/`, `rules/kmp/`). A group whose name is not a stack flag (`rules/common/`) always installs. Implemented in `lib/rules-loader.js`: `collectAllRules(pkgRoot, stackFlags)` walks `rules/` once and flags each rule `active`; `collectRules` is the active half and is what the adapters consume. The inactive half is not waste — `install` needs those bodies to prove a de-selected file on disk is one of ours before deleting it, which is why the package is never walked or rendered twice. Fails closed: no flags passed ⇒ only ungated groups. Turning a flag off removes the rules the plugin owns on the next `install`/`sync` (see Rules ownership below).

**Lockfile.** `spovishun-skills.lock.yaml` in the consumer repo. Pins exact versions and checksums per artifact. Re-applied by `sync`, diffed by `update`. Kinds: `skill`, `agent`, `template`, `rule`. Rule entries always carry `version: 0.0.0` — a sentinel meaning "unversioned data artifact; the checksum is the identity". Deliberately not the plugin version: that would flip every rule to `AUTO_APPLY` on each release even when its body is byte-identical. `update` never touches `rule:` entries (rules have no manifest, so they never appear in the upstream artifact map); they are regenerated wholesale by `install`/`sync`.

**Rules ownership.** Rules go through the same ownership model as skills and agents (`lib/update-classifier.js`), selected via `ownership: 'checksum'` rather than `'marker'`: they carry no YAML frontmatter, so the `x-spovishun` provenance marker does not apply and ownership is decided by **checksum equality alone**. `ADOPT` and `DISOWNED` are unreachable under that model — in particular a locked rule that was edited locally stays `LOCAL_ONLY` (entry kept, warned) and must never become `DISOWNED` (entry dropped). A rule whose on-disk body matches either the locked checksum or the current render is ours — `install` rewrites it and, when its group's flag goes off, deletes it. Anything else is owner-authored: `install` skips it with a warning (`--force` overwrites a *locked* edit; a file at an id we never locked is sacred even then), and the stale-rule pass leaves it on disk. Consumers upgrading from ≤ 1.15.0 have rules on disk and no `rule:` lock entries — those are adopted silently on the first `install`, because the on-disk body already equals the render.

**One classify-and-act path (`lib/install-planner.js`).** `install` classifies every artifact and every rule, on every target, through `planInstall` + the `INSTALL_HANDLERS` table, mirroring `ACTION_HANDLERS` in `bin/update.js`. It is **pure** — it decides, the adapter writes — and that split is deliberate: all targets need the same decisions but no two share a layout (claude writes `{id}/BODY.md` folders, windsurf chunked `-part-N.md` files). Sharing the decision while keeping the writes separate is what stops a second copy of the switch from appearing per adapter, which is exactly how windsurf ended up with no ownership model at all until #162. The loops differ only in where they write and in the hint a skipped local edit carries — rules say `install --force` because `update` genuinely cannot merge them (it skips every `rule:` lock entry). Warning strings are asserted by `test/install-claude.test.js` and `test/install-windsurf.test.js`; treat them as output contract.

**Ownership per target.** `marker` (claude) · `checksum` (windsurf, and rules on every target) · `none` (codex). A `checksum` target writes plain markdown with no frontmatter to stamp, so content alone answers "is this ours?"; `ADOPT` and `DISOWNED` are unreachable there. Codex is `none` because `AGENTS.md` inlines every body — there is no per-artifact file to own, classify or merge, and no meaning for `--force`. That is a real limitation, so it is stated rather than implied: a codex install that would discard local content warns, **but only when the new content actually differs** — a warning that fires on every idempotent re-install is one nobody reads. A skipped windsurf id keeps its entry in `.spovishun-manifest.json` (see below); dropping it would make the next run see `MISSING_ON_DISK` and overwrite the very edit the previous run preserved.

**One render per artifact.** `lib/render-artifact.js` owns the `placeholders → renderTemplate → sha256` triplet for every adapter and for `update`. The checksum is ALWAYS taken over the marker-stripped body — an identity operation when there is no marker, which is what keeps codex/windsurf checksums equal to the marked claude ones for the same content.

**Three-way merge.** Base = lockfile version · theirs = upstream · ours = local. Unchanged files auto-apply. Changed files emit diff-marker conflicts for manual resolution.

**Upstream attribution (`source:`).** An artifact adapted from a third-party repo declares `source: { repo, ref?, files: [{ path, sha }] }` in its `manifest.yaml`, pinning **every** upstream file it was derived from, and gets a matching row per file in `NOTICE.md`. `scripts/validate-all-manifests.js` compares the two registries in both directions (neither is generated from the other, so comparison is what keeps them honest); the same check runs in `test/attribution.test.js`. `npm run check:drift` queries the GitHub API for the current blob SHAs and reports movement — **report-only, always exits 0**, and deliberately not part of `lint`, because `lint` gates npm publishing in `release.yml` and must stay offline. Shared logic lives in `lib/attribution.js`.

**KMP skills supersede, never edit, the backend skills.** `dependency-injection-architecture` and `unit-testing-kotlin` are gated `[kotlin]` only, so they install into KMP projects too, carrying backend-specific Always-Active Rules. Rather than edit them (the Spovishun backend consumer relies on them), `koin-kmp` and `kmp-testing` carry a `## Supersedes <X> in KMP projects` block and KMP-only triggers. The gating defect itself is still open — see the 1.18.0 CHANGELOG note.

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
  kmp: false        # Kotlin/Compose Multiplatform; requires kotlin: true
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

The `rules/` directory at the repo root (NOT `.claude/rules/`) is **data**: canonical `.md` files that ship as part of the package and get installed into a consumer's `.claude/rules/` by the Claude adapter. They are configurable (support `{{KEY}}` placeholders) but not executed here.

Rules have **no `manifest.yaml`** — they are flat data. Gating is by directory name (see Key Patterns): put a rule in `rules/<stack-flag>/` to gate it, or in `rules/common/` to ship it to everyone.

Every rule MUST stay under the Windsurf `CHAR_LIMIT` (6 000 chars) — past it the adapter splits the file into `-part-N.md` fragments that Windsurf then reads as independent rules. Enforced by `every shipped rule fits in one windsurf file` in `test/rules-stack-gating.test.js`. Keep rules normative and prose-only; long-form code belongs in a skill's `references/` (`kotlin/gradle-build.md` → `gradle-build-auditor`, `kmp/architecture.md` → `kmp-multiplatform-specialist`).

| Rule | Source file | Gate | Status |
|---|---|---|---|
| Design principles | `rules/common/design-principles.md` | always | shipped |
| Feature documentation | `rules/common/feature-documentation.md` | always | shipped |
| Git workflow | `rules/common/git-workflow.md` | always | shipped |
| Security | `rules/common/security.md` | always | shipped |
| Testing | `rules/common/testing.md` | always | shipped |
| Kotlin style | `rules/kotlin/kotlin-style.md` | `stack.kotlin` | shipped |
| Gradle build (10 practices; deep audit via `gradle-build-auditor`) | `rules/kotlin/gradle-build.md` | `stack.kotlin` | shipped |
| KMP architecture (layers, MVI contract, Compose stability; Kotlin-free — code lives in `kmp-multiplatform-specialist/references/mvi-and-stability.md`) | `rules/kmp/architecture.md` | `stack.kmp` | shipped |
| KMP networking (repository as error boundary, one `expectSuccess` model; code in `ktor-client-kmp`) | `rules/kmp/networking.md` | `stack.kmp` | shipped |
| KMP modularization (visibility ladder, `internal` impls behind `public` interfaces) | `rules/kmp/modularization.md` | `stack.kmp` | shipped |
| KMP persistence (storage selection, schema history, migrations; code in `kmp-persistence`) | `rules/kmp/persistence.md` | `stack.kmp` | shipped |
| KMP feature structure (modules, screen package) | `rules/kmp/feature-structure.md` | `stack.kmp` | shipped |
| KMP navigation (Navigation 3 is the standard; back stack is the only navigation state; Nav 2 kept as legacy. Code in `kmp-multiplatform-specialist/references/navigation-3.md`) | `rules/kmp/navigation.md` | `stack.kmp` | shipped |
| KMP design system | `rules/kmp/uikit.md` | `stack.kmp` | shipped |
| KMP localization | `rules/kmp/localization.md` | `stack.kmp` | shipped |
| KMP testing (supersedes the common stack section) | `rules/kmp/testing.md` | `stack.kmp` | shipped |
| KMP component architecture (screen-level escalation: two or more independent state regions become components; effects stay on the ViewModel's channel. Code in `kmp-multiplatform-specialist/references/component-architecture.md`) | `rules/kmp/component-architecture.md` | `stack.kmp` | shipped |

## When to use scripts vs CLI

| Use case | Tool |
|---|---|
| Validate one skill | `node bin/spovishun-skills.js validate skills/<id>` |
| Validate every skill in the repo | `node scripts/validate-all-manifests.js` (also run by CI lint) |
| Check whether upstream sources moved | `npm run check:drift` (report-only; NOT part of `lint`) |
| Inspect package version | `node bin/spovishun-skills.js --version` |
| Add a new skill | Create `skills/<id>/` with `manifest.yaml` + `SKILL.md`, then validate |

## Glossary

- **Canonical body** — single source file for a skill/agent/hook (`SKILL.md`, `AGENT.md`, executable script).
- **Adapter** — code in `adapters/<target>/` that translates canonical bodies into target-specific files.
- **Target** — supported AI assistant: `claude` | `codex` | `windsurf` | `cursor`.
- **Stack flag** — boolean in consumer config (`stack.kotlin`, `stack.notion`, `stack.kmp`, …) that gates which `requires:`-tagged skills install, and which `rules/<group>/` directories ship.
- **Placeholder** — `{{KEY}}` token in canonical bodies, resolved per `placeholders:` array in manifest.
- **Lockfile** — `spovishun-skills.lock.yaml`, committed in consumer repo, pins installed versions for reproducibility.

## Phase roadmap

- **MVP** (#83 → #87): bootstrap · manifest schema · config resolver + init wizard · `install --target=claude` · migrate ~62 artefacts.
- **V1** (#88 → #92): codex (#88 ✓) / windsurf (#89 ✓) / cursor adapters · `sync` / `update` with three-way merge · `doctor` command.
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
