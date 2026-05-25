/**
 * Bootstraps Notion workspace for a new project installation.
 *
 * Uses Notion REST API directly (no MCP or external SDK) to:
 *   1. Create an Epics database under a given parent page.
 *   2. Patch the existing task-board database with relation properties.
 *
 * Requires a valid Notion integration token with write access to the parent page
 * and the task-board database.
 */

import { notionRequest } from './notion-client.js';

/**
 * Creates the Epics database as a child of parentPageId.
 *
 * Schema:
 *   - Name (title)
 *   - Status (select: Planned / Active / Completed)
 *   - Goal (rich_text)
 *   - Related Notion task (relation → taskBoardId)
 *
 * @param {string} token         — Notion integration token
 * @param {string} parentPageId  — page that will contain the Epics DB
 * @param {string} taskBoardId   — existing task-board DB id for the relation property
 * @returns {Promise<string>}    — created Epics DB id (UUID without dashes)
 */
export async function createEpicsDatabase(token, parentPageId, taskBoardId) {
  const db = await notionRequest('POST', '/databases', token, {
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: 'Epics' } }],
    properties: {
      Name: { title: {} },
      Status: {
        select: {
          options: [
            { name: 'Planned', color: 'gray' },
            { name: 'Active', color: 'blue' },
            { name: 'Completed', color: 'green' },
          ],
        },
      },
      Goal: { rich_text: {} },
      'Related Notion task': {
        relation: {
          database_id: taskBoardId,
          single_property: {},
        },
      },
    },
  });

  return db.id.replace(/-/g, '');
}

/**
 * Adds relation properties to an existing task-board database:
 *   - Epic → relation to epicsDbId (single)
 *   - Blocked by → self-relation (single)
 *
 * @param {string} token        — Notion integration token
 * @param {string} taskBoardId  — task-board DB id to patch
 * @param {string} epicsDbId    — Epics DB id returned by createEpicsDatabase()
 * @returns {Promise<void>}
 */
export async function patchTaskBoardWithRelations(token, taskBoardId, epicsDbId) {
  await notionRequest('PATCH', `/databases/${taskBoardId}`, token, {
    properties: {
      Epic: {
        relation: {
          database_id: epicsDbId,
          single_property: {},
        },
      },
      'Blocked by': {
        relation: {
          database_id: taskBoardId,
          single_property: {},
        },
      },
    },
  });
}

/**
 * Full bootstrap: creates Epics DB and patches task-board.
 * Returns the new epicsDbId on success.
 *
 * @param {object} opts
 * @param {string} opts.token         — Notion integration token value
 * @param {string} opts.parentPageId  — parent page for Epics DB
 * @param {string} opts.taskBoardId   — existing task-board DB id
 * @returns {Promise<{epicsDbId: string}>}
 */
export async function bootstrapNotion({ token, parentPageId, taskBoardId }) {
  const epicsDbId = await createEpicsDatabase(token, parentPageId, taskBoardId);
  await patchTaskBoardWithRelations(token, taskBoardId, epicsDbId);
  return { epicsDbId };
}
