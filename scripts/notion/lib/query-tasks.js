'use strict';

const constants = require('./constants');

const PRIORITY_TIERS = ['High', 'Medium', 'Low'];
const PICKER_TIER_LIMIT = 5;

async function queryByPriorityTier(http, token, statusFilter, excludePageIds) {
  for (const tier of PRIORITY_TIERS) {
    const result = await http.post(token, `/v1/databases/${constants.DATABASE_ID}/query`, {
      filter: {
        and: [
          { property: 'Status', status: { equals: statusFilter } },
          { property: 'Priority', select: { equals: tier } }
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
    filter: { property: 'Status', status: { equals: statusFilter } },
    page_size: PICKER_TIER_LIMIT
  });
  const candidates = (result?.results || []).filter(p => !excludePageIds.has(p.id.replace(/-/g, '')));
  return { candidates, tier: null };
}

module.exports = { queryByPriorityTier, PRIORITY_TIERS, PICKER_TIER_LIMIT };
