const graphData = document.getElementById('score-chart-data');
let points = graphData.dataset.entries ? JSON.parse(graphData.dataset.entries).sort((a, b) => a.x - b.x || a.id - b.id) : [];
const chartMessage = document.getElementById('chart-message');
const canvas = document.getElementById('score-chart');
const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' });
let chart;
let chartVersion = 0;
function updateChart(days) {
  chartVersion++;
  const now = Date.now();
  const filtered = points.filter(point => point.x <= now && (days === 'all' || point.x >= now - Number(days) * 86400000));
  chartMessage.textContent = !filtered.length ? 'Für diesen Zeitraum sind noch keine Einträge vorhanden.' : filtered.length === 1 ? 'Mit einem weiteren Eintrag kannst du die Entwicklung sehen.' : '';
  canvas.parentElement.hidden = !filtered.length;
  if (!filtered.length) { if (chart) { chart.destroy(); chart = null; } return; }
  if (chart) { chart.data.datasets[0].data = filtered; chart.update(); return; }
  const guide = { id: 'selectedGuide', afterDatasetsDraw(chart) { const selected = chart.tooltip?.getActiveElements(); if (!selected?.length) return; const x = selected[0].element.x, context = chart.ctx; context.save(); context.strokeStyle = '#8ca9ff88'; context.setLineDash([4, 4]); context.beginPath(); context.moveTo(x, chart.chartArea.top); context.lineTo(x, chart.chartArea.bottom); context.stroke(); context.restore(); } };
  chart = new Chart(canvas, {
    type: 'line',
    plugins: [guide],
    data: { datasets: [{ data: filtered, borderColor: '#86a7ff', backgroundColor: '#a0b8ff', pointRadius: 4, pointHoverRadius: 6, tension: 0, spanGaps: 86400000 }] },
    options: { responsive: true, maintainAspectRatio: false, parsing: false, interaction: { mode: 'nearest', axis: 'x', intersect: false }, animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 300 },
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: items => dateFormat.format(new Date(items[0].parsed.x)), label: item => 'Snapscore: ' + item.parsed.y.toLocaleString('de-DE') } } },
      scales: { x: { type: 'time', grid: { display: false }, ticks: { color: '#b2bdce', maxTicksLimit: 5 } }, y: { grid: { color: '#343d4c' }, ticks: { color: '#b2bdce', maxTicksLimit: 5, callback: value => Number(value).toLocaleString('de-DE') } } } }
  });
}
let requestVersion = 0;
async function selectPeriod(days) {
  const current = ++requestVersion;
  if (graphData.dataset.endpoint) {
    chartMessage.textContent = 'Verlauf wird geladen …';
    try {
      const response = await fetch(`${graphData.dataset.endpoint}?period=${encodeURIComponent(days)}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('load');
      const result = await response.json();
      if (current !== requestVersion) return;
      points = result.points.sort((a, b) => a.x - b.x || a.id - b.id);
    } catch {
      if (current !== requestVersion) return;
      chartMessage.textContent = 'Der Verlauf konnte nicht geladen werden. Bitte versuche es erneut.';
      canvas.parentElement.hidden = true;
      return;
    }
  }
  updateChart(days);
}
document.querySelectorAll('.period-chip').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.period-chip').forEach(other => { const selected = other === button; other.classList.toggle('is-active', selected); other.setAttribute('aria-pressed', String(selected)); });
  selectPeriod(button.dataset.days);
}));
canvas.addEventListener('touchend', () => {
  if (!chart) return;
  const active = chart.tooltip?.getActiveElements().map(({ datasetIndex, index }) => ({ datasetIndex, index })) || [];
  if (!active.length) return;
  const element = chart.getDatasetMeta(active[0].datasetIndex).data[active[0].index];
  const selectedChart = chart;
  const version = chartVersion;
  setTimeout(() => {
    if (chart !== selectedChart || chartVersion !== version) return;
    chart.setActiveElements(active);
    chart.tooltip.setActiveElements(active, { x: element.x, y: element.y });
    chart.update('none');
    setTimeout(() => {
      if (chart !== selectedChart || chartVersion !== version) return;
      chart.setActiveElements([]); chart.tooltip.setActiveElements([], { x: 0, y: 0 }); chart.update('none');
    }, 1200);
  }, 0);
}, { passive: true, capture: true });
selectPeriod('7');
