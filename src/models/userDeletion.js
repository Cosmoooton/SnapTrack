const crypto = require('crypto');
const { db } = require('../config/database');

function change(actorId, userId, action, username, reason) {
  return new Promise((resolve, reject) => db.run(
    'INSERT INTO user_deletion_actions (actor_id,user_id,action,new_username,reason) VALUES (?,?,?,?,?)',
    [actorId, userId, action, username, reason],
    function (error) { error ? reject(error) : resolve(this.lastID); }
  ));
}
function remove(actorId, userId, reason) {
  const placeholder = `~deleted:${userId}:${crypto.randomBytes(16).toString('hex')}`;
  return change(actorId, userId, 'delete', placeholder, reason);
}
function restore(actorId, userId, username, reason) {
  return change(actorId, userId, 'restore', username, reason);
}
function deleted(userId) {
  return new Promise((resolve, reject) => db.get('SELECT id,deleted_username,deleted_at,deleted_status,role FROM users WHERE id=? AND deleted_at IS NOT NULL', [userId], (error, row) => error ? reject(error) : resolve(row)));
}
function allDeleted() {
  return new Promise((resolve, reject) => db.all('SELECT id,deleted_username,deleted_at,deleted_status,role FROM users WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC,id DESC', (error, rows) => error ? reject(error) : resolve(rows)));
}
function nameInUse(username) {
  return new Promise((resolve, reject) => db.get('SELECT 1 FROM users WHERE username=? COLLATE NOCASE', [username], (error, row) => error ? reject(error) : resolve(Boolean(row))));
}
module.exports = { remove, restore, deleted, allDeleted, nameInUse };
