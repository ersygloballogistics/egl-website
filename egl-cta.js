(() => {
  if (window.__eglCta) return;
  window.__eglCta = true;

  const wa = 'https://wa.me/971556581004?text=' +
    encodeURIComponent('Hello ERSY GLOBAL, I’d like to enquire about your services.');

  const style = document.createElement('style');
  style.textContent = `
    .egl-wa-btn{background:#0e7a6b;color:#fff}
    .cta a.btn.egl-wa-btn{background:#128c7e!important;color:#fff!important}
    .egl-cta-row{display:flex;gap:15px;flex-wrap:wrap;justify-content:center}
    .egl-wa-float{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));
      z-index:900;background:#0e7a6b;color:#fff;padding:12px 18px;border-radius:999px;
      font:700 14px Arial,Helvetica,sans-serif;text-decoration:none;
      box-shadow:0 8px 24px rgba(0,0,0,.25)}
    .egl-wa-float:hover{background:#0b5f53}
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
    hero.prepend(link('/services/', 'btn btn-primary', 'Request a Quote'));
    hero.append(link(wa, 'btn egl-wa-btn', 'WhatsApp Us', true));
  }

  const cta = document.querySelector('.cta .container');
  if (cta) {
    const row = document.createElement('div');
    row.className = 'egl-cta-row';
    row.append(
      link('/services/', 'btn', 'Request a Quote'),
      link(wa, 'btn egl-wa-btn', 'Chat on WhatsApp', true)
    );
    cta.append(row);
  }

  const float = link(wa, 'egl-wa-float', 'WhatsApp', true);
  float.setAttribute('aria-label', 'Chat with ERSY GLOBAL on WhatsApp');
  document.body.append(float);
})();
