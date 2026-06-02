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
<goal from 🎯 section>

## Steps
<numbered steps from 📋 section>

## Definition of Done
<DoD from ✅ section>

## Key files / modules
<inferred from steps and architecture>

## Constraints & conventions
- Follow the architecture rules documented in the consumer's CLAUDE.md
- Commit format: type: short description (max 72 chars, lowercase, no period)
- See {{PROJECT_NAME}} repository CONVENTIONS.md / CLAUDE.md for any stack-specific constraints
```
