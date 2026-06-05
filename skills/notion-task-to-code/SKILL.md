# Notion Task to Code Prompt

Converts a Notion task into a ready-to-use AI agent prompt for Claude Code or similar AI coding agents.

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

### Step 2: Fetch CLAUDE.md (targeted)
```
node .claude/scripts/notion/get-claude-md.js --section commands       # just the Commands section
node .claude/scripts/notion/get-claude-md.js --section testing        # just Testing section
node .claude/scripts/notion/get-claude-md.js                          # full read — only when overview needed
```

### Step 3: Extract task fields
From the fetched task page, extract:
- **Goal** — what the task is about
- **Branch name** — `feature/{{PROJECT_PREFIX}}-N-xxx`
- **Steps** — ordered list of implementation steps
- **Definition of Done** — completion condition
- **prompt toggle** — existing AI prompt if present (use as base, expand if needed)
- **epic** — parent Epic title and id, if any
- **blockedBy** — list of blocker tasks (title + id)

When generating the prompt, inject into the Context section:
- "This task belongs to Epic: **<epic.title>**" — if epic is present
- "Blocked by (must verify before starting): <comma-separated blocker titles>" — if blockedBy is non-empty

### Step 4: Generate the final prompt

Fill the prompt template from all extracted task fields. Output as a fenced code block.

Template structure:
```
You are implementing a feature for the {{PROJECT_NAME}} project.

## Context
[Tech stack, architecture layer, key existing patterns]
[This task belongs to Epic: <epic.title>] (if applicable)
[Blocked by: <blockers>] (if applicable)

## Task
[Task title and number]

## Goal
[What this task should accomplish]

## Steps
1. [Step 1]
2. [Step 2]
3. Write/update tests

## Definition of Done
- [ ] [Condition 1]
- [ ] [Condition 2]
- [ ] All existing tests pass
- [ ] Code follows Clean Architecture layer rules

## Key files
- `path/to/RelevantFile.kt` — [why it matters]

## Constraints
[Project-specific architectural constraints from CLAUDE.md]
```

### Step 5: Present the output
Show the prompt in a code block and offer to update the prompt toggle in Notion.

### Step 6: Enter Plan Mode
After presenting the prompt, immediately enter Plan Mode using the `EnterPlanMode` tool.
Plannotator will intercept `ExitPlanMode` — wait for user approval before proceeding.
