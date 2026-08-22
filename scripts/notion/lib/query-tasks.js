'use strict';

const constants = require('./constants');

// Single source: hooks/notion-constants.js. The tier list and page size used to
// be declared here AND in the hook, under a "MUST stay in sync" comment and a
// guard test — which earned its keep when the hook grew a phantom 'Normal' tier.
const { PRIORITY_TIERS, PICKER_TIER_LIMIT, TODO_GROUP_STATUSES } = require('../../../hooks/notion-constants.js');

// One status → a plain equals clause; several → an OR. Notion's status filter
// has no group condition, so a whole status group is expressed as an OR of its
// options. Shared with get-board.js so the CLI has exactly one Status clause.
function statusClause(status) {
  const names = Array.isArray(status) ? status : [status];
  const clauses = names.map(name => ({ property: 'Status', status: { equals: name } }));
  return clauses.length === 1 ? clauses[0] : { or: clauses };
}

// statusFilter is a status name or an array of them (a whole status group).
// extraFilter (optional) is a single Notion filter object (e.g. a Board v2
// Stage filter) AND-combined with every tier query and the fallback query.
async function queryByPriorityTier(http, token, statusFilter, excludePageIds, extraFilter) {
  const status = statusClause(statusFilter);
  for (const tier of PRIORITY_TIERS) {
    const result = await http.post(token, `/v1/databases/${constants.DATABASE_ID}/query`, {
      filter: {
        and: [
          status,
          { property: 'Priority', select: { equals: tier } },
          ...(extraFilter ? [extraFilter] : [])
        ]
      },
      sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
      page_size: PICKER_TIER_LIMIT
    });
    if (result?.object === 'error') continue;
    const candidates = (result?.results || []).filter(p => !excludePageIds.has(p.id.replace(/-/g, '')));
    if (candidates.length > 0) return { candidates, tier };
  }

  const result = await http.post(token, `/v1/databases/${constants.DATABASE_ID}/query`, {
    filter: extraFilter ? { and: [status, extraFilter] } : status,
    page_size: PICKER_TIER_LIMIT
  });
  const candidates = (result?.results || []).filter(p => !excludePageIds.has(p.id.replace(/-/g, '')));
  return { candidates, tier: null };
}

module.exports = { queryByPriorityTier, statusClause, PRIORITY_TIERS, PICKER_TIER_LIMIT, TODO_GROUP_STATUSES };
