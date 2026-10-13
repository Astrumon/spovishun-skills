# New Task Skill

Create a new task on the project board in Notion; optionally prepare the corresponding git branch when work starts immediately.

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
2. **Task description** — the problem, the desired outcome, and how we will know it is done

If the user already supplied both in their message, use them directly — do NOT ask again.

Read the task format before composing anything: `.claude/_templates/task-page/TEMPLATE.md`
(task format v2). It is the single definition of properties, section order and rules — this skill
does not repeat it.

---

## Step 2: Determine next task number

```bash
node .claude/scripts/notion/get-board.js --next-number
```

Prints `{"next": N}` — the maximum task number over the newest tasks + 1, counting both
`feature/{{PROJECT_PREFIX}}-N:` and bare `{{PROJECT_PREFIX}}-N:` titles. An empty board gives 1.

If the script exits non-zero (no recent task carries a number) — stop and inform the user. Do NOT
guess or invent a number.

---

## Step 3: Compose task data

| Field | Value |
|---|---|
| Name (property) | `feature/{{PROJECT_PREFIX}}-{N}: {task title}` |
| Status | `To do` (the script default) |
| Stage | `Backlog` (default) or `Sprint` — see Step 3.7 |
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

## Step 3.7: Choose the Stage (Board v2)

Ask where the task lands:
- **Backlog** (default) — grooming queue, not committed to a sprint. Pick this unless the user says otherwise.
- **Sprint** — work starts right away; the task is visible to the picker immediately.

Save the answer as `stage`. On Board v1 (the board has no Stage property) set `stage = null` — the script then omits the property entirely.

---

## Step 3.8: Type / Appetite / Repo (only if the board has them)

```bash
node .claude/scripts/notion/get-board.js --properties
```

Prints the options of whichever of `Type`, `Appetite`, `Repo` the board has (`{}` when none).
For each property present, infer the value from the task and confirm it with the user in the same
question as the Stage; pick only from the printed options. Skip the properties the board lacks —
do not ask about them.

If the task comes out as Appetite `L`, or spans more than 3 phases or more than 2 architectural
layers, suggest splitting it (`task-decomposer`) before creating it.

---

## Step 4: Build page content

Write the body exactly as the **Body** section of `.claude/_templates/task-page/TEMPLATE.md`
prescribes: 🎯 → ✅ → 🌿 → 📍 → 📋 → 🧭, then 🕳 / 🚫 only when there is something to say.

Checklist before moving on:
- 🌿 holds `feature/{{PROJECT_PREFIX}}-{N}-{slug}`
- step 1 is the `[agent]` reference check; every step is marked `[agent]` or `[manual]`
- every DoD item is a `- [ ]` checkbox with a command or test; behaviour is phrased in EARS
- 🧭 has all three tiers (✅ always / ⚠️ ask / 🚫 never)
- no English prompt, no toggle, and nothing CLAUDE.md already says (commit style, base branch,
  stack) unless the task deviates from it
- no emoji in the Name property — the emoji goes in `icon`

---

## Step 5: Create the task

Use the script (supports `epicId`, `blockedBy`, and since v1.4.0 parses the full markdown `content` into native Notion blocks — headings, lists, code, callouts, toggles, tables):
```bash
echo '{
  "title": "feature/{{PROJECT_PREFIX}}-{N}: {task title}",
  "priority": "Medium",
  "icon": "✨",
  "stage": "<Backlog | Sprint from Step 3.7; null on Board v1>",
  "epicId": "<page-id from Step 3.5 or null>",
  "blockedBy": ["<page-id>", ...],
  "type": "<from Step 3.8; omit if the board has no Type>",
  "appetite": "<from Step 3.8; omit if the board has no Appetite>",
  "repo": "<from Step 3.8; omit if the board has no Repo>",
  "content": "{full page content from Step 4 — markdown is parsed, not flattened}"
}' | node .claude/scripts/notion/create-task.js
```

The script sets `Status = "To do"` automatically — do not pass `status` unless the user explicitly
asks for a different starting status. `type` / `appetite` / `repo` are checked against the board
schema: a property the board lacks is skipped with a note, a value outside its options is an error.

Alternatively (MCP path, if no relations needed):
```
notion-create-pages(
  parent: { type: "database_id", database_id: "{{NOTION_DATABASE_ID}}" },
  pages: [{
    properties: {
      "Name": "feature/{{PROJECT_PREFIX}}-{N}: {task title}",
      "Status": "To do",
      "Stage": "<Backlog | Sprint from Step 3.7>"   // omit if the board has no Stage property (Board v1)
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

## Step 6: Create git branch (conditional)

Create a branch ONLY when one of these holds:
- the task went straight to `Sprint` in Step 3.7 AND the user confirms starting work now, or
- the user explicitly asks for a branch.

For Backlog tasks skip this step — the branch is created later, when the task is promoted to Sprint and picked up.

```bash
git checkout {{GIT_DEVELOP_BRANCH}}
git pull origin {{GIT_DEVELOP_BRANCH}}
git checkout -b feature/{{PROJECT_PREFIX}}-{N}-{slug}
```

If there is already a branch with this name — inform the user and do NOT overwrite it.

---

## Step 7: Confirm to user

Report:
- Task created: `feature/{{PROJECT_PREFIX}}-{N}: {task title}` (with Notion URL if available), Stage: `Backlog` / `Sprint`
- If Step 6 ran — Branch created: `feature/{{PROJECT_PREFIX}}-{N}-{slug}` and current branch is now that branch
- If Step 6 was skipped — note that no branch was created (task is in Backlog)

---

## Do NOT

- Do NOT explore the codebase
- Do NOT report on or modify existing tasks
- Do NOT create a git branch for Backlog tasks unless explicitly requested
- Do NOT branch from `main` — always from `{{GIT_DEVELOP_BRANCH}}`
- Do NOT guess the task number — always fetch the board first
- Do NOT skip a required v2 section (🎯, ✅, 🌿, 📍, 📋, 🧭) — a 15-minute chore may omit 📍 and 🧭
- Do NOT write a separate English prompt or a `🤖` toggle — `notion-task-to-code` generates one from the body
- Do NOT copy the template into the task beyond its skeleton; the rules live in the template
