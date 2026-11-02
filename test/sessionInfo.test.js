const { test } = require('node:test');
const assert = require('node:assert/strict');
const sessionInfo = require('../src/utils/sessionInfo');

test('iPhone und Safari sowie IPv4-mapped IPv6 erkennen', () => {
  const info = sessionInfo({ ip: '::ffff:192.0.2.1', headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1' } });
  assert.deepEqual(info, { ip: '192.0.2.1', device: 'iPhone · Safari' });
});
test('iOS-Browser und ältere bzw. ungültige Angaben sicher behandeln', () => {
  assert.equal(sessionInfo({ ip: '2001:db8::1', headers: { 'user-agent': 'Mozilla/5.0 (iPhone) CriOS/120 Mobile Safari/604.1' } }).device, 'iPhone · Chrome');
  assert.deepEqual(sessionInfo({ ip: 'untrusted, 192.0.2.1', headers: {} }), { ip: null, device: null });
  assert.equal(sessionInfo({ ip: '::1', headers: { 'user-agent': '<script>alert(1)</script>' } }).device, 'Unbekanntes Gerät');
});
