'use strict';
// Every view shares one program. Only its camera and layout differ.
(() => {
  const button = document.getElementById('tb-display');
  if (!button) return;
  const menu = document.createElement('div');
  menu.className = 'stack';
  menu.id = 'display-mode-menu';
  menu.hidden = true;
  menu.style.zIndex = '35';
  const packed = /pack\.html$/.test(location.pathname);
  const isometric = /iso\.html$/.test(location.pathname);
  for (const [label, hint, href, active] of [
    ['Board', 'Free layout', 'index.html', !packed && !isometric],
    ['Pack', 'Area layout', 'pack.html', packed],
    ['Isometric', 'Extrude & stack', 'iso.html', isometric],
  ]) {
    const a = document.createElement('a');
    a.className = 'cap row item';
    a.href = href;
    a.style.cssText = 'text-decoration:none;color:inherit;min-width:204px';
    if (active) {
      a.style.boxShadow = 'inset 2px 0 0 var(--focus), var(--shadow)'; a.setAttribute('aria-current', 'page');
      a.addEventListener('click', (e) => { e.preventDefault(); close(); });
    } else {
      a.addEventListener('click', () => {
        const source = window.__pack || window.__iso || window.__board;
        if (window.ProgramModeState && source) {
          const state = window.ProgramModeState.capture(source);
          if (state) a.href = window.ProgramModeState.href(href, state);
        }
      });
    }
    const title = document.createElement('span'); title.textContent = label;
    const help = document.createElement('span'); help.className = 'hint'; help.textContent = hint;
    a.append(title, help); menu.append(a);
  }
  document.body.append(menu);
  button.setAttribute('aria-haspopup', 'true');
  button.setAttribute('aria-expanded', 'false');
  function close() { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); }
  button.addEventListener('click', () => {
    if (!menu.hidden) { close(); return; }
    menu.hidden = false; button.setAttribute('aria-expanded', 'true');
    const r = button.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, r.left + r.width / 2 - menu.offsetWidth / 2)) + 'px';
    menu.style.top = Math.max(8, r.top - menu.offsetHeight - 6) + 'px';
  });
  window.addEventListener('pointerdown', (e) => { if (!button.contains(e.target) && !menu.contains(e.target)) close(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
})();
