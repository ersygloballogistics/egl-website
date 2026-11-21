(() => {
  if (window.__eglCta) return;
  window.__eglCta = true;

  const wa = 'https://wa.me/971556581004?text=' +
    encodeURIComponent('Hello ERSY GLOBAL, I’d like to enquire about your services.');

  const style = document.createElement('style');
  style.textContent = `
    .egl-wa-btn{background:transparent;color:#e0b35a;border:2px solid #e0b35a}
    .cta a.btn.egl-wa-btn{background:transparent!important;color:#e0b35a!important;border:2px solid #e0b35a!important}
    .egl-cta-row{display:flex;gap:15px;flex-wrap:wrap;justify-content:center}
    .egl-wa-float{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));
      z-index:900;background:#b5841c;color:#fff;padding:12px 18px;border-radius:999px;
      font:700 14px Arial,Helvetica,sans-serif;text-decoration:none;
      box-shadow:0 8px 24px rgba(0,0,0,.25)}
    .egl-wa-float:hover{background:#8a6212}
    .egl-wa-float:focus-visible{outline:3px solid #e0b35a;outline-offset:3px}
  `;
  document.head.append(style);

  const link = (href, cls, label, external) => {
    const a = document.createElement('a');
    a.href = href;
    a.className = cls;
    a.textContent = label;
    if (external) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    return a;
  };

  const hero = document.querySelector('.hero-buttons');
  if (hero) {
    hero.append(link('/services/', 'btn btn-secondary', 'Request a Quote'));
  }

  const cta = document.querySelector('.cta .container');
  if (cta) {
    const row = document.createElement('div');
    row.className = 'egl-cta-row';
    row.append(link('/services/', 'btn', 'Request a Quote'));
    cta.append(row);
  }

})();
