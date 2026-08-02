import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { loadHookModule } from './helpers/hook-harness.js';

const require = createRequire(import.meta.url);

// notionRequest is the hook's whole transport layer, and its contract is subtle:
// it resolves parsed JSON for ANY status (Notion errors are structured bodies
// callers inspect) and rejects ONLY on transport failure — so an outage cannot
// masquerade as an empty board and get reported as "No Tasks Available".

/** Minimal `https` stand-in; drives whichever ending the scenario asks for. */
function fakeHttps(scenario) {
  const calls = [];
  return {
    calls,
    httpsImpl: {
      request(options, onResponse) {
        calls.push({ options, body: '' });
        const req = new EventEmitter();
        req.write = (chunk) => { calls[calls.length - 1].body += chunk; };
        req.destroy = (err) => { if (err) req.emit('error', err); };
        req.end = () => {
          if (scenario.networkError) {
            setImmediate(() => req.emit('error', new Error(scenario.networkError)));
            return;
          }
          if (scenario.timeout) {
            setImmediate(() => req.emit('timeout'));
            return;
          }
          setImmediate(() => {
            const res = new EventEmitter();
            res.statusCode = scenario.status ?? 200;
            onResponse(res);
            res.emit('data', scenario.raw ?? JSON.stringify(scenario.body ?? {}));
            res.emit('end');
          });
        };
        return req;
      },
    },
  };
}

// notionRequest's only ambient input is TOKEN_SOURCE, which hook-config resolves
// at require time — hence a fresh load per env.
function hookWith(env = {}) {
  return loadHookModule(require, { module: 'notion-api.js', env: { NOTION_TOKEN: 'tok', ...env } }).mod;
}

test('a successful response resolves as parsed JSON', async () => {
  const hook = hookWith();
  const { httpsImpl } = fakeHttps({ body: { object: 'list', results: [1, 2] } });
  const data = await hook.notionRequest('tok', 'GET', '/v1/pages/x', null, { httpsImpl });
  assert.deepEqual(data, { object: 'list', results: [1, 2] });
});

test('auth headers and Content-Length are set from the request itself', async () => {
  const hook = hookWith();
  const { httpsImpl, calls } = fakeHttps({ body: {} });
  const body = { filter: { property: 'Status' } };
  await hook.notionRequest('secret_abc', 'POST', '/v1/databases/db/query', body, { httpsImpl });

  const { options } = calls[0];
  assert.equal(options.hostname, 'api.notion.com');
  assert.equal(options.headers.Authorization, 'Bearer secret_abc');
  assert.equal(options.headers['Notion-Version'], '2022-06-28');
  assert.equal(options.headers['Content-Length'], Buffer.byteLength(JSON.stringify(body)));
  assert.equal(calls[0].body, JSON.stringify(body));
});

test('a GET with no body sends no Content-Length', async () => {
  const hook = hookWith();
  const { httpsImpl, calls } = fakeHttps({ body: {} });
  await hook.notionRequest('tok', 'GET', '/v1/pages/x', null, { httpsImpl });
  assert.equal(calls[0].options.headers['Content-Length'], undefined);
  assert.equal(calls[0].body, '');
});

test('a structured Notion error RESOLVES so callers can inspect it', async () => {
  const hook = hookWith();
  const { httpsImpl } = fakeHttps({
    status: 404,
    body: { object: 'error', code: 'object_not_found', message: 'nope' },
  });
  const data = await hook.notionRequest('tok', 'GET', '/v1/pages/x', null, { httpsImpl });
  assert.equal(data.object, 'error');
  assert.equal(data.code, 'object_not_found');
});

test('401 rejects and names the env var that supplied the token', async () => {
  const hook = hookWith({ NOTION_TOKEN: undefined, NOTION_SKILLS_TOKEN: 'stale' });
  const { httpsImpl } = fakeHttps({
    status: 401,
    body: { object: 'error', code: 'unauthorized', message: 'bad token' },
  });
  await assert.rejects(
    () => hook.notionRequest('stale', 'GET', '/v1/pages/x', null, { httpsImpl }),
    (err) => {
      assert.match(err.message, /auth failed \(HTTP 401 unauthorized\)/);
      assert.match(err.message, /token from NOTION_SKILLS_TOKEN/);
      return true;
    }
  );
});

test('403 rejects too — a permissionless integration is not an empty board', async () => {
  const hook = hookWith();
  const { httpsImpl } = fakeHttps({ status: 403, body: { object: 'error', code: 'restricted_resource' } });
  await assert.rejects(
    () => hook.notionRequest('tok', 'POST', '/v1/databases/db/query', {}, { httpsImpl }),
    /auth failed \(HTTP 403 restricted_resource\)/
  );
});

test('a non-JSON body rejects with the status and route', async () => {
  const hook = hookWith();
  const { httpsImpl } = fakeHttps({ status: 502, raw: '<html>bad gateway</html>' });
  await assert.rejects(
    () => hook.notionRequest('tok', 'GET', '/v1/pages/x', null, { httpsImpl }),
    /non-JSON response \(HTTP 502\) for GET \/v1\/pages\/x/
  );
});

test('a timeout rejects rather than hanging the hook', async () => {
  const hook = hookWith();
  const { httpsImpl } = fakeHttps({ timeout: true });
  await assert.rejects(
    () => hook.notionRequest('tok', 'GET', '/v1/pages/x', null, { httpsImpl }),
    /timed out after 30s: GET \/v1\/pages\/x/
  );
});

test('a socket error propagates unchanged', async () => {
  const hook = hookWith();
  const { httpsImpl } = fakeHttps({ networkError: 'ECONNRESET' });
  await assert.rejects(
    () => hook.notionRequest('tok', 'GET', '/v1/pages/x', null, { httpsImpl }),
    /ECONNRESET/
  );
});
