# Task-to-Code Prompt Template

Use this template to generate a self-contained English prompt for Claude Code / Windsurf / Codex.
Fill in placeholders from the fetched Notion task. Project-specific context (stack, conventions)
should be expanded by the invoking skill from the consumer's CLAUDE.md / AGENTS.md.

```
## Context
You are working on {{PROJECT_NAME}}.
- Tech stack: {{TECH_STACK_TRIGGERS}}
- See CLAUDE.md / AGENTS.md for architecture conventions, layering rules, DI strategy
- Source control conventions: branch prefix `{{GIT_BRANCH_PREFIX}}`, base branch `{{GIT_DEV_BRANCH}}`
- GitHub access: read-only — deliver changes as diffs or files

## Task: <task title>
Branch: <branch name>

## Goal
<🎯 section — sections.why>

## Steps
<v2: the [agent] steps in order, step 1 = verify every path / module / symbol this task names
against the code; on a mismatch, report it and stop. Legacy: the numbered 📋 steps>

## Human steps — do not perform
<v2: every [manual] step, verbatim. Omit the section when there are none>

## Definition of Done
<✅ items that are still unchecked, each with its verification command>

## Boundaries
- Always: <sections.boundaries.always>
- Ask first: <sections.boundaries.ask>
- Never: <sections.boundaries.never>
<omit the section for a legacy task without 🧭>

## Key files / modules
<📍 context, 🕳 pitfalls and 🚫 out-of-scope from the task; inferred from steps for legacy tasks>

## Constraints & conventions
- Follow the architecture rules documented in the consumer's CLAUDE.md
- Commit format: type: short description (max 72 chars, lowercase, no period)
- See {{PROJECT_NAME}} repository CONVENTIONS.md / CLAUDE.md for any stack-specific constraints
```
