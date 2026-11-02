// Helpers for preparing historical measurements. Date assignments are always
// explicit: a clock rollover is a suggestion, never proof of a new day.
const berlin = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});

function parseNote(text) {
  if (typeof text !== 'string') throw new TypeError('Expected note text');
  return text.split(/\r?\n/).flatMap((raw, index) => {
    const line = raw.trim();
    if (!line) return [];
    const match = /^(\d{1,2}):(\d{2})\s*(?:[-|:]\s*|\s+)(\d+|\d{1,3}(?:\.\d{3})+)$/.exec(line);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
      return [{ line: index + 1, raw, error: 'Bitte Uhrzeit und Score prüfen.' }];
    }
    const score = Number(match[3].replace(/\./g, ''));
    if (!Number.isSafeInteger(score)) return [{ line: index + 1, raw, error: 'Der Score ist zu groß.' }];
    return [{ line: index + 1, raw, time: `${match[1].padStart(2, '0')}:${match[2]}`, score }];
  });
}

function berlinInstant(date, time) {
  if (typeof date !== 'string' || typeof time !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return { error: 'invalid' };
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const nominal = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(nominal);
  if (year < 100 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day || hour > 23 || minute > 59) return { error: 'invalid' };
  // Berlin uses UTC+1 or UTC+2. Test both offsets and round-trip through Intl;
  // this explicitly detects the skipped and repeated DST hours.
  const matches = [60, 120].map(offset => nominal - offset * 60000).filter(value => {
    const parts = Object.fromEntries(berlin.formatToParts(value).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}` === date && `${parts.hour}:${parts.minute}` === time;
  });
  if (!matches.length) return { error: 'nonexistent' };
  if (matches.length > 1) return { error: 'ambiguous' };
  return { instant: new Date(matches[0]).toISOString() };
}

function dayBreakSuggestions(entries, newestFirst = false) {
  const ordered = newestFirst ? [...entries].reverse() : [...entries];
  return ordered.map((entry, index) => ({ ...entry, suggestedNewDay: index > 0 &&
    Boolean(entry.time && ordered[index - 1].time && entry.time < ordered[index - 1].time) }));
}

if (typeof module !== 'undefined' && module.exports) module.exports = { parseNote, berlinInstant, dayBreakSuggestions };
else window.historicalScores = { parseNote, berlinInstant, dayBreakSuggestions };
