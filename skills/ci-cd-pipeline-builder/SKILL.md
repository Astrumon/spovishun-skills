# CI/CD Pipeline Builder

Generate pragmatic CI/CD pipelines for Kotlin/Gradle projects from detected stack signals — fast baseline, repeatable checks, environment-aware deploy.

## Workflow

1. Identify whether the task is CI (lint/test/build) or deployment.
2. Match it to the **Decision Table** below.
3. Read `references/<chosen>.md` using the `Read` tool.
4. Apply the snippet, combined with the Best Practices below.

## Decision Table

| If the task involves… | Read first |
|---|---|
| Build/test workflow, Gradle caching, test artifacts, matrix strategy | `references/github-actions-ci.md` |
| Production deploy job, SSH deploy, approval gate, `needs: build` | `references/deploy-stage.md` |

## Best Practices (always active)

1. Start with CI only (`lint/test/build`), add deployment stages later.
2. Cache Gradle wrapper + caches keyed on `*.gradle.kts` + `libs.versions.toml`.
3. Require green CI before deployment jobs (`needs: build`).
4. Use protected environments with approval gates for production.
5. Keep deploy jobs separate from CI jobs to keep feedback fast.
6. Track pipeline duration — if >10 min, split into parallel jobs.

## Validation Checklist

1. Generated YAML parses successfully (`act` for local testing).
2. All referenced commands exist in the repo (`./gradlew tasks`).
3. Cache strategy matches the package manager (Gradle).
4. Required secrets are documented, not embedded in YAML.
5. Branch protection rules match org policy.

## Do NOT

- Do NOT load both reference files unless the task spans CI and deploy.
- Do NOT copy a Node/npm pipeline into a Kotlin/Gradle repo.
- Do NOT enable deploy jobs before tests are stable.
- Do NOT hardcode secrets in YAML — use GitHub Secrets.
- Do NOT run matrix builds for every trivial branch push.

## Related Skills

- `docker-deployment` — the image build + SSH deploy target the deploy stage drives
- `git-workflow-pr-writing` — branch protection and PR conventions that gate CI
