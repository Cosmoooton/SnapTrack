const express = require('express');
const rateLimit = require('express-rate-limit');
const auth = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const profiles = require('../controllers/profileController');
const account = require('../controllers/accountController');
const reset = require('../controllers/resetController');

const router = express.Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: 'Zu viele Anmeldeversuche. Bitte versuchen Sie es später erneut.'
});
router.get('/login', auth.loginPage);
router.post('/login', loginLimiter, auth.login);
router.get('/reset/:token', reset.page);
router.post('/reset/:token', loginLimiter, reset.submit);
router.post('/logout', requireAuth, auth.logout);
router.get('/account-deleted', (req, res) => res.render('account/deleted'));
router.get('/account', requireAuth, account.settings);
router.get('/account/delete', requireAuth, account.deletePage);
router.post('/account/delete', requireAuth, rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false }), account.deleteAccount);
router.get('/account/password', requireAuth, account.passwordPage);
router.post('/account/password', requireAuth, rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: 'Zu viele Versuche. Bitte versuchen Sie es später erneut.' }), account.changePassword);
router.get('/', requireAuth, profiles.index);
router.get('/profiles', requireAuth, profiles.manage);
router.get('/profiles/new', requireAuth, profiles.newForm);
router.post('/profiles', requireAuth, profiles.create);
router.get('/profiles/:id', requireAuth, profiles.show);
router.get('/profiles/:id/chart-data', requireAuth, profiles.chartData);
router.get('/profiles/:id/score-neighbor', requireAuth, profiles.scoreNeighbor);
router.get('/profiles/:id/scores/bulk', requireAuth, profiles.bulkPage);
router.post('/profiles/:id/scores/bulk', requireAuth, profiles.bulkSave);
router.get('/profiles/:id/scores/import', requireAuth, profiles.importPage);
router.post('/profiles/:id/scores/import/preview', requireAuth, profiles.importPreview);
router.post('/profiles/:id/scores', requireAuth, profiles.createScore);
router.post('/scores/undo', requireAuth, profiles.undoScore);
router.get('/profiles/:id/scores/:entryId/edit', requireAuth, profiles.editScoreForm);
router.post('/profiles/:id/scores/:entryId/edit', requireAuth, profiles.editScore);
router.get('/profiles/:id/scores/:entryId/delete', requireAuth, profiles.deleteScoreForm);
router.post('/profiles/:id/scores/:entryId/delete', requireAuth, profiles.deleteScore);
router.get('/profiles/:id/edit', requireAuth, profiles.editForm);
router.post('/profiles/:id/edit', requireAuth, profiles.update);
router.get('/profiles/:id/delete', requireAuth, profiles.deleteForm);
router.post('/profiles/:id/delete', requireAuth, profiles.remove);
module.exports = router;
