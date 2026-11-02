const { test } = require('node:test');
const assert = require('node:assert/strict');
const cache = require('../src/utils/statCache');

test('Cache trennt Nutzer, Accounts, Revisionen, Typen und Zeiträume', async () => {
  let calls = 0;
  const load = async () => ++calls;
  assert.equal(await cache.memo(101, 1, 1, 'stats', 'day-a', 10000, load), 1);
  assert.equal(await cache.memo(101, 1, 1, 'stats', 'day-a', 10000, load), 1);
  assert.equal(await cache.memo(102, 1, 1, 'stats', 'day-a', 10000, load), 2);
  assert.equal(await cache.memo(101, 2, 1, 'stats', 'day-a', 10000, load), 3);
  assert.equal(await cache.memo(101, 1, 2, 'stats', 'day-a', 10000, load), 4);
  assert.equal(await cache.memo(101, 1, 1, 'graph', 'day-a', 10000, load), 5);
  assert.equal(await cache.memo(101, 1, 1, 'stats', 'day-b', 10000, load), 6);
  cache.invalidate(101, 1);
  assert.equal(await cache.memo(101, 1, 1, 'stats', 'day-a', 10000, load), 7);
  assert.equal(await cache.memo(102, 1, 1, 'stats', 'day-a', 10000, load), 2);
});
test('Abgelaufene Werte werden neu berechnet', async () => {
  let calls = 0;
  assert.equal(await cache.memo(103, 1, 1, 'stats', '', 0, async () => ++calls), 1);
  assert.equal(await cache.memo(103, 1, 1, 'stats', '', 0, async () => ++calls), 2);
});
