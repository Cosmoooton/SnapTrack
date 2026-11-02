const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const files = [
  ['css/style.css', 'src/public/css/style.css'], ['js/scores.js', 'src/public/js/scores.js'], ['js/bulk.js', 'src/public/js/bulk.js'], ['js/historical-scores.js', 'src/utils/historicalScores.js'], ['js/smartpaste.js', 'src/public/js/smartpaste.js'],
  ['js/score-chart.js', 'src/public/js/score-chart.js'], ['js/password.js', 'src/public/js/password.js'], ['js/password-toggle.js', 'src/public/js/password-toggle.js'], ['js/pwa.js', 'src/public/js/pwa.js'],
  ['vendor/bootstrap/css/bootstrap.min.css', 'node_modules/bootstrap/dist/css/bootstrap.min.css'],
  ['vendor/bootstrap/js/bootstrap.bundle.min.js', 'node_modules/bootstrap/dist/js/bootstrap.bundle.min.js'],
  ['vendor/bootstrap-icons/bootstrap-icons.min.css', 'node_modules/bootstrap-icons/font/bootstrap-icons.min.css'],
  ['vendor/bootstrap-icons/fonts/bootstrap-icons.woff2', 'node_modules/bootstrap-icons/font/fonts/bootstrap-icons.woff2'],
  ['vendor/bootstrap-icons/fonts/bootstrap-icons.woff', 'node_modules/bootstrap-icons/font/fonts/bootstrap-icons.woff'],
  ['vendor/chartjs/chart.umd.js', 'node_modules/chart.js/dist/chart.umd.js'],
  ['vendor/chartjs-date/chartjs-adapter-date-fns.bundle.min.js', 'node_modules/chartjs-adapter-date-fns/dist/chartjs-adapter-date-fns.bundle.min.js'],
  ['icons/icon-192.png', 'src/public/icons/icon-192.png'], ['icons/icon-512.png', 'src/public/icons/icon-512.png'],
  ['icons/apple-touch-icon.png', 'src/public/icons/apple-touch-icon.png']
];
const hash = crypto.createHash('sha256');
// Auch die Auslieferung beeinflusst die Cache-Version: fehlerhafte alte Antworten
// dürfen nach einem Fix nicht unter derselben unveränderlichen URL verbleiben.
hash.update('asset-headers-v2');
const content = files.map(([url, file]) => {
  const bytes = fs.readFileSync(path.join(root, file));
  hash.update(url).update(bytes);
  return { url, file, bytes };
});
const version = hash.digest('hex').slice(0, 20);
function serve(asset) {
  return (req, res) => res.set('Cache-Control', 'public, max-age=31536000, immutable').type(path.extname(asset.file)).send(asset.bytes);
}
module.exports = { version, base: `/assets/${version}`, files, content, root, serve };
