const { db } = require('../config/database');

function all(userId) {
  return new Promise((resolve, reject) => db.all(
    'SELECT p.id, p.username, p.created_at, COALESCE(r.revision,0) AS revision FROM snapchat_profiles p LEFT JOIN profile_revisions r ON r.profile_id=p.id WHERE p.user_id = ? AND p.deleted_at IS NULL ORDER BY p.username COLLATE NOCASE',
    [userId], (error, rows) => error ? reject(error) : resolve(rows)));
}

function find(userId, id) {
  return new Promise((resolve, reject) => db.get(
    'SELECT p.id, p.username, p.created_at, COALESCE(r.revision,0) AS revision FROM snapchat_profiles p LEFT JOIN profile_revisions r ON r.profile_id=p.id WHERE p.user_id = ? AND p.id = ? AND p.deleted_at IS NULL',
    [userId, id], (error, row) => error ? reject(error) : resolve(row)));
}

function create(userId, username) {
  return new Promise((resolve, reject) => db.run(
    'INSERT INTO snapchat_profiles (user_id, username) VALUES (?, ?)',
    [userId, username], function (error) { error ? reject(error) : resolve(this.lastID); }));
}

function update(userId, id, username) {
  return new Promise((resolve, reject) => db.run(
    'UPDATE snapchat_profiles SET username = ? WHERE user_id = ? AND id = ? AND deleted_at IS NULL',
    [username, userId, id], function (error) { error ? reject(error) : resolve(this.changes); }));
}

function remove(userId, id) {
  return new Promise((resolve, reject) => db.run(
    "UPDATE snapchat_profiles SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), deleted_by = 'user' WHERE user_id = ? AND id = ? AND deleted_at IS NULL",
    [userId, id], function (error) { error ? reject(error) : resolve(this.changes); }));
}

module.exports = { all, find, create, update, remove };
