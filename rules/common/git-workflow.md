# Git Workflow Rules

## Commit Format
ALWAYS use Conventional Commits. Format: `type: short description`
- Lowercase, imperative mood, no trailing period, max 72 chars
- Allowed types: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`, `ci`, `build`, `perf`
- NEVER use vague messages like "fix", "update", "changes", "wip"
- Co-author line when Claude-assisted: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

## Branch Naming
Format: `{{GIT_BRANCH_PREFIX}}-{N}-short-slug`
- `{N}` = task number from your task tracker
- slug = max 3 words, kebab-case, describes the change
- NEVER branch directly from `main` — always from `{{GIT_DEV_BRANCH}}`
- NEVER work on `main` or `{{GIT_DEV_BRANCH}}` directly

## Pull Request Structure
Every PR MUST include all three sections:
1. **Goal** — what problem does this solve and why
2. **Changes** — what was changed and key decisions made
3. **Testing** — how was this verified (tests run, manual steps)

PRs missing any section MUST be updated before merge.

## General Rules
- NEVER force-push to `main` or `{{GIT_DEV_BRANCH}}`
- NEVER skip pre-commit hooks (`--no-verify`)
- NEVER commit `.env` files or files with secrets
- Prefer small, focused PRs over large omnibus changes
- One logical change per commit — squash WIP commits before PR
