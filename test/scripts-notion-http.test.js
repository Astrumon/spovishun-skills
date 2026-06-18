import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// scripts/notion/lib/notion-http.js is CommonJS. request() accepts an optional
// { httpsImpl } so the header construction can be asserted without a real socket.
const notionHttp = require(join(here, '..', 'scripts', 'notion', 'lib', 'notion-http.js'));

// Fake `https` whose .request() captures the options and feeds back a JSON body.
function fakeHttps(responseBody) {
  const calls = [];
  const httpsImpl = {
    request(options, onResponse) {
      calls.push(options);
      const req = new EventEmitter();
      req.write = () => {};
      req.end = () => {
        const res = new EventEmitter();
        res.statusCode = 200;
        onResponse(res);
        res.emit('data', JSON.stringify(responseBody));
        res.emit('end');
      };
      req.destroy = () => {};
      return req;
    },
  };
  return { httpsImpl, calls };
}

test('GET sends a User-Agent header alongside auth headers', async () => {
  const { httpsImpl, calls } = fakeHttps({ object: 'list', results: [] });
  const data = await notionHttp.get('secret_abc', '/v1/databases/x/query', { httpsImpl });

  assert.deepEqual(data, { object: 'list', results: [] });
  assert.equal(calls.length, 1);
  const { headers } = calls[0];
  assert.equal(headers['User-Agent'], 'spovishun-skills-notion-cli');
  assert.equal(headers.Authorization, 'Bearer secret_abc');
  assert.equal(headers['Notion-Version'], '2022-06-28');
  assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(headers['Content-Length'], undefined);
});

test('POST sets Content-Length and keeps the User-Agent header', async () => {
  const { httpsImpl, calls } = fakeHttps({ id: 'page_1' });
  const body = { parent: { database_id: 'db' } };
  await notionHttp.post('tok', '/v1/pages', body, { httpsImpl });

  const { headers } = calls[0];
  assert.equal(headers['User-Agent'], 'spovishun-skills-notion-cli');
  assert.equal(headers['Content-Length'], Buffer.byteLength(JSON.stringify(body)));
});
