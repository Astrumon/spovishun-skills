'use strict';

// Preload (`node --require <this>`) that replaces https.request with a scripted
// stub, so hooks/notion-task-inject.js can be driven END TO END — real argv,
// real stdin, real exit codes, real files and git state — without a network.
//
// The hook's interesting paths (runPicker, applyPickMain, main) call
// process.exit() and are therefore untestable in-process: a failing assertion
// would take the test runner down with them. Driving the real CLI in a
// subprocess is what makes exit codes and the stdout directive assertable at
// all, and it keeps those tests indifferent to how the hook is split up
// internally — which is the whole point of writing them before the split.
//
// Env contract:
//   NOTION_STUB_FILE — JSON array of routes, each:
//       { method, path, status?, body?, nonJson?, timeout?, networkError? }
//     `path` is matched as a SUBSTRING of the request path. Routes are consumed
//     in declaration order; once every matching route is used the last one
//     repeats, so a single entry can answer an unbounded number of calls.
//   NOTION_STUB_LOG  — file to append one JSON line per request
//                      ({ method, path, body }) for assertions.

const fs = require('fs');
const https = require('https');
const { EventEmitter } = require('events');

// `node --test` globs everything under test/, this file included. Without its
// env contract there is nothing to stub, so stay inert instead of throwing —
// patching https for an unrelated process would be worse than doing nothing.
if (!process.env.NOTION_STUB_FILE) return;

const routes = JSON.parse(fs.readFileSync(process.env.NOTION_STUB_FILE, 'utf8'));
const logPath = process.env.NOTION_STUB_LOG || null;
const used = new Array(routes.length).fill(false);

function matchRoute(method, path) {
  const indexes = routes
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.method === method && path.includes(r.path));
  if (indexes.length === 0) return null;
  const fresh = indexes.find(({ i }) => !used[i]);
  const chosen = fresh || indexes[indexes.length - 1];
  used[chosen.i] = true;
  return chosen.r;
}

https.request = function stubbedRequest(options, onResponse) {
  const req = new EventEmitter();
  let payload = '';
  req.write = (chunk) => { payload += chunk; };
  req.destroy = (err) => { if (err) req.emit('error', err); };

  req.end = () => {
    if (logPath) {
      fs.appendFileSync(logPath, JSON.stringify({
        method: options.method,
        path: options.path,
        body: payload ? JSON.parse(payload) : null,
      }) + '\n', 'utf8');
    }

    const route = matchRoute(options.method, options.path);
    // An unrouted call is a test-authoring bug, not a Notion outage — surface it
    // as a transport error carrying the path so the failure names itself.
    if (!route) {
      setImmediate(() => req.emit('error', new Error(`notion-stub: no route for ${options.method} ${options.path}`)));
      return;
    }
    if (route.networkError) {
      setImmediate(() => req.emit('error', new Error(route.networkError)));
      return;
    }
    if (route.timeout) {
      setImmediate(() => req.emit('timeout'));
      return;
    }

    setImmediate(() => {
      const res = new EventEmitter();
      res.statusCode = route.status || 200;
      onResponse(res);
      res.emit('data', route.nonJson !== undefined ? route.nonJson : JSON.stringify(route.body ?? {}));
      res.emit('end');
    });
  };

  return req;
};
