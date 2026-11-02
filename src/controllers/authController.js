const bcrypt = require('bcrypt');
const User = require('../models/user');
const { db } = require('../config/database');
const sessionInfo = require('../utils/sessionInfo');

// Auch bei unbekannten Nutzern einen bcrypt-Vergleich ausführen.
const dummyHash = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxbLk2GzvVYx4.2mP0y0w5gK5eK';

exports.loginPage = (req, res) => {
  if (res.locals.currentUser) return res.redirect('/');
  res.render('login', { error: null });
};

exports.login = async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (typeof username !== 'string' || typeof password !== 'string' || username.length > 64 || Buffer.byteLength(password, 'utf8') > 72) {
      return res.status(400).render('login', { error: 'Benutzername oder Passwort ist ungültig.' });
    }
    const user = await User.findByUsername(username.trim());
    const valid = await bcrypt.compare(password, user ? user.password_hash : dummyHash);
    if (!user || !valid || user.status !== 'active') return res.status(401).render('login', { error: 'Benutzername oder Passwort ist ungültig oder das Konto ist nicht aktiv.' });
    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.userId = user.id;
      req.session.sessionVersion = user.session_version;
      req.session.sessionInfo = sessionInfo(req);
      db.run('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
      req.session.save((saveError) => saveError ? next(saveError) : res.redirect('/'));
    });
  } catch (error) { next(error); }
};

exports.logout = (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('snaptrack.sid', { path: '/' });
    res.redirect('/login');
  });
};
