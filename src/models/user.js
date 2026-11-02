const { db } = require('../config/database');

function findByUsername(username) {
  return new Promise((resolve, reject) => {
    db.get('SELECT id, username, password_hash, role, status, session_version, force_password_change FROM users WHERE username = ? COLLATE NOCASE AND deleted_at IS NULL', [username],
      (error, user) => error ? reject(error) : resolve(user));
  });
}

function findById(id) {
  return new Promise((resolve, reject) => {
    db.get('SELECT id, username, role, status, session_version, force_password_change FROM users WHERE id = ? AND deleted_at IS NULL', [id],
      (error, user) => error ? reject(error) : resolve(user));
  });
}

function create(username, passwordHash) {
  return new Promise((resolve, reject) => {
    db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, passwordHash],
      function (error) { if (error) reject(error); else resolve(this.lastID); });
  });
}

function createByAdmin(username, passwordHash, forcePasswordChange, adminId, ignoreRequirements = false) {
  return new Promise((resolve, reject) => {
    db.run('INSERT INTO users (username, password_hash, force_password_change, created_by_admin_id, password_policy_bypassed) VALUES (?, ?, ?, ?, ?)',
      [username, passwordHash, forcePasswordChange ? 1 : 0, adminId, ignoreRequirements ? 1 : 0],
      function (error) { if (error) reject(error); else resolve(this.lastID); });
  });
}

function changePassword(id, oldHash, newHash) {
  return new Promise((resolve, reject) => {
    db.run("UPDATE users SET password_hash = ?, session_version = session_version + 1, force_password_change = 0 WHERE id = ? AND password_hash = ? AND deleted_at IS NULL AND status='active'", [newHash, id, oldHash],
      function (error) { if (error) reject(error); else resolve(this.changes); });
  });
}
function sessionRevoked(key) {
  return new Promise((resolve, reject) => db.get('SELECT 1 FROM revoked_sessions WHERE session_key = ? AND expires_at > ?', [key, Date.now()], (error, row) => error ? reject(error) : resolve(Boolean(row))));
}

module.exports = { findByUsername, findById, create, createByAdmin, changePassword, sessionRevoked };
