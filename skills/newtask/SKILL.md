# New Task Skill

Create a new task on the project board in Notion and prepare the corresponding git branch.

---

## Step 0: Initialize silently

Fetch CLAUDE.md to load project context:
```
notion-fetch(id: "{{NOTION_CLAUDE_MD_PAGE_ID}}")
```
Do not announce this step.

---

## Step 1: Gather task info

Ask the user (if not already provided):
1. **Task title** — short, imperative, describes the outcome (e.g., "Add member ban command")
2. **Task description** — what is the goal, why it's needed, and expected outcome (2–5 sentences)

If the user already supplied both in their message, use them directly — do NOT ask again.

---

## Step 2: Determine next task number

Query the 10 most recently created tasks:
```bash
node .claude/scripts/notion/get-board.js --latest --format json
```

Iterate through the returned array in order. Find the first `title` that matches the pattern
`feature/{{PROJECT_PREFIX}}-{N}:` and extract N. Next task number = N + 1.

If no task matches the pattern — stop and inform the user. Do NOT guess or invent a number.
If the array is empty (board has no tasks) — start from 1.

---

## Step 3: Compose task data

| Field | Value |
|---|---|
| Name (property) | `feature/{{PROJECT_PREFIX}}-{N}: {task title}` |
| Status | `Not started` |
| icon | `✨` (default; user may override) |

Branch name: `feature/{{PROJECT_PREFIX}}-{N}-{slug}`
- `{slug}` = max **3 words** from the title, kebab-case, English only
- Example: title "Add member ban command" → `feature/{{PROJECT_PREFIX}}-17-add-member-ban`

---

## Step 3.5: Link to an Epic (optional)

Ask the user if they want to link this task to an existing epic.

If yes — list available epics:
```bash
node .claude/scripts/notion/list-epics.js --format=text
```

Show the numbered list and ask which one (`1`, `2`, …) or `skip`. Save the chosen epic's `id` as `epicId`. If the user says `skip` or the list is empty, `epicId = null`.

If the user wants a brand-new epic, suggest invoking the `newepic` skill first, then return here.

---

## Step 3.6: Mark blockers (optional)

Ask if there are blocker tasks already on the board that must complete before this one can start.

If yes — accept task numbers (e.g. `84, 86`) or full page IDs. For each number, resolve to a page ID:
```bash
node .claude/scripts/notion/get-task.js {{PROJECT_PREFIX}}-<N> --format=json
```
Collect the resolved page IDs into `blockedBy` (array). If the user skips, `blockedBy = []`.

---

## Step 4: Build page content

Every new task page must include all five sections:

```
## 🎯 Goal
{Goal in 1-3 sentences. What result is expected?}

## 🌿 Branch name
feature/{{PROJECT_PREFIX}}-{N}-{slug}

## 📋 Steps
1. {First implementation step}
2. {Second implementation step}
3. ...

## ✅ Definition of Done
> {A concrete, testable condition — when is this task complete?}

🤖 prompt  ← toggle (collapsible)
  {Professional AI agent prompt in English. Include: task context, tech stack, relevant files/modules, expected output, conventions from CLAUDE.md.}
```

Rules:
- No emoji in the Name property — emoji goes in `icon` only
- AI prompt must be in **English**, professional, precise — suitable for autonomous agent execution
- Steps should match the architectural layers involved

---

## Step 5: Create the task

Use the script (it supports `epicId` and `blockedBy`):
```bash
echo '{
  "title": "feature/{{PROJECT_PREFIX}}-{N}: {task title}",
  "priority": "Medium",
  "icon": "✨",
  "epicId": "<page-id from Step 3.5 or null>",
  "blockedBy": ["<page-id>", ...],
  "content": "{full page content from Step 4}"
}' | node .claude/scripts/notion/create-task.js
```

Alternatively (MCP path, if no relations needed):
```
notion-create-pages(
  parent: { type: "database_id", database_id: "{{NOTION_DATABASE_ID}}" },
  pages: [{
    properties: {
      "Name": "feature/{{PROJECT_PREFIX}}-{N}: {task title}",
      "Status": "Not started",
      "Stage": "Backlog"   // omit if the board has no Stage property (Board v1)
    },
    icon: "✨",
    content: "{full page content from Step 4}"
  }]
)
```

⚠️ The property name is **Name** (not Title) — case-sensitive.

⚠️ MCP `type: "database_id"` parent works only when the database has exactly **one** data source. Multi-source databases require a live-fetched `data_source_id` — use `notion-task-board-manager` for that pattern.

⚠️ Board v2 (Scrum) only: new tasks must land in `Stage = "Backlog"` (visible to grooming, hidden from the Sprint picker until promoted). Skip the `Stage` property entirely on Board v1 / unset `notion.picker.stage_filter`.

---

## Step 6: Create git branch

```bash
git checkout {{GIT_DEVELOP_BRANCH}}
git pull origin {{GIT_DEVELOP_BRANCH}}
git checkout -b feature/{{PROJECT_PREFIX}}-{N}-{slug}
```

If there is already a branch with this name — inform the user and do NOT overwrite it.

---

## Step 7: Confirm to user

Report:
- Task created: `feature/{{PROJECT_PREFIX}}-{N}: {task title}` (with Notion URL if available)
- Branch created: `feature/{{PROJECT_PREFIX}}-{N}-{slug}`
- Current branch is now: `feature/{{PROJECT_PREFIX}}-{N}-{slug}`

---

## Do NOT

- Do NOT explore the codebase
- Do NOT report on or modify existing tasks
- Do NOT branch from `main` — always from `{{GIT_DEVELOP_BRANCH}}`
- Do NOT guess the task number — always fetch the board first
- Do NOT skip any of the five page sections (Goal, Branch, Steps, DoD, prompt)
