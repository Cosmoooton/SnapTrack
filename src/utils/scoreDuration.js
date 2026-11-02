function scoreDuration(latest, previous) {
  const end = Date.parse(latest);
  const start = Date.parse(previous);
  if (!Number.isFinite(end) || !Number.isFinite(start) || end < start) return null;
  const minutes = Math.floor((end - start) / 60000);
  if (minutes < 1) return 'weniger als 1 Min.';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainingMinutes = minutes % 60;
  if (days) return `${days} ${days === 1 ? 'Tag' : 'Tage'}${hours ? ` ${hours} Std.` : ''}`;
  if (hours) return `${hours} Std.${remainingMinutes ? ` ${remainingMinutes} Min.` : ''}`;
  return `${minutes} Min.`;
}

module.exports = scoreDuration;
