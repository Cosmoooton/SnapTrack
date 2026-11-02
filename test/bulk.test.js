const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');

test('Bulk-HTTP-Import speichert atomar, idempotent und nur für den eigenen Account', async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), '.bulk-test-'));
  fs.mkdirSync(path.join(root, 'src', 'config'), { recursive: true });
  fs.copyFileSync(path.join(process.cwd(), 'src/config/database.js'), path.join(root, 'src', 'config', 'database.js'));
  const config = require(path.join(root, 'src', 'config', 'database.js'));
  await config.ready;
  const configPath = require.resolve('../src/config/database');
  require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: config };
  const controller = require('../src/controllers/profileController');
  const run = (sql, params = []) => new Promise((resolve, reject) => config.db.run(sql, params, error => error ? reject(error) : resolve()));
  const get = (sql, params = []) => new Promise((resolve, reject) => config.db.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
  await run("INSERT INTO users(id,username,password_hash) VALUES(1,'a','hash'),(2,'b','hash')");
  await run("INSERT INTO snapchat_profiles(id,user_id,username) VALUES(1,1,'profile'),(2,2,'other')");
  const app = express(); app.use(express.urlencoded({ extended: false, limit: '128kb' }));
  app.use((req, res, next) => { res.locals.currentUser = { id: 1 }; next(); });
  app.post('/profiles/:id/scores/bulk', controller.bulkSave);
  app.post('/profiles/:id/scores/import/preview', controller.importPreview);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const post = (profile, key, entries) => fetch(`http://127.0.0.1:${server.address().port}/profiles/${profile}/scores/bulk`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ submissionKey: key, entries: JSON.stringify(entries) }) });
  const key = '11111111-1111-4111-8111-111111111111';
  const entries = Array.from({ length: 50 }, (_, i) => ({ date: '2020-01-01', time: `12:${String(i).padStart(2,'0')}`, score: String(100 + i) })).reverse();
  try {
    assert.equal((await post(1, key, entries)).status, 200);
    assert.equal((await post(1, key, entries)).status, 200);
    assert.equal((await get('SELECT count(*) AS n FROM score_entries')).n, 50);
    const rows = await new Promise((resolve, reject) => config.db.all('SELECT score,measured_at AS created_at FROM score_entries WHERE profile_id=1 ORDER BY measured_at DESC', (error, result) => error ? reject(error) : resolve(result)));
    const stats = require('../src/utils/scoreStats').analyze(rows, Date.parse('2020-01-02T12:00:00Z'));
    assert.equal(stats.count, 50); assert.equal(stats.gain, 49); assert.equal(stats.tracking.days, 1);
    assert.equal((await post(2, key, entries)).status, 404);
    const check = await fetch(`http://127.0.0.1:${server.address().port}/profiles/1/scores/import/preview`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ entries: JSON.stringify([entries[0], { date: '2020-03-29', time: '02:30', score: '200' }]) }) });
    const preview = await check.json(); assert.equal(check.status, 200); assert.ok(preview.errors['0']); assert.ok(preview.errors['1']);
    assert.equal((await post(1, key, [{ ...entries[0], score: '999' }])).status, 409);
    const conflict = [{ date: '2020-01-01', time: '13:00', score: '160' }, { date: '2020-01-01', time: '13:00', score: '161' }];
    assert.equal((await post(1, '22222222-2222-4222-8222-222222222222', conflict)).status, 409);
    assert.equal((await get('SELECT count(*) AS n FROM score_entries')).n, 50);
    assert.equal((await get('SELECT count(*) AS n FROM bulk_score_imports')).n, 1);
    assert.equal((await post(1, '33333333-3333-4333-8333-333333333333', [{ date: '2020-01-01', time: '13:00', score: '-1' }])).status, 400);
    assert.equal((await post(1, '44444444-4444-4444-8444-444444444444', [{ date: '2020-03-29', time: '02:30', score: '200' }])).status, 400);
    assert.equal((await post(1, '55555555-5555-4555-8555-555555555555', [{ date: '2020-10-25', time: '02:30', score: '200' }])).status, 400);
    assert.equal((await post(1, '66666666-6666-4666-8666-666666666666', [{ date: '2020-01-01', time: '11:00', score: '101' }])).status, 409);
    assert.equal((await get('SELECT count(*) AS n FROM score_entries')).n, 50);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => config.db.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
