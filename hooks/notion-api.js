'use strict';

// The hook's entire Notion transport. Kept separate from scripts/notion/lib/
// notion-http.js on purpose: hooks/ installs unconditionally, scripts/notion/
// only when stack.notion=true, so a hook may never require out of scripts/.
// The two also behave differently — this one rejects on 401/403, that one sends
// a User-Agent for the CLI. Only NOTION_VERSION is genuinely shared, and it is
// re-exported from here by scripts/notion/lib/constants.js.

const https = require('https');
const { TOKEN_SOURCE } = require('./hook-config.js');
const { NOTION_VERSION } = require('./notion-constants.js');

const REQUEST_TIMEOUT_MS = 30000;

/**
 * Turns a raw response body into the value notionRequest resolves with, or
 * throws the transport-level error it should reject with.
 *
 * A structured Notion error (`{ object: 'error' }`) is a RESULT, not a failure —
 * callers inspect it. The exception is 401/403: that body resolves with no
 * `results`, which would masquerade as an empty board and make the hook skip
 * silently, so it becomes an error naming the env var that supplied the token.
 */
function parseNotionBody(raw, statusCode, method, urlPath, tokenSource) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Notion API returned non-JSON response (HTTP ${statusCode}) for ${method} ${urlPath}`);
  }
  if (parsed && parsed.object === 'error' && (statusCode === 401 || statusCode === 403)) {
    throw new Error(
      `Notion API auth failed (HTTP ${statusCode} ${parsed.code}): token from ${tokenSource} is invalid or lacks access — unset a stale ${tokenSource} or fix its value.`
    );
  }
  return parsed;
}

/**
 * Resolves parsed JSON for any HTTP status. Rejects only on transport failure:
 * network error, timeout, non-JSON body, or the auth case above — so an API
 * outage surfaces as a logged error instead of an empty board.
 *
 * @param {object} [opts]
 * @param {object} [opts.httpsImpl]   injectable `https` for tests
 * @param {string} [opts.tokenSource] env var that supplied the token; named in
 *   auth errors so a stale NOTION_SKILLS_TOKEN is identifiable, not just "invalid"
 */
function notionRequest(token, method, urlPath, body, opts = {}) {
  const { httpsImpl = https, tokenSource = TOKEN_SOURCE } = opts;
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.notion.com',
      path: urlPath,
      method,
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);

    const req = httpsImpl.request(options, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try {
          resolve(parseNotionBody(raw, res.statusCode, method, urlPath, tokenSource));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error(`Notion API request timed out after ${REQUEST_TIMEOUT_MS / 1000}s: ${method} ${urlPath}`));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

module.exports = { notionRequest, parseNotionBody, NOTION_VERSION, REQUEST_TIMEOUT_MS };
