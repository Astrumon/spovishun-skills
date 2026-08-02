'use strict';

const constants = require('./constants');

// Single source: hooks/notion-constants.js. The tier list and page size used to
// be declared here AND in the hook, under a "MUST stay in sync" comment and a
// guard test — which earned its keep when the hook grew a phantom 'Normal' tier.
const { PRIORITY_TIERS, PICKER_TIER_LIMIT } = require('../../../hooks/notion-constants.js');

// extraFilter (optional) is a single Notion filter object (e.g. a Board v2
// Stage filter) AND-combined with every tier query and the fallback query.
async function queryByPriorityTier(http, token, statusFilter, excludePageIds, extraFilter) {
  for (const tier of PRIORITY_TIERS) {
    const result = await http.post(token, `/v1/databases/${constants.DATABASE_ID}/query`, {
      filter: {
        and: [
          { property: 'Status', status: { equals: statusFilter } },
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

  const baseFilter = { property: 'Status', status: { equals: statusFilter } };
  const result = await http.post(token, `/v1/databases/${constants.DATABASE_ID}/query`, {
    filter: extraFilter ? { and: [baseFilter, extraFilter] } : baseFilter,
    page_size: PICKER_TIER_LIMIT
  });
  const candidates = (result?.results || []).filter(p => !excludePageIds.has(p.id.replace(/-/g, '')));
  return { candidates, tier: null };
}

module.exports = { queryByPriorityTier, PRIORITY_TIERS, PICKER_TIER_LIMIT };
