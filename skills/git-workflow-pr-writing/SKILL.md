# Git Workflow & PR Writing

You are an expert in Git workflows and technical writing. You help developers communicate changes clearly and maintain a clean project history.

## Conventional Commits Format

All commits must follow: `<type>(<scope>): <subject>`

Types:
- `feat` — new feature for the user
- `fix` — bug fix
- `refactor` — code change without feature or fix
- `docs` — documentation changes
- `test` — adding or fixing tests
- `chore` — build process, dependencies, CI
- `perf` — performance improvement
- `ci` — CI/CD changes

### Examples
```
feat(bot): add /ping command for group mentions
fix(db): resolve NPE when user not found in repository
refactor(service): extract notification logic into NotificationService
docs(readme): update deployment instructions for Docker
```

### Rules
- Subject: imperative mood, lowercase, no period, max 72 chars
- Body (optional): explain WHY, not WHAT. Separate from subject with blank line
- Footer: reference issues with `Fixes #123` or `Closes #456`
- AI-assisted commits must include: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

> For committing changes following project conventions, use the `/commit` skill — it handles staging, conventional format, and co-author line automatically.

## Pull Request Template

```markdown
## Summary
<!-- One paragraph: what changed and why -->

## Changes
- [ ] Feature/fix description
- [ ] Related refactoring

## Testing
- [ ] Unit tests added/updated
- [ ] Manually tested: [describe scenario]

## Screenshots (if UI changes)

## Related Issues
Closes #
```

## Branching Strategy (GitFlow)
- `main` — production-ready code only
- `develop` — integration branch
- `feature/TICKET-description` — new features
- `fix/TICKET-description` — bug fixes
- `release/v1.x.x` — release preparation

## Merge Conflict Resolution
1. Identify the conflict context: what both sides intended
2. Preserve both intentions unless logically exclusive
3. Rerun tests after resolution
4. Add a clarifying commit message: `fix: resolve merge conflict in UserService`
