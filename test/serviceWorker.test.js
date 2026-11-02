const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const assets = require('../src/config/assets');

test('Service Worker verarbeitet nur versionierte statische GET-Anfragen', async () => {
  const handlers = {}, requests = [];
  const self = { location: { origin: 'https://example.test' }, addEventListener: (name, fn) => { handlers[name] = fn; } };
  const caches = { open: async () => ({ match: async key => { requests.push(key); return 'cached'; } }) };
  const source = `const ASSET_BASE=${JSON.stringify(assets.base)}; const ASSET_PATHS=${JSON.stringify(assets.files.map(([url]) => url))};\n` + fs.readFileSync(require('node:path').join(__dirname, '../src/public/sw.js'), 'utf8');
  vm.runInNewContext(source, { self, caches, URL, fetch: () => { throw new Error('Netzwerk nicht erwartet'); } });
  let response;
  handlers.fetch({ request: { method: 'GET', url: 'https://example.test/profiles/1' }, respondWith: value => { response = value; } });
  assert.equal(response, undefined);
  handlers.fetch({ request: { method: 'POST', url: 'https://example.test' + assets.base + '/css/style.css' }, respondWith: value => { response = value; } });
  assert.equal(response, undefined);
  const font = assets.base + '/vendor/bootstrap-icons/fonts/bootstrap-icons.woff2';
  handlers.fetch({ request: { method: 'GET', url: 'https://example.test' + font + '?version=font' }, respondWith: value => { response = value; } });
  assert.equal(await response, 'cached'); assert.deepEqual(requests, [font]);
});
