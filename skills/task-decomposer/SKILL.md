# Task Decomposer

Break a solution into atomic, Notion-compatible tasks. Input: Solution Decision (from `solution-designer`) or a direct solution description.

## Workflow

### Step 0: Load Context (silently)
Fetch CLAUDE.md and the current board state to determine the next task number. Do not announce this step.

```bash
node .claude/scripts/notion/get-board.js --latest --format json   # 10 newest tasks — use to find max task number
```

```
notion-fetch(id: "{{NOTION_CLAUDE_MD_PAGE_ID}}")
```

`get-board.js --latest` queries the board via REST `/databases/{{NOTION_DATABASE_ID}}/query` sorted by `created_time` descending and returns the 10 newest tasks with their `Name` property, from which the highest existing task number N is extracted. New tasks start at N+1. `--latest` is required here: without it the board applies its default status filter, so tasks in other statuses are missing and N comes out too low.

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
- Each task should be completable in **one focused session (~1–4 hours)**
- If a task seems larger than 4 hours, split it further

### Step 3: Format
For each task produce the full 5-section Notion card (see Output Template below).
AI prompt in the collapsible toggle must be in **English**.

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
   - `content` = the full 5-section markdown
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

```markdown
---
### Task {{PROJECT_PREFIX}}-{N}: {Task name}

## 🎯 Goal
[What this task accomplishes and why it's needed]

## 🌿 Branch name
feature/{{PROJECT_PREFIX}}-{N}-{slug}

## 📋 Steps
1. [Concrete implementation step with file/function names]
2. [...]
3. Write/update tests for [specific behavior]

## ✅ Definition of Done
- [ ] [Verifiable condition 1]
- [ ] [Verifiable condition 2]
- [ ] All existing tests pass
- [ ] Code follows Clean Architecture layer rules

<details>
<summary>🤖 prompt</summary>

[Professional English prompt for AI agent execution.
Include: task context, tech stack, relevant files, expected output, architectural constraints.]

</details>
```

---

## Critical Constraints

**MUST DO:**
- Fetch the board to get the correct next task number (never guess or hardcode)
- Every task card MUST have all 5 sections: Goal, Branch, Steps, DoD, AI prompt
- Steps must be **concrete**: include file names, function names, not vague instructions
- DoD conditions must be **verifiable/testable**, not subjective
- Branch slug: max 3 words, kebab-case, from `{{GIT_DEVELOP_BRANCH}}`
- AI prompt inside `<details>` toggle must be in **English**
- Order tasks by dependency — earlier tasks unblock later ones
- Include `"All existing tests pass"` in every DoD
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
