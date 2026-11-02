const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const db = new sqlite3.Database(':memory:');
const config = require.resolve('../src/config/database');
require.cache[config] = { id: config, filename: config, loaded: true, exports: { db } };
const Score = require('../src/models/score');
db.serialize(() => {
  db.run('CREATE TABLE snapchat_profiles (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, deleted_at TEXT)');
  db.run("CREATE TABLE score_entries (id INTEGER PRIMARY KEY, profile_id INTEGER NOT NULL, score INTEGER NOT NULL, submission_key TEXT UNIQUE, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), deleted_at TEXT, deleted_by TEXT)" );
  db.run('INSERT INTO snapchat_profiles (id,user_id) VALUES (1, 1), (2, 2)');
  db.run('CREATE TABLE streak_milestones (user_id INTEGER, profile_id INTEGER, milestone INTEGER, PRIMARY KEY(user_id, profile_id, milestone))');
});
test('Meilensteine werden pro Nutzer und Account nur einmal markiert', async () => {
  assert.equal(await Score.markMilestone(1, 1, 7), 1);
  assert.equal(await Score.markMilestone(1, 1, 7), 0);
  assert.equal(await Score.markMilestone(2, 1, 7), 0);
  assert.equal(await Score.markMilestone(2, 2, 7), 1);
});
after(() => new Promise(resolve => db.close(resolve)));
test('Neue Werte sinken nicht, gleiche Werte sind erlaubt und Requests bleiben eindeutig', async () => {
  assert.equal(await Score.createNondecreasing(1, 1, 100, 'first'), 1);
  assert.equal(await Score.createNondecreasing(1, 1, 100, 'first'), 0);
  assert.equal(await Score.createNondecreasing(1, 1, 99, 'lower'), 0);
  assert.equal(await Score.createNondecreasing(1, 1, 100, 'equal'), 1);
  assert.equal(await Score.createNondecreasing(2, 1, 200, 'foreign'), 0);
  assert.equal((await Score.history(1, 1)).length, 2);
  assert.equal(await Score.findByKey(2, 1, 'first'), undefined);
});
test('Soft Delete blendet nur den eigenen Eintrag aus und Wiederherstellung erhält den Wert', async () => {
  const entry = await Score.findByKey(1, 1, 'first');
  assert(entry);
  assert.equal(await Score.remove(2, 1, entry.id), 0);
  assert.equal(await Score.remove(1, 1, entry.id), 1);
  assert.equal(await Score.findByKey(1, 1, 'first'), undefined);
  assert.equal((await Score.history(1, 1)).length, 1);
  await new Promise((resolve, reject) => db.run('UPDATE score_entries SET deleted_at=NULL,deleted_by=NULL WHERE id=?', [entry.id], error => error ? reject(error) : resolve()));
  assert.equal((await Score.findByKey(1, 1, 'first')).score, 100);
});
test('Paginierung und Verlauf bleiben auf den eigenen Account beschränkt', async () => {
  const firstPage = await Score.page(1, 1, 0, 1);
  const secondPage = await Score.page(1, 1, 1, 1);
  assert.equal(firstPage.length, 1); assert.equal(secondPage.length, 1);
  assert.notEqual(firstPage[0].id, secondPage[0].id);
  assert.equal((await Score.page(2, 1, 0, 50)).length, 0);
  assert.equal((await Score.range(2, 1, '0000-01-01', '9999-12-31')).length, 0);
});
