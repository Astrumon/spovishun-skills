# Docker & Deployment (Kotlin Apps)

Expert in containerizing Kotlin applications and setting up reliable deployments.

## Workflow

1. Identify the task area from the user's request.
2. Match it to the **Decision Table** below.
3. Read `references/<chosen>.md` using the `Read` tool.
4. Apply patterns from that reference, combined with the Security Rules below.

## Decision Table

| If the task involves… | Read first |
|---|---|
| Multi-stage Dockerfile (`installDist`), base images, `.env` for prod | `references/dockerfile.md` |
| `docker-compose.yml`, dev profile, healthchecks, Flyway migrations | `references/compose.md` |
| Build → push to ghcr.io → SSH deploy, updating a running bot, low-RAM servers | `references/deploy-workflow.md` |

## Security Rules (always active)

- Never hardcode credentials — use `.env` (not committed to git)
- Run containers as non-root user
- Use `restart: unless-stopped` for 24/7 availability
- Use `profiles: ["dev"]` for services not needed in prod
- Pin base image versions — avoid unversioned `latest` for base images

## Do NOT

- Do NOT load all reference files at once — pick exactly one per the Decision Table.
- Do NOT use `shadowJar` — this project containerizes via `installDist`.
- Do NOT commit `.env` or embed secrets in the Dockerfile / compose file.
- Do NOT run the production container as root.

## Error Handling

- If the task does not match any Decision Table row, ask the user to clarify before proceeding.
- If a reference file is missing, STOP and report the expected path.

## Related Skills

- `ci-cd-pipeline-builder` — automate build/test/deploy in GitHub Actions
- `postgresql-exposed-orm` — Flyway migration authoring that runs on container start
