'use strict';

const http = require('./notion-http');
const { richText } = require('./format-task');

async function fetchTitle(token, pageId) {
  const page = await http.get(token, `/v1/pages/${pageId}`);
  if (!page || page.object === 'error') return null;
  const titleProp = Object.values(page.properties || {}).find(p => p?.type === 'title');
  return titleProp ? richText(titleProp.title) : null;
}

async function resolveRelationIds(token, ids) {
  if (!ids || ids.length === 0) return new Map();
  const unique = [...new Set(ids)];
  const results = await Promise.all(unique.map(id => fetchTitle(token, id).then(title => [id, title])));
  return new Map(results);
}

function extractRelationIds(property) {
  if (!property || property.type !== 'relation') return [];
  return (property.relation || []).map(r => r.id);
}

module.exports = { resolveRelationIds, extractRelationIds, fetchTitle };
