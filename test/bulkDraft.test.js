const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const script = fs.readFileSync(require.resolve('../src/public/js/bulk.js'), 'utf8');

// Minimal asynchronous IndexedDB and DOM harness to exercise the actual page script.
function page(records, user = '1', profile = '1', transport = () => { throw Error('offline'); }) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, { value: '', hidden: false, dataset: {}, listeners: {}, className: '', textContent: '', addEventListener(name, fn) { this.listeners[name] = fn; }, focus() {}, replaceChildren() {}, append() {} });
    return elements.get(id);
  }
  const root = element('bulk-app');
  root.dataset = { user, profile, endpoint: '/profiles/1/scores/bulk', csrf: 'token' };
  root.querySelectorAll = () => [];
  const database = { transaction() {
    const tx = {};
    const store = {
      get(key) { const req = { result: records.get(key) && structuredClone(records.get(key)) }; setImmediate(() => tx.oncomplete()); return req; },
      put(value) { const req = {}; records.set(value.identity, structuredClone(value)); setImmediate(() => tx.oncomplete()); return req; },
      delete(key) { const req = {}; records.delete(key); setImmediate(() => tx.oncomplete()); return req; }
    };
    tx.objectStore = () => store; return tx;
  } };
  const indexedDB = { open() { const req = { result: database }; setImmediate(() => req.onsuccess()); return req; } };
  const document = { getElementById: element, createElement: () => element(`new-${Math.random()}`) };
  vm.runInNewContext(script, { document, indexedDB, crypto, URLSearchParams, window: { location: { assign() {} } }, confirm: () => false, fetch: transport });
  return { element, event(id, name, event = {}) { return element(id).listeners[name]({ preventDefault() {}, ...event }); } };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 20));

test('Entwurf einschließlich unbestätigter Eingabe nach erneutem Öffnen fortsetzen und Nutzer trennen', async () => {
  const records = new Map(), first = page(records);
  await flush();
  for (const [field, value] of [['date','2020-01-01'], ['time','12:00'], ['score','100']]) { first.element('bulk-' + field).value = value; first.event('bulk-' + field, 'input'); }
  await first.event('bulk-form', 'submit'); await flush();
  first.element('bulk-score').value = '125'; first.event('bulk-score', 'input'); await flush();
  assert.equal(records.get('1:1').entries.length, 1);
  assert.equal(records.get('1:1').current.score, '125');
  const resumed = page(records); await flush();
  assert.equal(resumed.element('bulk-resume').hidden, false);
  resumed.element('bulk-resume-yes').onclick(); await flush();
  assert.equal(resumed.element('bulk-score').value, '125');
  assert.equal(resumed.element('bulk-date').value, '2020-01-01');
  const other = page(records, '2', '1'); await flush();
  assert.equal(other.element('bulk-resume').hidden, true);
  assert.equal(records.get('1:1').entries.length, 1);
});
test('Bei Netzwerkfehler bleiben Werte und derselbe Schlüssel für den Wiederholungsversuch erhalten', async () => {
  const records = new Map(), keys = [];
  const offline = (url, options) => { keys.push(options.body.get('submissionKey')); throw Error('offline'); };
  const first = page(records, '1', '1', offline); await flush();
  for (const [field, value] of [['date','2020-01-01'], ['time','12:00'], ['score','100']]) { first.element('bulk-' + field).value = value; first.event('bulk-' + field, 'input'); }
  await first.event('bulk-form', 'submit'); await flush();
  first.element('bulk-finish').onclick(); await flush();
  await first.element('bulk-save').onclick(); await flush();
  assert.equal(records.get('1:1').entries.length, 1);
  assert.ok(records.get('1:1').pending);
  const resumed = page(records, '1', '1', offline); await flush();
  resumed.element('bulk-resume-yes').onclick(); await flush();
  await resumed.element('bulk-save').onclick(); await flush();
  assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]);
  assert.equal(records.get('1:1').entries.length, 1);
});
