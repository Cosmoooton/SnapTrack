const net = require('net');

function sessionInfo(req) {
  let ip = typeof req.ip === 'string' ? req.ip : '';
  if (ip.startsWith('::ffff:') && net.isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  if (!net.isIP(ip)) ip = null;
  const agent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 512) : '';
  let device = null;
  if (agent) {
    const system = /iPhone/i.test(agent) ? 'iPhone' : /iPad/i.test(agent) || (/Macintosh/i.test(agent) && /Mobile/i.test(agent)) ? 'iPad' : /iPod/i.test(agent) ? 'iPod' : /Android/i.test(agent) ? 'Android' : /Windows/i.test(agent) ? 'Windows' : /Macintosh|Mac OS X/i.test(agent) ? 'Mac' : /Linux/i.test(agent) ? 'Linux' : 'Unbekanntes Gerät';
    const browser = /EdgiOS|EdgA|Edg\//i.test(agent) ? 'Edge' : /OPiOS|OPR\//i.test(agent) ? 'Opera' : /FxiOS|Firefox\//i.test(agent) ? 'Firefox' : /CriOS|Chrome\//i.test(agent) ? 'Chrome' : /Safari\//i.test(agent) ? 'Safari' : null;
    device = browser ? `${system} · ${browser}` : system;
  }
  return { ip, device };
}

module.exports = sessionInfo;
