/**
 * Generates NOTION_SETUP.md — manual setup instructions for Notion workspace
 * when automatic bootstrap via REST API is not available or fails.
 *
 * The generated file contains a ready-to-paste Claude Code prompt that uses
 * MCP Notion tools to perform the same operations automatically.
 */

/**
 * @param {object} opts
 * @param {string} opts.taskBoardId      — existing task-board DB id from config
 * @param {string} opts.parentPageId     — root page id where Epics DB should be created
 * @param {string} opts.tokenEnv         — env var name holding the Notion token
 * @param {string} [opts.epicsDbId]      — if already created, include it for reference
 * @returns {string}                     — markdown content for NOTION_SETUP.md
 */
export function generateFallbackPrompt({ taskBoardId, parentPageId, tokenEnv, epicsDbId }) {
  const epicsSection = epicsDbId
    ? `> Epics DB was partially created with id: \`${epicsDbId}\`\n> Skip Step 1 and proceed to Step 2.\n`
    : '';

  return `# Notion Setup — Manual Instructions

Automatic Notion bootstrap did not complete. Follow the steps below, or paste the
Claude Code prompt at the end of this file into a Claude Code session that has the
Notion MCP server configured.

${epicsSection}
## What needs to be done

### Step 1 — Create the Epics database

Create a new database called **Epics** as a child of page \`${parentPageId}\` with the
following properties:

| Property | Type | Options |
|---|---|---|
| Name | Title | — |
| Status | Select | Planned · Active · Completed |
| Goal | Rich text | — |
| Related Notion task | Relation → task-board | DB id: \`${taskBoardId}\` |

After creation, copy the new database id and add it to your config:
\`\`\`yaml
notion:
  epics_database_id: "<paste id here>"
\`\`\`

### Step 2 — Patch the task-board

Add the following properties to the existing task-board (\`${taskBoardId}\`):

| Property | Type |
|---|---|
| Epic | Relation → Epics DB (from Step 1) |
| Blocked by | Self-relation → task-board |

---

## Claude Code prompt (copy & paste into a session with Notion MCP)

\`\`\`
You have access to Notion MCP tools. Perform the following two operations:

1. Create a database called "Epics" as a child of page "${parentPageId}" with these properties:
   - Name (title)
   - Status (select): options Planned, Active, Completed
   - Goal (rich_text)
   - "Related Notion task" (relation to database "${taskBoardId}", single_property)

2. Update database "${taskBoardId}" to add:
   - "Epic" (relation to the Epics database created in step 1, single_property)
   - "Blocked by" (self-relation to database "${taskBoardId}", single_property)

After completing both operations, output the new Epics database id so I can add it
to spovishun-skills.config.yaml under notion.epics_database_id.

Use the Notion token from the environment variable ${tokenEnv}.
\`\`\`
`;
}
