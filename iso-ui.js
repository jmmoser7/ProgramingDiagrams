'use strict';
(() => {
  const $ = id => document.getElementById(id), panel = $('inspector'), views = $('views'), exports = $('iso-export');
  let position = { x: 30, y: 30 };
  const api = () => window.__iso;
  function place(node, x, y) {
    node.style.left = Math.max(8, Math.min(innerWidth - node.offsetWidth - 8, x)) + 'px';
    node.style.top = Math.max(8, Math.min(innerHeight - node.offsetHeight - 48, y)) + 'px';
  }
  function close() { panel.hidden = true; }
  function open(detail) {
    position = { x: Number(detail?.x) || innerWidth / 2, y: Number(detail?.y) || innerHeight / 2 };
    $('iso-metadata').open = !!detail?.metadata;
    if (detail?.geometry) { const group = [...panel.querySelectorAll('details')].find(node => node.querySelector('summary')?.textContent.trim().startsWith('Geometry')); if (group) group.open = true; }
    panel.hidden = false; place(panel, position.x, position.y);
  }
  function refresh() {
    const state = api(); if (!state) return;
    $('view-toggle').textContent = state.camera.direction + ' ▾';
    $('grid').setAttribute('aria-pressed', String(!!state.view.grid));
    if (!panel.hidden) place(panel, position.x, position.y);
  }
  window.ProgramIsoUI = {open,close,refresh};
  window.addEventListener('program-iso-menu', event => open(event.detail));
  $('context-close').addEventListener('click', close);
  panel.addEventListener('toggle', () => { if (!panel.hidden) place(panel, position.x, position.y); }, true);
  document.addEventListener('pointerdown', event => {
    if (!panel.hidden && !panel.contains(event.target)) {
      close();
      if (event.target.id === 'scene' && event.button === 0) { event.preventDefault(); event.stopImmediatePropagation(); }
    }
    if (!views.hidden && !views.contains(event.target) && event.target !== $('view-toggle')) views.hidden = true;
    if (!exports.hidden && !exports.contains(event.target) && event.target !== $('export')) exports.hidden = true;
  }, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { close(); views.hidden = exports.hidden = true; } });
  $('view-toggle').addEventListener('click', () => {
    views.hidden = !views.hidden;
    if (!views.hidden) { const b = $('view-toggle').getBoundingClientRect(); place(views, b.x + b.width / 2 - views.offsetWidth / 2, b.y - views.offsetHeight - 6); }
  });
  views.addEventListener('click', event => { if (event.target.closest('[data-direction]')) views.hidden = true; });
  $('export').addEventListener('click', () => {
    exports.hidden = !exports.hidden;
    if (!exports.hidden) { const b = $('export').getBoundingClientRect(); place(exports, b.x + b.width / 2 - exports.offsetWidth / 2, b.y - exports.offsetHeight - 6); }
  });
  function download(name, blob) {
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  exports.addEventListener('click', event => {
    const type = event.target.dataset.isoExport, state = api(); if (!type || !state?.model) return;
    state.flushEdits?.(); const base = (state.model.fileName || 'program').replace(/\.[^.]+$/,'');
    if (type === 'csv') download(base + '.clone.csv',new Blob([window.ProgramBoard.exportCsv(state.model)],{type:'text/csv;charset=utf-8'}));
    if (type === 'png') {
      state.refresh();
      requestAnimationFrame(() => {
        const source = $('scene'), canvas = document.createElement('canvas');canvas.width = source.width; canvas.height = source.height; const context = canvas.getContext('2d');
        context.drawImage($('ground'),0,0); context.drawImage(source,0,0);
        const software = document.getElementById('iso-software-surface') || document.getElementById('fallback-surface'); if (software) context.drawImage(software,0,0);
        context.drawImage($('overlay'),0,0); canvas.toBlob(blob => { if (blob) download(base + '.isometric.png',blob); },'image/png');
      });
    }
    exports.hidden = true;
  });
  function minimize(on) { $('toolbar').hidden = on; $('blister').hidden = !on; if (api()) { api().view.toolbarMin = on; api().persist(); } }
  $('tb-min').addEventListener('click',() => minimize(true)); $('blister').addEventListener('click',() => minimize(false));
  const create = document.createElement('button'); create.className='cap row item';create.textContent='New sticky';create.addEventListener('click',()=>{api()?.newCell(position.x,position.y);close();});panel.append(create);
  window.addEventListener('resize',()=>{if(!panel.hidden)place(panel,position.x,position.y);});
})();
