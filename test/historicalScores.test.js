const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseNote, berlinInstant, dayBreakSuggestions } = require('../src/utils/historicalScores');

test('parses note formats and keeps invalid lines visible', () => {
  const entries = parseNote('13:30 58238\n13:30 - 58238\n13:30: 58238\n13:30 | 58238\n13:30 58.238\n\n25:00 1\n12:00 58.23');
  assert.equal(entries.length, 7);
  assert.deepEqual(entries.slice(0, 5).map(x => x.score), Array(5).fill(58238));
  assert.equal(entries[5].line, 7);
  assert.ok(entries[5].error && entries[6].error);
});

test('preserves order in large notes and suggests rollovers for either sort order', () => {
  const note = Array.from({ length: 55 }, (_, i) => `${String(i % 24).padStart(2, '0')}:15 ${50000 + i}`).join('\n');
  const entries = parseNote(note);
  assert.equal(entries.length, 55);
  assert.deepEqual(dayBreakSuggestions(entries), dayBreakSuggestions([...entries].reverse(), true));
  assert.equal(dayBreakSuggestions(entries).filter(x => x.suggestedNewDay).length, 2);
});

test('converts Berlin local time without guessing during daylight saving changes', () => {
  assert.equal(berlinInstant('2026-01-01', '12:00').instant, '2026-01-01T11:00:00.000Z');
  assert.equal(berlinInstant('2026-07-01', '12:00').instant, '2026-07-01T10:00:00.000Z');
  assert.equal(berlinInstant('2026-03-29', '02:30').error, 'nonexistent');
  assert.equal(berlinInstant('2026-10-25', '02:30').error, 'ambiguous');
  assert.equal(berlinInstant('2026-02-30', '12:00').error, 'invalid');
});
