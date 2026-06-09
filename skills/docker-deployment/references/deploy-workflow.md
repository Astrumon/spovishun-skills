# Deployment Workflow (low-RAM server)

For servers that cannot run `gradle build` inside Docker.
Strategy: **build locally → push to registry → server pulls and runs**.

## Build & Push (local machine)

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

## Deploy (on server)

```bash
ssh -i ~/.ssh/deploy_key ubuntu@{{DEPLOY_HOST}}
cd ~/{{DEPLOY_DIR}}
docker compose pull bot
docker compose up -d
```

## Verify

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
