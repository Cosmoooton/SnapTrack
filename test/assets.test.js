const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const assets = require('../src/config/assets');

test('Versionierte Dateien erhalten browsergeeignete MIME-Typen und Cache-Header', async () => {
  const app = express();
  for (const asset of assets.content) app.get(`${assets.base}/${asset.url}`, assets.serve(asset));
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  try {
    for (const [file, mime] of [['css/style.css', 'text/css'], ['js/scores.js', 'javascript'], ['vendor/bootstrap/css/bootstrap.min.css', 'text/css'], ['vendor/bootstrap-icons/fonts/bootstrap-icons.woff2', 'font/woff2'], ['icons/icon-192.png', 'image/png']]) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${assets.base}/${file}`);
      assert.equal(response.status, 200, file);
      assert(response.headers.get('content-type').includes(mime), `${file}: ${response.headers.get('content-type')}`);
      assert(response.headers.get('cache-control').includes('immutable'));
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
