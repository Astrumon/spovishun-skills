'use strict';

const https = require('https');
const { NOTION_VERSION } = require('./constants');

// Prevents a hung socket from blocking a CLI script forever.
const REQUEST_TIMEOUT_MS = 30000;

// Resolves with the parsed JSON body for ANY status code — Notion returns
// structured `{ object: 'error', ... }` bodies that callers already handle.
// Rejects only on transport problems: network error, timeout, or a non-JSON
// body (proxy HTML page, truncated response). Rejecting instead of resolving
// null keeps an API outage from masquerading as an empty board.
function request(token, method, apiPath, body, opts = {}) {
  const { httpsImpl = https } = opts;
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.notion.com',
      path: apiPath,
      method,
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
        // Cloudflare in front of api.notion.com rejects requests with no
        // User-Agent (returns an HTML 403, not a JSON error body). Always send one.
        'User-Agent': 'spovishun-skills-notion-cli',
        ...(bodyStr && { 'Content-Length': Buffer.byteLength(bodyStr) })
      }
    };

    const req = httpsImpl.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Notion API returned non-JSON response (HTTP ${res.statusCode}) for ${method} ${apiPath}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Notion API request timed out after ${REQUEST_TIMEOUT_MS / 1000}s: ${method} ${apiPath}`));
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/**
 * Adapts this transport to the callback lib/block-tree.js expects. The walker
 * stays transport-agnostic so hooks/ and scripts/notion/ can share one copy of
 * the pagination + recursion without sharing an HTTP layer — hooks/notion-api.js
 * carries the mirror of this function for its own transport.
 *
 * It lives here rather than in a call site because get-task.js and
 * get-claude-md.js both need it.
 */
function childrenPageFetcher(token, opts) {
  return (blockId, cursor) => {
    const cursorParam = cursor ? `&start_cursor=${cursor}` : '';
    return request(token, 'GET', `/v1/blocks/${blockId}/children?page_size=100${cursorParam}`, null, opts);
  };
}

module.exports = {
  request,
  childrenPageFetcher,
  get:   (token, apiPath, opts)        => request(token, 'GET',   apiPath, null, opts),
  post:  (token, apiPath, body, opts)  => request(token, 'POST',  apiPath, body, opts),
  patch: (token, apiPath, body, opts)  => request(token, 'PATCH', apiPath, body, opts),
};
