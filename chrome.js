'use strict';
(() => {
  const source = document.getElementById('src') || document.getElementById('source');
  const toolbar = document.getElementById('toolbar');
  if (source && toolbar) {
    const row = document.createElement('div'); row.id = 'chrome-row';
    const balance = document.createElement('div'); balance.className = 'chrome-balance';
    balance.setAttribute('aria-hidden', 'true');
    document.body.append(row); row.append(source, toolbar, balance);
  }
})();
