const Score = require('../models/score');
const cache = require('../utils/statCache');
const { analyze, streak, local } = require('../utils/scoreStats');

async function insights(userId, profile) {
  const today = local(Date.now()).day;
  return cache.memo(userId, profile.id, profile.revision, 'insights', today, 60000, async () => {
    const history = await Score.history(userId, profile.id);
    const exceptions = await Score.exceptionsForProfile(userId, profile.id);
    return { history, stats: analyze(history, Date.now(), exceptions) };
  });
}
async function graph(userId, profile, period) {
  return cache.memo(userId, profile.id, profile.revision, 'graph', period, 15000, async () => {
    const now = Date.now();
    const since = period === 'all' ? '0000-01-01T00:00:00.000Z' : new Date(now - Number(period) * 86400000).toISOString();
    const entries = await Score.range(userId, profile.id, since, new Date(now).toISOString());
    return entries.map(entry => ({ id: entry.id, x: Date.parse(entry.created_at), y: entry.score }));
  });
}
async function dashboardStreak(userId, profile, entries, exceptions) {
  return cache.memo(userId, profile.id, profile.revision, 'streak', local(Date.now()).day, 60000,
    async () => streak(entries, Date.now(), exceptions).current);
}
function cachedStreak(userId, profile) {
  return cache.peek(userId, profile.id, profile.revision, 'streak', local(Date.now()).day);
}
module.exports = { insights, graph, dashboardStreak, cachedStreak };
