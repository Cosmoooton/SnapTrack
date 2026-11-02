const User = require('../models/user');
const sessionKey = require('../utils/sessionKey');

async function loadUser(req, res, next) {
  try {
    res.locals.currentUser = req.session.userId ? await User.findById(req.session.userId) : null;
    if (res.locals.currentUser && (res.locals.currentUser.status !== 'active' || (req.session.sessionVersion || 0) !== res.locals.currentUser.session_version || await User.sessionRevoked(sessionKey(req.sessionID)))) res.locals.currentUser = null;
    if (req.session.userId && !res.locals.currentUser) delete req.session.userId;
    next();
  } catch (error) { next(error); }
}

function requireAuth(req, res, next) {
  if (!res.locals.currentUser) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!res.locals.currentUser) return res.redirect('/login');
  if (res.locals.currentUser.role !== 'admin') return res.status(403).render('error', { message: 'Für diesen Bereich fehlen dir die Berechtigungen.' });
  next();
}

module.exports = { loadUser, requireAuth, requireAdmin };
