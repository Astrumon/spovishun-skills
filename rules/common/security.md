# Security Rules

## Secrets
- NEVER hardcode secrets, tokens, passwords, or API keys in source code
- NEVER commit `.env` files — they belong in `.gitignore`
- ALL secrets must be loaded via environment variables at runtime
- NEVER store secrets in comments, docs, or test fixtures

## Logging
- NEVER log user-identifiable data (user IDs, tokens, emails, phone numbers)
- NEVER log raw request/response bodies that may contain credentials
- Log only anonymized identifiers (e.g., action type, command name) for debugging

## Input Handling
- NEVER pass user input directly to shell commands (no command injection)
- NEVER use user input in SQL string concatenation (use parameterized queries)
- Validate and sanitize all external input at system boundaries

## On Finding a Secret
If a secret is found in source code or a staged file:
1. STOP immediately — do not proceed with the current task
2. Report the finding to the user with the exact file and line
3. Do NOT commit, push, or suggest any action that would preserve the secret
4. Wait for the user to remove and rotate the secret before continuing
