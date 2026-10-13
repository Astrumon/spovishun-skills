# Notion Task to Code Prompt

Converts a Notion task into a ready-to-use AI agent prompt for Claude Code or similar AI coding agents.

**Invocation args:** `pageId` (required) and an optional `grillFirst=true` — set by the
`notion-task-inject` picker when the user said "start new task with grill" (or a Ukrainian
equivalent: з грилем / з допитом / з прожаркою). See Step 6.

## Workflow

### Step 1: Fetch the task

**1a.** Get the current branch:
```
git rev-parse --abbrev-ref HEAD
```

**1b.** Derive the cache folder: replace `/` with `-` in the branch name and append `_prd` (e.g. `feature/{{PROJECT_PREFIX}}-77-foo` → `feature-{{PROJECT_PREFIX}}-77-foo_prd`).

**1c.** If `.dev-context/{folder}/task.json` exists → `Read` it directly. No Bash, no Notion API call needed.

**1d.** Otherwise (standalone invocation or no cache) → fetch from Notion:
```
node .claude/scripts/notion/get-task.js <{{PROJECT_PREFIX}}-N | N | pageId> [--format=json|md|text]
```
- `{{PROJECT_PREFIX}}-19` — fully-qualified task id (board lookup by name).
- `19` — bare number; resolves to `{{PROJECT_PREFIX}}-19` automatically.
- 32-char compact (or dashed) Notion `pageId` — direct fetch.

Default `--format=json`. Use `md` for a rendered markdown card or `text` for a plain human-readable summary.

**1e. Stage check (Board v2).** If the fetched task has a non-null `stage` and it is not `"Sprint"`, warn the user before continuing: the task is still in `Backlog` (not committed to the active sprint) or already in `Archive`. Offer to promote it first (`node .claude/scripts/notion/update-status.js <id> --stage Sprint`) or proceed anyway. Skip the warning when `stage` is `null` (Board v1 — no Stage property).

### Step 2: Fetch CLAUDE.md (targeted)
```
node .claude/scripts/notion/get-claude-md.js --section commands       # just the Commands section
node .claude/scripts/notion/get-claude-md.js --section testing        # just Testing section
node .claude/scripts/notion/get-claude-md.js                          # full read — only when overview needed
```

### Step 3: Read the task sections
`get-task.js --format=json` returns `sections` — the body split per task format v2
(`.claude/_templates/task-page/TEMPLATE.md`). A cached `task.json` carries only `content`; in that
case run `get-task.js <id> --format=json` once to get `sections`.

- `sections.format === "v2"` — the body is the spec. There is no stored prompt; build it from:
  `why`, `dod[]` (`text`, `checked`), `branch`, `context`, `steps[]` (`n`, `marker`: `agent` |
  `manual` | null, `text`), `boundaries` (`always[]`, `ask[]`, `never[]`), `pitfalls`, `outOfScope`.
- `sections.format === "legacy"` — a pre-v2 task (`🎯 Goal` / `🌿 Branch name` / `📋 Steps` / `✅ DoD`,
  often extra sections). `sections.legacyPrompt` holds the old `🤖 prompt` toggle text when present:
  use it as the base and expand it from `content`, as before. Do not rewrite the Notion page.

Also take from the task JSON:
- **epic** — parent Epic title and id, if any
- **blockedBy** — list of blocker tasks (title + id)

### Step 4: Generate the final prompt

Fill `.claude/_templates/task-to-code-prompt/TEMPLATE.md` and output it as a fenced code block.

For a **v2** task:
- **Steps** — the `agent` steps in order, step 1 (the reference check) first and unchanged: the
  agent verifies every path and symbol the task names and stops on a mismatch.
- **Human steps — do not perform** — every `manual` step, verbatim, so the agent knows they exist
  and leaves them to a person.
- **Definition of Done** — every `dod` item with its verification command; skip items already checked.
- **Boundaries** — `boundaries.always` / `ask` / `never` copied verbatim as Always / Ask first / Never.
- **Context** — `context`, plus `pitfalls` and `outOfScope` when present.
- Do not add conventions CLAUDE.md already states; the agent reads CLAUDE.md itself.

For a **legacy** task: as before — Goal, Branch, Steps, DoD from `sections` / `content`, with
`legacyPrompt` as the base when present.

In both cases inject into the Context section:
- "This task belongs to Epic: **<epic.title>**" — if epic is present
- "Blocked by (must verify before starting): <comma-separated blocker titles>" — if blockedBy is non-empty

Write the prompt in English unless the user asks otherwise; identifiers stay as in the task.

### Step 5: Present the output
Show the prompt in a code block. Do **not** offer to store it in Notion for a v2 task — the body
stays the single source and the prompt is regenerated on demand. For a legacy task, offering to
update its prompt toggle is still fine.

### Step 6: Grill (optional), then enter Plan Mode
After presenting the prompt:
- If invoked with `grillFirst=true`: first invoke the `grill-me` skill on the prompt generated
  in Step 4 to stress-test the plan, and wait for that grill session to conclude. Only then
  enter Plan Mode using the `EnterPlanMode` tool.
- Otherwise (default — no `grillFirst` arg): immediately enter Plan Mode using the
  `EnterPlanMode` tool, as before.

Plannotator will intercept `ExitPlanMode` — wait for user approval before proceeding.
