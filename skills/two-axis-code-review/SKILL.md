# Two-Axis Code Review (Standards + Spec)

Two-axis review of the diff between `HEAD` and a fixed point (default: `develop`):

- **Standards** — does the code conform to this project's documented standards (CLAUDE.md, Kotlin rules, Clean Architecture) and the smell baseline?
- **Spec** — does the code faithfully implement the originating Notion task (Goal / Steps / Definition of Done)?

Both axes run as **parallel sub-agents** so they don't pollute each other's context, then this skill aggregates their findings side by side. Both reports are written **in Ukrainian**.

## Scope

This skill covers **Spec conformance + architectural/style standards ONLY**. Out of scope — do NOT report:

- Bugs, logic errors, silent failures
- Test coverage and test quality
- Type design
- Database migrations, transactions, indexes, N+1

Those belong to the dedicated review agents (`kotlin-reviewer`, `code-architecture-reviewer`, `database-reviewer`) and the `code-reviewer` skill. Do not duplicate their work.

## Process

### 1. Pin the fixed point

Default fixed point is **`develop`** — do not ask the user for it. Only use a different ref (commit SHA, branch, tag, `HEAD~5`, …) if the user explicitly supplied one.

- Confirm the ref resolves: `git rev-parse develop` (if it fails, try `origin/develop`; use whichever resolves as `<fixed-point>` below).
- Capture the diff once: `git diff <fixed-point>...HEAD` (three-dot — comparison is against the merge-base).
- Note the commit list: `git log <fixed-point>..HEAD --oneline`.

A bad ref or an empty diff should fail here — not inside two parallel sub-agents.

### 2. Resolve the spec from Notion

The spec is the originating Notion task, resolved from the branch name:

1. Get the current branch: `git rev-parse --abbrev-ref HEAD`.
2. Extract the task number `N` from the `feature/{{PROJECT_PREFIX}}-N-*` pattern.
3. Fetch the task:
   ```
   node .claude/scripts/notion/get-task.js {{PROJECT_PREFIX}}-N --format=json
   ```
4. The spec = the task's **Goal**, **Steps**, and **Definition of Done** sections.

Fallbacks, in order:

- If the user passed a task id (`{{PROJECT_PREFIX}}-N`, bare `N`, or a Notion pageId) as an argument — use it instead of branch parsing.
- If the branch doesn't match the pattern and no argument was given — ask the user which task this branch implements.
- If there is genuinely no task, skip the Spec sub-agent and state "спеки немає" in the final report.

### 3. Identify the standards sources

Read these files (skip any that are missing — do not fail):

- `CLAUDE.md` (project root)
- `.claude/rules/kotlin/*.md` (glob — take every file present)
- `.claude/rules/common/design-principles.md`

On top of the documented standards, the Standards axis always carries the **smell baseline** below — a fixed set of Fowler code smells (_Refactoring_, ch.3) plus a Kotlin/Clean-Architecture checklist. Two rules bind it:

- **The repo overrides.** A documented project standard always wins; where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation — and, like any standard here, skip anything tooling already enforces (detekt, ktlint).

Each item reads *what it is* → *how to fix*; match it against the diff.

**Fowler baseline:**

- **Mysterious Name** — a function, variable, or type whose name doesn't reveal what it does or holds. → rename it; if no honest name comes, the design's murky.
- **Duplicated Code** — the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.
- **Feature Envy** — a method that reaches into another object's data more than its own. → move the method onto the data it envies.
- **Data Clumps** — the same few fields or params keep travelling together (a type wanting to be born). → bundle them into one type, pass that.
- **Primitive Obsession** — a primitive or string standing in for a domain concept that deserves its own type. → give the concept its own small type.
- **Repeated Switches** — the same `when`/`if`-cascade on the same type recurs across the change. → replace with polymorphism, or one map both sites share.
- **Shotgun Surgery** — one logical change forces scattered edits across many files in the diff. → gather what changes together into one module.
- **Divergent Change** — one file or module is edited for several unrelated reasons. → split so each module changes for one reason.
- **Speculative Generality** — abstraction, parameters, or hooks added for needs the spec doesn't have. → delete it; inline back until a real need shows.
- **Message Chains** — long `a.b().c().d()` navigation the caller shouldn't depend on. → hide the walk behind one method on the first object.
- **Middle Man** — a class or function that mostly just delegates onward. → cut it, call the real target direct.
- **Refused Bequest** — a subclass or implementer that ignores or overrides most of what it inherits. → drop the inheritance, use composition.

**Kotlin / Clean Architecture checklist:**

- **Layer-boundary violation** — a dependency that doesn't point inward (`presentation → domain ← data`); e.g. domain importing from data or presentation. → invert it behind an interface owned by domain.
- **Framework leak into domain** — Ktor, Exposed, Koin, serialization, or other framework types inside the domain layer. → move them to data/presentation; domain stays pure Kotlin.
- **Callback instead of coroutine** — a callback/listener API where `suspend fun` or `Flow` fits. → convert to suspend/Flow.
- **Non-idiomatic Kotlin** — a plain class where `data class`/`sealed class` fits, an `if`-cascade where `when` fits, Java-style getters/setters/builders. → use the idiomatic form.

### 4. Spawn both sub-agents in parallel

Send a single message with two `Agent` tool calls. Use the `general-purpose` subagent for both.

**Standards sub-agent prompt** — include:

- The full diff command and commit list.
- The list of standards-source files you found in step 3, **plus the full smell baseline and Kotlin/Clean-Architecture checklist from step 3** pasted in full — the sub-agent has no other access to them.
- The out-of-scope list from the Scope section — findings must not drift into bug-hunting, tests, types, or DB.
- The brief: "Напиши звіт українською мовою. Report — per file/hunk where relevant — (a) every place the diff violates a documented standard: cite the standard (file + the rule); and (b) any baseline smell or checklist item you spot: name it and quote the hunk. Distinguish hard violations from judgement calls — documented-standard breaches can be hard, but baseline smells are always judgement calls, and a documented project standard overrides the baseline. Skip anything tooling enforces. Under 400 words."

**Spec sub-agent prompt** — include:

- The diff command and commit list.
- The fetched spec: the task's Goal, Steps, and Definition of Done, pasted in full.
- The out-of-scope list from the Scope section.
- The brief: "Напиши звіт українською мовою. Report: (a) requirements the spec asked for that are missing or partial; (b) behaviour in the diff that wasn't asked for (scope creep); (c) requirements that look implemented but where the implementation looks wrong. Quote the spec line for each finding. Under 400 words."

If the spec is missing, skip the Spec sub-agent and note this in the final report.

### 5. Aggregate

Present the two reports under `## Standards` and `## Spec` headings, verbatim or lightly cleaned. Do **not** merge or rerank findings — the two axes are deliberately separate (see _Why two axes_).

End with a one-line summary per axis: total findings and the worst issue _within that axis_ (if any). Don't pick a single winner across axes — that's the reranking the separation exists to prevent.

## Why two axes

A change can pass one axis and fail the other:

- Code that follows every standard but implements the wrong thing → **Standards pass, Spec fail.**
- Code that does exactly what the task asked but breaks the project's conventions → **Spec pass, Standards fail.**

Reporting them separately stops one axis from masking the other.
