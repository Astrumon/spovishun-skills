# Task Decomposer

Break a solution into atomic, Notion-compatible tasks. Input: Solution Decision (from `solution-designer`) or a direct solution description.

## Workflow

### Step 0: Load Context (silently)
Fetch CLAUDE.md and the current board state to determine the next task number. Do not announce this step.

```bash
node .claude/scripts/notion/get-board.js --next-number   # {"next": N} — the first task of this run gets N
node .claude/scripts/notion/get-board.js --properties    # options of Type / Appetite / Repo, if the board has them
```

```
notion-fetch(id: "{{NOTION_CLAUDE_MD_PAGE_ID}}")
```

`--next-number` takes the maximum task number over the newest tasks (both `feature/{{PROJECT_PREFIX}}-N:` and bare `{{PROJECT_PREFIX}}-N:` titles) and adds 1. It exits non-zero when no recent task carries a number — stop and ask; never guess. Number the tasks of this run consecutively from N.

Also read `.claude/_templates/task-page/TEMPLATE.md` — task format v2, the single definition of the task page. Every card below follows it.

(MCP `notion-search` with `data_source_url: "collection://<id>"` is an alternative, but it requires the live data_source_id of the board — fetch it from the database first; do not interpolate it from config.)

### Step 0.5: Determine Epic context

If the decomposition produces **3 or more tasks**, an Epic is required.

1. List existing epics:
   ```bash
   node .claude/scripts/notion/list-epics.js --format=text
   ```
2. Ask the user: "Link to an existing epic (enter number) or create a new one?"
3. If user picks an existing one → save its `id` as `epicId`.
4. If new → create it **with full body inline**:
   - Use required sections: TL;DR, Current state, Risks, Roadmap, Task decomposition
   - Reuse the Solution Decision to populate sections
   - The decomposition table produced in Step 2 goes into the Task decomposition section
   - Create via MCP so callouts/tables/toggles render correctly:
     ```
     notion-create-pages(
       parent: { type: "database_id", database_id: "{{NOTION_EPICS_DATABASE_ID}}" },
       pages: [{
         properties: { "Name": "<Epic name>", "Status": "Active", "Goal": "<1–2 sentences>" },
         icon: "🧩",
         content: "<full markdown body following the template>"
       }]
     )
     ```
     (`type: "database_id"` requires the epics DB to have a single data source. For multi-source DBs fetch the live `data_source_id` first.)
   - Save the returned `id` as `epicId`
   - Never create a stub-with-link — the Epic page must own the content

For 1–2 tasks, an Epic is optional — ask once and respect the answer.

### Step 1: Understand
Parse the input — either a Solution Decision or a direct solution description.
Identify all layers and components that need changes.
List them before decomposing.

### Step 2: Decompose
Break the solution into atomic tasks using these rules:

**Decomposition rules:**
- One task per architectural layer when changes span multiple layers
- Database migration is always a **separate task** (comes first)
- Tests belong **in the same task** as the code they test — never a separate "write tests" task
- DI wiring is a separate task only if non-trivial (e.g., new module, new scope)
- Order by dependency: tasks that block others come first
- Each task should be completable in **one focused session (~1–4 hours)** — Appetite `S` or `M`
- If a task seems larger than 4 hours, or spans more than 3 phases or 2 layers (Appetite `L`), split it further

### Step 3: Format
For each task produce a task format v2 card (see Output Template below and the template file).
No English prompt and no toggle — the body is the spec; `notion-task-to-code` generates a prompt
from it when an agent picks the task up.

### Step 4: Present
Show the **Overview Table** first (compact), then the full **Task Cards**.
Ask the user to confirm, merge, split, or reorder before creating anything in Notion.

### Step 5: Create in Notion (on confirmation)
For each task in order:
1. Build the stdin JSON for `create-task.js`:
   - `title` = `feature/{{PROJECT_PREFIX}}-{N}: {task title}`
   - `priority` = inferred from the overview table (default `Medium`)
   - `epicId` = the Epic chosen in Step 0.5 (or `null` if skipped)
   - `blockedBy` = page IDs of preceding tasks **already created in this run**
   - `type` / `appetite` / `repo` = only for properties `--properties` listed (Appetite from the Size column)
   - `content` = the full v2 card body
2. Call:
   ```bash
   echo '<json>' | node .claude/scripts/notion/create-task.js
   ```
3. Record the returned `id` so later tasks can reference it as a blocker.

All created tasks land with `Stage = Backlog` (the create-task.js default) — decomposition feeds the grooming queue, not the active sprint.

After creating, offer to promote the first unblocked task to Sprint:
```bash
node .claude/scripts/notion/update-status.js <first-task-id> --stage Sprint
```
Then suggest starting implementation with `notion-task-to-code` on that task.

---

## Output Template

### Overview Table

```markdown
# Task Decomposition: {Feature name}

**Tasks:** {N} total
**Starting number:** {{PROJECT_PREFIX}}-{next_N}

## Overview
| # | Task | Layer(s) | Size | Depends on |
|---|------|----------|------|------------|
| 1 | ...  | domain   | S    | —          |
| 2 | ...  | data     | M    | #1         |
| 3 | ...  | presentation | S | #1, #2  |
```

### Per-Task Card (repeat for each task)

The card body is exactly the **Body** skeleton of `.claude/_templates/task-page/TEMPLATE.md`,
filled for this task:

```markdown
---
### Task {{PROJECT_PREFIX}}-{N}: {Task name}   ← card title in the chat only; Name in Notion is feature/{{PROJECT_PREFIX}}-{N}: {Task name}

## 🎯 …        problem → outcome, 1–3 sentences
## ✅ …        - [ ] checkbox + verification command per item; EARS for behaviour; "existing tests pass" as a command
## 🌿 …        feature/{{PROJECT_PREFIX}}-{N}-{slug}
## 📍 …        file:line references, related tasks (#K of this run by its number)
## 📋 …        1. [agent] reference check · 2. [agent] … with file/function names · tests in the same task · [manual] for host/console steps
## 🧭 …        ✅ always / ⚠️ ask / 🚫 never
```

## Critical Constraints

**MUST DO:**
- Fetch the board to get the correct next task number (never guess or hardcode)
- Every task card follows task format v2: 🎯, ✅, 🌿, 📍, 📋, 🧭 (🕳 / 🚫 when there is something to say)
- Steps must be **concrete**: include file names, function names, not vague instructions
- Step 1 of every card is the `[agent]` reference check; every step is marked `[agent]` or `[manual]`
- DoD conditions must be **verifiable/testable** checkboxes with a command, not subjective
- Branch slug: max 3 words, kebab-case, from `{{GIT_DEVELOP_BRANCH}}`
- Order tasks by dependency — earlier tasks unblock later ones
- Include an "all existing tests pass" item with its command in every DoD
- Present the overview table for user confirmation before creating anything in Notion

**MUST NOT DO:**
- Create a separate "write tests" task — tests go with the code
- Auto-create tasks in Notion without user confirmation
- Produce fewer than 2 tasks
- Make tasks larger than ~4 hours of focused work

---

## Related Skills
- `solution-designer` — previous step: produces the Solution Decision to decompose
- `idea-brainstormer` — two steps back: structures the original raw idea
- `newtask` — creates an individual task in Notion + feature branch
- `newepic` — creates an Epic page when decomposition needs one
- `notion-spovishun-task-manager` — board CRUD; use for bulk task creation
- `notion-task-to-code` — use after tasks are created to start implementation
