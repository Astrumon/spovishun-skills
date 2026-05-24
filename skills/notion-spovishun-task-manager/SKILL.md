# Notion Project Task Manager

Task management for a project board in Notion with project-specific conventions — task numbering, branch naming, and documentation auto-update.

**I/O rule:** Reads go through `scripts/notion/` CLI scripts. Writes use MCP (`notion-create-pages`, `notion-update-page`) or `scripts/notion/create-task.js` / `scripts/notion/update-status.js` interchangeably.

## Project Conventions

### Task numbering
- Format: `feature/{{PROJECT_PREFIX}}-N-short-description`
- `N` — next sequential number (always fetch board to find max N)
- `short-description` — maximum 3 words in kebab-case

### Task title in Notion
- Property name is **Name** (not Title) — case-sensitive
- Format: `feature/{{PROJECT_PREFIX}}-N: task name`
- No emoji in title — emoji goes in the `icon` field

## Reading the Board

```
node scripts/notion/get-board.js                       # JSON (default) — use when processing data
node scripts/notion/get-board.js --format=md           # markdown table — use when displaying to user
node scripts/notion/get-board.js --epic "<name|id>"    # only tasks linked to that epic
```

Display statuses: In progress / Not started / Done (last 3). The board table includes `Epic` and `Blocked by` columns.

## Epics

```
node scripts/notion/list-epics.js --format=md          # list all epics
node scripts/notion/list-epics.js --status=Active      # filter by status
echo '{"name":"…","goal":"…","status":"Planned"}' | node scripts/notion/create-epic.js
```

To re-assign a task's epic, use `notion-update-page` with the property `Epic` set to `[{"id": "<epic-page-id>"}]`. To clear it, pass an empty array.

## Updating a Task

```
notion-update-page(
  page_id: "<task-id>",
  properties: { "Status": "In progress" }
)
```

Status flow: `Not started -> In progress -> Done`

<details>
<summary>Extended: creating a task (full 4-step workflow), common mistakes</summary>

## Creating a Task

### Step 1: Next number
Search the board; next N = max existing + 1.

### Step 2: Task data

| Field | Value |
|---|---|
| Name | `feature/{{PROJECT_PREFIX}}-N: task name` |
| Status | `Not started` |

### Step 3: Page content — all five sections required

```
## Goal
What is the purpose of this task and what outcome is expected.

## Branch name
feature/{{PROJECT_PREFIX}}-{N}-short-description

## Steps
1. First step
2. Second step

## Definition of Done
A concrete condition — when this task is considered complete.

prompt  (toggle/collapsible)
  Professional English prompt for AI agents (Claude Code / Windsurf).
```

### Step 4: Create with icon

```
notion-create-pages(
  parent: { type: "data_source_id", data_source_id: "{{NOTION_BOARD_COLLECTION_ID}}" },
  pages: [{
    properties: { "Name": "feature/{{PROJECT_PREFIX}}-N: task name", "Status": "Not started" },
    icon: "...",
    content: "..."
  }]
)
```

## Common Mistakes
- Property name is **Name**, not Title
- Missing any of the five page sections (Goal / Branch / Steps / DoD / prompt)
- prompt toggle must be in English, professional tone
- Only one task In progress at a time — remind the user if they try to start another

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
