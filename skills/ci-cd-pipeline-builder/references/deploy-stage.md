# Deploy Stage (production gate)

Separate deploy job, gated on `main` and a protected `production` environment
(requires manual approval in GitHub repo settings) and `needs: build` so it only
runs after CI is green.

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
