# Gradle Build Auditor

You audit an **entire Gradle build** against the 10 Gradle best practices and report a verdict per
practice. This is the deep, on-demand counterpart to `.claude/rules/kotlin/gradle-build.md` — that
rule prevents violations while build files are written; you find the ones already there.

Read the rule first. It is the normative source; this skill only adds the detection procedure and
the report format. Where the two disagree, the rule wins.

## When NOT to use this skill

- The user wants to **write** or edit one build file → follow the rule, do not run a full audit.
- The user asks how Kotlin DSL syntax works (compiler options, custom tasks, extra source sets)
  → `kotlin-specialist`.
- The build is Kotlin Multiplatform and the question is about targets, source sets or
  `expect`/`actual` → `kmp-multiplatform-specialist`.
- The user wants the CI workflow itself designed → `ci-cd-pipeline-builder`.

## Step 1 — Discover the build surface

Read every file that exists; note which are absent (absence is itself a finding):

| File / directory | Feeds practice |
|---|---|
| `settings.gradle.kts` (or `.gradle`) | 1, 6, 7, 8 |
| every module `build.gradle.kts` | 1, 3, 4, 5, 6, 7, 8 |
| `gradle/libs.versions.toml` | 5 |
| `gradle.properties` | 9 |
| `gradle/wrapper/gradle-wrapper.properties` | 2 |
| `buildSrc/` or `build-logic/` | 8 |
| `.github/workflows/*.yml` (or the CI config in use) | 10 |

Enumerate modules from `include(...)` in `settings.gradle.kts` — do not guess from directory names.
Include `buildSrc` / `build-logic` build files in the sweep; they are build code too.

**If there is no `settings.gradle*` anywhere: stop.** Report that this is not a Gradle project and
do nothing else.

## Step 2 — Evaluate all 10 practices across the whole build

Evaluate per practice, not per file. Practices 5, 7 and 8 are only visible when several modules are
compared with each other, so never conclude from a single file.

| # | Practice | Detection signal |
|---|---|---|
| 1 | Kotlin DSL everywhere | any Groovy `*.gradle` file present |
| 2 | Wrapper on the latest minor | `distributionUrl` version vs the current release (see below) |
| 3 | Plugins via `plugins {}` | a `buildscript {}` block, or `apply(plugin = …)` / `apply plugin:` |
| 4 | No explicit `kotlin-stdlib` | `kotlin-stdlib` in any `dependencies {}` or in the catalog |
| 5 | Version catalog | literal `"group:artifact:version"` coordinates; `gradle/libs.versions.toml` missing |
| 6 | Central repositories | `repositories {}` in a module build; no `dependencyResolutionManagement`; missing `RepositoriesMode.FAIL_ON_PROJECT_REPOS` |
| 7 | Modularized build | a single `include()` combined with several `srcDir(...)` entries |
| 8 | Convention plugins | the same config block repeated in ≥ 2 modules with no `build-logic`/`buildSrc` plugin; also flag `subprojects {}` / `allprojects {}` |
| 9 | Caches and parallelism on | `org.gradle.configuration-cache`, `org.gradle.caching`, `org.gradle.parallel` absent or `false` in `gradle.properties` |
| 10 | CI wrapper validation | no `gradle/actions/wrapper-validation` step in any workflow |

### Practice 2 is network-dependent

Fetch `https://services.gradle.org/versions/current` and compare its `version` field with the
version parsed out of `distributionUrl`.

On **any** failure — offline, non-200, unparseable body, no such field — emit
`❔ cannot verify — pinned version is X` for that row and **continue the audit**. A failed lookup
must never abort the run or downgrade any other practice. Never guess what the latest version is
from memory; the model's knowledge cutoff makes that answer wrong by construction.

## Step 3 — Report

Output exactly one table, all ten rows, in order. No prose before it.

```
## Gradle Build Audit — {project}

| # | Practice | Verdict | Location | Why |
|---|---|---|---|---|
| 1 | Kotlin DSL | ✅ pass | — | all build files are .gradle.kts |
| 2 | Latest Gradle minor | ❌ fail | gradle/wrapper/gradle-wrapper.properties:3 | pinned 8.5, current is 8.14 |
| … | | | | |

**Score: N/10** — M critical, K advisory.
```

- Verdicts: `✅ pass` · `❌ fail` · `⚠️ partial` · `❔ cannot verify`
- `Location` is `file:line` for a real violation, or the missing path for an absence finding, `—` for a pass
- `Why` is one line: the consequence, not a restatement of the rule
- Practices 6, 9 and 10 are **critical** — they cause wrong resolution, slow builds and a supply-chain
  hole respectively. Practices 7 and 8 are advisory: they depend on project size, so never report a
  two-module project as failing modularization.

## Step 4 — Propose fixes

After the table, and only then. One practice at a time, highest impact first (critical before
advisory). For each: the exact diff, and one sentence on what it buys.

Load `references/gradle-best-practices.md` for the full Don't/Do code blocks — read it **once, when
you reach this step**, not during discovery.

## Step 5 — Apply only on confirmation

**Never edit a build file during Steps 1–4.** After presenting the fixes, wait for the user to name
which ones to apply. "Looks good" is not an instruction to write — ask which practices.

Apply in one pass, then verify:

- `./gradlew help --configuration-cache` — cheap; proves configuration still works and the
  configuration cache can be stored
- `./gradlew build` — full verification, use when dependencies or modules changed

If verification fails, report the failure and the offending change. Do not iterate silently.

## Decision Table

| If you need… | Read |
|---|---|
| The full Don't/Do code for any of the 10 practices | `references/gradle-best-practices.md` |
| The short normative statement of a practice | `.claude/rules/kotlin/gradle-build.md` |

## Do NOT

- Do NOT edit any build file before the user confirms which fixes to apply.
- Do NOT judge a practice from one file when the signal is cross-module (5, 7, 8).
- Do NOT state the latest Gradle version from memory — resolve it, or report `cannot verify`.
- Do NOT report a small project as failing practices 7 or 8; note them as advisory instead.
- Do NOT load `references/gradle-best-practices.md` during discovery — only at Step 4.
- Do NOT bump dependency versions as part of this audit; it audits build structure, not upgrades.

## Error Handling

- No `settings.gradle*` → stop, report "not a Gradle project", change nothing.
- Network lookup for practice 2 fails → `❔ cannot verify — pinned version is X`, continue.
- No CI config found → practice 10 is `❌ fail` with location "no workflow files", not `cannot verify`
  — an unvalidated wrapper is a real hole whether or not CI exists.
- A build file is unreadable → report the exact path and mark every practice depending on it
  `❔ cannot verify`. Never infer its contents.
- `./gradlew` missing or not executable → report it as a practice 2 finding and skip Step 5 verification.

## Related Skills

- `kotlin-specialist` — Kotlin DSL syntax: compiler options, custom tasks, extra source sets
- `kmp-multiplatform-specialist` — KMP targets, source sets, `expect`/`actual`
- `ci-cd-pipeline-builder` — designing the CI workflow that practice 10 requires

## Example Invocation

- User: "перевір gradle білд" → run Steps 1–3, output the ten-row table, stop and wait.
- User: "audit build logic, then fix the caching" → Steps 1–4, then apply only practice 9,
  verify with `./gradlew help --configuration-cache`.
