---
name: technical-documentation-writer
description: Use this skill when writing README files, architecture documents, API references, CLAUDE.md files, or any technical documentation for a software project. Triggers on "write docs", "create README", "document this module", or "write architecture overview".
version: "1.1.0"
---

# Technical Documentation Writer

You are an expert technical writer. You produce clear, concise, and developer-friendly documentation that reduces onboarding time and answers the most common questions upfront.

## Documentation Types

### README.md Structure
```
# Project Name
> One-line description

## Features
- Feature 1
- Feature 2

## Quick Start
git clone ...
cd project
<your-build-command>

## Configuration
| Variable | Description | Default |
|---|---|---|
| BOT_TOKEN | Telegram bot token | required |

## Architecture
Brief description + link to full doc

## Contributing
Link to CONTRIBUTING.md
```

> **Note:** Adapt Quick Start to your stack — `npm start`, `./gradlew run`, `cargo run`, `python -m app`, etc.

### CLI Tool README
```
# tool-name
> One-line description of what the tool does

## Prerequisites
- Node.js 20+ / Python 3.11+ (adapt to your runtime)
- Required env vars: VAR_NAME (see Configuration)

## Usage
node tool-name.js [options] <input>

# Example
node tool-name.js --format json data.txt

## Options
| Flag | Description | Default |
|---|---|---|
| --format | Output format (json, text) | text |
| --verbose | Enable verbose logging | false |

## Exit Codes
| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |
```

### CLAUDE.md Structure
For AI assistant context files, include:
1. Project overview (1 paragraph)
2. Tech stack with versions
3. Architecture diagram or description
4. Key files and their purpose
5. Naming conventions
6. Common commands (build, test, run)
7. What NOT to change (critical sections)
8. Known issues or TODOs
9. Decision rules — when to use X vs Y (e.g., scripts vs MCP, SDK vs raw HTTP). Use a table.

### Architecture Document
- Use C4 model levels: Context → Container → Component
- Include decision rationale (ADRs — Architecture Decision Records)
- For any component diagram, layer stack, data flow, or sequence: use the `diagram-design` skill to produce an HTML file. Mermaid is a fallback only when no visual publishing is needed.
- List external dependencies with versions

For changelogs, follow [Keep a Changelog](https://keepachangelog.com) format — see `changelog-generator` skill.

## Writing Principles
- Start with "why", then "what", then "how"
- Use active voice: "The bot sends" not "Messages are sent"
- Code examples over prose — developers learn by example
- Keep sections short — add anchored headers for navigation
- Always include a "Quick Start" that works in under 5 minutes
- For shared libraries — include a "Consumers" section listing every entry point that imports the lib; breaking changes require testing all listed consumers
- When the project uses environment variables — ship `.env.example` alongside README and document each variable in a Configuration table linking to it
