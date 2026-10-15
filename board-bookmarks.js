'use strict';

// A bookmark owns a complete Board snapshot, but never another bookmark
// catalogue. The live catalogue belongs to the model and survives restores.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProgramBookmarks = api;
})(typeof window !== 'undefined' ? window : null, function (root) {
  const MAX_BOOKMARKS = 30;
  const MAX_NAME = 96;
  let serial = 0;

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function freeze(value) {
    if (value && typeof value === 'object') {
      Object.keys(value).forEach(key => freeze(value[key]));
      Object.freeze(value);
    }
    return value;
  }

  function snapshot(state) {
    if (!state || typeof state !== 'object' || !state.board || typeof state.board !== 'object') {
      throw new TypeError('Open a program before saving a bookmark.');
    }
    const source = { ...state, board: { ...state.board } };
    delete source.bookmarks;
    delete source.board.bookmarks;
    return freeze(clone(source));
  }

  function cleanName(value, fallback) {
    return String(value == null ? '' : value).trim().slice(0, MAX_NAME) || fallback || 'Bookmark';
  }

  function normalize(bookmarks) {
    if (!Array.isArray(bookmarks)) return [];
    const seen = new Set();
    const out = [];
    bookmarks.forEach((entry, index) => {
      if (!entry || !entry.state || !entry.state.board) return;
      let state;
      try { state = snapshot(entry.state); } catch (err) { return; }
      const base = String(entry.id || 'bookmark-' + (index + 1)).slice(0, 128);
      let id = base;
      let duplicate = 1;
      while (seen.has(id)) id = base + '-' + (++duplicate);
      seen.add(id);
      out.push({
        id: id,
        name: cleanName(entry.name, 'Bookmark ' + (index + 1)),
        createdAt: Number.isFinite(Date.parse(entry.createdAt)) ? new Date(entry.createdAt).toISOString() : '',
        state: state,
      });
    });
    // Imported catalogues are retained even if they exceed the creation
    // limit. The user can remove entries; none disappear on load or rename.
    return out;
  }

  function nextId(list) {
    let id;
    do {
      id = root && root.crypto && typeof root.crypto.randomUUID === 'function'
        ? 'bookmark-' + root.crypto.randomUUID()
        : 'bookmark-' + Date.now().toString(36) + '-' + (++serial).toString(36);
    } while (list.some(entry => entry.id === id));
    return id;
  }

  function add(bookmarks, state, name, time) {
    const list = normalize(bookmarks);
    if (list.length >= MAX_BOOKMARKS) throw new RangeError('All 30 bookmarks are in use. Delete one before saving another.');
    let number = 1;
    while (list.some(entry => entry.name === 'Bookmark ' + number)) number++;
    const date = time == null ? new Date() : new Date(time);
    if (!Number.isFinite(date.getTime())) throw new TypeError('A bookmark needs a valid date.');
    list.push({ id: nextId(list), name: cleanName(name, 'Bookmark ' + number), createdAt: date.toISOString(), state: snapshot(state) });
    return list;
  }

  function rename(bookmarks, id, name) {
    return normalize(bookmarks).map(entry => entry.id === id
      ? Object.assign({}, entry, { name: cleanName(name, entry.name) }) : entry);
  }

  function remove(bookmarks, id) { return normalize(bookmarks).filter(entry => entry.id !== id); }

  function installStyle(doc) {
    if (doc.getElementById('board-bookmarks-style')) return;
    const style = doc.createElement('style');
    style.id = 'board-bookmarks-style';
    style.textContent = `
      .board-bookmarks{position:fixed;top:auto;left:8px;z-index:36;width:310px;max-width:calc(100vw - 16px);display:grid;grid-template-columns:minmax(0,1fr) 24px;align-items:start;overflow:visible;padding:1px;gap:4px;outline:none}
      .board-bookmarks .bookmark-stack{display:flex;flex-direction:column;min-width:0;gap:4px;max-height:inherit;overflow-y:auto;scrollbar-width:thin}
      .board-bookmarks .cap{height:24px;min-height:24px;border-radius:12px;flex:none}
      .board-bookmarks .row{padding:0 7px 0 11px;gap:6px}
      .board-bookmarks .bookmark-entry{cursor:pointer}
      .board-bookmarks .bookmark-entry:hover{border-color:var(--border-strong)}
      .board-bookmarks .bookmark-entry:focus-visible{outline:1px solid var(--focus);outline-offset:1px}
      .board-bookmarks .bookmark-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:18px}
      .board-bookmarks .bookmark-list{display:flex;flex-direction:column;gap:4px}
      .board-bookmarks .bookmark-name{height:18px;flex:1;min-width:0;width:1px;border:0;padding:0 2px;outline:none;background:transparent;font:inherit;color:var(--ink);text-overflow:ellipsis}
      .board-bookmarks .bookmark-name:focus{box-shadow:inset 0 -1px 0 var(--focus);text-overflow:clip}
      .board-bookmarks .bookmark-add{width:24px;height:24px;min-height:24px;padding:0;display:grid;place-items:center;border-radius:50%;font-size:17px;line-height:1;color:var(--sub)}
      .board-bookmarks .bookmark-add:hover:not(:disabled){color:var(--ink);background-image:linear-gradient(var(--hover),var(--hover))}
      .board-bookmarks .bookmark-add:focus-visible,.board-bookmarks .bookmark-rename:focus-visible,.board-bookmarks .bookmark-delete:focus-visible{outline:1px solid var(--focus);outline-offset:1px}
      .board-bookmarks .bookmark-rename{width:18px;height:18px;flex:none;padding:0;display:grid;place-items:center;border-radius:9px;color:var(--sub);font-size:13px}
      .board-bookmarks .bookmark-delete{height:18px;padding:0 8px;font-size:10px;flex:none;border:1px solid var(--border);border-radius:9px;background:var(--panel);color:var(--sub)}
      .board-bookmarks .bookmark-delete:hover{color:#9b1c1c}
      .board-bookmarks .bookmark-empty,.board-bookmarks .bookmark-status{font-size:11px;color:var(--sub);white-space:normal;height:auto;min-height:24px;line-height:16px;padding-top:3px;padding-bottom:3px}
      .board-bookmarks .bookmark-status{color:#9b1c1c}
    `;
    doc.head.appendChild(style);
  }

  function create(options) {
    const o = options || {};
    const doc = root && root.document;
    if (!doc || !o.button || typeof o.getState !== 'function' || typeof o.restoreState !== 'function') {
      throw new TypeError('Bookmarks need a button, getState, and restoreState.');
    }
    installStyle(doc);
    const button = o.button;
    const nodes = new Map();
    let open = false;

    function element(tag, className, text) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    }
    function action(label, className, fn) {
      const node = element('button', className, label);
      node.type = 'button';
      node.addEventListener('click', fn);
      return node;
    }
    const panel = element('div', 'stack board-bookmarks');
    panel.id = 'board-bookmarks';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Board bookmarks');
    const stack = element('div', 'bookmark-stack');
    const addButton = action('+', 'cap bookmark-add', () => addBookmark());
    addButton.setAttribute('aria-label', 'Add bookmark');
    addButton.title = 'Save the entire board, its data, view, and camera at this moment';
    const listNode = element('div', 'bookmark-list');
    const empty = element('div', 'cap row bookmark-empty', 'Save this board arrangement');
    const status = element('div', 'cap row bookmark-status');
    status.hidden = true;
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    stack.append(listNode, empty, status);
    panel.append(stack, addButton);
    doc.body.appendChild(panel);
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', panel.id);
    button.setAttribute('aria-expanded', 'false');

    function read() {
      const list = typeof o.getBookmarks === 'function' ? o.getBookmarks() : (o.getState()?.board?.bookmarks || []);
      return Array.isArray(list) ? list.filter(entry => entry && entry.id && entry.state && entry.state.board) : [];
    }
    function error(err) {
      status.textContent = err && err.message || 'The bookmark could not be saved.';
      status.hidden = false;
      position();
    }
    function write(list, type, id) {
      if (typeof o.setBookmarks === 'function') o.setBookmarks(list);
      else {
        const state = o.getState();
        if (!state || !state.board) throw new Error('Open a program before saving a bookmark.');
        state.board.bookmarks = list;
      }
      status.hidden = true;
      if (typeof o.onChange === 'function') o.onChange({ type: type, id: id });
      refresh();
    }
    function addBookmark(name) {
      try {
        const state = o.getState();
        const list = add(read(), state, name);
        const entry = list[list.length - 1];
        write(list, 'add', entry.id);
        beginRename(entry.id);
        return entry.id;
      } catch (err) { error(err); return null; }
    }
    function renameBookmark(id, name) {
      try {
        const entry = read().find(item => item.id === id);
        if (!entry) return;
        const next = cleanName(name, entry.name);
        if (next !== entry.name) write(rename(read(), id, next), 'rename', id);
        else refresh();
      } catch (err) { error(err); }
    }
    function restoreBookmark(id) {
      const entry = read().find(item => item.id === id);
      if (!entry) return;
      try {
        // Restorers receive their own writable copy. The stored snapshot
        // and the catalogue remain independent of the active board.
        o.restoreState(clone(snapshot(entry.state)));
        status.hidden = true;
        if (typeof o.onChange === 'function') o.onChange({ type: 'restore', id: id });
        refresh();
      } catch (err) { error(err); }
    }
    function beginRename(id) {
      const item = nodes.get(id);
      const entry = read().find(value => value.id === id);
      if (!item || !entry) return;
      item.editing = true;
      item.label.hidden = item.rename.hidden = true;
      item.input.hidden = false;
      item.input.value = entry.name;
      item.row.tabIndex = -1;
      item.row.setAttribute('role', 'group');
      item.row.setAttribute('aria-label', 'Edit bookmark ' + entry.name);
      item.input.focus();
      item.input.select();
    }
    function finishRename(id, save, focus) {
      const item = nodes.get(id);
      if (!item || !item.editing) return;
      const value = item.input.value;
      item.editing = false;
      item.input.hidden = true;
      item.label.hidden = item.rename.hidden = false;
      item.row.tabIndex = 0;
      item.row.setAttribute('role', 'button');
      if (save) renameBookmark(id, value);
      else refresh();
      if (focus) item.row.focus();
    }
    function rowFor(entry) {
      if (nodes.has(entry.id)) return nodes.get(entry.id);
      const row = element('div', 'cap row bookmark-entry');
      row.dataset.bookmarkId = entry.id;
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      const label = element('span', 'bookmark-label');
      const input = element('input', 'bookmark-name');
      input.type = 'text';
      input.maxLength = MAX_NAME;
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.hidden = true;
      input.addEventListener('blur', () => finishRename(entry.id, true, false));
      input.addEventListener('click', event => event.stopPropagation());
      input.addEventListener('dblclick', event => event.stopPropagation());
      input.addEventListener('keydown', event => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          finishRename(entry.id, true, true);
        }
        else if (event.key === 'Escape') {
          event.preventDefault();
          finishRename(entry.id, false, true);
        }
      });
      const rename = action('✎', 'round bookmark-rename', event => {
        event.stopPropagation();
        beginRename(entry.id);
      });
      rename.title = 'Rename bookmark';
      const del = action('Delete', 'btn bookmark-delete', event => {
        event.stopPropagation();
        try { write(remove(read(), entry.id), 'delete', entry.id); } catch (err) { error(err); }
      });
      label.addEventListener('dblclick', event => {
        event.preventDefault(); event.stopPropagation(); beginRename(entry.id);
      });
      row.addEventListener('click', event => {
        if (event.detail > 1 || item.editing) return;
        restoreBookmark(entry.id);
      });
      row.addEventListener('keydown', event => {
        if (event.target !== row) return;
        if (event.key === 'F2') {
          event.preventDefault(); event.stopPropagation(); beginRename(entry.id);
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); event.stopPropagation(); restoreBookmark(entry.id);
        }
      });
      row.append(label, input, rename, del);
      const item = { row: row, label: label, input: input, rename: rename, del: del, editing: false };
      nodes.set(entry.id, item);
      return item;
    }
    function refresh() {
      const list = read();
      addButton.disabled = list.length >= MAX_BOOKMARKS;
      addButton.title = addButton.disabled ? 'Delete a bookmark before saving another (30 maximum)' : 'Save the entire board, its data, view, and camera at this moment';
      empty.hidden = list.length > 0;
      const current = new Set(list.map(entry => entry.id));
      nodes.forEach((item, id) => {
        if (!current.has(id)) { item.row.remove(); nodes.delete(id); }
      });
      let cursor = listNode.firstChild;
      list.forEach(entry => {
        const item = rowFor(entry);
        // Keep existing nodes while renaming so blur cannot remove the
        // Restore/Delete button before its following click is delivered.
        if (!item.editing) item.input.value = entry.name;
        item.label.textContent = entry.name;
        item.input.setAttribute('aria-label', 'Bookmark name: ' + entry.name);
        item.row.setAttribute('aria-label', (item.editing ? 'Edit bookmark ' : 'Restore ') + entry.name);
        item.rename.setAttribute('aria-label', 'Rename ' + entry.name);
        item.del.setAttribute('aria-label', 'Delete ' + entry.name);
        const date = Number.isFinite(Date.parse(entry.createdAt)) ? new Date(entry.createdAt).toLocaleString() : '';
        item.row.title = (date ? 'Saved ' + date : 'Saved board snapshot') + ' · Double-click name or press F2 to rename';
        if (item.row !== cursor) listNode.insertBefore(item.row, cursor);
        cursor = item.row.nextSibling;
      });
      if (open) position();
    }
    function position() {
      if (!open) return;
      const rect = button.getBoundingClientRect();
      const width = Math.min(310, Math.max(160, root.innerWidth - 16));
      panel.style.width = width + 'px';
      panel.style.left = Math.max(8, Math.min(root.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2)) + 'px';
      panel.style.bottom = Math.max(8, root.innerHeight - rect.top + 6) + 'px';
      panel.style.maxHeight = Math.max(24, rect.top - 14) + 'px';
    }
    function close() {
      if (panel.contains(doc.activeElement)) doc.activeElement.blur();
      open = false;
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-pressed', 'false');
    }
    function toggle(force) {
      const next = typeof force === 'boolean' ? force : !open;
      if (!next) { close(); return; }
      open = true;
      panel.hidden = false;
      status.hidden = true;
      button.setAttribute('aria-expanded', 'true');
      button.setAttribute('aria-pressed', 'true');
      refresh();
    }
    function outside(event) {
      if (open && !panel.contains(event.target) && !button.contains(event.target)) close();
    }
    function key(event) {
      if (event.key === 'Escape' && event.target.tagName !== 'INPUT') { close(); button.focus(); }
      event.stopPropagation();
    }
    button.addEventListener('click', toggleClick);
    function toggleClick() { toggle(); }
    panel.addEventListener('keydown', key);
    panel.addEventListener('keyup', event => event.stopPropagation());
    doc.addEventListener('pointerdown', outside, true);
    root.addEventListener('resize', position);
    refresh();
    return { toggle: toggle, close: close, refresh: refresh, add: addBookmark, element: panel, destroy: () => {
      close();
      button.removeEventListener('click', toggleClick);
      doc.removeEventListener('pointerdown', outside, true);
      root.removeEventListener('resize', position);
      panel.remove();
    } };
  }

  return { MAX_BOOKMARKS: MAX_BOOKMARKS, snapshot: snapshot, normalize: normalize, add: add, rename: rename, remove: remove, create: create };
});
