if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
const isIphone = /iPhone|iPod/.test(navigator.userAgent);
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
if (isIphone && !standalone) {
  let dismissed = false;
  try { dismissed = localStorage.getItem('snaptrack-install-dismissed') === '1'; } catch {}
  if (!dismissed) {
    const tip = document.createElement('aside');
    tip.className = 'install-tip';
    const text = document.createElement('span');
    text.textContent = 'Für schnellen Zugriff: In Safari auf „Teilen“ und dann „Zum Home-Bildschirm“ tippen.';
    const close = document.createElement('button');
    close.type = 'button'; close.setAttribute('aria-label', 'Hinweis schließen'); close.textContent = '×';
    close.addEventListener('click', () => { try { localStorage.setItem('snaptrack-install-dismissed', '1'); } catch {} tip.remove(); });
    tip.append(text, close);
    document.body.append(tip);
  }
}
