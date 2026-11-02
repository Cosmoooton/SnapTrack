const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAdmin } = require('../middleware/auth');
const Admin = require('../models/admin');
const { analyze, local, streak } = require('../utils/scoreStats');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const User = require('../models/user');
const Profile = require('../models/profile');
const Score = require('../models/score');
const profileStats = require('../services/profileStats');
const { dataDir } = require('../config/database');
const sessionKey = require('../utils/sessionKey');
const statCache = require('../utils/statCache');
const UserDeletion = require('../models/userDeletion');
const { passwordIsValid } = require('../utils/password');
const router = express.Router();
const safe = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const id = value => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
const missing = res => res.status(404).render('error', { message: 'Der Eintrag wurde nicht gefunden.' });
const sessionCount = async (req, userId = null) => {
  const users = await Admin.all("SELECT id,session_version FROM users WHERE status='active'");
  const versions = new Map(users.map(user => [user.id, user.session_version]));
  const revoked = new Set((await Admin.all('SELECT session_key FROM revoked_sessions WHERE expires_at > ?', [Date.now()])).map(row => row.session_key));
  const rows = await new Promise((resolve, reject) => req.sessionStore.db.all('SELECT sid,sess FROM sessions WHERE expired > ?', [Date.now()], (error, result) => error ? reject(error) : resolve(result)));
  return rows.reduce((count, row) => {
    try {
      const session = JSON.parse(row.sess);
      return count + (versions.has(session.userId) && !revoked.has(sessionKey(row.sid)) && (userId === null || session.userId === userId) && (session.sessionVersion || 0) === versions.get(session.userId) ? 1 : 0);
    } catch { return count; }
  }, 0);
};
const sessionsFor = async (req, user) => {
  const revoked = new Set((await Admin.all('SELECT session_key FROM revoked_sessions WHERE user_id=? AND expires_at > ?', [user.id, Date.now()])).map(row => row.session_key));
  const rows = await new Promise((resolve, reject) => req.sessionStore.db.all('SELECT sid,sess,expired FROM sessions WHERE expired > ?', [Date.now()], (error, result) => error ? reject(error) : resolve(result)));
  return rows.flatMap(row => {
    try {
      const session = JSON.parse(row.sess), key = sessionKey(row.sid);
      if (session.userId !== user.id || (session.sessionVersion || 0) !== user.session_version || revoked.has(key)) return [];
      const info = session.sessionInfo && typeof session.sessionInfo === 'object' ? session.sessionInfo : {};
      return [{ handle: key, expires: row.expired, current: row.sid === req.sessionID,
        ip: typeof info.ip === 'string' ? info.ip : null,
        device: typeof info.device === 'string' ? info.device : null }];
    } catch { return []; }
  });
};
router.use(requireAdmin);
router.use((req, res, next) => { res.locals.adminSection = req.path.split('/')[1] || 'overview'; next(); });
router.get('/', safe(async (req, res) => {
  await Admin.audit(res.locals.currentUser.id, 'dashboard.view');
  const summary = await Admin.summary();
  summary.sessions = await sessionCount(req);
  const recentUsers = (await Admin.users({ page: 1 })).rows.slice(0, 5);
  const logs = await Admin.all('SELECT a.*, u.username AS admin FROM audit_logs a LEFT JOIN users u ON u.id=a.admin_id ORDER BY a.id DESC LIMIT 8');
  res.render('admin/dashboard', { summary, recentUsers, logs });
}));
router.get('/users', safe(async (req, res) => {
  await Admin.audit(res.locals.currentUser.id, 'users.list');
  const filters = { search: typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 64) : '', role: req.query.role, status: req.query.status, sort: req.query.sort, page: Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1)) };
  res.render('admin/users', { ...await Admin.users(filters), filters });
}));
router.get('/users/deleted', safe(async (req, res) => {
  await Admin.audit(res.locals.currentUser.id, 'users.deleted_list');
  res.render('admin/users-deleted', { users: await UserDeletion.allDeleted() });
}));
router.get('/users/deleted/:deletedId/restore', safe(async (req, res) => {
  if (!id(req.params.deletedId)) return missing(res);
  const user = await UserDeletion.deleted(req.params.deletedId);
  if (!user) return missing(res);
  await Admin.audit(res.locals.currentUser.id, 'user.deleted_view', user.id);
  res.render('admin/user-restore', { user, conflict: await UserDeletion.nameInUse(user.deleted_username), error: null });
}));
router.post('/users/deleted/:deletedId/restore', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false }), safe(async (req, res) => {
  if (!id(req.params.deletedId)) return missing(res);
  const user = await UserDeletion.deleted(req.params.deletedId);
  if (!user) return missing(res);
  const { reason, confirm } = req.body;
  let conflict = await UserDeletion.nameInUse(user.deleted_username);
  const username = conflict && typeof req.body.username === 'string' ? req.body.username.trim() : user.deleted_username;
  const fail = message => res.status(409).render('admin/user-restore', { user, conflict, error: message });
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 500 || confirm !== 'yes') return fail('Bitte gib eine Begründung ein und bestätige die Wiederherstellung.');
  if (!username || username.length > 64 || /[\x00-\x1f\x7f]/.test(username)) return fail('Bitte gib einen Benutzernamen mit 1 bis 64 Zeichen ohne Steuerzeichen ein.');
  if (await UserDeletion.nameInUse(username)) { conflict = true; return fail('Dieser Benutzername ist bereits vergeben. Bitte wähle einen anderen.'); }
  try { await UserDeletion.restore(res.locals.currentUser.id, user.id, username, reason.trim()); }
  catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT') { conflict = true; return fail('Die Wiederherstellung war nicht möglich. Bitte prüfe den Benutzernamen und versuche es erneut.'); }
    throw error;
  }
  res.redirect(303, `/admin/users/${user.id}`);
}));
router.get('/users/new', (req, res) => res.render('admin/user-new', { error: null, username: '', forcePasswordChange: false, ignoreRequirements: false }));
router.post('/users/new', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false }), safe(async (req, res) => {
  const { password, forcePasswordChange, ignoreRequirements } = req.body;
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
  const force = forcePasswordChange === 'yes';
  const ignore = ignoreRequirements === 'yes';
  const fail = (message, status = 400) => res.status(status).render('admin/user-new', { error: message, username, forcePasswordChange: force, ignoreRequirements: ignore });
  if (!username || username.length > 64 || /[\x00-\x1f\x7f]/.test(username)) return fail('Bitte gib einen Benutzernamen mit 1 bis 64 Zeichen ohne Steuerzeichen ein.');
  if (forcePasswordChange !== undefined && forcePasswordChange !== 'yes') return fail('Die Auswahl zur Passwortänderung ist ungültig.');
  if (ignoreRequirements !== undefined && ignoreRequirements !== 'yes') return fail('Die Auswahl zu den Passwortanforderungen ist ungültig.');
  if (typeof password !== 'string' || !password.length || Buffer.byteLength(password, 'utf8') > 72) return fail('Bitte gib ein gültiges Startpasswort ein.');
  if (!ignore && !passwordIsValid(password)) return fail('Das Passwort benötigt mindestens 8 Zeichen, eine Zahl, ein Sonderzeichen sowie einen Groß- und einen Kleinbuchstaben.');
  try {
    const userId = await User.createByAdmin(username, await bcrypt.hash(password, 12), force, res.locals.currentUser.id, ignore);
    req.session.createdUserId = userId;
    res.redirect(303, `/admin/users/${userId}`);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT' && /UNIQUE constraint failed: users\.username/.test(error.message)) return fail('Dieser Benutzername ist bereits vergeben.', 409);
    if (error.code === 'SQLITE_CONSTRAINT') return fail('Der Nutzer konnte nicht angelegt werden. Bitte prüfe deine Berechtigung.', 409);
    throw error;
  }
}));
router.use('/users/:userId', safe(async (req, res, next) => {
  if (!id(req.params.userId)) return missing(res);
  const user = await Admin.user(req.params.userId);
  if (!user) return missing(res);
  res.locals.targetUser = user;
  if (req.method === 'GET') await Admin.audit(res.locals.currentUser.id, 'user.view', user.id);
  next();
}));
router.get('/users/:userId', safe(async (req, res) => {
  const user = res.locals.targetUser;
  const profiles = await Admin.profiles(user.id);
  const allEntries = await Score.allForUser(user.id), allExceptions = await Score.exceptionsForUser(user.id);
  const byProfile = new Map(), exceptionsByProfile = new Map();
  for (const entry of allEntries) { if (!byProfile.has(entry.profile_id)) byProfile.set(entry.profile_id, []); byProfile.get(entry.profile_id).push(entry); }
  for (const item of allExceptions) { if (!exceptionsByProfile.has(item.profile_id)) exceptionsByProfile.set(item.profile_id, []); exceptionsByProfile.get(item.profile_id).push(item.day); }
  for (const profile of profiles) {
    const result = streak(byProfile.get(profile.id) || [], Date.now(), exceptionsByProfile.get(profile.id) || []);
    profile.currentStreak = result.current;
    profile.longestStreak = result.longestStreak;
  }
  const authUser = await User.findById(user.id);
  const created = req.session.createdUserId === user.id;
  if (created) delete req.session.createdUserId;
  res.render('admin/user', { user, created, profiles, notes: await Admin.notes(user.id), sessions: await sessionCount(req, user.id), sessionList: authUser.status === 'active' ? await sessionsFor(req, authUser) : [] });
}));
router.get('/users/:userId/delete', (req, res) => res.render('admin/user-delete', { user: res.locals.targetUser, error: null }));
router.post('/users/:userId/delete', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false }), safe(async (req, res, next) => {
  const { password, reason, confirm } = req.body, target = res.locals.targetUser;
  const fail = (message, status = 400) => res.status(status).render('admin/user-delete', { user: target, error: message });
  if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 72 || typeof reason !== 'string' || !reason.trim() || reason.length > 500 || confirm !== 'yes') return fail('Bitte Passwort und Begründung eingeben und die Löschung bestätigen.');
  const actor = await User.findByUsername(res.locals.currentUser.username);
  if (!actor || !await bcrypt.compare(password, actor.password_hash)) return fail('Das Administrator-Passwort ist nicht korrekt.', 403);
  try { await UserDeletion.remove(actor.id, target.id, reason.trim()); }
  catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT') return fail('Der Nutzer konnte nicht gelöscht werden. Mindestens ein aktiver Administrator muss erhalten bleiben.', 409);
    throw error;
  }
  if (actor.id === target.id) return req.session.destroy(error => {
    if (error) return next(error);
    res.clearCookie('snaptrack.sid', { path: '/' });
    res.redirect(303, '/account-deleted');
  });
  res.redirect(303, '/admin/users/deleted');
}));
router.get('/users/:userId/diagnose', safe(async (req, res) => {
  const user = res.locals.targetUser;
  const profiles = await Admin.profiles(user.id);
  const diagnostics = [];
  for (const profile of profiles) {
    const history = await Admin.scores(user.id, profile.id);
    const exceptions = await Admin.all('SELECT day FROM streak_exceptions WHERE profile_id=?', [profile.id]);
    const invalid = history.filter(entry => !Number.isSafeInteger(entry.score) || entry.score < 0 || !Number.isFinite(Date.parse(entry.created_at))).length;
    const decreases = history.slice(0, -1).filter((entry, index) => entry.score < history[index + 1].score).length;
    diagnostics.push({ profile, invalid, decreases, stats: invalid ? null : analyze(history, Date.now(), exceptions.map(item => item.day)) });
  }
  const foreignKeys = await Admin.all('PRAGMA foreign_key_check');
  await Admin.audit(res.locals.currentUser.id, 'user.diagnose', user.id);
  res.render('admin/diagnose', { user, diagnostics, foreignKeys: foreignKeys.length });
}));
router.get('/users/:userId/deleted', safe(async (req, res) => {
  const user = res.locals.targetUser;
  const deletedProfiles = await Admin.all('SELECT id,username,deleted_at,deleted_by FROM snapchat_profiles WHERE user_id=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC', [user.id]);
  const deletedScores = await Admin.all('SELECT s.id,s.score,s.created_at,s.deleted_at,s.deleted_by,p.id AS profile_id,p.username FROM score_entries s JOIN snapchat_profiles p ON p.id=s.profile_id WHERE p.user_id=? AND p.deleted_at IS NULL AND s.deleted_at IS NOT NULL ORDER BY s.deleted_at DESC', [user.id]);
  for (const item of deletedScores) {
    const history = await Admin.scores(user.id, item.profile_id);
    const ordered = history.concat(item).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);
    const index = ordered.findIndex(entry => entry.id === item.id);
    item.orderWarning = (ordered[index - 1] && ordered[index - 1].score > item.score) || (ordered[index + 1] && ordered[index + 1].score < item.score);
  }
  const retention = Number(process.env.DELETED_RETENTION_DAYS || 30);
  res.render('admin/deleted', { user, deletedProfiles, deletedScores, retention: Number.isInteger(retention) && retention > 0 ? retention : 30 });
}));
router.post('/users/:userId/deleted/action', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false }), safe(async (req, res) => {
  const { action, profileId, entryId, reason, password, confirm } = req.body;
  if (!['restore_profile','restore_score','purge_profile','purge_score'].includes(action) || !id(profileId || '') || (action.endsWith('score') && !id(entryId || '')) || typeof reason !== 'string' || !reason.trim() || reason.length > 500 || confirm !== 'yes') return res.status(400).render('error', { message: 'Bitte prüfe Auswahl, Begründung und Bestätigung.' });
  if (action.startsWith('purge_')) {
    if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 72) return res.status(400).render('error', { message: 'Bitte gib dein Administrator-Passwort ein.' });
    const actor = await User.findByUsername(res.locals.currentUser.username);
    if (!actor || !await bcrypt.compare(password, actor.password_hash)) return res.status(403).render('error', { message: 'Das Administrator-Passwort ist nicht korrekt.' });
  }
  try {
    await Admin.run('INSERT INTO admin_data_actions(admin_id,user_id,profile_id,entry_id,action,reason) VALUES (?,?,?,?,?,?)', [res.locals.currentUser.id, res.locals.targetUser.id, profileId, action.endsWith('score') ? entryId : null, action, reason.trim()]);
    statCache.invalidate(res.locals.targetUser.id, profileId);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT') return res.status(409).render('error', { message: 'Die Daten wurden bereits geändert oder können wegen eines Konflikts nicht wiederhergestellt werden.' });
    throw error;
  }
  res.redirect(303, `/admin/users/${res.locals.targetUser.id}/deleted`);
}));
router.post('/users/:userId/notes', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }), safe(async (req, res) => {
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
  if (!content || content.length > 2000) return res.status(400).render('error', { message: 'Bitte gib eine Notiz mit höchstens 2000 Zeichen ein.' });
  await Admin.addNote(res.locals.currentUser.id, res.locals.targetUser.id, content);
  res.redirect(303, `/admin/users/${res.locals.targetUser.id}#support`);
}));
router.post('/users/:userId/access', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false }), safe(async (req, res) => {
  const { role, status, reason, password, confirm } = req.body;
  if (!['user','admin'].includes(role) || !['active','suspended','disabled'].includes(status) || typeof reason !== 'string' || !reason.trim() || reason.length > 500 || typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 72 || confirm !== 'yes') {
    return res.status(400).render('error', { message: 'Bitte Rolle, Status, Begründung und Passwort eingeben und die Änderung bestätigen.' });
  }
  const actor = await User.findByUsername(res.locals.currentUser.username);
  if (!actor || !await bcrypt.compare(password, actor.password_hash)) return res.status(403).render('error', { message: 'Das Administrator-Passwort ist nicht korrekt.' });
  try {
    await Admin.run('INSERT INTO admin_user_changes (admin_id,user_id,new_role,new_status,reason) VALUES (?,?,?,?,?)', [actor.id, res.locals.targetUser.id, role, status, reason.trim()]);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT') return res.status(409).render('error', { message: 'Die Änderung konnte nicht durchgeführt werden. Mindestens ein aktiver Administrator muss erhalten bleiben.' });
    throw error;
  }
  res.redirect(303, `/admin/users/${res.locals.targetUser.id}`);
}));
router.post('/users/:userId/sessions/revoke', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false }), safe(async (req, res) => {
  const { password, reason, confirm } = req.body;
  if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 72 || typeof reason !== 'string' || !reason.trim() || reason.length > 500 || confirm !== 'yes') return res.status(400).render('error', { message: 'Bitte Passwort, Begründung und Bestätigung eingeben.' });
  const actor = await User.findByUsername(res.locals.currentUser.username);
  if (!actor || !await bcrypt.compare(password, actor.password_hash)) return res.status(403).render('error', { message: 'Das Administrator-Passwort ist nicht korrekt.' });
  await Admin.run('INSERT INTO admin_session_revocations (admin_id,user_id,reason) VALUES (?,?,?)', [actor.id, res.locals.targetUser.id, reason.trim()]);
  res.redirect(303, `/admin/users/${res.locals.targetUser.id}`);
}));
router.post('/users/:userId/sessions/single', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false }), safe(async (req, res) => {
  const { password, reason, confirm, handle } = req.body;
  if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 72 || typeof reason !== 'string' || !reason.trim() || reason.length > 500 || confirm !== 'yes' || typeof handle !== 'string' || !/^[a-f0-9]{64}$/.test(handle)) return res.status(400).render('error', { message: 'Bitte Passwort, Begründung und Bestätigung eingeben.' });
  const actor = await User.findByUsername(res.locals.currentUser.username);
  if (!actor || !await bcrypt.compare(password, actor.password_hash)) return res.status(403).render('error', { message: 'Das Administrator-Passwort ist nicht korrekt.' });
  const target = await User.findById(res.locals.targetUser.id);
  const session = (await sessionsFor(req, target)).find(item => item.handle === handle);
  if (!session) return res.status(409).render('error', { message: 'Die Sitzung ist nicht mehr aktiv.' });
  try { await Admin.run('INSERT INTO revoked_sessions(session_key,user_id,admin_id,expires_at,reason) VALUES(?,?,?,?,?)', [session.handle,target.id,actor.id,session.expires,reason.trim()]); }
  catch (error) { if (error.code === 'SQLITE_CONSTRAINT') return res.status(409).render('error', { message: 'Die Sitzung wurde bereits beendet.' }); throw error; }
  res.redirect(303, `/admin/users/${target.id}`);
}));
router.post('/users/:userId/password/:action', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false }), safe(async (req, res) => {
  const { password, reason, confirm } = req.body;
  if (!['reset','require'].includes(req.params.action) || typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 72 || typeof reason !== 'string' || !reason.trim() || reason.length > 500 || confirm !== 'yes') return res.status(400).render('error', { message: 'Bitte Passwort, Begründung und Bestätigung eingeben.' });
  const actor = await User.findByUsername(res.locals.currentUser.username);
  if (!actor || !await bcrypt.compare(password, actor.password_hash)) return res.status(403).render('error', { message: 'Das Administrator-Passwort ist nicht korrekt.' });
  if (req.params.action === 'require') {
    await Admin.run('INSERT INTO admin_password_requirements(admin_id,user_id,reason) VALUES(?,?,?)', [actor.id,res.locals.targetUser.id,reason.trim()]);
    return res.redirect(303, `/admin/users/${res.locals.targetUser.id}`);
  }
  let base;
  try {
    base = new URL(process.env.PUBLIC_BASE_URL);
    if (base.username || base.password || base.search || base.hash || base.pathname !== '/' || !(base.protocol === 'https:' || (base.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(base.hostname)))) throw new Error('invalid');
  } catch { return res.status(503).render('error', { message: 'PUBLIC_BASE_URL muss auf die vertrauenswürdige HTTPS-Adresse der App gesetzt sein.' }); }
  const token = crypto.randomBytes(32).toString('hex');
  const digest = crypto.createHash('sha256').update(token).digest('hex');
  const target = await User.findById(res.locals.targetUser.id);
  await Admin.run('INSERT INTO password_resets(user_id,admin_id,token_hash,expires_at,session_version,reason) VALUES(?,?,?,?,?,?)', [target.id,actor.id,digest,Date.now() + 30 * 60000,target.session_version,reason.trim()]);
  res.set('Referrer-Policy', 'no-referrer');
  res.render('admin/reset-link', { user: res.locals.targetUser, link: new URL('/reset/' + token, base).href });
}));
router.get('/users/:userId/profiles/:profileId', safe(async (req, res) => {
  const user = res.locals.targetUser;
  if (!id(req.params.profileId)) return missing(res);
  const profile = await Profile.find(user.id, req.params.profileId);
  if (!profile) return missing(res);
  await Admin.audit(res.locals.currentUser.id, 'profile.view', user.id, profile.id);
  const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
  const history = await Score.page(user.id, profile.id, (page - 1) * 50, 51);
  const total = await Score.count(user.id, profile.id);
  const { stats } = await profileStats.insights(user.id, profile);
  const exceptions = await Admin.all('SELECT id,day,reason,created_at FROM streak_exceptions WHERE profile_id=? ORDER BY day DESC', [profile.id]);
  const recent = await Score.range(user.id, profile.id, new Date(Date.now() - 36 * 86400000).toISOString(), new Date().toISOString());
  const observedDays = new Set(recent.map(entry => local(entry.created_at).day));
  const exceptionDays = new Set(exceptions.map(entry => entry.day));
  const today = local(Date.now()).ordinal;
  const calendar = Array.from({ length: 35 }, (_, i) => {
    const day = new Date((today - 34 + i) * 86400000).toISOString().slice(0, 10);
    return { date: day, type: observedDays.has(day) ? 'score' : exceptionDays.has(day) ? 'exception' : 'missing' };
  });
  res.render('admin/profile', { user, profile, history, page, total, exceptions, calendar, stats });
}));
router.get('/users/:userId/profiles/:profileId/chart-data', safe(async (req, res) => {
  if (!id(req.params.profileId)) return missing(res);
  const profile = await Profile.find(res.locals.targetUser.id, req.params.profileId);
  if (!profile) return missing(res);
  const period = req.query.period || '7';
  if (!['1','7','30','183','365','all'].includes(period)) return res.status(400).json({ error: 'Ungültiger Zeitraum.' });
  await Admin.audit(res.locals.currentUser.id, 'profile.chart_view', res.locals.targetUser.id, profile.id);
  res.json({ points: await profileStats.graph(res.locals.targetUser.id, profile, period) });
}));
router.post('/users/:userId/profiles/:profileId/streak', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false }), safe(async (req, res) => {
  const { action, day, reason, confirm } = req.body;
  const validDay = typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day + 'T00:00:00Z')) && new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) === day && day <= local(Date.now()).day;
  if (!id(req.params.profileId) || !['add','remove'].includes(action) || !validDay || typeof reason !== 'string' || !reason.trim() || reason.length > 500 || confirm !== 'yes') return res.status(400).render('error', { message: 'Bitte Datum, Aktion und Begründung prüfen.' });
  const profile = await Admin.profile(res.locals.targetUser.id, req.params.profileId);
  if (!profile) return missing(res);
  if (action === 'add' && (await Admin.scores(res.locals.targetUser.id, profile.id)).some(entry => local(entry.created_at).day === day)) return res.status(409).render('error', { message: 'Für diesen Tag ist bereits ein Score eingetragen.' });
  try { await Admin.run('INSERT INTO admin_streak_actions(admin_id,user_id,profile_id,day,action,reason) VALUES(?,?,?,?,?,?)', [res.locals.currentUser.id, res.locals.targetUser.id, profile.id, day, action, reason.trim()]); }
  catch (error) { if (error.code === 'SQLITE_CONSTRAINT') return res.status(409).render('error', { message: 'Die Ausnahme besteht bereits oder wurde zwischenzeitlich geändert.' }); throw error; }
  statCache.invalidate(res.locals.targetUser.id, profile.id);
  res.redirect(303, `/admin/users/${res.locals.targetUser.id}/profiles/${profile.id}#streak`);
}));
router.get('/users/:userId/profiles/:profileId/scores/:entryId/correct', safe(async (req, res) => {
  if (!id(req.params.profileId) || !id(req.params.entryId)) return missing(res);
  const profile = await Admin.profile(res.locals.targetUser.id, req.params.profileId);
  if (!profile) return missing(res);
  const entry = (await Admin.scores(res.locals.targetUser.id, profile.id)).find(row => row.id === Number(req.params.entryId));
  if (!entry) return missing(res);
  res.render('admin/correct', { user: res.locals.targetUser, profile, entry, preview: null });
}));
router.post('/users/:userId/profiles/:profileId/scores/:entryId/correct', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false }), safe(async (req, res) => {
  const { score, timestamp, reason, step, password, confirm, oldScore, oldTime } = req.body;
  if (!id(req.params.profileId) || !id(req.params.entryId) || typeof score !== 'string' || !/^\d+$/.test(score) || !Number.isSafeInteger(Number(score)) || typeof timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp + 'Z')) || typeof reason !== 'string' || !reason.trim() || reason.length > 500 || !['preview','commit'].includes(step)) return res.status(400).render('error', { message: 'Bitte Score, UTC-Zeitpunkt und Begründung prüfen.' });
  if (new Date(timestamp + 'Z').toISOString().slice(0, 16) !== timestamp.slice(0, 16)) return res.status(400).render('error', { message: 'Bitte einen gültigen UTC-Zeitpunkt eingeben.' });
  const profile = await Admin.profile(res.locals.targetUser.id, req.params.profileId);
  if (!profile) return missing(res);
  const history = await Admin.scores(res.locals.targetUser.id, profile.id);
  const entry = history.find(row => row.id === Number(req.params.entryId));
  if (!entry) return missing(res);
  const newTime = new Date(timestamp + 'Z').toISOString(), newScore = Number(score);
  const historyDigest = crypto.createHash('sha256').update(JSON.stringify(history)).digest('hex');
  if (step === 'preview') {
    const ordered = history.filter(row => row.id !== entry.id).concat({ id: entry.id, score: newScore, created_at: newTime }).sort((a,b) => Date.parse(a.created_at)-Date.parse(b.created_at) || a.id-b.id);
    const index = ordered.findIndex(row => row.id === entry.id), previous = ordered[index - 1], next = ordered[index + 1];
    const warning = (previous && previous.score > newScore) || (next && next.score < newScore);
    req.session.scoreCorrection = { profileId: profile.id, entryId: entry.id, oldScore: entry.score, oldTime: entry.created_at, newScore, newTime, reason: reason.trim(), historyDigest, expires: Date.now() + 10 * 60000 };
    return res.render('admin/correct', { user: res.locals.targetUser, profile, entry, preview: { newScore, newTime, reason: reason.trim(), warning, previous, next } });
  }
  if (confirm !== 'yes' || typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 72 || typeof oldTime !== 'string' || typeof oldScore !== 'string' || !/^\d+$/.test(oldScore)) return res.status(400).render('error', { message: 'Bitte bestätige die Korrektur mit deinem Passwort.' });
  const actor = await User.findByUsername(res.locals.currentUser.username);
  if (!actor || !await bcrypt.compare(password, actor.password_hash)) return res.status(403).render('error', { message: 'Das Administrator-Passwort ist nicht korrekt.' });
  const checked = req.session.scoreCorrection;
  if (!checked || checked.expires < Date.now() || checked.profileId !== profile.id || checked.entryId !== entry.id || checked.oldScore !== Number(oldScore) || checked.oldTime !== oldTime || checked.newScore !== newScore || checked.newTime !== newTime || checked.reason !== reason.trim() || checked.historyDigest !== historyDigest) return res.status(409).render('error', { message: 'Die Daten oder die Vorschau wurden verändert. Bitte prüfe die Korrektur erneut.' });
  try { await Admin.run('INSERT INTO admin_score_corrections(admin_id,user_id,profile_id,entry_id,old_score,old_time,new_score,new_time,reason) VALUES(?,?,?,?,?,?,?,?,?)', [actor.id,res.locals.targetUser.id,profile.id,entry.id,oldScore,oldTime,newScore,newTime,reason.trim()]); }
  catch (error) { if (error.code === 'SQLITE_CONSTRAINT') return res.status(409).render('error', { message: 'Der Eintrag wurde zwischenzeitlich geändert. Bitte prüfe ihn erneut.' }); throw error; }
  statCache.invalidate(res.locals.targetUser.id, profile.id);
  delete req.session.scoreCorrection;
  res.redirect(303, `/admin/users/${res.locals.targetUser.id}/profiles/${profile.id}`);
}));
router.get('/users/:userId/profiles/:profileId/scores/:entryId/delete', safe(async (req, res) => {
  if (!id(req.params.profileId) || !id(req.params.entryId)) return missing(res);
  const profile = await Admin.profile(res.locals.targetUser.id, req.params.profileId);
  if (!profile) return missing(res);
  const entry = (await Admin.scores(res.locals.targetUser.id, profile.id)).find(row => row.id === Number(req.params.entryId));
  if (!entry) return missing(res);
  res.render('admin/delete-score', { user: res.locals.targetUser, profile, entry });
}));
router.post('/users/:userId/profiles/:profileId/scores/:entryId/delete', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false }), safe(async (req, res) => {
  const { reason, password, confirm } = req.body;
  if (!id(req.params.profileId) || !id(req.params.entryId) || typeof reason !== 'string' || !reason.trim() || reason.length > 500 || typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 72 || confirm !== 'yes') return res.status(400).render('error', { message: 'Bitte Begründung, Passwort und Bestätigung prüfen.' });
  const actor = await User.findByUsername(res.locals.currentUser.username);
  if (!actor || !await bcrypt.compare(password, actor.password_hash)) return res.status(403).render('error', { message: 'Das Administrator-Passwort ist nicht korrekt.' });
  try { await Admin.run('INSERT INTO admin_soft_deletions(admin_id,user_id,profile_id,entry_id,reason) VALUES(?,?,?,?,?)', [actor.id,res.locals.targetUser.id,req.params.profileId,req.params.entryId,reason.trim()]); }
  catch (error) { if (error.code === 'SQLITE_CONSTRAINT') return res.status(409).render('error', { message: 'Der Eintrag ist nicht mehr verfügbar.' }); throw error; }
  statCache.invalidate(res.locals.targetUser.id, req.params.profileId);
  res.redirect(303, `/admin/users/${res.locals.targetUser.id}/profiles/${req.params.profileId}`);
}));
router.get('/support', (req, res) => res.render('admin/support'));
router.get('/system', safe(async (req, res) => {
  const check = await Admin.get('PRAGMA quick_check');
  const size = fs.statSync(path.join(dataDir, 'app.sqlite')).size;
  await Admin.audit(res.locals.currentUser.id, 'system.integrity_check');
  res.render('admin/system', { check: check.quick_check, size, uptime: process.uptime(), memory: process.memoryUsage().rss, version: process.version, appVersion: require('../../package.json').version, sessions: await sessionCount(req) });
}));
router.get('/audit', safe(async (req, res) => {
  await Admin.audit(res.locals.currentUser.id, 'audit.view');
  const where = [], params = [];
  for (const [key, column] of [['admin','a.admin_id'], ['user','a.user_id']]) if (id(req.query[key] || '')) { where.push(`${column} = ?`); params.push(req.query[key]); }
  if (typeof req.query.action === 'string' && req.query.action.trim()) { where.push('a.action LIKE ?'); params.push('%' + req.query.action.trim().slice(0, 80).replace(/[\\%_]/g, '\\$&') + '%'); where[where.length-1] += " ESCAPE '\\'"; }
  if (typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)) { where.push('a.created_at >= ?'); params.push(req.query.from); }
  if (typeof req.query.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)) { where.push('a.created_at < date(?, \'+1 day\')'); params.push(req.query.to); }
  const logs = await Admin.all('SELECT a.*, u.username AS admin FROM audit_logs a LEFT JOIN users u ON u.id=a.admin_id' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY a.id DESC LIMIT 200', params);
  res.render('admin/audit', { logs, filters: req.query });
}));
module.exports = router;
