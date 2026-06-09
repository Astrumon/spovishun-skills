# docker-compose & Flyway Migrations

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

## Flyway Migrations

Migrations run automatically on container start — no manual steps needed.
Add new migration files under `src/main/resources/db/migration/postgresql/`, deploy new image, done.
