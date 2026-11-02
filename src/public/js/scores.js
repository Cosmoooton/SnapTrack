document.querySelectorAll('.local-time').forEach(element => {
  const date = new Date(element.dateTime);
  if (!Number.isNaN(date.getTime())) element.textContent = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(date);
});
document.querySelectorAll('.score-form').forEach(form => {
  const modal = form.closest('.modal');
  const input = form.querySelector('.score-input');
  const error = form.querySelector('.score-error');
  const difference = form.querySelector('.score-difference');
  const button = form.querySelector('[type="submit"]');
  const previous = form.dataset.previous === '' ? null : Number(form.dataset.previous);
  let pending = false;
  let uncertain = false;
  function update() {
    input.setCustomValidity('');
    const value = input.value;
    const number = Number(value);
    const valid = /^\d+$/.test(value) && Number.isSafeInteger(number);
    const lower = valid && previous !== null && number < previous;
    if (/^\d+$/.test(value) && !Number.isSafeInteger(number)) input.setCustomValidity('Diese Zahl ist zu groß. Bitte prüfe den Score.');
    if (lower) input.setCustomValidity('Der neue Score darf nicht kleiner als der letzte Score sein.');
    difference.textContent = lower ? 'Der neue Score darf nicht kleiner als der letzte Score sein.' : valid && previous !== null ? (number === previous ? 'Keine Veränderung' : `+${(number - previous).toLocaleString('de-DE')} seit der letzten Eingabe`) : '';
    difference.classList.toggle('text-danger', lower);
  }
  input.addEventListener('input', update);
  let saved = false;
  const initialValue = input.value;
  if (window.visualViewport) {
    const resizeSheet = () => {
      modal.style.setProperty('--visible-height', `${window.visualViewport.height}px`);
      modal.style.setProperty('--keyboard-offset', `${Math.max(0, window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop)}px`);
    };
    window.visualViewport.addEventListener('resize', resizeSheet);
    window.visualViewport.addEventListener('scroll', resizeSheet);
    resizeSheet();
  }
  modal.addEventListener('shown.bs.modal', () => { input.focus(); if (!uncertain) input.select(); });
  modal.addEventListener('hide.bs.modal', event => {
    if (saved) return;
    if (pending) { event.preventDefault(); return; }
    if ((uncertain || input.value !== initialValue) && !window.confirm('Möchtest du die Eingabe wirklich schließen? Dein Score wurde noch nicht bestätigt.')) event.preventDefault();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending) return;
    update();
    if (!form.reportValidity()) return;
    pending = true;
    button.disabled = true;
    button.textContent = 'Wird gespeichert …';
    error.hidden = true;
    const body = new URLSearchParams(new FormData(form));
    try {
      const response = await fetch(form.action, { method: 'POST', body, headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      const type = response.headers.get('content-type') || '';
      if (!type.includes('application/json')) throw new Error('unconfirmed');
      const result = await response.json();
      if (response.ok && result.redirect) {
        saved = true;
        try { sessionStorage.setItem('snaptrack-score-animation', JSON.stringify({ path: form.action, from: previous, to: Number(input.value) })); } catch {}
        modal.addEventListener('hidden.bs.modal', () => window.location.assign(result.redirect), { once: true });
        bootstrap.Modal.getOrCreateInstance(modal).hide();
        return;
      }
      if (response.status >= 400 && response.status < 500 && result.error) {
        error.textContent = result.error;
        error.hidden = false;
        uncertain = false;
        input.readOnly = false;
        button.textContent = 'Speichern';
      } else { throw new Error('unconfirmed'); }
    } catch {
      uncertain = true;
      input.readOnly = true;
      error.textContent = 'Speichern nicht bestätigt. Prüfe deine Verbindung und versuche es erneut.';
      error.hidden = false;
      button.textContent = 'Erneut versuchen';
    } finally { if (!saved) { pending = false; button.disabled = false; } }
  });
  update();
});
document.querySelectorAll('.score-toast').forEach(notice => {
  const expires = Number(notice.dataset.expires);
  window.setTimeout(() => notice.remove(), expires ? Math.max(0, expires - Date.now()) : 5000);
  const profileId = notice.dataset.streakProfile;
  if (profileId) document.querySelectorAll(`.score-value[data-profile-id="${profileId}"]`).forEach(value => value.closest('.score-card')?.querySelector('.streak-badge')?.classList.add('streak-celebrate'));
});
try {
  const raw = sessionStorage.getItem('snaptrack-score-animation');
  if (raw) {
    sessionStorage.removeItem('snaptrack-score-animation');
    const data = JSON.parse(raw), match = data.path.match(/\/profiles\/(\d+)\/scores$/);
    const value = match && document.querySelector(`.score-value[data-profile-id="${match[1]}"]`);
    if (value && Number(value.dataset.score) === data.to) {
      const change = value.parentElement.querySelector('.score-change');
      if (change) change.classList.add('feedback-fade');
      if (data.from !== null && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const start = performance.now();
        const draw = now => { const p = Math.min(1, (now - start) / 500); value.textContent = Math.round(data.from + (data.to - data.from) * (1 - (1 - p) ** 3)).toLocaleString('de-DE'); if (p < 1) requestAnimationFrame(draw); };
        requestAnimationFrame(draw);
      }
    }
  }
} catch {}
