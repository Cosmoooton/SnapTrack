const { db, ready } = require('../src/config/database');
const username = process.argv[2];
async function main() {
  await ready;
  if (!username) throw new Error('Aufruf: npm run create-admin -- BENUTZERNAME');
  const result = await new Promise((resolve, reject) => db.run(`UPDATE users SET role = 'admin'
    WHERE username = ? COLLATE NOCASE AND status = 'active'
    AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')`, [username],
  function (error) { error ? reject(error) : resolve(this.changes); }));
  if (!result) throw new Error('Nutzer nicht gefunden, nicht aktiv oder ein Administrator existiert bereits.');
  await new Promise((resolve, reject) => db.run(`INSERT INTO audit_logs (admin_id, action, user_id, details)
    SELECT id, 'admin.bootstrap', id, 'Erster Administrator per CLI eingerichtet' FROM users WHERE username = ? COLLATE NOCASE`,
  [username], error => error ? reject(error) : resolve()));
  console.log('Erster Administrator wurde eingerichtet.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.close());
