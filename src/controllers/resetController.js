const crypto = require('crypto');
const bcrypt = require('bcrypt');
const Admin = require('../models/admin');
const { passwordIsValid } = require('../utils/password');
const hash = token => crypto.createHash('sha256').update(token).digest('hex');
const validToken = token => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
const errorPage = res => res.status(410).render('error', { message: 'Dieser Link ist ungültig, abgelaufen oder wurde bereits verwendet.' });
exports.page = async (req, res, next) => {
  try {
    if (!validToken(req.params.token)) return errorPage(res);
    const row = await Admin.get("SELECT r.id FROM password_resets r JOIN users u ON u.id=r.user_id WHERE r.token_hash=? AND r.used_at IS NULL AND r.expires_at>? AND u.status='active' AND u.session_version=r.session_version", [hash(req.params.token), Date.now()]);
    if (!row) return errorPage(res);
    res.render('account/reset', { token: req.params.token, error: null });
  } catch (error) { next(error); }
};
exports.submit = async (req, res, next) => {
  try {
    if (!validToken(req.params.token)) return errorPage(res);
    if (!passwordIsValid(req.body.newPassword) || req.body.newPassword !== req.body.confirmPassword) return res.status(400).render('account/reset', { token: req.params.token, error: 'Prüfe die Passwortanforderungen und die Bestätigung.' });
    const passwordHash = await bcrypt.hash(req.body.newPassword, 12);
    const changes = await Admin.run("UPDATE password_resets SET used_at=?, new_password_hash=? WHERE token_hash=? AND used_at IS NULL AND expires_at>? AND EXISTS (SELECT 1 FROM users WHERE id=password_resets.user_id AND status='active' AND session_version=password_resets.session_version)", [Date.now(), passwordHash, hash(req.params.token), Date.now()]);
    if (!changes) return errorPage(res);
    res.render('account/reset-done');
  } catch (error) { next(error); }
};
