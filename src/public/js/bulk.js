(() => {
  const root = document.getElementById('bulk-app');
  if (!root) return;
  const $ = id => document.getElementById(`bulk-${id}`);
  const identity = `${root.dataset.user}:${root.dataset.profile}`;
  const fresh = () => ({ identity, userId: root.dataset.user, profileId: root.dataset.profile, entries: [], current: { date: '', time: '', score: '' }, step: 'editor', edit: null, pending: null, updatedAt: Date.now() });
  let draft, database, writing = Promise.resolve(), failed = false, busy = false;
  const message = (text, error = false) => { $('message').hidden = !text; $('message').className = error ? 'alert alert-danger mt-3' : 'text-success mt-3'; $('message').textContent = text; };
  const open = () => new Promise((resolve, reject) => {
    const request = indexedDB.open('snaptrack-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('bulk', { keyPath: 'identity' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('blocked'));
  });
  const transaction = (mode, operation) => new Promise((resolve, reject) => {
    const tx = database.transaction('bulk', mode);
    const request = operation(tx.objectStore('bulk'));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(tx.error || request.error);
  });
  function save() {
    draft.updatedAt = Date.now();
    const snapshot = JSON.parse(JSON.stringify(draft));
    writing = writing.catch(() => {}).then(() => transaction('readwrite', store => store.put(snapshot))).then(() => { failed = false; }, () => { failed = true; message('Der Entwurf konnte auf diesem Gerät nicht gespeichert werden. Prüfe den verfügbaren Speicher.', true); });
    return writing;
  }
  const remove = () => transaction('readwrite', store => store.delete(identity));
  const uuid = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  };
  function show(step) {
    ['resume', 'editor', 'review-view', 'confirm', 'success'].forEach(name => { $(name).hidden = name !== step; });
    if (['editor', 'review-view', 'confirm'].includes(step)) { draft.step = step; save(); }
    if (step === 'editor') {
      $('count').textContent = `${draft.entries.length} ${draft.entries.length === 1 ? 'Eintrag erfasst' : 'Einträge erfasst'}`;
      for (const key of ['date', 'time', 'score']) $(key).value = draft.current[key];
      $('next').textContent = draft.edit === null ? 'Nächster Wert' : 'Änderung übernehmen';
    }
    if (step === 'review-view') review();
    if (step === 'confirm') {
      $('confirm-title').textContent = `${draft.entries.length} ${draft.entries.length === 1 ? 'Eintrag' : 'Einträge'} übernehmen?`;
      $('save').textContent = draft.pending ? 'Speichern erneut prüfen' : `${draft.entries.length} ${draft.entries.length === 1 ? 'Eintrag' : 'Einträge'} speichern`;
      $('confirm-back').hidden = Boolean(draft.pending);
      if (draft.pending) message('Das letzte Speichern wurde noch nicht bestätigt. Du kannst es sicher erneut versuchen.', true);
    }
  }
  function review() {
    const list = $('list'); list.replaceChildren();
    draft.entries.forEach((entry, index) => {
      const row = document.createElement('li'); row.className = 'py-3 border-bottom';
      const label = document.createElement('div'); label.textContent = `${entry.date} · ${entry.time} · ${Number(entry.score).toLocaleString('de-DE')}`;
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'btn btn-secondary mt-2 me-2'; edit.textContent = 'Bearbeiten';
      edit.addEventListener('click', () => { draft.edit = index; draft.current = { ...entry }; show('editor'); });
      const del = document.createElement('button'); del.type = 'button'; del.className = 'btn btn-secondary text-danger mt-2'; del.textContent = 'Entfernen';
      del.addEventListener('click', () => { if (confirm('Diesen Eintrag aus dem Entwurf entfernen?')) { draft.entries.splice(index, 1); draft.edit = null; save(); review(); } });
      row.append(label, edit, del); list.append(row);
    });
    if (!draft.entries.length) list.textContent = 'Noch keine Einträge erfasst.';
  }
  for (const key of ['date', 'time', 'score']) $(key).addEventListener('input', () => { draft.current[key] = $(key).value; save(); });
  $('form').addEventListener('submit', async event => {
    event.preventDefault();
    const score = draft.current.score;
    if (!/^\d+$/.test(score) || !Number.isSafeInteger(Number(score))) { message('Bitte gib einen gültigen Score ohne Komma oder Minuszeichen ein.', true); return; }
    if (draft.entries.length >= 500 && draft.edit === null) { message('Bitte speichere zuerst die bisherigen 500 Einträge.', true); return; }
    if (draft.edit === null) draft.entries.push({ ...draft.current }); else draft.entries[draft.edit] = { ...draft.current };
    draft.edit = null; draft.current.score = ''; await save();
    show('editor'); if (!failed) message('Eintrag vorgemerkt.'); $('score').focus();
  });
  $('review').onclick = () => show('review-view');
  $('review-back').onclick = () => show('editor');
  $('finish').onclick = () => {
    if (!draft.entries.length) return message('Bitte erfasse zuerst einen Eintrag.', true);
    if (draft.current.score || draft.edit !== null) return message('Bitte übernimm zuerst den aktuellen Wert mit „Nächster Wert“.', true);
    message(''); show('confirm');
  };
  $('confirm-back').onclick = () => { message(''); show('editor'); };
  $('resume-yes').onclick = () => show(draft.pending ? 'confirm' : (['editor','review-view','confirm'].includes(draft.step) ? draft.step : 'editor'));
  $('discard').onclick = async () => {
    if (draft.pending) return message('Das Speichern ist noch nicht bestätigt. Bitte prüfe es zuerst mit „Fortsetzen“.', true);
    if (!confirm('Diesen Entwurf endgültig löschen?')) return;
    try { await writing; await remove(); draft = fresh(); show('editor'); } catch { message('Der Entwurf konnte nicht gelöscht werden.', true); }
  };
  $('save').onclick = async () => {
    if (busy) return;
    busy = true; $('save').disabled = true;
    if (!draft.pending) { draft.pending = { key: uuid(), entries: JSON.parse(JSON.stringify(draft.entries)) }; await save(); }
    if (failed) { busy = false; $('save').disabled = false; return; }
    try {
      const body = new URLSearchParams({ _csrf: root.dataset.csrf, submissionKey: draft.pending.key, entries: JSON.stringify(draft.pending.entries) });
      const response = await fetch(root.dataset.endpoint, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' }, body });
      const type = response.headers.get('content-type') || '';
      if (!type.includes('application/json')) throw new Error('unconfirmed');
      const result = await response.json();
      if (response.ok && result.success) {
        await writing; await remove();
        $('success-text').textContent = `${result.count} ${result.count === 1 ? 'Score erfolgreich übernommen!' : 'Scores erfolgreich übernommen!'}`;
        message(''); show('success'); return;
      }
      if (response.status >= 400 && response.status < 500) {
        draft.pending = null; await save(); show('confirm'); message(result.error || 'Bitte prüfe deine Einträge.', true);
      } else throw new Error('unconfirmed');
    } catch { show('confirm'); message('Speichern nicht bestätigt. Prüfe deine Verbindung und versuche es erneut.', true); }
    finally { busy = false; $('save').disabled = false; }
  };
  root.querySelectorAll('a').forEach(link => link.addEventListener('click', async event => {
    if (!draft || !database || link.target || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); await writing; window.location.assign(link.href);
  }));
  (async () => {
    try {
      database = await open();
      draft = await transaction('readonly', store => store.get(identity));
      if (draft && draft.identity === identity && String(draft.userId) === root.dataset.user && String(draft.profileId) === root.dataset.profile) {
        $('resume-text').textContent = `Du hast noch einen Entwurf mit ${draft.entries.length} ${draft.entries.length === 1 ? 'Eintrag' : 'Einträgen'} vorbereitet.`; show('resume');
      } else { draft = fresh(); show('editor'); }
    } catch { message('Der lokale Speicher ist nicht verfügbar. Bitte erlaube Website-Daten und versuche es erneut.', true); }
  })();
})();
