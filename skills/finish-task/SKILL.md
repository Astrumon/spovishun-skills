# Finish Task

Runs the task-completion gate symmetric to the "start new task" flow: a **blocking**
quality gate (tests → build → lint), then an **advisory** code review on the task diff,
before offering push / PR / Notion status update. Closes with a plain-language summary in
the project's own language. Never auto-merges and never sets a task to `Done` automatically.

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
**Definition of Done** — use them later to confirm the work matches what was asked. If the
file is absent, say so once and continue, but do **not** claim in Step 7 that the Definition
of Done was verified.

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

If `CLAUDE.md` documents no commands, **stop and ask the user** which test, build and lint
commands to run. Do not infer a build tool from the file tree — a guessed command that
silently does nothing reports a green gate on unverified code.

### Step 3: Blocking gate (tests → build → lint), in order

Run, in this exact order:
1. **Tests** — including integration tests if the project defines them.
2. **Build**.
3. **Blocking lint/format check**.

On the **first failure**: STOP the gate. Surface the failing output as `file:line` references
and a short diagnosis. Do **not** run the code review, do **not** offer push/PR, do **not**
touch Notion — skip Steps 4, 5 and 6 entirely. Then **jump straight to Step 7** and emit the
summary, marking the review as not run. After the summary, hand control back so the user can
fix and re-run `finish task`.

### Step 4: Non-blocking static analysis

Run any non-blocking analysis (e.g. detekt). **Report** findings, but never fail the gate on
them.

### Step 5: Advisory code review on the task diff

Compute the task diff against the base branch:
```
git diff {{GIT_DEVELOP_BRANCH}}...HEAD
git diff --numstat {{GIT_DEVELOP_BRANCH}}...HEAD
```
(If `{{GIT_DEVELOP_BRANCH}}` is empty, default to `develop`.)

The review is not one-size-fits-all: classify what the diff touched first (5a), resolve at
most three domain specialists that are actually available (5b), then run one review (5c).

#### Step 5a: Classify the diff

`--numstat` gives per-file volume; the hunks give content signals. Match every changed file
against this table. Path/extension signals come first, content signals confirm.

| Domain | Path / extension signals | Content signals |
|---|---|---|
| `ui-compose` | `*.kt` under `ui/`, `presentation/`, `composeApp/` | `@Composable`, `androidx.compose.`, `Modifier`, `remember`, `LaunchedEffect` |
| `concurrency` | any `*.kt` | `suspend fun`, `launch {`, `async {`, `Flow<`, `withContext`, `CoroutineScope`, `Dispatchers.`, `CancellationException` |
| `persistence` | `data/`, `db/`, `repository/`; `*.sq`, `schemas/*.json` | `: Table`, `transaction {`, `safeDbQuery`, Exposed / SQLDelight / Room imports, `@Entity` |
| `sql-schema` | `db/migration/*.sql`, any `*.sql` | `CREATE INDEX`, `ALTER TABLE`, `JOIN`, `EXPLAIN` |
| `di` | `di/`, `*Module.kt` | `module {`, `single<`, `factory<`, `viewModelOf`, `by inject` |
| `bot` | `presentation/bot/`, `*Handler.kt` | Telegram SDK imports, `command(`, `InlineKeyboard` |
| `networking` | `network/`, `api/`, `*Client.kt` | `HttpClient`, `expectSuccess`, Ktor client imports |
| `tests` | `src/test/`, `src/*Test/`, `commonTest`, `*Test.kt`, `*Spec.kt` | `@Test`, `runTest`, `mockk`, `Turbine` |
| `build` | `build.gradle.kts`, `settings.gradle.kts`, `gradle/libs.versions.toml`, `gradle.properties` | — (path is enough) |
| `containers` | `Dockerfile*`, `docker-compose*.y*ml`, `.dockerignore` | — (path is enough) |

**Trigger threshold.** Count only **substantive** changed lines. Excluded: `import` /
`package` lines, blank lines, comment-only lines, and lines whose only change is formatting
or a rename.

A domain is **touched** when it has **≥ 10 substantive changed lines**, or **≥ 2 files** with
any substantive change.

*Worked counter-example:* one changed `import androidx.compose.foundation.layout.Column`
line does **not** make `ui-compose` touched.

**Exception — always touched at any size:** a new or modified DB migration, a `Dockerfile` /
compose file, or a version-catalog entry. A schema, an image and a dependency version are
substantive at one line.

A file may belong to more than one domain (a `Repository.kt` full of `suspend fun` counts for
both `persistence` and `concurrency`). Count it in each.

#### Step 5b: Rank, cap, and resolve by presence

1. Rank touched domains by **share of substantive changed lines**, descending.
2. **Cap: at most 3** specialists per run, at most **one per domain row**. Beyond that the
   review context balloons and `code-reviewer` drowns in it.
3. For each of the top domains, walk its candidate list in order and take the **first one
   available in this session**:

| Domain | Candidates (first available wins) |
|---|---|
| `ui-compose` | `compose-multiplatform` → `kmp-multiplatform-specialist` |
| `concurrency` | `kotlin-coroutines-expert` * → `kotlin-specialist` |
| `persistence` | `postgresql-exposed-orm` → `kmp-persistence` → `database-optimizer` |
| `sql-schema` | `database-optimizer` → `database-reviewer` (agent) |
| `di` | `dependency-injection-architecture` → `koin-kmp` |
| `bot` | `telegram-bot-development` |
| `networking` | `ktor-client-kmp` |
| `tests` | `unit-testing-kotlin` → `kmp-testing` |
| `build` | `gradle-build-auditor` |
| `containers` | `docker-deployment` |
| *Kotlin general* — only if **no** row above resolved and the diff is Kotlin-heavy | `kotlin-code-review` * → `thermo-nuclear-code-quality-review` * → `kotlin-reviewer` (agent) |

`*` = not shipped with this skill. Reachable only when the consumer happens to have it in
`~/.claude/skills/` or via another plugin.

**Availability check — resolve by presence, never by assumption.** This skill installs into
projects that have none of the skills above on disk. Never assume a row's target exists.

1. Primary: the id appears in the list of skills / agents available in this session. That
   list is the only check that sees project skills, user-level `~/.claude/skills/`, and
   plugin skills alike.
2. Fallback when that is unclear: `Glob` for `.claude/skills/<id>/SKILL.md`,
   `~/.claude/skills/<id>/SKILL.md`, `.claude/agents/<id>/AGENT.md`.

**If no candidate in a row is available, skip the row silently** — no error, no warning, no
mention in the report. A project with none of them resolves zero rows, and Step 5 degrades
to a plain `code-reviewer` pass. That is a correct outcome, not a degraded one.

#### Step 5c: Run the review

1. Invoke each resolved specialist **scoped to its own domain's files only**, and ask it for
   **domain findings as input** — not for a report of its own.
2. Then invoke the `code-reviewer` skill **once**, scoped to the full diff, passing the
   specialist findings as extra context.
3. Emit `code-reviewer`'s Critical / Major / Minor + Verdict report. Above it, one line names
   which specialists ran, e.g. `Domain review: compose-multiplatform, kotlin-specialist`.
   Skipped rows are simply absent from that line; if none resolved, omit the line.

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

### Step 7: Plain-language summary in {{PROJECT_LANGUAGE}}

Always runs — on green after Step 6, and immediately after a Step 3 blocking failure. It sits
**alongside** the technical report from Step 5; it never replaces it.

**Brief:**

> Write the summary in the project language `{{PROJECT_LANGUAGE}}` (ISO code — `uk` is
> Ukrainian, `en` is English), in plain technical prose: short sentences, one idea per
> sentence, no metaphors.
>
> **Technical terms stay in their original form.** Do not translate `coroutine`, `Flow`,
> `CancellationException`, `detekt`, `ktlint`, `Composable`, `migration`, `PR`. What gets
> simplified is **sentence structure, not vocabulary** — this is not ELI5.
>
> If the project defines a ubiquitous language (a `CONTEXT.md`, or a Glossary section in the
> root `CLAUDE.md`), use its terms.
>
> **Under 250 words.**

Four sections, with the headings themselves written in `{{PROJECT_LANGUAGE}}` (canonical
English names given here for reference):

1. **What changed** — 2–4 sentences derived from the diff.
2. **What the blocking gate reported** — tests / build / lint: passed, or the first failure
   and where it is.
3. **What the review found** — counts by severity plus the worst finding. State `not run`
   when Step 5 was skipped.
4. **What is left for you to do** — concrete next actions: fix X, push, open a PR,
   acknowledge a Critical finding, set Notion `Done` after the merge.

## Review boundaries

Who writes what, so nothing is reviewed twice:

- **`code-reviewer`** — always runs, and is the **sole author** of the Critical / Major /
  Minor + Verdict report.
- **Specialist skills from Step 5b** — add domain depth and feed their findings into
  `code-reviewer`. They never emit their own severity block or verdict.
- **`two-axis-code-review`** — a *different* review (Standards vs Spec) that the user invokes
  directly. `finish-task` **never** invokes it: running both would put two verdicts on one
  diff.
- **`kotlin-reviewer` / `code-architecture-reviewer` / `database-reviewer` agents** — deep
  standalone audits. At most one is reached, and only through the last-resort row in the
  table. Its output is folded into `code-reviewer`'s report, never printed separately.

## Do NOT

- Do **not** make the routing table safe by narrowing this skill to a single stack. The
  presence check in Step 5b is what makes the table safe; a project with none of those skills
  must still get the full gate.
- Do **not** invoke a specialist skill without checking it is available first.
- Do **not** let a specialist skill write its own Critical/Major/Minor report.
- Do **not** skip Step 7 when the blocking gate fails — that is exactly when the summary is
  most useful.
- Do **not** push, open a PR, merge, or set Notion `Status = Done` without the user asking.

## Example run

User is on `feature/{{PROJECT_PREFIX}}-142-schedule-digest`. The diff against
`{{GIT_DEVELOP_BRANCH}}` is 180 substantive lines: ~120 in `domain/schedule/` (all
`suspend fun` and `Flow<`), ~45 in `data/ScheduleRepository.kt` (Exposed `Table` + a new
migration), 15 in `ScheduleModule.kt`.

Expected outcome:

- Step 3 runs tests → build → lint; all green.
- Step 5a marks `concurrency`, `persistence` and `di` as touched. `sql-schema` is touched too
  (a migration is substantive at any size).
- Step 5b ranks them, caps at 3, and resolves `kotlin-specialist`, `postgresql-exposed-orm`
  and `database-optimizer`. `di` falls outside the cap. In a project where none of those
  three is installed, all rows are skipped and nothing is said about it.
- Step 5c prints `Domain review: kotlin-specialist, postgresql-exposed-orm, database-optimizer`
  and then one `code-reviewer` report with a single Verdict.
- Step 6 offers push / PR / Notion `Done`, performing none of them.
- Step 7 prints the four-section summary in `{{PROJECT_LANGUAGE}}`, under 250 words, with
  `Flow`, `suspend`, `migration` and `ktlint` left untranslated.

## Related Skills

- `code-reviewer` — the review pass invoked in Step 5c; owns the report format.
- `commit` — committing the work before the gate runs.
- `git-workflow-pr-writing` — PR body and branch conventions for Step 6.
