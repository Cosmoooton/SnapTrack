const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyze, streak } = require('../src/utils/scoreStats');
const entry = (id, created_at, score = 100) => ({ id, created_at, score });

test('fehlende und identische Zeitpunkte erzeugen keine ungültigen Durchschnittswerte', () => {
  assert.equal(analyze([]).daily, null);
  const rows = Array.from({ length: 5 }, (_, i) => entry(i + 1, '2026-01-01T12:00:00Z', 100 + i));
  const stats = analyze(rows);
  assert.equal(stats.daily, null); assert.equal(stats.hourly, null);
  assert.equal(stats.qualifiedTime, 0); assert.equal(stats.tracking.average, 0);
});
test('Streak folgt Berliner Kalendertagen über Sommerzeit und berücksichtigt gestern', () => {
  const rows = [entry(1, '2026-03-29T00:30:00Z'), entry(2, '2026-03-29T22:30:00Z')];
  const result = streak(rows, Date.parse('2026-03-31T10:00:00Z'));
  assert.equal(result.current, 2); assert.equal(result.longestStreak, 2);
  assert.equal(streak(rows, Date.parse('2026-04-01T10:00:00Z')).current, 0);
});
test('Streak über Winterzeit und mehrere Einträge am selben Tag', () => {
  const rows = [entry(1, '2026-10-24T21:00:00Z'), entry(2, '2026-10-25T00:30:00Z'), entry(3, '2026-10-25T02:30:00Z'), entry(4, '2026-10-25T23:30:00Z')];
  const result = streak(rows, Date.parse('2026-10-26T12:00:00Z'));
  assert.equal(result.current, 3); assert.equal(result.longestStreak, 3);
});
test('Streak-Ausnahmen füllen Lücken ohne künstliche Score-Einträge', () => {
  const rows = [entry(1, '2026-03-28T12:00:00Z'), entry(2, '2026-03-30T12:00:00Z')];
  assert.equal(streak(rows, Date.parse('2026-03-30T16:00:00Z')).current, 1);
  assert.equal(streak(rows, Date.parse('2026-03-30T16:00:00Z'), ['2026-03-29']).current, 3);
  assert.equal(analyze(rows, Date.parse('2026-03-30T16:00:00Z'), ['2026-03-29']).count, 2);
});
test('große Lücken und negative Änderungen zählen nicht als Aktivitätsintervalle', () => {
  const rows = [entry(1, '2026-01-01T08:00:00Z', 100), entry(2, '2026-01-02T08:00:00Z', 200), entry(3, '2026-01-02T08:30:00Z', 150), entry(4, '2026-01-02T09:00:00Z', 160)];
  const stats = analyze(rows);
  assert.equal(stats.qualifiedWeek, 1); assert.equal(stats.qualifiedTime, 1);
  assert.equal(stats.hasNegative, true); assert.equal(stats.weekReady, false); assert.equal(stats.timeReady, false);
});
test('Voraussetzungen und Differenzen verwenden tatsächliche Einträge', () => {
  const rows = [entry(1, '2026-01-01T10:00:00Z', 10), entry(2, '2026-01-01T16:00:00Z', 20), entry(3, '2026-01-02T10:00:00Z', 20), entry(4, '2026-01-02T16:00:00Z', 50), entry(5, '2026-01-03T10:00:00Z', 60)];
  const s = analyze(rows); assert.equal(s.gain, 50); assert.equal(s.daily, 25); assert.equal(s.biggest.gain, 30); assert.equal(s.still.ms, 18 * 3600000); assert.equal(s.tracking.days, 3);
});
test('Aktivitätszeiten benötigen Daten an sieben Tagen und zwei ausreichend erfasste Zeitfenster', () => {
  const rows = []; let id = 1, value = 0;
  for (let day = 1; day <= 7; day++) {
    for (const hour of [1, 2, 3, 4, 5, 7, 8, 9, 10, 11]) {
      rows.push(entry(id++, `2026-01-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`, value));
      value += 10;
    }
  }
  const result = analyze(rows);
  assert(result.qualifiedTime >= 30); assert.equal(result.timeReady, true);
  assert(result.timeWindows.filter(w => w.rate !== null).length >= 2);
});
test('Gleichstand bei Eingabezeiten liefert keinen Favoriten', () => {
  const rows = Array.from({ length: 16 }, (_, i) => entry(i + 1, `2026-01-${String(1 + Math.floor(i / 2)).padStart(2, '0')}T${i % 2 ? '12' : '00'}:00:00Z`, i));
  assert.equal(analyze(rows).tracking.favorite, null);
});
