const { db } = require('../config/database');
const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (error) { error ? reject(error) : resolve(this.changes); }));
const audit = (admin, action, user = null, profile = null, details = null) => run('INSERT INTO audit_logs (admin_id, action, user_id, profile_id, details) VALUES (?, ?, ?, ?, ?)', [admin, action, user, profile, details]);
const userSelect = `SELECT u.id, u.username, u.role, u.status, u.created_at, u.last_login_at,
  (SELECT count(*) FROM snapchat_profiles p WHERE p.user_id=u.id AND p.deleted_at IS NULL) AS profiles,
  (SELECT count(*) FROM score_entries s JOIN snapchat_profiles p ON p.id=s.profile_id WHERE p.user_id=u.id AND p.deleted_at IS NULL AND s.deleted_at IS NULL) AS scores FROM users u`;

async function summary() {
  return get(`SELECT (SELECT count(*) FROM users WHERE deleted_at IS NULL) AS users,
    (SELECT count(*) FROM users WHERE status='active') AS active,
    (SELECT count(*) FROM users WHERE status IN ('suspended','disabled') AND deleted_at IS NULL) AS suspended,
    (SELECT count(*) FROM users WHERE created_at >= datetime('now','-7 days') AND deleted_at IS NULL) AS registrations,
    (SELECT count(*) FROM snapchat_profiles p JOIN users u ON u.id=p.user_id WHERE p.deleted_at IS NULL AND u.deleted_at IS NULL) AS profiles,
    (SELECT count(*) FROM score_entries s JOIN snapchat_profiles p ON p.id=s.profile_id JOIN users u ON u.id=p.user_id WHERE s.deleted_at IS NULL AND p.deleted_at IS NULL AND u.deleted_at IS NULL) AS scores,
    (SELECT count(*) FROM score_entries s JOIN snapchat_profiles p ON p.id=s.profile_id JOIN users u ON u.id=p.user_id WHERE s.deleted_at IS NULL AND p.deleted_at IS NULL AND u.deleted_at IS NULL AND julianday(s.created_at) >= julianday('now','-1 day')) AS recent_scores`);
}
async function users({ search, role, status, sort, page }) {
  const conditions = ['u.deleted_at IS NULL'], params = [];
  if (search) { conditions.push('(u.username LIKE ? ESCAPE \'\\\' OR CAST(u.id AS TEXT) = ?)'); params.push('%' + search.replace(/[\\%_]/g, '\\$&') + '%', search); }
  if (['user','admin'].includes(role)) { conditions.push('u.role = ?'); params.push(role); }
  if (['active','suspended','disabled'].includes(status)) { conditions.push('u.status = ?'); params.push(status); }
  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  const order = { username: 'u.username COLLATE NOCASE ASC', login: 'u.last_login_at DESC', created: 'u.created_at DESC' }[sort] || 'u.created_at DESC';
  const total = await get('SELECT count(*) AS count FROM users u' + where, params);
  const rows = await all(userSelect + where + ` ORDER BY ${order}, u.id DESC LIMIT 25 OFFSET ?`, [...params, (page - 1) * 25]);
  return { total: total.count, rows };
}
const user = id => get(userSelect + ' WHERE u.id = ? AND u.deleted_at IS NULL', [id]);
const profiles = id => all(`SELECT p.id, p.username, p.created_at,
  (SELECT count(*) FROM score_entries s WHERE s.profile_id=p.id AND s.deleted_at IS NULL) AS score_count,
  (SELECT score FROM score_entries s WHERE s.profile_id=p.id AND s.deleted_at IS NULL ORDER BY measured_at DESC,id DESC LIMIT 1) AS latest_score,
  (SELECT measured_at FROM score_entries s WHERE s.profile_id=p.id AND s.deleted_at IS NULL ORDER BY measured_at DESC,id DESC LIMIT 1) AS latest_at
  FROM snapchat_profiles p WHERE p.user_id=? AND p.deleted_at IS NULL ORDER BY p.username COLLATE NOCASE`, [id]);
const profile = (userId, id) => get('SELECT id, username, created_at FROM snapchat_profiles WHERE user_id = ? AND id = ? AND deleted_at IS NULL', [userId, id]);
const scores = (userId, id) => all('SELECT s.id, s.score, s.measured_at AS created_at, s.created_at AS saved_at FROM score_entries s JOIN snapchat_profiles p ON p.id=s.profile_id WHERE p.user_id=? AND p.id=? AND p.deleted_at IS NULL AND s.deleted_at IS NULL ORDER BY s.measured_at DESC,s.id DESC', [userId, id]);
const notes = id => all('SELECT n.content,n.created_at,u.username AS admin FROM support_notes n JOIN users u ON u.id=n.admin_id WHERE n.user_id=? ORDER BY n.id DESC', [id]);
const addNote = (adminId,userId,content) => run('INSERT INTO support_notes (admin_id,user_id,content) SELECT ?,id,? FROM users WHERE id=?', [adminId,content,userId]);
module.exports = { get, all, run, audit, summary, users, user, profiles, profile, scores, notes, addNote };
