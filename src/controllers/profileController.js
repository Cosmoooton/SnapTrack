const Profile = require('../models/profile');
const Score = require('../models/score');
const crypto = require('crypto');
const scoreDuration = require('../utils/scoreDuration');
const { streak } = require('../utils/scoreStats');
const profileStats = require('../services/profileStats');
const statCache = require('../utils/statCache');

function takeScoreNotice(req, destination) {
  if (req.session.scoreNotice !== destination) return false;
  delete req.session.scoreNotice;
  const undo = req.session.scoreUndo;
  const effect = req.session.streakEffect;
  delete req.session.streakEffect;
  return undo && undo.expires > Date.now() ? { key: undo.key, expires: undo.expires, effect } : { effect };
}
const wantsJson = req => req.accepts(['html', 'json']) === 'json';

const notFound = res => res.status(404).render('error', { message: 'Dieses Profil wurde nicht gefunden.' });
const validId = id => /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id));
const validate = value => {
  if (typeof value !== 'string') return { username: '', error: 'Bitte geben Sie einen Benutzernamen ein.' };
  const username = value.trim();
  if (!/^[a-zA-Z0-9._-]{3,30}$/.test(username)) {
    return { username, error: 'Bitte geben Sie 3 bis 30 Zeichen ein: Buchstaben, Zahlen, Punkt, Unterstrich oder Bindestrich.' };
  }
  return { username, error: null };
};
const duplicate = error => error.code === 'SQLITE_CONSTRAINT';
const form = (res, options) => res.render('profiles/form', options);

exports.index = async (req, res, next) => {
  try {
    const userId = res.locals.currentUser.id;
    const profiles = await Profile.all(userId);
    const scores = await Score.latestForUser(userId);
    const cached = new Map(profiles.map(profile => [profile.id, profileStats.cachedStreak(userId, profile)]));
    const missing = profiles.filter(profile => !cached.get(profile.id).found).map(profile => profile.id);
    const entries = [], exceptions = [];
    for (let offset = 0; offset < missing.length; offset += 500) {
      const batch = missing.slice(offset, offset + 500);
      entries.push(...await Score.allForUser(userId, batch));
      exceptions.push(...await Score.exceptionsForUser(userId, batch));
    }
    const entriesByProfile = new Map(), exceptionsByProfile = new Map(), scoresByProfile = new Map();
    for (const item of entries) { if (!entriesByProfile.has(item.profile_id)) entriesByProfile.set(item.profile_id, []); entriesByProfile.get(item.profile_id).push(item); }
    for (const item of exceptions) { if (!exceptionsByProfile.has(item.profile_id)) exceptionsByProfile.set(item.profile_id, []); exceptionsByProfile.get(item.profile_id).push(item.day); }
    for (const item of scores) { if (!scoresByProfile.has(item.profile_id)) scoresByProfile.set(item.profile_id, []); scoresByProfile.get(item.profile_id).push(item); }
    for (const profile of profiles) {
      profile.scores = scoresByProfile.get(profile.id) || [];
      profile.submissionKey = crypto.randomUUID();
      profile.streak = cached.get(profile.id).found ? cached.get(profile.id).value : await profileStats.dashboardStreak(userId, profile, entriesByProfile.get(profile.id) || [], exceptionsByProfile.get(profile.id) || []);
    }
    res.render('home', { profiles, scoreDuration, scoreSaved: takeScoreNotice(req, '/') });
  }
  catch (error) { next(error); }
};
exports.manage = async (req, res, next) => {
  try { res.render('profiles/index', { profiles: await Profile.all(res.locals.currentUser.id) }); }
  catch (error) { next(error); }
};
exports.show = async (req, res, next) => {
  try {
    const profile = validId(req.params.id) && await Profile.find(res.locals.currentUser.id, req.params.id);
    if (!profile) return notFound(res);
    const createdAt = new Date(profile.created_at.replace(' ', 'T') + 'Z');
    const createdDate = Number.isNaN(createdAt.getTime()) ? 'Nicht verfügbar' : new Intl.DateTimeFormat('de-DE', { dateStyle: 'long', timeZone: 'Europe/Berlin' }).format(createdAt);
    const userId = res.locals.currentUser.id;
    profile.scores = await Score.page(userId, profile.id, 0, 2);
    profile.submissionKey = crypto.randomUUID();
    const activeTab = ['liste', 'verlauf', 'fakten', 'tracking'].includes(req.query.tab) ? req.query.tab : 'verlauf';
    const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
    let history = [], stats = null, hasNext = false;
    if (activeTab === 'liste') { history = await Score.page(userId, profile.id, (page - 1) * 50, 51); hasNext = history.length > 50; }
    if (activeTab === 'fakten' || activeTab === 'tracking') ({ stats } = await profileStats.insights(userId, profile));
    const actionNotice = req.session.actionNotice;
    delete req.session.actionNotice;
    res.render('profiles/show', { profile, createdDate, history, stats, activeTab, page, hasNext, scoreDuration, actionNotice, scoreSaved: takeScoreNotice(req, `/profiles/${profile.id}`) });
  } catch (error) { next(error); }
};
exports.chartData = async (req, res, next) => {
  try {
    const profile = validId(req.params.id) && await Profile.find(res.locals.currentUser.id, req.params.id);
    if (!profile) return res.status(404).json({ error: 'Account nicht gefunden.' });
    const period = req.query.period || '7';
    if (!['1','7','30','183','365','all'].includes(period)) return res.status(400).json({ error: 'Ungültiger Zeitraum.' });
    res.json({ points: await profileStats.graph(res.locals.currentUser.id, profile, period) });
  } catch (error) { next(error); }
};
exports.createScore = async (req, res, next) => {
  try {
    const userId = res.locals.currentUser.id;
    const profile = validId(req.params.id) && await Profile.find(userId, req.params.id);
    if (!profile) return notFound(res);
    const { score, submissionKey, returnTo } = req.body;
    if (typeof score !== 'string' || !/^\d+$/.test(score) || !Number.isSafeInteger(Number(score)) ||
        typeof submissionKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionKey)) {
      return res.status(400).render('error', { message: 'Bitte gib den Snapscore als ganze Zahl ohne Minuszeichen oder Komma ein. Er darf höchstens 9.007.199.254.740.991 betragen.' });
    }
    let entry = await Score.findByKey(userId, profile.id, submissionKey);
    let created = 0;
    if (!entry) {
      created = await Score.createNondecreasing(userId, profile.id, Number(score), submissionKey);
      if (created) statCache.invalidate(userId, profile.id);
      entry = await Score.findByKey(userId, profile.id, submissionKey);
    }
    if (!entry || entry.score !== Number(score)) {
      const message = 'Der neue Score darf nicht kleiner als der zuletzt gespeicherte Score sein. Prüfe deine Eingabe.';
      return wantsJson(req) ? res.status(409).json({ error: message }) : res.status(409).render('error', { message });
    }
    const destination = returnTo === 'profile' ? `/profiles/${profile.id}` : '/';
    if (created) {
      const history = await Score.history(userId, profile.id);
      const exceptions = (await Score.exceptionsForUser(userId)).filter(item => item.profile_id === profile.id).map(item => item.day);
      const before = streak(history.filter(item => item.id !== entry.id), Date.now(), exceptions).current;
      const after = streak(history, Date.now(), exceptions).current;
      if (after >= 2 && after > before) {
        let milestone = null;
        if ([7, 14, 30, 60, 100].includes(after) && await Score.markMilestone(userId, profile.id, after)) milestone = after;
        req.session.streakEffect = { profileId: profile.id, milestone };
      } else { delete req.session.streakEffect; }
    }
    const expires = Date.parse(entry.created_at) + 30000;
    req.session.scoreNotice = destination;
    req.session.scoreUndo = { userId, profileId: profile.id, entryId: entry.id, key: submissionKey, expires };
    req.session.save(error => error ? next(error) : wantsJson(req) ? res.json({ redirect: destination }) : res.redirect(303, destination));
  } catch (error) { next(error); }
};
exports.undoScore = async (req, res, next) => {
  try {
    const undo = req.session.scoreUndo;
    if (!undo || undo.userId !== res.locals.currentUser.id || undo.expires < Date.now() || req.body.key !== undo.key) {
      return res.status(410).render('error', { message: 'Rückgängig ist für diesen Eintrag nicht mehr möglich.' });
    }
    const entry = await Score.findByKey(undo.userId, undo.profileId, undo.key);
    if (entry && entry.id === undo.entryId) { await Score.remove(undo.userId, undo.profileId, undo.entryId); statCache.invalidate(undo.userId, undo.profileId); }
    delete req.session.scoreUndo;
    delete req.session.scoreNotice;
    delete req.session.streakEffect;
    req.session.save(error => error ? next(error) : res.redirect(303, req.body.returnTo === 'profile' ? `/profiles/${undo.profileId}` : '/'));
  } catch (error) { next(error); }
};
async function scoreEntry(req) {
  if (!validId(req.params.id) || !validId(req.params.entryId)) return null;
  return Score.find(req.res.locals.currentUser.id, req.params.id, req.params.entryId);
}
exports.editScoreForm = async (req, res, next) => {
  try {
    const entry = await scoreEntry(req);
    if (!entry) return notFound(res);
    res.render('profiles/score-edit', { entry, profileId: req.params.id, error: null });
  } catch (error) { next(error); }
};
exports.editScore = async (req, res, next) => {
  try {
    const entry = await scoreEntry(req);
    if (!entry) return notFound(res);
    const value = req.body.score;
    if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
      return res.status(400).render('profiles/score-edit', { entry, profileId: req.params.id, error: 'Bitte gib eine ganze Zahl ohne Komma oder Minuszeichen ein (höchstens 9.007.199.254.740.991).' });
    }
    if (!await Score.update(res.locals.currentUser.id, req.params.id, entry.id, Number(value))) return notFound(res);
    statCache.invalidate(res.locals.currentUser.id, req.params.id);
    req.session.actionNotice = 'Score geändert.';
    res.redirect(303, `/profiles/${req.params.id}?tab=liste`);
  } catch (error) { next(error); }
};
exports.deleteScoreForm = async (req, res, next) => {
  try {
    const entry = await scoreEntry(req);
    if (!entry) return notFound(res);
    res.render('profiles/score-delete', { entry, profileId: req.params.id });
  } catch (error) { next(error); }
};
exports.deleteScore = async (req, res, next) => {
  try {
    if (!validId(req.params.id) || !validId(req.params.entryId) || !await Score.remove(res.locals.currentUser.id, req.params.id, req.params.entryId)) return notFound(res);
    statCache.invalidate(res.locals.currentUser.id, req.params.id);
    req.session.actionNotice = 'Eintrag gelöscht.';
    res.redirect(303, `/profiles/${req.params.id}?tab=liste`);
  } catch (error) { next(error); }
};
exports.newForm = (req, res) => form(res, { profile: null, username: '', error: null });
exports.create = async (req, res, next) => {
  const { username, error } = validate(req.body.username);
  if (error) return res.status(400).render('profiles/form', { profile: null, username, error });
  try {
    await Profile.create(res.locals.currentUser.id, username);
    res.redirect('/profiles');
  } catch (err) {
    if (duplicate(err)) return res.status(409).render('profiles/form', { profile: null, username, error: 'Dieses Profil ist bereits vorhanden.' });
    next(err);
  }
};
exports.editForm = async (req, res, next) => {
  try {
    const profile = validId(req.params.id) && await Profile.find(res.locals.currentUser.id, req.params.id);
    if (!profile) return notFound(res);
    form(res, { profile, username: profile.username, error: null });
  } catch (error) { next(error); }
};
exports.update = async (req, res, next) => {
  try {
    const profile = validId(req.params.id) && await Profile.find(res.locals.currentUser.id, req.params.id);
    if (!profile) return notFound(res);
    const { username, error } = validate(req.body.username);
    if (error) return res.status(400).render('profiles/form', { profile, username, error });
    try {
      const changed = await Profile.update(res.locals.currentUser.id, profile.id, username);
      if (!changed) return notFound(res);
      statCache.invalidate(res.locals.currentUser.id, profile.id);
      res.redirect('/profiles');
    } catch (err) {
      if (duplicate(err)) return res.status(409).render('profiles/form', { profile, username, error: 'Dieses Profil ist bereits vorhanden.' });
      next(err);
    }
  } catch (error) { next(error); }
};
exports.deleteForm = async (req, res, next) => {
  try {
    const profile = validId(req.params.id) && await Profile.find(res.locals.currentUser.id, req.params.id);
    if (!profile) return notFound(res);
    res.render('profiles/delete', { profile });
  } catch (error) { next(error); }
};
exports.remove = async (req, res, next) => {
  try {
    if (!validId(req.params.id) || !await Profile.remove(res.locals.currentUser.id, req.params.id)) return notFound(res);
    statCache.invalidate(res.locals.currentUser.id, req.params.id);
    res.redirect('/profiles');
  } catch (error) { next(error); }
};
