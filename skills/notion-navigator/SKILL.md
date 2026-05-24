# Notion Navigator — Workspace Map

Reference map of the project's Notion workspace. Use this skill to instantly find the correct page when creating, updating, or linking documentation. Load silently before any Notion write operation.

## Decision Table: Where to Put New Documentation

New documentation articles are created as records in the category inline database (not as standalone pages).

| I want to document... | Category | Group Page ID |
|-----------------------|----------|--------------|
| New architecture pattern, design decision, layer change | Architecture | `{{NOTION_CATEGORY_ARCHITECTURE_ID}}` |
| Tech stack change, new dependency, code convention | Architecture | `{{NOTION_CATEGORY_ARCHITECTURE_ID}}` |
| New DB table, schema change, ORM update | Database | `{{NOTION_CATEGORY_DATABASE_ID}}` |
| Database migration workflow, DB setup | Database | `{{NOTION_CATEGORY_DATABASE_ID}}` |
| E2E test setup, integration test infrastructure | Testing | `{{NOTION_CATEGORY_TESTING_ID}}` |
| GitHub Actions workflow, CI pipeline, repo setup | CI/CD | `{{NOTION_CATEGORY_CICD_ID}}` |
| New user-facing feature (new command, scheduler, behaviour change) | Features | `{{NOTION_CATEGORY_FEATURES_ID}}` |
| New or updated skill, hook, agent, rule in .claude/ | AI Tools | `{{NOTION_CATEGORY_AITOOLS_ID}}` |
| Idea planning pipeline, Claude Code guides | AI Tools | `{{NOTION_CATEGORY_AITOOLS_ID}}` |
| New Epic (multi-task initiative description) | Epics | `{{NOTION_CATEGORY_EPICS_ID}}` |
| Learning resources, reference links | Other/Learning | fetch from workspace root |
| General project rules (for AI or devs) | CLAUDE.md | `{{NOTION_CLAUDE_MD_PAGE_ID}}` |

## Critical Rules

- NEVER create a standalone page — new documentation is a record in the category inline database
- NEVER hardcode IDs from memory — use this map; IDs here are verified against live Notion
- To add a doc article: create a new page in the inline DB of the matching category group page
- When a topic spans multiple categories: create one article in the primary category and mention it from the other

<details>
<summary>Extended: full workspace map, board collection, refresh workflow</summary>

## Workspace Root

Fetch via `notion-fetch` using the workspace root URL to discover top-level structure.

Key resources:
- Board (task kanban) — fetched via `{{NOTION_BOARD_COLLECTION_ID}}`
- Epics database — fetched via `{{NOTION_EPICS_DATA_SOURCE_ID}}`
- CLAUDE.md — `{{NOTION_CLAUDE_MD_PAGE_ID}}`

## When to Refresh

Refresh when: new Notion page was created, user mentions an unknown page, or user explicitly asks to refresh/sync the navigator.

## Refresh Workflow

### Step 1: Fetch live structure
```
notion-fetch(id: "<workspace root URL>")
notion-fetch(id: "<documentation root URL>")
```

### Step 2: Compare
For every page URL entry returned:
- Extract title and ID
- Check if it already exists in the map; if missing — add it; if title changed — update; if no longer in Notion — mark as removed

### Step 3: Update this file
Rewrite only changed rows/sections using the Edit tool. Update `last_verified` in frontmatter.

### Step 4: Confirm
Report: "Updated: +N new, ~M changed, -K removed pages."

</details>
