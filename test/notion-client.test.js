import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notionRequest } from '../lib/notion-client.js';

function mockFetch(response) {
  return async (url, opts) => {
    mockFetch.lastCall = { url, opts };
    return response;
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'ERR',
    async json() {
      return body;
    },
  };
}

test('sends correct headers and method', async () => {
  const fetchImpl = mockFetch(jsonResponse(200, { object: 'user', id: 'u_1' }));
  const data = await notionRequest('GET', '/users/me', 'secret_abc', undefined, { fetchImpl });
  assert.equal(data.id, 'u_1');
  assert.equal(mockFetch.lastCall.url, 'https://api.notion.com/v1/users/me');
  assert.equal(mockFetch.lastCall.opts.method, 'GET');
  assert.equal(mockFetch.lastCall.opts.headers.Authorization, 'Bearer secret_abc');
  assert.equal(mockFetch.lastCall.opts.headers['Notion-Version'], '2022-06-28');
  assert.equal(mockFetch.lastCall.opts.body, undefined);
});

test('serializes body for POST', async () => {
  const fetchImpl = mockFetch(jsonResponse(200, { id: 'db_1' }));
  await notionRequest('POST', '/databases', 'tok', { title: 'x' }, { fetchImpl });
  assert.equal(mockFetch.lastCall.opts.method, 'POST');
  assert.equal(mockFetch.lastCall.opts.body, JSON.stringify({ title: 'x' }));
});

test('throws on non-2xx with status attached', async () => {
  const fetchImpl = mockFetch(jsonResponse(401, { message: 'API token is invalid' }));
  await assert.rejects(
    () => notionRequest('GET', '/users/me', 'bad', undefined, { fetchImpl }),
    (err) => {
      assert.equal(err.status, 401);
      assert.match(err.message, /401/);
      assert.match(err.message, /API token is invalid/);
      return true;
    }
  );
});

test('passes AbortSignal through to fetch', async () => {
  const fetchImpl = mockFetch(jsonResponse(200, {}));
  const controller = new AbortController();
  await notionRequest('GET', '/users/me', 'tok', undefined, { fetchImpl, signal: controller.signal });
  assert.equal(mockFetch.lastCall.opts.signal, controller.signal);
});
