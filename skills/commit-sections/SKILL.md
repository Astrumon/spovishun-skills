# Commit Sections

Turns a large finished change into a sequence of small, reviewable, dependency-ordered commits.
The user reviews each section from the git index and commits it themselves; this skill only
stages, explains, verifies and keeps the plan.

> **LANGUAGE.** Talk to the user in `{{PROJECT_LANGUAGE}}` (from `project.language`). If that
> value is empty, use the language the user writes in — do not silently fall back to English.
> Commit messages, code, identifiers and quoted material stay in English. Section descriptions
> are prose in the project language around English code.

> **HARD RULE — NEVER COMMIT.** `git commit`, `git commit --amend`, `git rebase`, `git push`
> are the user's actions. This skill runs `git add` / `git reset` (index only) and prints the
> commit command. If you catch yourself about to commit, stop.

> **INDEX CHECKS.** Always use `git diff --cached --quiet` (empty?) and
> `git diff --cached --name-status` (what?). Never `git status | grep "^[AM]"` — it misses
> staged deletions and renames.

## When NOT to use this skill

- The change is one coherent thing that lands as a single commit → `commit`.
- The code is not written yet → `task-decomposer` (split the work), `new-feature` (scaffold it).
- The commits already exist and the task needs its gate, PR and board update → `finish-task`.
- The question is whether the diff is *correct* → `code-reviewer`, `two-axis-code-review`, or the
  reviewer agents. This skill slices and explains; it does not audit for bugs.

## When it applies

- The code is already written (post-implementation). This skill does not plan sections at design
  time and does not write feature code beyond small review-driven fixes.
- Input pool = every change in the working tree relative to `HEAD` — modified, deleted, renamed
  and untracked files. `.dev-context/` is **never** part of the pool (it holds this skill's own
  state plus the hook cache); if it is not gitignored in this project, say so once and keep
  excluding it.
- Optional argument `base-ref` (e.g. `/commit-sections {{GIT_DEVELOP_BRANCH}}`): when part of the
  work was already committed and needs re-slicing. This **rewrites the branch**:
  1. `git status -sb` — if the branch has an upstream and is not purely ahead of it, or is
     someone else's, warn that a force-push will be needed.
  2. Ask for explicit confirmation, then `git reset --soft <base-ref>` followed by `git reset -q`
     so the whole pool is unstaged.
  3. Not confirmed → work only with the uncommitted pool.

## Phase 0 — Resume check

State lives at `.dev-context/{folder}/commit-sections.md`, where `{folder}` is the branch name
with `/` replaced by `-` and `_prd` appended — the same folder the dev-context hook already uses
(`feature/{{PROJECT_PREFIX}}-77-foo` → `.dev-context/feature-{{PROJECT_PREFIX}}-77-foo_prd/`).
Create the folder if it does not exist.

1. State file exists → read it and compare with `git log --oneline -20`, `git status --short`
   and `git ls-files --others --exclude-standard`:
   - every section `done` (its commit is in the log) → the plan is finished; delete the file and
     start fresh;
   - the pool contains files not in the plan, or plan files are gone → the plan is stale; say so,
     delete it and start fresh;
   - otherwise mark sections whose commit is present as `done` and propose to continue from the
     first pending one. The user confirms or discards.
2. No state file → start fresh (Phase 1).

## Phase 1 — Baseline verification (once)

If a full check has not been run in this conversation yet, run the project's own commands. Read
them from this project's `CLAUDE.md` **`## Commands`** / **`## Testing`** sections — do **not**
hardcode a build tool and do not infer one from the file tree; a guessed command that silently
does nothing reports a green baseline on unverified code. If `CLAUDE.md` documents no commands,
ask the user for the lint / build / test commands once, and without an answer stick to git only.

Run lint/format, compile/build, and the unit tests for the touched modules. Red results are
reported before any slicing — the user decides whether to fix first.

## Phase 2 — Slice into sections

1. **Respect an existing index.** If `git diff --cached --quiet` fails, show
   `git diff --cached --name-status` and ask before unstaging: the user may have pre-selected
   files on purpose. Then `git reset -q`.
2. Collect the pool: `git status --short` + `git ls-files --others --exclude-standard`. For line
   counts of untracked files use intent-to-add and undo it right away:
   ```bash
   git add -N -- .          # intent-to-add: untracked files become visible to git diff
   git diff HEAD --stat
   git reset -q             # undo it — nothing stays staged
   ```
   Run this **only** on an empty index (step 1 already emptied it): the trailing `git reset -q`
   clears everything. `-- .` keeps it shell-agnostic — no `xargs`, so it behaves identically in
   PowerShell and in bash.
3. **not-for-PR bucket.** Pull out local/temporary changes first: `.env*`, local tokens,
   `spovishun-skills.config.yaml`, `.mcp.json`, `.claude/settings.local.json`, `*.properties`,
   environment URLs, debug flags, build config switched to a test environment. They are never
   part of a section. Show them and ask what to do (separate commit, revert, or leave unstaged).
   A file that carries a secret is never staged, whatever the user answers — offer a revert or a
   `.gitignore` entry instead.
4. **Ordering — bottom-up by dependency**, so every commit's main source set compiles on its own.
   The invariant is "nothing references a file from a later section"; the ladder itself follows
   whatever dependency direction this project documents in `CLAUDE.md` → *Layer Rules*. Typical
   shapes:
   - **Kotlin backend:** schema / migrations → models → repositories & mappers → services /
     use-cases → routes & handlers → DI wiring → tests.
   - **KMP / Compose:** model → data (network, persistence, repositories) → domain / use-cases →
     DI → shared UI components → state (state/actions/ViewModel) → screens → tests.
   - **Node package (this repo's own shape):** `schema/` → `lib/` → `adapters/<target>/` →
     `adapters/registry.js` → `bin/` → `test/`.

   Resources (string catalogs, drawables, raw assets, fixtures) go into the first section that
   references them.
5. **Compilability is reasoned, not built.** Trace imports of each section against earlier
   sections. When a file would not compile without one from a later section, either pull that
   file forward (and say so in the description) or state plainly that the section does not build
   alone. Do not build every section in a temporary worktree or run the full suite per section.
6. **Tests last** as one section, with a known consequence: intermediate commits may have a red
   *test* compilation when constructors or signatures change (main stays green). Say this in the
   overview and in the description of every section that changes a signature used by existing
   tests. Alternative when the user prefers fully green commits: put the edits to *existing*
   tests into the section that breaks them and keep only *new* test files for the last section.
   With only one or two sections, tests may stay with their code.
7. **Size heuristics** (soft): up to ~8 files / ~400 diff lines per section; below ~30 lines merge
   with a neighbour. No cap on the number of sections.
8. Write the plan to the state file (see format below) and present the **overview**: numbered
   sections, one-line intent, files, `+a/−b`, the tests-compilation note if relevant, plus the
   not-for-PR bucket.
9. **Wait for approval.** The user may reorder, merge, split or move files. Only then stage
   section 1.

## Phase 3 — Per-section loop

### Guard before staging

- **Previous section committed?** Compare `git rev-parse HEAD` with `head_before` stored when
  the previous section was staged, and require `git diff --cached --quiet` to succeed. Confirm
  with `git show --stat --format= HEAD` that the section's files are in that commit (the user may
  have reworded the message — do not match on the message). If HEAD did not move or the index is
  not empty: **stop and ask** whether to add the leftover to the new section or wait. Never merge
  sections on your own.
- **Foreign edits.** Working-tree changes in files of already-committed sections (the user's own
  touch-ups): report them, ask where they should go (current section or a separate commit). Do
  not stage silently.

### Stage

```bash
git add -A -- <paths of section N>        # -A stages deletions and renames too
git diff --cached --name-status
git diff --cached --stat | tail -1
git rev-parse HEAD                        # store as head_before in the state file
```

### Describe — template

Headings are written in the project language. For `uk`: *Що в стейджі* · *Ключовий код* ·
*Схема звʼязків* · *На що звернути увагу* · *Вимоги* · *Як перевірити руками*.

Sections under ~50 diff lines get the compact form: header, one line per file, commit command.
Everything else:

1. Header line: `Section N staged (K files, +a/−b).` In the **first** section only, add a pointer
   to `git diff --cached`.
2. **What is staged** — one or two sentences per file: what it adds/changes and why.
3. **Key code** — 5–15 line quotes of new code for non-obvious decisions, with `path:line`.
4. **Wiring diagram** — a short ASCII diagram, only when the section has interacting parts
   (state machine, component ↔ host, repository ↔ transport, event flow, adapter ↔ registry).
   Skip for flat sections.
5. **Watch out for** — risks, assumptions, deviations from spec, TODOs, things to check by hand,
   and "this section breaks test compilation until the tests section" when true.
6. **Requirements** — the task behind the branch, resolved locally: take `N` from
   `feature/{{PROJECT_PREFIX}}-N-slug` and read `.dev-context/{folder}/task.json` for **Goal**,
   **Steps** and **Definition of Done**; quote the points this section implements. No cached
   `task.json` → **skip this block entirely**; never claim the Definition of Done was verified,
   and do not go fetch the board mid-review.
7. **How to verify by hand** — concrete steps for user-facing / flow sections.
8. Commit command in a code block — Conventional Commits, exactly as
   `.claude/rules/common/git-workflow.md` requires: `type: short description`, lowercase English,
   imperative, ≤ 72 chars, no trailing period, no body. The task number lives in the branch name
   and in the PR, not in the subject. Never `--no-verify`. If the project's git-workflow rule
   mandates a trailer, pass it as a second `-m`.
   ```bash
   git commit -m "feat: add split key models and schema"
   ```
9. Close with what the next section is.

### While the user reviews

- Answer questions about the code with `path:line` references, in the project language.
- Requested refactors / fixes: apply → run the project's lint/format + build + tests for the
  **touched module, plus the tests of its direct dependents when a shared API changed** →
  `git add -A -- <changed files>` again → post a short delta to the description and the
  (unchanged or updated) commit command.
- Checks against the spec or a design source requested mid-section are in scope; keep them to the
  current section's files.

### Plan commands (rebuild plan + state file each time)

- `наступна` / `next` — run the guard, stage the next section.
- `обʼєднай з наступною` / `merge with next` — merge current with next.
- `розділи на дві` / `split` — split current; propose the split first.
- `перенеси X у секцію N` / `move X to N` — move a file.
- `поверни попередню` / `back` — only when the previous section is not committed yet:
  `git reset -q`, re-stage the previous one.

## Phase 4 — Wrap-up

Post the wrap-up together with the last section's commit command:

- Anything still unstaged / untracked.
- The not-for-PR bucket as revert candidates (env URLs, test environments, debug flags) with the
  concrete files.
- Pre-PR reminders that surfaced during review (open design questions, follow-up tasks, schema
  regeneration, dependency bumps) **and a full lint + build + test run**, because the Phase 1
  baseline predates the review-time edits.
- Hand off: `finish-task` owns the completion gate, the PR and the board status — this skill does
  not push, does not open a PR and does not touch the task board.
- Delete the state file only once the last commit is detected (HEAD moved, index empty); if the
  session ends before that, Phase 0 will clean it up next time.

## State file format

`.dev-context/{folder}/commit-sections.md`:

```markdown
# commit-sections: <repo> @ <branch>
base: HEAD            # or the base-ref if used
task: {{PROJECT_PREFIX}}-77   # or none
head_before: 8e0a114  # HEAD when the currently staged section was staged

| # | title | files | status | commit |
|---|-------|-------|--------|--------|
| 1 | Split key, models, schema | lib/split-key.js, ... | done | 9ae5289 |
| 2 | Pass problem ids on save | ... | staged | |
| 3 | ... | ... | pending | |

not-for-PR: .mcp.json (local server), gradle.properties (test env URL)
tests-compile-note: sections 2, 7 change signatures used by existing tests
```

Update `status`, `commit` and `head_before` on every stage / commit detection / plan command.

## Don'ts

- No `.patch` exports; the index and `git diff --cached` are the source of truth.
- No commits, amends, rebases, pushes.
- No `git reset` of an index the user filled on purpose without showing it and asking.
- No staging of not-for-PR files, secrets, or the user's own uncommitted edits without asking.
- No mixing of two sections in one index without explicit confirmation.
- No full-project builds per section; verify only after edits and only the touched module (+
  direct dependents' tests when a shared API changed).
- No board or documentation updates from here — that is `finish-task` and `update-doc-full`.
