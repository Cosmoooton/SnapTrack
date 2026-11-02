const format = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
const windows = ['Nacht', 'Morgen', 'Nachmittag', 'Abend'];
function local(value) {
  const fields = Object.fromEntries(format.formatToParts(new Date(value)).map(part => [part.type, part.value]));
  const day = `${fields.year}-${fields.month}-${fields.day}`;
  return { day, ordinal: Math.floor(Date.UTC(+fields.year, +fields.month - 1, +fields.day) / 86400000), window: Math.floor(+fields.hour / 6) };
}
function streak(entries, now = Date.now(), exceptions = []) {
  const days = new Set(entries.map(entry => local(entry.created_at).ordinal));
  for (const day of exceptions) days.add(Math.floor(Date.parse(day + 'T00:00:00Z') / 86400000));
  const sorted = [...days].sort((a, b) => a - b);
  let longest = 0, run = 0, previous;
  for (const day of sorted) { run = day === previous + 1 ? run + 1 : 1; longest = Math.max(longest, run); previous = day; }
  const today = local(now).ordinal;
  let cursor = days.has(today) ? today : today - 1, current = 0;
  while (days.has(cursor)) { current++; cursor--; }
  return { current, longestStreak: longest, lastSeven: Array.from({ length: 7 }, (_, i) => {
    const ordinal = today - 6 + i;
    return { date: new Date(ordinal * 86400000).toISOString().slice(0, 10), marked: days.has(ordinal) };
  }) };
}
function analyze(history, now = Date.now(), exceptions = []) {
  const entries = [...history].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);
  const count = entries.length, days = new Set(entries.map(e => local(e.created_at).ordinal));
  const intervals = entries.slice(1).map((entry, i) => {
    const older = entries[i], ms = Date.parse(entry.created_at) - Date.parse(older.created_at);
    return { older, entry, ms, gain: entry.score - older.score, start: local(older.created_at), end: local(entry.created_at) };
  });
  const elapsed = count > 1 ? Date.parse(entries[count - 1].created_at) - Date.parse(entries[0].created_at) : 0;
  const gain = count > 1 ? entries[count - 1].score - entries[0].score : null;
  const increases = intervals.filter(i => i.gain > 0);
  const still = intervals.filter(i => i.gain === 0);
  const week = Array.from({ length: 7 }, () => ({ count: 0, ms: 0, gain: 0 }));
  const times = windows.map(name => ({ name, count: 0, ms: 0, gain: 0, days: new Set() }));
  const qualifiedWeek = intervals.filter(i => i.ms > 0 && i.ms <= 4 * 3600000 && i.gain >= 0 && i.start.day === i.end.day);
  for (const i of qualifiedWeek) { const w = week[(i.end.ordinal + 3) % 7]; w.count++; w.ms += i.ms; w.gain += i.gain; }
  const qualifiedTime = intervals.filter(i => i.ms > 0 && i.ms <= 3600000 && i.gain >= 0 && i.start.day === i.end.day && i.start.window === i.end.window);
  for (const i of qualifiedTime) { const w = times[i.end.window]; w.count++; w.ms += i.ms; w.gain += i.gain; w.days.add(i.end.day); }
  const daySpan = days.size ? Math.max(...days) - Math.min(...days) : 0;
  const weekReady = qualifiedWeek.length >= 20 && week.filter(w => w.count >= 3).length >= 4 && daySpan >= 14;
  const weekday = week.map(w => ({ ...w, rate: weekReady && w.count >= 3 && w.ms >= 4 * 3600000 ? w.gain / (w.ms / 3600000) : null }));
  const timeReady = qualifiedTime.length >= 30 && days.size >= 7;
  const timeWindows = times.map(w => ({ name: w.name, count: w.count, ms: w.ms, rate: timeReady && w.count >= 5 && w.days.size >= 3 && w.ms >= 3 * 3600000 ? w.gain / (w.ms / 3600000) : null }));
  const windowCounts = [0, 0, 0, 0]; entries.forEach(e => windowCounts[local(e.created_at).window]++);
  const maxCount = Math.max(...windowCounts), winners = windowCounts.map((n, i) => n === maxCount ? i : -1).filter(i => i >= 0);
  return {
    count, first: entries[0] || null, gain, elapsed, daily: count >= 5 && days.size >= 3 && elapsed >= 48 * 3600000 ? gain / (elapsed / 86400000) : null,
    hourly: count >= 5 && elapsed >= 6 * 3600000 ? gain / (elapsed / 3600000) : null,
    biggest: increases.length ? increases.reduce((a, b) => a.gain >= b.gain ? a : b) : null,
    still: count >= 5 && still.length ? still.reduce((a, b) => a.ms >= b.ms ? a : b) : null,
    weekday, weekReady, qualifiedWeek: qualifiedWeek.length,
    timeWindows, timeReady: timeWindows.filter(w => w.rate !== null).length >= 2, qualifiedTime: qualifiedTime.length,
    hasNegative: intervals.some(i => i.gain < 0),
    tracking: { days: days.size, average: count >= 3 ? intervals.reduce((sum, i) => sum + i.ms, 0) / intervals.length : null,
      shortestGap: count >= 3 ? Math.min(...intervals.map(i => i.ms)) : null, longestGap: count >= 3 ? Math.max(...intervals.map(i => i.ms)) : null,
      favorite: count >= 15 && days.size >= 5 && winners.length === 1 ? windows[winners[0]] : null,
      ...streak(entries, now, exceptions) }
  };
}
module.exports = { analyze, streak, local };
