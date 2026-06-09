# Changelog Generator

## Overview

Use this skill to produce consistent, auditable release notes from Conventional Commits. Separates commit parsing, semantic bump logic, and changelog rendering.

## Core Capabilities

- Parse commit messages using Conventional Commit rules
- Detect semantic version bump (`major`, `minor`, `patch`) from commit stream
- Render Keep a Changelog sections (`Added`, `Changed`, `Fixed`, etc.)
- Enforce commit format discipline

## When to Use

- Before publishing a release tag
- During CI to generate release notes automatically
- When converting raw git history into user-facing notes

## Conventional Commit Rules

Supported types:
- `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`
- `security`, `deprecated`, `remove`

Breaking changes:
- `type(scope)!: summary`
- Footer/body includes `BREAKING CHANGE:`

SemVer mapping:
- breaking → `major`
- non-breaking `feat` → `minor`
- all others → `patch`

## Changelog Format (Keep a Changelog)

```markdown
# Changelog

## [Unreleased]

## [1.2.0] - 2026-03-22

### Added
- feat(bot): add /ping command for group mentions (#12)

### Fixed
- fix(db): resolve NPE when user not found in repository (#11)

### Changed
- refactor(service): extract notification logic into NotificationService

## [1.1.0] - 2026-03-01
...
```

## Manual Generation (git log)

```bash
# List commits for a range
git log v1.1.0..HEAD --pretty=format:"%s" --no-merges

# Group by type manually
git log v1.1.0..HEAD --pretty=format:"%s" --no-merges | grep "^feat"
git log v1.1.0..HEAD --pretty=format:"%s" --no-merges | grep "^fix"
```

## Common Pitfalls

1. Mixing merge commit messages with release commit parsing
2. Using vague commit summaries that cannot become release notes
3. Failing to include migration guidance for breaking changes
4. Treating `docs/chore` changes as user-facing features
5. Overwriting historical changelog sections instead of prepending

## Best Practices

1. Keep commits small and intent-driven
2. Scope commit messages (`feat(api): ...`) for multi-area repos
3. Review generated markdown before publishing
4. Tag releases only after changelog is approved
5. Keep an `[Unreleased]` section for manual curation

## Output Quality Checks

- Each bullet is user-meaningful, not implementation noise
- Breaking changes include migration action
- Security fixes are isolated in `Security` section
- Sections with no entries are omitted
- Duplicate bullets across sections are removed
