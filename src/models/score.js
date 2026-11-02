const { db } = require('../config/database');

function history(userId, profileId) {
  return new Promise((resolve, reject) => db.all(`
    SELECT s.id, s.score, s.measured_at AS created_at, s.measured_at, s.created_at AS saved_at FROM score_entries s
    JOIN snapchat_profiles p ON p.id = s.profile_id
    WHERE p.user_id = ? AND p.id = ? AND p.deleted_at IS NULL AND s.deleted_at IS NULL ORDER BY s.measured_at DESC, s.id DESC`,
  [userId, profileId], (error, rows) => error ? reject(error) : resolve(rows)));
}
function page(userId, profileId, offset, limit) {
  return new Promise((resolve, reject) => db.all(`SELECT s.id,s.score,s.measured_at AS created_at,s.measured_at,s.created_at AS saved_at FROM score_entries s
    JOIN snapchat_profiles p ON p.id=s.profile_id WHERE p.user_id=? AND p.id=? AND p.deleted_at IS NULL AND s.deleted_at IS NULL
    ORDER BY s.measured_at DESC,s.id DESC LIMIT ? OFFSET ?`, [userId, profileId, limit, offset],
  (error, rows) => error ? reject(error) : resolve(rows)));
}
function range(userId, profileId, since, until) {
  return new Promise((resolve, reject) => db.all(`SELECT s.id,s.score,s.measured_at AS created_at,s.measured_at,s.created_at AS saved_at FROM score_entries s
    JOIN snapchat_profiles p ON p.id=s.profile_id WHERE p.user_id=? AND p.id=? AND p.deleted_at IS NULL AND s.deleted_at IS NULL
    AND s.measured_at>=? AND s.measured_at<=? ORDER BY s.measured_at ASC,s.id ASC`, [userId, profileId, since, until],
  (error, rows) => error ? reject(error) : resolve(rows)));
}
function count(userId, profileId) {
  return new Promise((resolve, reject) => db.get(`SELECT count(*) AS total FROM score_entries s
    JOIN snapchat_profiles p ON p.id=s.profile_id WHERE p.user_id=? AND p.id=? AND p.deleted_at IS NULL AND s.deleted_at IS NULL`,
  [userId, profileId], (error, row) => error ? reject(error) : resolve(row.total)));
}
function exceptionsForProfile(userId, profileId) {
  return new Promise((resolve, reject) => db.all(`SELECT e.day FROM streak_exceptions e JOIN snapchat_profiles p ON p.id=e.profile_id
    WHERE p.user_id=? AND p.id=? AND p.deleted_at IS NULL`, [userId, profileId],
  (error, rows) => error ? reject(error) : resolve(rows.map(row => row.day))));
}

function latestForUser(userId) {
  return new Promise((resolve, reject) => db.all(`
    SELECT p.id AS profile_id, s.score, s.measured_at AS created_at FROM snapchat_profiles p
    JOIN score_entries s ON s.id IN (SELECT id FROM score_entries WHERE profile_id=p.id AND deleted_at IS NULL ORDER BY measured_at DESC,id DESC LIMIT 2)
    WHERE p.user_id=? AND p.deleted_at IS NULL ORDER BY p.id,s.measured_at DESC,s.id DESC`,
  [userId], (error, rows) => error ? reject(error) : resolve(rows)));
}
function allForUser(userId, profileIds) {
  if (profileIds && !profileIds.length) return Promise.resolve([]);
  const filter = profileIds ? ` AND p.id IN (${profileIds.map(() => '?').join(',')})` : '';
  return new Promise((resolve, reject) => db.all(`SELECT s.profile_id, s.measured_at AS created_at FROM score_entries s
    JOIN snapchat_profiles p ON p.id = s.profile_id WHERE p.user_id = ? AND p.deleted_at IS NULL AND s.deleted_at IS NULL${filter}`, [userId, ...(profileIds || [])],
  (error, rows) => error ? reject(error) : resolve(rows)));
}
function exceptionsForUser(userId, profileIds) {
  if (profileIds && !profileIds.length) return Promise.resolve([]);
  const filter = profileIds ? ` AND p.id IN (${profileIds.map(() => '?').join(',')})` : '';
  return new Promise((resolve, reject) => db.all(`SELECT e.profile_id, e.day FROM streak_exceptions e
    JOIN snapchat_profiles p ON p.id=e.profile_id WHERE p.user_id=? AND p.deleted_at IS NULL${filter}`, [userId, ...(profileIds || [])],
  (error, rows) => error ? reject(error) : resolve(rows)));
}

function create(userId, profileId, score, key) {
  return new Promise((resolve, reject) => db.run(`
    INSERT INTO score_entries (profile_id, score, submission_key)
    SELECT id, ?, ? FROM snapchat_profiles WHERE id = ? AND user_id = ? AND deleted_at IS NULL
    ON CONFLICT(submission_key) DO NOTHING`,
  [score, key, profileId, userId], function (error) { error ? reject(error) : resolve(this.changes); }));
}

function createNondecreasing(userId, profileId, score, key, measuredAt) {
  const savedAt = new Date().toISOString();
  measuredAt ||= savedAt;
  return new Promise((resolve, reject) => db.run(`
    INSERT INTO score_entries (profile_id, score, submission_key, measured_at, created_at)
    SELECT p.id, ?, ?, ?, ? FROM snapchat_profiles p WHERE p.id = ? AND p.user_id = ? AND p.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM score_entries s WHERE s.profile_id=p.id AND s.deleted_at IS NULL AND s.measured_at=?)
    AND ? >= COALESCE((SELECT s.score FROM score_entries s WHERE s.profile_id=p.id AND s.deleted_at IS NULL AND s.measured_at < ? ORDER BY s.measured_at DESC,s.id DESC LIMIT 1), 0)
    AND ? <= COALESCE((SELECT s.score FROM score_entries s WHERE s.profile_id=p.id AND s.deleted_at IS NULL AND s.measured_at > ? ORDER BY s.measured_at ASC,s.id ASC LIMIT 1), 9007199254740991)
    ON CONFLICT(submission_key) DO NOTHING`,
  [score, key, measuredAt, savedAt, profileId, userId, measuredAt, score, measuredAt, score, measuredAt], function (error) { error ? reject(error) : resolve(this.changes); }));
}

function findByKey(userId, profileId, key) {
  return new Promise((resolve, reject) => db.get(`SELECT s.id, s.score, s.measured_at AS created_at, s.measured_at, s.created_at AS saved_at FROM score_entries s
    JOIN snapchat_profiles p ON p.id = s.profile_id WHERE p.user_id = ? AND p.id = ? AND s.submission_key = ? AND p.deleted_at IS NULL AND s.deleted_at IS NULL`,
  [userId, profileId, key], (error, row) => error ? reject(error) : resolve(row)));
}
function bulkReceipt(userId, key) {
  return new Promise((resolve, reject) => db.get('SELECT profile_id,payload_hash FROM bulk_score_imports WHERE user_id=? AND request_key=?', [userId, key], (error, row) => error ? reject(error) : resolve(row)));
}
function createBulk(userId, profileId, key, hash, entries) {
  return new Promise((resolve, reject) => db.run('INSERT INTO bulk_score_imports(user_id,profile_id,request_key,payload_hash,entries) VALUES(?,?,?,?,?)', [userId, profileId, key, hash, JSON.stringify(entries)], function (error) { error ? reject(error) : resolve(this.changes); }));
}
function markMilestone(userId, profileId, milestone) {
  return new Promise((resolve, reject) => db.run(`INSERT OR IGNORE INTO streak_milestones (user_id, profile_id, milestone)
    SELECT user_id, id, ? FROM snapchat_profiles WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
  [milestone, profileId, userId], function (error) { error ? reject(error) : resolve(this.changes); }));
}

function find(userId, profileId, entryId) {
  return new Promise((resolve, reject) => db.get(`
    SELECT s.id, s.score, s.measured_at AS created_at, s.measured_at, s.created_at AS saved_at FROM score_entries s
    JOIN snapchat_profiles p ON p.id = s.profile_id
    WHERE p.user_id = ? AND p.id = ? AND s.id = ? AND p.deleted_at IS NULL AND s.deleted_at IS NULL`,
  [userId, profileId, entryId], (error, row) => error ? reject(error) : resolve(row)));
}

function update(userId, profileId, entryId, score) {
  return new Promise((resolve, reject) => db.run(`
    UPDATE score_entries SET score = ? WHERE id = ? AND profile_id = ? AND deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM snapchat_profiles p WHERE p.id = score_entries.profile_id AND p.user_id = ? AND p.deleted_at IS NULL)`,
  [score, entryId, profileId, userId], function (error) { error ? reject(error) : resolve(this.changes); }));
}

function remove(userId, profileId, entryId) {
  return new Promise((resolve, reject) => db.run(`
    UPDATE score_entries SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), deleted_by = 'user' WHERE id = ? AND profile_id = ? AND deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM snapchat_profiles p WHERE p.id = score_entries.profile_id AND p.user_id = ? AND p.deleted_at IS NULL)`,
  [entryId, profileId, userId], function (error) { error ? reject(error) : resolve(this.changes); }));
}

module.exports = { history, page, range, count, exceptionsForProfile, latestForUser, allForUser, exceptionsForUser, create, createNondecreasing, findByKey, bulkReceipt, createBulk, markMilestone, find, update, remove };
