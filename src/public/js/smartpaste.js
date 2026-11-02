(() => {
  const root = document.getElementById('smart-app');
  if (!root) return;
  const { parseNote, dayBreakSuggestions } = window.historicalScores;
  const $ = name => document.getElementById(`smart-${name}`);
  const identity = `smart:${root.dataset.user}:${root.dataset.profile}`;
  const fresh = () => ({ identity, userId: root.dataset.user, profileId: root.dataset.profile, text: '', parsedText: null, order: 'oldest', parsedOrder: null, rows: [], breaks: {}, overrides: {}, reference: '', confirmed: false, step: 'paste', pending: null, updatedAt: Date.now() });
  let draft, database, writing = Promise.resolve(), failed = false, busy = false, errors = {}, previewReady = false, rowsFilter = 'all';
  const message = (text, error = false) => { $('message').hidden = !text; $('message').className = error ? 'alert alert-danger mt-3' : 'text-success mt-3'; $('message').textContent = text; };
  const open = () => new Promise((resolve, reject) => {
    const request = indexedDB.open('snaptrack-drafts', 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('bulk')) request.result.createObjectStore('bulk', { keyPath: 'identity' }); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('blocked'));
  });
  const transaction = (mode, operation) => new Promise((resolve, reject) => {
    const tx = database.transaction('bulk', mode), request = operation(tx.objectStore('bulk'));
    tx.oncomplete = () => resolve(request.result); tx.onerror = tx.onabort = () => reject(tx.error || request.error);
  });
  function save() {
    draft.updatedAt = Date.now(); const snapshot = JSON.parse(JSON.stringify(draft));
    writing = writing.catch(() => {}).then(() => transaction('readwrite', store => store.put(snapshot))).then(() => { failed = false; }, () => { failed = true; message('Der Entwurf konnte auf diesem Gerät nicht gespeichert werden.', true); });
    return writing;
  }
  const remove = () => transaction('readwrite', store => store.delete(identity));
  function uuid() {
    const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
    const h = Array.from(bytes, n => n.toString(16).padStart(2, '0')).join(''); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  }
  const ordered = () => draft.order === 'newest' ? [...draft.rows].reverse() : [...draft.rows];
  function shift(date, days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
    const value = new Date(`${date}T00:00:00.000Z`);
    if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== date) return '';
    value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10);
  }
  function blocks() {
    const rows = ordered(), result = [];
    for (const row of rows) {
      const gap = Number(draft.breaks[row.line] || 0);
      if (!result.length || gap > 0) result.push({ id: row.line, gap: result.length ? gap : 0, rows: [] });
      result[result.length - 1].rows.push(row);
    }
    let date = draft.reference;
    for (let i = result.length - 1; i >= 0; i--) {
      result[i].date = draft.overrides[result[i].id] || date;
      date = shift(date, -result[i].gap);
    }
    return result;
  }
  const datesByLine = () => Object.fromEntries(blocks().flatMap(block => block.rows.map(row => [row.line, block.date])));
  function changed(days = false) { if (days) draft.confirmed = false; previewReady = false; errors = {}; save(); }
  function show(step) {
    ['resume','paste','days','review','rows','confirm','success'].forEach(name => { $(name).hidden = name !== step; });
    if (['paste','days','review','rows','confirm'].includes(step)) { draft.step = step; save(); }
    if (step === 'paste') { $('text').value = draft.text; $('order').value = draft.order; }
    if (step === 'days') renderDays();
    if (step === 'review') renderSummary();
    if (step === 'rows') renderRows();
    if (step === 'confirm') {
      const count = draft.pending ? draft.pending.entries.length : included().length;
      $('confirm-title').textContent = `${count} ${count === 1 ? 'Eintrag' : 'Einträge'} übernehmen?`;
      $('save').textContent = draft.pending ? 'Import erneut prüfen' : `${count} ${count === 1 ? 'Eintrag' : 'Einträge'} importieren`;
      $('confirm-back').hidden = Boolean(draft.pending);
      if (draft.pending) message('Der letzte Import wurde noch nicht bestätigt. Versuche es erneut.', true);
    }
  }
  function addText(tag, text, className = '') { const element = document.createElement(tag); element.textContent = text; element.className = className; return element; }
  function renderDays() {
    $('recognized').textContent = `${draft.rows.length} Einträge erkannt`;
    $('reference').value = draft.reference; $('confirm-days').checked = draft.confirmed;
    const boundaries = $('boundaries'); boundaries.replaceChildren();
    const rows = ordered();
    const suggested = new Set(dayBreakSuggestions(draft.rows, draft.order === 'newest').filter(row => row.suggestedNewDay).map(row => row.line));
    rows.slice(1).forEach(row => {
      const line = addText('div', '', 'border-bottom py-2');
      const label = addText('label', `${suggested.has(row.line) ? 'Möglicher neuer Tag · ' : ''}vor Zeile ${row.line}: ${row.raw}`, 'form-label');
      const input = document.createElement('input'); input.type = 'number'; input.inputMode = 'numeric'; input.min = '0'; input.max = '36500'; input.className = 'form-control'; input.value = String(draft.breaks[row.line] || 0); label.append(input); line.append(label);
      input.addEventListener('change', () => { const n = Number(input.value); draft.breaks[row.line] = Number.isInteger(n) && n >= 0 && n <= 36500 ? n : 0; changed(true); renderDays(); }); boundaries.append(line);
    });
    const container = $('blocks'); container.replaceChildren();
    blocks().forEach((block, index, all) => {
      const wrapper = addText('div', '', 'mt-2');
      const label = addText('label', `Tag ${index + 1} · ${block.rows.length} Einträge`, 'form-label');
      const input = document.createElement('input'); input.type = 'date'; input.className = 'form-control'; input.value = block.date; label.append(input); wrapper.append(label);
      input.addEventListener('change', () => { if (index === all.length - 1) { draft.reference = input.value; delete draft.overrides[block.id]; } else draft.overrides[block.id] = input.value; changed(true); renderDays(); });
      container.append(wrapper);
    });
  }
  function included() { return draft.rows.filter(row => !row.excluded); }
  function payload() {
    const dates = datesByLine();
    return included().map(row => ({ date: dates[row.line] || '', time: row.time || '', score: row.score === undefined ? '' : String(row.score) }));
  }
  async function preview() {
    const rows = included(); errors = {};
    rows.forEach(row => { if (row.error) errors[row.line] = row.error; });
    try {
      const response = await fetch(root.dataset.preview, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' }, body: new URLSearchParams({ _csrf: root.dataset.csrf, entries: JSON.stringify(payload()) }) });
      if (!response.ok || !(response.headers.get('content-type') || '').includes('application/json')) throw new Error('preview');
      const result = await response.json();
      Object.entries(result.errors).forEach(([index, value]) => { if (rows[Number(index)]) errors[rows[Number(index)].line] = value; });
      previewReady = true; renderSummary();
    } catch { previewReady = false; message('Prüfen nicht möglich. Bitte prüfe deine Verbindung und versuche es erneut.', true); }
  }
  function renderSummary() {
    const count = included().length, problems = Object.keys(errors).length;
    $('summary').replaceChildren(...[`${draft.rows.length} Einträge erkannt`, `${new Set(blocks().filter(b => b.rows.some(row => !row.excluded)).map(b => b.date)).size} Tage zugeordnet`, `${count - problems} gültig`, `${problems} benötigen deine Aufmerksamkeit`].map(text => addText('p', text, 'mb-2')));
  }
  function renderRows() {
    $('rows-title').textContent = rowsFilter === 'errors' ? 'Fehler prüfen' : 'Alle Einträge';
    const list = $('row-list'); list.replaceChildren();
    const dates = datesByLine();
    draft.rows.filter(row => rowsFilter === 'all' || errors[row.line] || row.error).forEach(row => {
      const wrapper = addText('div', '', 'border-bottom py-3');
      wrapper.append(addText('p', `Zeile ${row.line} · ${dates[row.line] || 'Datum fehlt'}`, 'mb-2'));
      const input = document.createElement('input'); input.className = 'form-control'; input.value = row.raw; input.setAttribute('aria-label', `Zeile ${row.line} korrigieren`); wrapper.append(input);
      const error = addText('div', errors[row.line] || row.error || '', 'text-danger small mt-1'); wrapper.append(error);
      input.addEventListener('input', () => {
        row.raw = input.value; const parsed = parseNote(input.value)[0];
        delete row.time; delete row.score; row.error = parsed ? parsed.error : 'Bitte Uhrzeit und Score eingeben.';
        if (parsed && !parsed.error) { row.time = parsed.time; row.score = parsed.score; }
        error.textContent = row.error || ''; changed(true);
      });
      const label = addText('label', '', 'form-check-label mt-2');
      const check = document.createElement('input'); check.type = 'checkbox'; check.className = 'form-check-input me-2'; check.checked = Boolean(row.excluded);
      check.addEventListener('change', () => { row.excluded = check.checked; changed(true); });
      label.append(check, document.createTextNode('Vom Import ausschließen')); wrapper.append(label); list.append(wrapper);
    });
    if (!list.childNodes.length) list.append(addText('p', 'Keine fehlerhaften Einträge gefunden.'));
  }
  $('text').addEventListener('input', () => { draft.text = $('text').value; changed(true); });
  $('order').addEventListener('change', () => { draft.order = $('order').value; changed(true); });
  $('parse').onclick = () => {
    if (draft.parsedText !== draft.text || draft.parsedOrder !== draft.order) {
      if (draft.rows.length && !confirm('Die Liste wurde geändert. Vorherige Korrekturen und Tageszuordnungen ersetzen?')) return;
      draft.rows = parseNote(draft.text).map(row => ({ ...row, excluded: false }));
      if (!draft.rows.length || draft.rows.length > 500) return message('Bitte füge zwischen 1 und 500 Zeilen ein.', true);
      draft.breaks = {}; draft.overrides = {};
      dayBreakSuggestions(draft.rows, draft.order === 'newest').forEach(row => { if (row.suggestedNewDay) draft.breaks[row.line] = 1; });
      draft.parsedText = draft.text; draft.parsedOrder = draft.order; draft.confirmed = false;
    }
    message(''); show('days');
  };
  $('reference').addEventListener('change', () => { draft.reference = $('reference').value; const last = blocks().at(-1); if (last) delete draft.overrides[last.id]; changed(true); renderDays(); });
  $('confirm-days').addEventListener('change', () => { draft.confirmed = $('confirm-days').checked; changed(); });
  $('days-back').onclick = () => show('paste');
  $('to-review').onclick = async () => {
    if (!draft.reference || blocks().some(block => !block.date) || !draft.confirmed) return message('Bitte wähle ein Datum und bestätige alle zugeordneten Tage.', true);
    message(''); show('review'); await preview();
  };
  $('edit-days').onclick = () => show('days');
  $('all').onclick = () => { rowsFilter = 'all'; show('rows'); };
  $('errors').onclick = () => { rowsFilter = 'errors'; show('rows'); };
  $('rows-back').onclick = async () => { show('review'); await preview(); };
  $('to-confirm').onclick = async () => {
    if (!draft.confirmed) return message('Bitte bestätige nach der Änderung erneut die Tageszuordnung.', true);
    if (!previewReady) { await preview(); if (!previewReady) return; }
    if (!included().length || Object.keys(errors).length) return message('Bitte korrigiere oder schließe alle fehlerhaften Einträge aus.', true);
    message(''); show('confirm');
  };
  $('confirm-back').onclick = () => show('review');
  $('resume-yes').onclick = async () => { show(draft.pending ? 'confirm' : (['paste','days','review','rows','confirm'].includes(draft.step) ? draft.step : 'paste')); if (!draft.pending && draft.step === 'review') await preview(); };
  $('discard').onclick = async () => {
    if (draft.pending) return message('Der Import ist noch nicht bestätigt. Bitte prüfe ihn zuerst mit „Fortsetzen“.', true);
    if (!confirm('Diesen Importentwurf endgültig löschen?')) return;
    try { await writing; await remove(); draft = fresh(); show('paste'); } catch { message('Der Entwurf konnte nicht gelöscht werden.', true); }
  };
  $('save').onclick = async () => {
    if (busy) return; busy = true; $('save').disabled = true;
    if (!draft.pending) { draft.pending = { key: uuid(), entries: payload() }; await save(); }
    if (failed) { busy = false; $('save').disabled = false; return; }
    try {
      const body = new URLSearchParams({ _csrf: root.dataset.csrf, submissionKey: draft.pending.key, entries: JSON.stringify(draft.pending.entries) });
      const response = await fetch(root.dataset.endpoint, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' }, body });
      if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('unconfirmed');
      const result = await response.json();
      if (response.ok && result.success) { await writing; await remove(); $('success-text').textContent = `${result.count} Scores erfolgreich importiert!`; message(''); show('success'); return; }
      if (response.status >= 400 && response.status < 500) { draft.pending = null; await save(); show('review'); await preview(); message(result.error || 'Bitte prüfe die Einträge.', true); }
      else throw new Error('unconfirmed');
    } catch { show('confirm'); message('Import nicht bestätigt. Prüfe deine Verbindung und versuche es erneut.', true); }
    finally { busy = false; $('save').disabled = false; }
  };
  root.querySelectorAll('a').forEach(link => link.addEventListener('click', async event => { if (!draft || !database || link.target || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); await writing; window.location.assign(link.href); }));
  (async () => {
    try {
      database = await open(); draft = await transaction('readonly', store => store.get(identity));
      if (draft && draft.identity === identity && String(draft.userId) === root.dataset.user && String(draft.profileId) === root.dataset.profile) show('resume');
      else { draft = fresh(); show('paste'); }
    } catch { message('Der lokale Speicher ist nicht verfügbar. Bitte erlaube Website-Daten und versuche es erneut.', true); }
  })();
})();
