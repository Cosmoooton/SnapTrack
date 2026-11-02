const { test } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const express = require('express');
const db = new sqlite3.Database(':memory:');
const config = require.resolve('../src/config/database');
require.cache[config] = { id: config, filename: config, loaded: true, exports: { db } };
const profileModule = require.resolve('../src/models/profile');
require.cache[profileModule] = { id: profileModule, filename: profileModule, loaded: true, exports: {
  find: async (userId, id) => userId === 1 && String(id) === '1' ? { id: 1 } : null
} };
const controller = require('../src/controllers/profileController');
db.serialize(() => {
  db.run('CREATE TABLE snapchat_profiles (id INTEGER PRIMARY KEY, user_id INTEGER, deleted_at TEXT)');
  db.run('CREATE TABLE score_entries (id INTEGER PRIMARY KEY, profile_id INTEGER, score INTEGER, submission_key TEXT UNIQUE, measured_at TEXT, created_at TEXT, deleted_at TEXT, deleted_by TEXT)');
  db.run('INSERT INTO snapchat_profiles VALUES (1,1,NULL),(2,2,NULL)');
});
test('Historische HTTP-Eingabe prüft Zeit, Reihenfolge, Wiederholung und Eigentümer', async () => {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => { res.locals.currentUser = { id: 1 }; req.session = { save: cb => cb() }; res.render = (view, options) => res.send(options.message); next(); });
  app.post('/profiles/:id/scores', controller.createScore);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const post = (id, fields) => fetch(`http://127.0.0.1:${server.address().port}/profiles/${id}/scores`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
  const base = { score: '100', submissionKey: '11111111-1111-4111-8111-111111111111', date: '2020-01-02', time: '12:00' };
  try {
    assert.equal((await post(1, base)).status, 200);
    assert.equal((await post(1, base)).status, 200);
    assert.equal((await post(1, { ...base, score: '101' })).status, 409);
    assert.equal((await post(1, { ...base, date: '2026-03-29', time: '02:30' })).status, 400);
    assert.equal((await post(1, { ...base, date: '2099-01-01' })).status, 400);
    assert.equal((await post(2, base)).status, 404);
    const row = await new Promise((resolve, reject) => db.get('SELECT count(*) AS n, measured_at, created_at FROM score_entries', (error, result) => error ? reject(error) : resolve(result)));
    assert.equal(row.n, 1);
    assert.equal(row.measured_at, '2020-01-02T11:00:00.000Z');
    assert.notEqual(row.created_at, row.measured_at);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => db.close(resolve));
  }
});
