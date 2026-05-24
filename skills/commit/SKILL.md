---
name: commit
description: Use this skill to commit staged or all current changes following project conventions. Invoke with `/commit` or `/commit -m "message"`. Triggers on "закоміть", "commit", "зроби коміт".
user_invocable: true
---

# Commit Skill

You are a Git commit assistant for the {{PROJECT_NAME}} project. Follow project conventions from CLAUDE.md strictly.

## Commit Convention

Format: `type: short description` — lowercase English, no trailing period, max 72 chars, imperative mood.

Types: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`, `ci`, `build`, `perf`

## Procedure

1. Run `git status` and `git diff --stat HEAD` in parallel to understand current changes.
2. If there are no changes to commit, inform the user and stop.
3. Analyze ALL changes (staged + unstaged + untracked relevant files) to determine:
   - The correct commit `type` based on the nature of changes
   - A concise subject line describing the "why" not the "what"
4. Stage all relevant files individually (never use `git add -A` or `git add .`). Do NOT stage `.env`, credentials, or other sensitive files.
5. Create the commit using a HEREDOC for the message:
   - First line: `type: short description` (max 72 chars, imperative, lowercase, no period)
   - If the change is non-trivial, add a blank line and a body with bullet points explaining key changes
6. Run `git status` after the commit to verify success.

## Arguments

- If the user provides `-m "message"`, use that message as the subject line (still validate format).
- If no arguments, auto-generate the commit message from the diff analysis.

## Rules

- NEVER amend existing commits unless explicitly asked
- NEVER push unless explicitly asked
- NEVER use `--no-verify`
- NEVER commit files that contain secrets
- If pre-commit hook fails, fix the issue and create a NEW commit
- Use specific file names in `git add`, not wildcards
- Pass commit messages via HEREDOC for correct formatting
