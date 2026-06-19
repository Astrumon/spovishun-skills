# Finish Task

Runs the task-completion gate symmetric to the "start new task" flow: a **blocking**
quality gate (tests → build → lint), then an **advisory** code review on the task diff,
before offering push / PR / Notion status update. Never auto-merges and never sets a task
to `Done` automatically.

## Workflow

Execute the steps **in order**. Do not skip ahead — a failure in the blocking gate stops
the whole flow.

### Step 1: Resolve the active task

**1a.** Get the current branch:
```
git rev-parse --abbrev-ref HEAD
```
If the branch is `{{GIT_DEVELOP_BRANCH}}` (default `develop`) or `main`, stop: there is no
active task to finish — ask the user to switch to a task branch first.

**1b.** Derive the cache folder: replace `/` with `-` in the branch name and append `_prd`
(e.g. `feature/{{PROJECT_PREFIX}}-77-foo` → `feature-{{PROJECT_PREFIX}}-77-foo_prd`).

**1c.** `Read` `.dev-context/{folder}/task.json` (if present) for the task **Goal** and
**Definition of Done** — use them later to confirm the work matches what was asked.

### Step 2: Resolve the project commands

Read the build/test/lint commands from the consumer's `CLAUDE.md` **`## Commands`** and
**`## Testing`** sections — do **not** hardcode a build tool. Identify:
- the **test** command(s),
- the **build** command,
- the **blocking** linter/formatter check(s),
- any **non-blocking** static analysis the project documents (e.g. a CI gate marked
  non-blocking).

> Example (Spovishun): tests `./gradlew test` (+ `./gradlew integrationTest`), build
> `./gradlew build`, blocking lint `./gradlew ktlintCheck`, non-blocking `./gradlew detekt`.

### Step 3: Blocking gate (tests → build → lint), in order

Run, in this exact order:
1. **Tests** — including integration tests if the project defines them.
2. **Build**.
3. **Blocking lint/format check**.

On the **first failure**: STOP. Surface the failing output as `file:line` references and a
short diagnosis. Do **not** run the code review, do **not** offer push/PR, do **not** touch
Notion. Hand control back so the user can fix and re-run `finish task`.

### Step 4: Non-blocking static analysis

Run any non-blocking analysis (e.g. detekt). **Report** findings, but never fail the gate on
them.

### Step 5: Advisory code review on the task diff

Compute the task diff against the base branch:
```
git diff {{GIT_DEVELOP_BRANCH}}...HEAD
```
(If `{{GIT_DEVELOP_BRANCH}}` is empty, default to `develop`.)

Then **invoke the `code-reviewer` skill** scoped to that diff and emit its
Critical / Major / Minor + Verdict report.

- **Critical** findings must be surfaced explicitly and **acknowledged by the user** before
  offering `Done` — but they do **not** hard-block the flow.
- Major / Minor are advisory.

### Step 6: On green — offer next actions

Summarize the gate result and the review verdict, then offer (do not perform automatically):
- **push** the branch,
- **open a PR**,
- set Notion `Status = Done` — **only after the PR is merged** (per the project's Task Status
  Workflow).

Never auto-merge. Never set `Done` automatically. Confirm the work satisfies the task's
Definition of Done from Step 1 before recommending completion.
