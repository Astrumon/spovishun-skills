'use strict';

const https = require('https');
const { NOTION_VERSION } = require('./constants');

function request(token, method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.notion.com',
      path: apiPath,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
        ...(bodyStr && { 'Content-Length': Buffer.byteLength(bodyStr) })
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

module.exports = {
  request,
  get:   (token, apiPath)        => request(token, 'GET',   apiPath, null),
  post:  (token, apiPath, body)  => request(token, 'POST',  apiPath, body),
  patch: (token, apiPath, body)  => request(token, 'PATCH', apiPath, body),
};
