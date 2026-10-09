# Comment Hygiene

Removes comments that read as generically AI-generated (decorative, restating the obvious,
narrating, loud) from the **task diff**, and keeps the comments that carry information the code
does not show. Proposes edits as a diff, applies them only after the user confirms, verifies that
nothing but comments changed, and never commits.

**Scope guardrail.** This skill changes comments only. Never modify executable code, identifiers,
imports, annotations, formatting, indentation, control flow or logic. When in doubt, leave the
comment alone — a surviving weak comment costs less than a broken build.

## Workflow

### Step 1: Collect candidates from the task diff

```
git diff -U0 {{GIT_DEVELOP_BRANCH}}...HEAD
```
(If `{{GIT_DEVELOP_BRANCH}}` is empty, default to `develop`.)

A candidate is a comment on a `+` line of that diff: a line comment, a block or KDoc comment, or
the trailing comment part of a code line. Comments outside the diff are out of bounds, even when
they are noisy — this pass cleans up the task, not the codebase.

Then run `git status --porcelain`. A candidate file with **uncommitted changes** is skipped and
named in the report: the rollback in Step 4 restores a file to `HEAD`, which is only safe when
the file had nothing else uncommitted.

### Step 2: Drop the allowlist — never touched

Before judging anything, remove these from the candidate set. They are directives read by tools,
or legal text, and removing one breaks the build, the IDE or the licence:

- `// region` / `// endregion` (IDE folding)
- `// language=…` (IntelliJ language injection, e.g. `// language=SQL`)
- `//noinspection …`
- `// @formatter:off` / `// @formatter:on`
- `// ktlint-disable …`, `/* ktlint-disable */`, `// ktlint-enable …`
- detekt suppressions, and the comment justifying an `@Suppress(...)` annotation
- license and copyright headers (any comment containing `license`, `copyright`, `SPDX-License-Identifier`)
- every comment in a DB migration file (`**/db/migration/**`, any `*.sql`) — Flyway checksums the
  whole file, so a comment edit in an applied migration fails validation

### Step 3: Judge the rest, then propose

Match each remaining candidate against **Tells** below and keep everything under **Preserve**.
Present the proposed changes as one unified diff in chat, grouped by file, with the tell named for
each hunk. If nothing qualifies, say so and stop.

Apply with `Edit` **only after the user explicitly confirms**. A partial confirmation ("only the
banners") applies only that part.

### Step 4: Comment-only check

After applying, verify every touched file:
```
git diff -U0 -- <file>
```
For each hunk, strip the comment part from every `-` and `+` line (`// …` to end of line, `/* … */`,
KDoc lines starting with `*`). Pass when:

- the remaining code on the `-` side and the `+` side is **byte-identical**, line for line, and
- every line that disappeared entirely was a comment line or a blank line left by a removed comment.

On a failure, restore that file — and only that file — with `git restore -- <file>`, then report the
offending hunk. Step 1 guaranteed the file had no other uncommitted changes, so nothing of the
user's is lost.

### Step 5: Report in {{PROJECT_LANGUAGE}}

Write the report in the project language `{{PROJECT_LANGUAGE}}` (`uk` is Ukrainian, `en` English):
counts per tell, allowlisted comments that were kept, skipped files and why, and any file restored
by Step 4. Never commit. Point out that the edits are uncommitted.

## Tells

Each entry is **Tell** (the pattern), **Why** (why it reads as noise), **Fix**.

**Decorative separators.** Tell: `// ===== REPOSITORY =====`, `// -------- MAPPERS --------`,
`/* ---- ROUTES ---- */`. Why: the decoration is the message; ALL CAPS reads as shouting. Fix: one
plain line, or remove if the label adds nothing. A `// region` is a directive, not a banner — keep it.

**Restating the obvious.** Tell: `// Create the repository` above `val repository = UserRepository(db)`,
`// User entity` above `data class User(...)`. Why: doubles the reading load. Fix: remove.

**Workflow narration.** Tell: inside a `suspend fun`, `// Step 1: Validate input`,
`// Step 2: Load user`, `// Step 3: Emit result`, or `// First…` / `// Finally…`. Why: the sequence is
visible in the code; numbering reads as a checklist. Fix: remove. If the flow is hard to follow, that
is a structure problem, not a missing comment.

**Empty labels.** Tell: `// Main logic`, `// Helper function`, `// Error handling`,
`// Note: this is important`. Why: names a category, not a fact. Fix: remove unless it carries one —
`// Note: retries only on 5xx` stays.

**Vague placeholders.** Tell: `// TODO: improve`, `// TODO: add more validation`,
`// Future optimizations`. Why: names a feeling, not a task. Fix: remove. Keep a TODO that names what
to do and why.

**Signature echo.** Tell:
```kotlin
/**
 * Finds a user by id.
 * @param id the id
 * @return the user
 */
suspend fun findById(id: UserId): User?
```
Why: restates the signature and adds length, not understanding. Fix: remove the echo. Keep KDoc that
documents business rules, edge cases (`@return null when the user was soft-deleted`), thrown
exceptions, side effects, threading or a public API contract.

**Decorative emoji.** Tell: `// ✅ Validation`, `// 🚀 Fast path`. Fix: plain words, or remove.

**End markers.** Tell: `} // end if`, `} // end of processOrder`. Why: the brace already ends the
block. Fix: remove the trailing comment; the `}` stays exactly as it was.

**Over-explained comment.** Tell: four lines of history, issue numbers and a "because X, so Y" chain
around a one-line constraint. Fix: cut to the constraint — one line, two at most. Keep the trap, the
silent failure, the protocol rule; drop the history.

**Line-by-line narration.** Tell: a comment on every trivial statement. Fix: at most one comment per
logical block; none if the block needs none.

**Stiff or loud wording.** Tell: "This function is responsible for validating whether the supplied
credentials are valid before…", or `// MAIN LOGIC`. Fix: a short sentence-case line in a developer's
voice, saying why rather than what.

## Preserve

Never remove a comment that explains business logic and intent, an architectural decision, security,
a performance trade-off, concurrency behaviour (dispatcher choice, cancellation, a `Mutex`), a
protocol detail, an API contract, a workaround, an edge case or assumption, or licensing. It must stay:
```kotlin
// Telegram retries webhook delivery on any non-2xx; dedupe by update_id.
```
Earning a place says what may stay, not how long it may run — a valuable comment can still be
shortened to its constraint.

## Checklist

All answers must be **yes** before proposing:

- [ ] Every candidate came from the task diff, and no allowlisted comment is in the proposal.
- [ ] Every remaining comment adds information the code does not already show.
- [ ] No decorative separators, step narration, empty labels, vague TODOs, signature echo, emoji or
      end markers survive in the diff.
- [ ] Every comment is one line, or two when the second carries a new fact.
- [ ] Only comments change — the Step 4 check will pass.

## Do NOT

- Do **not** touch a comment outside the task diff, or any allowlisted comment.
- Do **not** apply edits without explicit confirmation, and do **not** commit them.
- Do **not** ask the user to pick a mode before running — this pass runs inside non-interactive
  flows such as `finish-task`; the one question it asks is the confirmation in Step 3.
- Do **not** turn this into a review: no severity levels, no findings about the code. Code review
  belongs to `code-reviewer`.

## Related Skills

- `finish-task` — runs this pass as its non-blocking Step 2b, before the blocking gate.
- `commit` — committing the confirmed comment edits.
- `code-reviewer` — reviews the code; this skill reviews nothing but comments.
