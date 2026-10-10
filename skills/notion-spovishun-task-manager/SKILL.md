# Notion Project Task Manager

Task management for a project board in Notion with project-specific conventions — task numbering, branch naming, and documentation auto-update.

**I/O rule:** Reads go through `.claude/scripts/notion/` CLI scripts. Writes use MCP (`notion-create-pages`, `notion-update-page`) or `.claude/scripts/notion/create-task.js` / `.claude/scripts/notion/update-status.js` interchangeably. Cleanup uses `.claude/scripts/notion/archive-task.js <pageId> [--unarchive]` to move a throwaway page to Notion Trash (useful for smoke tests; no MCP equivalent at the moment).

## Project Conventions

### Task numbering
- Format: `feature/{{PROJECT_PREFIX}}-N-short-description`
- `N` — next sequential number: `node .claude/scripts/notion/get-board.js --next-number` (max over the newest tasks + 1, both `feature/{{PROJECT_PREFIX}}-N` and bare `{{PROJECT_PREFIX}}-N` titles)
- `short-description` — maximum 3 words in kebab-case

### Task title in Notion
- Property name is **Name** (not Title) — case-sensitive
- Format: `feature/{{PROJECT_PREFIX}}-N: task name`
- No emoji in title — emoji goes in the `icon` field

## Reading the Board

```
node .claude/scripts/notion/get-board.js                       # JSON (default) — use when processing data
node .claude/scripts/notion/get-board.js --format=md           # markdown table — use when displaying to user
node .claude/scripts/notion/get-board.js --epic "<name|id>"    # tasks linked to that epic, any status
node .claude/scripts/notion/get-board.js --stage Backlog       # filter by Stage (Backlog | Sprint | Archive)
```

Display statuses: In progress / To do / Done (last 3). The board table includes `Epic` and `Blocked by` columns; a `Stage` column appears on Board v2 (when stage data exists).

By default the board shows the whole `to_do` status group — both `To do` (the `create-task.js` default) and the legacy `Not started` — so every not-yet-started task is visible without arguments. Pass `--status` to narrow to a single option. `--epic` overrides the status filter entirely: it lists the epic's tasks across **all** statuses (so a Backlog epic isn't falsely shown as empty). Pass `--status` alongside `--epic` to intersect (e.g. `--epic "<name>" --status Done`); `--stage` always composes (AND).

## Epics

```
node .claude/scripts/notion/list-epics.js --format=md          # list all epics
node .claude/scripts/notion/list-epics.js --status=Active      # filter by status
echo '{"name":"…","goal":"…","status":"Planned"}' | node .claude/scripts/notion/create-epic.js
```

To re-assign a task's epic, use `notion-update-page` with the property `Epic` set to `[{"id": "<epic-page-id>"}]`. To clear it, pass an empty array.

## Updating a Task

```
notion-update-page(
  page_id: "<task-id>",
  properties: { "Status": "In progress" }
)
```

Status flow: `To do -> In progress -> Done` (legacy tasks may still start at `Not started`)

## Stage Workflows (Board v2)

Stage tracks lifecycle ownership (`Backlog -> Sprint -> Archive`) independently of Status. The Stage model, board views, and migration from v1 are documented in `references/board-v2-stages.md` — that file is the single source of truth.

```
# Sprint planning: promote a groomed task into the sprint
node .claude/scripts/notion/update-status.js <task-id> --stage Sprint

# Sprint close: archive a completed task (optionally finish it in the same call)
node .claude/scripts/notion/update-status.js <task-id> Done --stage Archive

# Grooming: list backlog candidates (the default to_do group covers To do and Not started)
node .claude/scripts/notion/get-board.js --stage Backlog --format=md
```

`update-status.js` accepts a status, a `--stage`, or both — at least one is required. Note: `archive-task.js` is different — it moves the page to Notion Trash, while `--stage Archive` keeps it on the board in the Archive view.

<details>
<summary>Extended: creating a task, common mistakes</summary>

## Creating a Task

Use the `newtask` skill (one task) or `task-decomposer` (several). The page format — properties,
section order, step 0, DoD, boundaries — is defined once in `.claude/_templates/task-page/TEMPLATE.md`
(task format v2); follow it rather than any copy. The short version:

1. Next number: `node .claude/scripts/notion/get-board.js --next-number`.
2. Name `feature/{{PROJECT_PREFIX}}-N: task name`; `Status` defaults to `To do`, `Stage` to `Backlog`.
3. Body per the template: 🎯 → ✅ DoD → 🌿 → 📍 → 📋 (`[agent]` / `[manual]`, step 0 first) → 🧭.
4. Create with `create-task.js` (stdin JSON; `type` / `appetite` / `repo` only if
   `get-board.js --properties` lists them).

⚠️ MCP `notion-create-pages` with `type: "database_id"` parent works only when the database has a single data source. For multi-source databases use the live-fetched `data_source_id` pattern from `notion-task-board-manager`.

## Common Mistakes
- Property name is **Name**, not Title
- Writing a separate English prompt — v2 has none; `notion-task-to-code` generates one from the body
- Skipping step 0 (the reference check) or leaving steps unmarked
- Only one task In progress at a time — remind the user if they try to start another
- Board v2: forgetting to set `Stage = "Backlog"` on creation — task ends up with empty Stage and falls outside both Backlog and Sprint views

</details>

## After Task Completion (Auto Doc)

When a task moves to `Done`, automatically perform the following steps — no user prompt needed.

### Step 1 — Identify changed files

```bash
git diff {{GIT_DEVELOP_BRANCH}}...HEAD --name-only
```

### Step 2 — Classify the change set

| File pattern match | Action |
|---|---|
| New command/feature file in presentation layer | New feature |
| Modified existing command/feature file | Existing feature update |
| No matches | No doc action needed — exit |

### Step 3 — Apply doc change

**New feature:** use `notion-navigator` to get the correct category group page ID, then create a new record in the category inline DB.

**Feature update:** find the existing record by name (search via `notion-search`). Patch only the affected section. Do not rewrite unaffected sections.

### Step 4 — Report

At the end of the task transition, report what was created or updated (one line).

### Failure handling

If any Notion API call fails: log the intended change in chat and continue — do NOT block the task status transition.
