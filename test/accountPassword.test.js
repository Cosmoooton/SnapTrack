const { test } = require('node:test');
const assert = require('node:assert/strict');

const userPath = require.resolve('../src/models/user');
const bcryptPath = require.resolve('bcrypt');
let currentUser;
let changed;
const userStub = {
  findByUsername: async () => currentUser,
  changePassword: async (...args) => { changed = args; return 1; }
};
require.cache[userPath] = { id: userPath, filename: userPath, loaded: true, exports: userStub };
require.cache[bcryptPath] = { id: bcryptPath, filename: bcryptPath, loaded: true, exports: {
  compare: async (password, hash) => password === 'old-password' && hash === 'old-hash',
  hash: async () => 'new-hash'
} };
const { changePassword } = require('../src/controllers/accountController');

async function attempt(force, body) {
  currentUser = { id: 1, username: 'tester', password_hash: 'old-hash', session_version: 0, force_password_change: force };
  changed = null;
  const req = { body, ip: '127.0.0.1', headers: {}, session: { regenerate: callback => callback(), save: callback => callback() } };
  const result = {};
  const res = { locals: { currentUser }, status(code) { result.status = code; return this; }, render(view, data) { result.error = data.error; }, redirect(url) { result.redirect = url; } };
  await changePassword(req, res, error => { throw error; });
  return { result, changed };
}

test('Erzwungene Änderung benötigt kein altes Passwort', async () => {
  const { result, changed } = await attempt(1, { newPassword: 'Newpass1!', confirmPassword: 'Newpass1!' });
  assert.equal(result.redirect, '/account/password?changed=1');
  assert.deepEqual(changed, [1, 'old-hash', 'new-hash']);
});
test('Freiwillige Änderung verlangt weiterhin das bisherige Passwort', async () => {
  const { result, changed } = await attempt(0, { newPassword: 'Newpass1!', confirmPassword: 'Newpass1!' });
  assert.equal(result.status, 400); assert.equal(changed, null);
});
test('Auch bei erzwungener Änderung gelten neue Passwortregeln und Bestätigung', async () => {
  assert.equal((await attempt(1, { newPassword: 'short', confirmPassword: 'short' })).result.status, 400);
  assert.equal((await attempt(1, { newPassword: 'Newpass1!', confirmPassword: 'Otherpass1!' })).result.status, 400);
});
