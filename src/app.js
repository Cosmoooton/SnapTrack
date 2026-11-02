const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const crypto = require('crypto');
const { dataDir, ready } = require('./config/database');
const { loadUser } = require('./middleware/auth');
const assets = require('./config/assets');
const fs = require('fs');

function createApp() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET muss mindestens 32 Zeichen lang sein.');
  const app = express();
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.locals.assetBase = assets.base;
  app.disable('x-powered-by');
  app.use(helmet());
  for (const asset of assets.content) app.get(`${assets.base}/${asset.url}`, assets.serve(asset));
  app.use('/vendor/bootstrap', express.static(path.join(__dirname, '../node_modules/bootstrap/dist')));
  app.use('/vendor/bootstrap-icons', express.static(path.join(__dirname, '../node_modules/bootstrap-icons/font')));
  app.use('/vendor/chartjs', express.static(path.join(__dirname, '../node_modules/chart.js/dist')));
  app.use('/vendor/chartjs-date', express.static(path.join(__dirname, '../node_modules/chartjs-adapter-date-fns/dist')));
  app.use('/css', express.static(path.join(__dirname, 'public/css')));
  app.use('/js', express.static(path.join(__dirname, 'public/js')));
  app.use('/icons', express.static(path.join(__dirname, 'public/icons')));
  app.get('/manifest.webmanifest', (req, res) => { const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'public/manifest.webmanifest'), 'utf8')); manifest.icons.forEach(icon => { icon.src = assets.base + icon.src; }); res.set('Cache-Control', 'no-cache').type('application/manifest+json').send(manifest); });
  app.get('/sw.js', (req, res) => { res.set('Cache-Control', 'no-cache').type('application/javascript').send(`const ASSET_BASE=${JSON.stringify(assets.base)};\nconst ASSET_PATHS=${JSON.stringify(assets.files.map(([url]) => url))};\n` + fs.readFileSync(path.join(__dirname, 'public/sw.js'), 'utf8')); });
  app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use((req, res, next) => { ready.then(() => next(), next); });
  app.use(express.urlencoded({ extended: false, limit: '10kb' }));
  app.use(session({
    name: 'snaptrack.sid',
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: dataDir }),
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 30 * 24 * 60 * 60 * 1000 }
  }));
  app.use((req, res, next) => {
    if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    res.locals.csrfToken = req.session.csrfToken;
    if (req.method === 'POST') {
      const supplied = typeof req.body._csrf === 'string' ? Buffer.from(req.body._csrf) : Buffer.alloc(0);
      const expected = Buffer.from(req.session.csrfToken);
      if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
        return res.status(403).render('error', { message: 'Die Anfrage ist ungültig. Bitte laden Sie die Seite erneut.' });
      }
    }
    next();
  });
  app.use(loadUser);
  app.use((req, res, next) => {
    if (res.locals.currentUser && res.locals.currentUser.force_password_change && !['/account/password', '/logout'].includes(req.path)) return res.redirect('/account/password');
    next();
  });
  app.use('/admin', require('./routes/admin'));
  app.use(require('./routes'));
  app.use((req, res) => res.status(404).render('error', { message: 'Diese Seite wurde nicht gefunden.' }));
  app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).render('error', { message: 'Ein unerwarteter Fehler ist aufgetreten.' });
  });
  return app;
}
module.exports = createApp;
