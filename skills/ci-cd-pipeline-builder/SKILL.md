---
name: "ci-cd-pipeline-builder"
description: Use this skill when setting up or improving CI/CD pipelines for Kotlin projects. Triggers on "GitHub Actions", "CI pipeline", "build workflow", "deploy automation", or "continuous integration" questions.
---

# CI/CD Pipeline Builder

## Overview

Generate pragmatic CI/CD pipelines from detected project stack signals. Focus on fast baseline generation, repeatable checks, and environment-aware deployment stages.

## Core Capabilities

- Recommend CI stages (`lint`, `test`, `build`, `deploy`)
- Generate GitHub Actions or GitLab CI starter pipelines
- Include caching and matrix strategy based on detected stack
- Keep pipeline logic aligned with project lockfiles and build commands

## When to Use

- Bootstrapping CI for a new repository
- Replacing brittle copied pipeline files
- Auditing whether pipeline steps match actual stack
- Creating a reproducible baseline before custom hardening

## GitHub Actions — Kotlin / Gradle

```yaml
name: CI
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-java@v4
        with:
          java-version: '21'
          distribution: 'temurin'

      - name: Cache Gradle packages
        uses: actions/cache@v4
        with:
          path: |
            ~/.gradle/caches
            ~/.gradle/wrapper
          key: ${{ runner.os }}-gradle-${{ hashFiles('**/*.gradle.kts', '**/libs.versions.toml') }}
          restore-keys: ${{ runner.os }}-gradle-

      - name: Run tests
        run: ./gradlew test --no-daemon

      - name: Build JAR
        run: ./gradlew shadowJar --no-daemon

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-results
          path: build/reports/tests/
```

## Deploy Stage (production gate)

```yaml
  deploy:
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/main'
    environment: production     # requires manual approval in GitHub settings

    steps:
      - uses: actions/checkout@v4
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /app/{{PROJECT_NAME}}
            docker compose pull
            docker compose up -d --force-recreate
```

## Common Pitfalls

1. Copying a Node pipeline into Kotlin/Gradle repos
2. Enabling deploy jobs before stable tests
3. Forgetting Gradle cache keys — results in slow builds every run
4. Running matrix builds for every trivial branch push
5. Hardcoding secrets in YAML instead of GitHub Secrets

## Best Practices

1. Start with CI only (`lint/test/build`), add deployment stages later
2. Cache Gradle wrapper + caches keyed on `*.gradle.kts` + `libs.versions.toml`
3. Require green CI before deployment jobs (`needs: build`)
4. Use protected environments with approval gates for production
5. Separate deploy jobs from CI jobs to keep feedback fast
6. Track pipeline duration — if >10 min, split into parallel jobs

## Validation Checklist

1. Generated YAML parses successfully (`act` for local testing)
2. All referenced commands exist in the repo (`./gradlew tasks`)
3. Cache strategy matches package manager (Gradle)
4. Required secrets are documented, not embedded in YAML
5. Branch protection rules match org policy
