const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

/**
 * Low-level Notion REST API request helper. Used by notion-bootstrap (write
 * operations during init) and doctor (read-only health pings). Throws on
 * non-2xx with a message that includes the Notion error body.
 *
 * @param {string}   method                — HTTP verb (GET/POST/PATCH/...)
 * @param {string}   path                  — request path starting with '/'
 * @param {string}   token                 — Notion integration secret
 * @param {object}   [body]                — request payload (JSON)
 * @param {object}   [opts]
 * @param {Function} [opts.fetchImpl]      — injectable fetch for tests (defaults to globalThis.fetch)
 * @param {AbortSignal} [opts.signal]      — optional AbortSignal for cancellation/timeout
 * @returns {Promise<object>}              — parsed JSON response body
 */
export async function notionRequest(method, path, token, body, opts = {}) {
  const { fetchImpl = globalThis.fetch, signal } = opts;
  const res = await fetchImpl(`${NOTION_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION,
      // Cloudflare in front of api.notion.com rejects requests with no
      // User-Agent (returns an HTML 403, not a JSON error body). Always send one.
      'User-Agent': 'spovishun-skills',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = data?.message ?? res.statusText;
    const err = new Error(`Notion API ${method} ${path} failed (${res.status}): ${msg}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export { NOTION_API, NOTION_VERSION };
