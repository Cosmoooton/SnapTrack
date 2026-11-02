require('dotenv').config();
const { db, ready } = require('../src/config/database');
const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (error) { error ? reject(error) : resolve(this.changes); }));
const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
async function main() {
  await ready;
  if (!process.argv.includes('--confirm')) throw new Error('Endgültiges Löschen nur mit --confirm. Bitte zuerst Backups prüfen.');
  const days = Number(process.env.DELETED_RETENTION_DAYS || 30);
  if (!Number.isInteger(days) || days < 1 || days > 36500) throw new Error('DELETED_RETENTION_DAYS muss zwischen 1 und 36500 liegen.');
  const threshold = new Date(Date.now() - days * 86400000).toISOString();
  await run('BEGIN IMMEDIATE');
  try {
    const count = await get('SELECT count(*) AS n FROM score_entries s JOIN snapchat_profiles p ON p.id=s.profile_id WHERE (s.deleted_at IS NOT NULL AND s.deleted_at <= ?) OR (p.deleted_at IS NOT NULL AND p.deleted_at <= ?)', [threshold, threshold]);
    await run('DELETE FROM score_entries WHERE deleted_at IS NOT NULL AND deleted_at <= ?', [threshold]);
    const scores = count.n;
    const profiles = await run('DELETE FROM snapchat_profiles WHERE deleted_at IS NOT NULL AND deleted_at <= ?', [threshold]);
    await run("INSERT INTO audit_logs (action,details) VALUES ('data.retention_purge', ?)", [`Aufbewahrung ${days} Tage; ${scores} Einträge und ${profiles} Accounts endgültig gelöscht`]);
    await run('COMMIT');
    console.log(`Endgültig gelöscht: ${scores} Einträge, ${profiles} Accounts.`);
  } catch (error) { await run('ROLLBACK'); throw error; }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.close());
