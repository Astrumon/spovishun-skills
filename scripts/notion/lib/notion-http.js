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

module.exports = {
  request,
  get:   (token, apiPath, opts)        => request(token, 'GET',   apiPath, null, opts),
  post:  (token, apiPath, body, opts)  => request(token, 'POST',  apiPath, body, opts),
  patch: (token, apiPath, body, opts)  => request(token, 'PATCH', apiPath, body, opts),
};
