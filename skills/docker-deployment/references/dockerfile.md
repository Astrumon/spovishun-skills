# Dockerfile & Environment

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
