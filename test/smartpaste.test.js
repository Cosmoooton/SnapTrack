const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const historicalScores = require('../src/utils/historicalScores');
const script = fs.readFileSync(require.resolve('../src/public/js/smartpaste.js'), 'utf8');

function page(records, fetcher, user = '1') {
  const elements = new Map();
  const create = () => ({ value: '', checked: false, hidden: false, dataset: {}, listeners: {}, childNodes: [], className: '', textContent: '', addEventListener(name, fn) { this.listeners[name] = fn; }, setAttribute() {}, append(...nodes) { this.childNodes.push(...nodes); }, replaceChildren(...nodes) { this.childNodes = nodes; } });
  function element(id) { if (!elements.has(id)) elements.set(id, create()); return elements.get(id); }
  const root = element('smart-app'); root.dataset = { user, profile: '1', endpoint: '/bulk', preview: '/preview', csrf: 'token' }; root.querySelectorAll = () => [];
  const database = { transaction() {
    const tx = {}, store = {
      get(key) { const request = { result: records.get(key) && structuredClone(records.get(key)) }; setImmediate(() => tx.oncomplete()); return request; },
      put(value) { const request = {}; records.set(value.identity, structuredClone(value)); setImmediate(() => tx.oncomplete()); return request; },
      delete(key) { const request = {}; records.delete(key); setImmediate(() => tx.oncomplete()); return request; }
    }; tx.objectStore = () => store; return tx;
  } };
  const indexedDB = { open() { const request = { result: database }; setImmediate(() => request.onsuccess()); return request; } };
  const document = { getElementById: element, createElement: create, createTextNode: text => ({ textContent: text }) };
  vm.runInNewContext(script, { document, indexedDB, crypto, URLSearchParams, Date, window: { historicalScores, location: { assign() {} } }, confirm: () => true, fetch: fetcher });
  return { element, event(id, name) { return element(id).listeners[name](); } };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 20));
const ok = data => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => data });

test('SmartPaste verarbeitet 50 Zeilen, markiert Tageswechsel und übernimmt nach Bestätigung', async () => {
  const records = new Map(), requests = [];
  const fetcher = async (url, options) => { requests.push({ url, body: options.body }); return url === '/preview' ? ok({ errors: {} }) : ok({ success: true, count: 50 }); };
  const ui = page(records, fetcher); await flush();
  const lines = Array.from({ length: 50 }, (_, i) => `${String(Math.floor(i / 5) % 24).padStart(2, '0')}:${String(i % 5 * 10).padStart(2, '0')} ${50000 + i}`);
  ui.element('smart-text').value = lines.join('\n'); ui.event('smart-text', 'input');
  ui.element('smart-parse').onclick(); await flush();
  ui.element('smart-reference').value = '2020-01-03'; ui.event('smart-reference', 'change');
  ui.element('smart-confirm-days').checked = true; ui.event('smart-confirm-days', 'change');
  await ui.element('smart-to-review').onclick(); await ui.element('smart-to-confirm').onclick();
  await ui.element('smart-save').onclick(); await flush();
  const imported = JSON.parse(requests.find(x => x.url === '/bulk').body.get('entries'));
  assert.equal(imported.length, 50); assert.equal(imported[0].score, '50000'); assert.equal(imported[49].date, '2020-01-03');
  assert.equal(ui.element('smart-success').hidden, false); assert.equal(records.has('smart:1:1'), false);
});

test('SmartPaste-Entwurf und unveränderte Wiederholung bleiben nach Netzwerkfehler erhalten', async () => {
  const records = new Map(), keys = [];
  const fetcher = async (url, options) => { if (url === '/preview') return ok({ errors: {} }); keys.push(options.body.get('submissionKey')); throw Error('offline'); };
  const ui = page(records, fetcher); await flush();
  ui.element('smart-text').value = '23:00 100\n08:00 110'; ui.event('smart-text', 'input'); ui.element('smart-parse').onclick();
  ui.element('smart-reference').value = '2020-01-03'; ui.event('smart-reference', 'change');
  ui.element('smart-confirm-days').checked = true; ui.event('smart-confirm-days', 'change');
  await ui.element('smart-to-review').onclick(); await ui.element('smart-to-confirm').onclick(); await ui.element('smart-save').onclick(); await flush();
  const saved = records.get('smart:1:1'); assert.equal(saved.rows.length, 2); assert.equal(saved.breaks[2], 1); assert.ok(saved.pending);
  assert.equal(saved.pending.entries[0].date, '2020-01-02');
  const resumed = page(records, fetcher); await flush(); await resumed.element('smart-resume-yes').onclick(); await resumed.element('smart-save').onclick(); await flush();
  assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]);
  assert.equal(records.get('smart:1:1').rows.length, 2);
  const other = page(records, fetcher, '2'); await flush(); assert.equal(other.element('smart-resume').hidden, true);
});
test('Umgekehrte Reihenfolge, übersprungene Tage und korrigierte Zeilen bleiben im Entwurf', async () => {
  const records = new Map();
  const fetcher = async url => url === '/preview' ? ok({ errors: {} }) : ok({ success: true, count: 3 });
  const ui = page(records, fetcher); await flush();
  ui.element('smart-text').value = '15:00 300\nfehler\n10:00 100'; ui.event('smart-text', 'input');
  ui.element('smart-order').value = 'newest'; ui.event('smart-order', 'change'); ui.element('smart-parse').onclick();
  ui.element('smart-reference').value = '2020-01-10'; ui.event('smart-reference', 'change');
  const boundaries = ui.element('smart-boundaries').childNodes;
  const gap = boundaries[0].childNodes[0].childNodes[0]; gap.value = '3'; gap.listeners.change();
  ui.element('smart-confirm-days').checked = true; ui.event('smart-confirm-days', 'change');
  await ui.element('smart-to-review').onclick(); ui.element('smart-all').onclick();
  const bad = ui.element('smart-row-list').childNodes[1].childNodes[1]; bad.value = '12:00 200'; bad.listeners.input();
  await ui.element('smart-rows-back').onclick(); ui.element('smart-edit-days').onclick();
  ui.element('smart-confirm-days').checked = true; ui.event('smart-confirm-days', 'change');
  await ui.element('smart-to-review').onclick(); await ui.element('smart-to-confirm').onclick();
  await flush();
  const saved = records.get('smart:1:1');
  assert.equal(saved.rows[1].score, 200); assert.equal(saved.breaks[2], 3);
  assert.equal(ui.element('smart-confirm').hidden, false);
});
