# Docker & Deployment (Kotlin Apps)

You are an expert in containerizing Kotlin applications and setting up reliable deployments.

## Dockerfile (Multi-stage, installDist)

This project uses `installDist` (not `shadowJar`) — produces a distribution directory with a launch script.

```dockerfile
# Stage 1: Build
FROM eclipse-temurin:21-jdk-alpine AS builder

WORKDIR /app

# Cache dependency layer
COPY gradlew .
COPY gradle/ gradle/
COPY build.gradle.kts settings.gradle.kts gradle.properties ./
COPY buildSrc/ buildSrc/

RUN sed -i 's/\r$//' gradlew && chmod +x gradlew && ./gradlew dependencies --no-daemon

COPY src/ src/
RUN ./gradlew installDist --no-daemon

# Stage 2: Runtime
FROM eclipse-temurin:21-jre-alpine AS runtime

WORKDIR /app
COPY --from=builder /app/build/install/{{PROJECT_NAME}}/ ./

RUN addgroup -S app && adduser -S app -G app
USER app

ENTRYPOINT ["./bin/{{PROJECT_NAME}}"]
```

## docker-compose.yml (Prod — no local DB)

For production, the bot connects to a cloud DB. No local postgres needed in prod.

```yaml
services:
  bot:
    image: {{DOCKER_IMAGE}}:latest
    container_name: {{PROJECT_NAME}}-bot
    env_file: .env
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    container_name: {{PROJECT_NAME}}-db
    profiles: ["dev"]   # only starts with: docker compose --profile dev up
    environment:
      POSTGRES_DB: {{PROJECT_NAME}}_dev
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${DEV_DATABASE_PASSWORD}
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d {{PROJECT_NAME}}_dev"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  pgdata:
```

## .env (prod)

```env
TELEGRAM_BOT_TOKEN=<token>
ADMINS=<id1,id2>
PROFILE=prod
PROD_DATABASE_URL=jdbc:postgresql://ep-xxx.region.aws.neon.tech/neondb?sslmode=require
PROD_DATABASE_DRIVER=org.postgresql.Driver
PROD_DATABASE_USERNAME=neondb_owner
PROD_DATABASE_PASSWORD=<password>
PROD_DATABASE_POOL_SIZE=5
```

## Deployment Workflow (low-RAM server)

For servers that cannot run `gradle build` inside Docker.
Strategy: **build locally → push to registry → server pulls and runs**.

### Build & Push (local machine)

```bash
docker build -t {{DOCKER_IMAGE}}:latest .
docker push {{DOCKER_IMAGE}}:latest
```

Requires prior login:
```bash
echo <PAT> | docker login ghcr.io -u <username> --password-stdin
```

PAT scopes required: `write:packages`, `read:packages`.
Image name MUST be lowercase — ghcr.io enforces this.

### Deploy (on server)

```bash
ssh -i ~/.ssh/deploy_key ubuntu@{{DEPLOY_HOST}}
cd ~/{{DEPLOY_DIR}}
docker compose pull bot
docker compose up -d
```

### Verify

```bash
docker compose ps
docker compose logs --tail=50 bot
```

## Updating the Bot

Every new release:

1. **Local:** build and push new image
   ```bash
   docker build -t {{DOCKER_IMAGE}}:latest .
   docker push {{DOCKER_IMAGE}}:latest
   ```

2. **Server:** pull and restart
   ```bash
   cd ~/{{DEPLOY_DIR}}
   docker compose pull bot
   docker compose up -d
   ```

Downtime: ~2-5 seconds.

## Flyway Migrations

Migrations run automatically on container start — no manual steps needed.
Add new migration files under `src/main/resources/db/migration/postgresql/`, deploy new image, done.

## Security Rules
- Never hardcode credentials — use `.env` (not committed to git)
- Run containers as non-root user
- Use `restart: unless-stopped` for 24/7 availability
- Use `profiles: ["dev"]` for services not needed in prod
- Pin base image versions — avoid unversioned `latest` for base images
