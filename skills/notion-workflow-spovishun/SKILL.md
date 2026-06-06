# Notion Workflow — Project Orchestrator

Entry point for all Notion operations in this project. Routes to the correct skill, enforces REST-first hot path, and prevents duplicate MCP calls.

## Workflow

1. Fetch the targeted section of CLAUDE.md for the current operation (see commands below).
2. Identify the operation type and pick the matching row in the Decision Table.
3. If IDs are needed, use the `notion-navigator` skill — do not guess or recall IDs from memory.
4. Invoke the routed skill to complete the operation.

## CLAUDE.md Fetch Commands

Fetch silently before responding — no need to announce it:

```
node .claude/scripts/notion/get-claude-md.js --section commands       # architecture / commands
node .claude/scripts/notion/get-claude-md.js --section testing        # testing conventions
node .claude/scripts/notion/get-claude-md.js --section architecture   # source structure / layers
node .claude/scripts/notion/get-claude-md.js                          # full read — only when overview needed
```

Use targeted `--section` reads to load only the relevant part and save tokens.

## REST-first hot path

The start-task flow (`.claude/scripts/notion/*.js`) is 100% Notion REST via the project's HTTP client. Task content, status updates, and CLAUDE.md reads all happen through these scripts — no MCP is involved. The hook writes the result to `.dev-context/{branch}_prd/` and injects it via `additionalContext`.

**Do NOT add MCP calls to this path.** MCP is for operations the scripts cannot cover.

## MCP vs REST decision matrix

| Operation | Tool |
|---|---|
| Read task / board / CLAUDE.md (hot path) | `.claude/scripts/notion/*.js` (REST) |
| Update task status (hot path) | `.claude/scripts/notion/update-status.js` or hook PATCH |
| Archive / restore a throwaway page (cleanup) | `.claude/scripts/notion/archive-task.js <pageId> [--unarchive]` |
| Free-form semantic search across Notion | MCP `notion-search` |
| Create / update arbitrary page content | MCP via `notion-page-builder` skill |
| Create / query databases | MCP via `notion-database-manager` skill |
| Bulk doc sync | MCP via `update-doc-full` |

## Decision Table

| Operation | Skill |
|---|---|
| Task CRUD on project board | `notion-spovishun-task-manager` |
| Generic Kanban board operations | `notion-task-board-manager` |
| Create / update Notion pages | `notion-page-builder` |
| Search / read existing content | `notion-content-reader` |
| Create / query databases | `notion-database-manager` |
| Migrate external content | `notion-data-migrator` |
| Workspace structure / moves | `notion-workspace-organizer` |
| Workspace / category / collection IDs | `notion-navigator` |

## Do NOT

- Do NOT load `notion-navigator` unless an ID is actually needed — most operations go through the dedicated skill.
- Do NOT duplicate operations handled by a routed skill — delegate and do not re-implement.
- Do NOT hardcode IDs from memory — always look them up from `notion-navigator`.

## Error Handling

- If no row in the Decision Table matches, ask the user to clarify the operation type.
- If a reference file is missing, stop and report the exact path.
- If `node .claude/scripts/notion/get-claude-md.js` fails, check that `NOTION_API_TOKEN` is set in the environment.

## Related Skills

- `notion-navigator` — full workspace map with all category page IDs and collection IDs
- `notion-spovishun-task-manager` — task CRUD, status updates, board queries
- `notion-page-builder` — creating and updating Notion page content via MCP
