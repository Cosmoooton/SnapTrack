const bcrypt = require('bcrypt');
const User = require('../models/user');
const { passwordIsValid } = require('../utils/password');
const sessionInfo = require('../utils/sessionInfo');
const UserDeletion = require('../models/userDeletion');

exports.settings = (req, res) => res.render('account/settings');
exports.deletePage = (req, res) => res.render('account/delete', { error: null });
exports.deleteAccount = async (req, res, next) => {
  try {
    const { password, confirm } = req.body;
    const fail = (message, status = 400) => res.status(status).render('account/delete', { error: message });
    if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 72 || confirm !== 'yes') return fail('Bitte gib dein Passwort ein und bestätige die Löschung.');
    const user = await User.findByUsername(res.locals.currentUser.username);
    if (!user || !await bcrypt.compare(password, user.password_hash)) return fail('Das Passwort ist nicht korrekt.', 403);
    try { await UserDeletion.remove(user.id, user.id, 'Nutzer hat sein Konto selbst gelöscht'); }
    catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT') return fail('Das Konto konnte nicht gelöscht werden. Mindestens ein aktiver Administrator muss erhalten bleiben.', 409);
      throw error;
    }
    req.session.destroy(error => {
      if (error) return next(error);
      res.clearCookie('snaptrack.sid', { path: '/' });
      res.redirect(303, '/account-deleted');
    });
  } catch (error) { next(error); }
};

exports.passwordPage = (req, res) => res.render('account/password', { error: null, success: req.query.changed === '1' });

exports.changePassword = async (req, res, next) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  const fail = message => res.status(400).render('account/password', { error: message, success: false });
  try {
    const user = await User.findByUsername(res.locals.currentUser.username);
    if (!user) return fail('Das Konto wurde nicht gefunden.');
    if (!user.force_password_change) {
      if (typeof currentPassword !== 'string' || Buffer.byteLength(currentPassword, 'utf8') > 72) return fail('Das bisherige Passwort ist ungültig.');
      if (!await bcrypt.compare(currentPassword, user.password_hash)) return fail('Das bisherige Passwort ist nicht korrekt.');
    }
    if (!passwordIsValid(newPassword)) return fail('Das neue Passwort erfüllt nicht alle Anforderungen.');
    if (newPassword !== confirmPassword) return fail('Die neuen Passwörter stimmen nicht überein.');
    const hash = await bcrypt.hash(newPassword, 12);
    if (!await User.changePassword(user.id, user.password_hash, hash)) return fail('Das Passwort wurde zwischenzeitlich geändert. Bitte versuchen Sie es erneut.');
    req.session.regenerate(error => {
      if (error) return next(error);
      req.session.userId = user.id;
      req.session.sessionVersion = user.session_version + 1;
      req.session.sessionInfo = sessionInfo(req);
      req.session.save(saveError => saveError ? next(saveError) : res.redirect('/account/password?changed=1'));
    });
  } catch (error) { next(error); }
};
