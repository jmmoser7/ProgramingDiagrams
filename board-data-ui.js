'use strict';

// The board's sheet editor is deliberately a DOM surface: the imported
// strings stay strings, and the app owns every model mutation / undo step.
(function (root) {
  const TAGS = [
    { id: 'area', key: 'areaKey', label: 'Area', hint: 'Sizes each program sticky from this column.' },
    { id: 'group', key: 'groupKeys', label: 'Group', hint: 'Groups siblings by this column. Several columns can be tagged.' },
    { id: 'count', key: 'countKey', label: 'Submodules', hint: 'Subdivides each sticky into exactly this many cells, bounded by the sticky.' },
    { id: 'width', key: 'moduleWidthKey', label: 'Module width', hint: 'Sets the base width of a module, in feet.' },
    { id: 'depth', key: 'moduleDepthKey', label: 'Module depth', hint: 'Sets the base depth of a module, in feet.' },
  ];
  let sequence = 0;

  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = value;
    return node;
  }

  function button(className, value, label) {
    const node = element('button', className, value);
    node.type = 'button';
    if (label) node.setAttribute('aria-label', label);
    return node;
  }

  function numeric(value) {
    const parsed = Number(String(value == null ? '' : value).replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function rawValue(row, key) {
    return row && row.fields && row.fields[key] != null ? String(row.fields[key]) : '';
  }

  function roleConfig(model, engine) {
    let source;
    if (engine && typeof engine.getColumnRoles === 'function') source = engine.getColumnRoles(model);
    else {
      const inferred = engine && typeof engine.categoricalKeys === 'function'
        ? engine.categoricalKeys(model).map((entry) => entry.key)
        : [model.deptKey, model.groupKey].filter(Boolean);
      source = Object.assign({ areaKey: model.areaKey, groupKeys: inferred }, model.columnRoles || {});
    }
    return {
      areaKey: source.areaKey || null,
      groupKeys: Array.isArray(source.groupKeys) ? source.groupKeys.slice() : [],
      countKey: source.countKey || null,
      moduleWidthKey: source.moduleWidthKey || null,
      moduleDepthKey: source.moduleDepthKey || null,
      moduleLock: source.moduleLock === 'hard' ? 'hard' : 'loose',
    };
  }

  function hasRole(roles, tag, key) {
    return tag.id === 'group' ? roles.groupKeys.indexOf(key) >= 0 : roles[tag.key] === key;
  }

  function create(options) {
    const opts = options || {};
    if (typeof opts.getModel !== 'function') throw new Error('The data dashboard needs getModel.');
    const anchor = opts.button || null;
    const engine = opts.engine || root.ProgramBoard;
    const id = 'program-data-dashboard-' + (++sequence);
    const dialog = element('section', 'board-data-dashboard');
    dialog.id = id;
    dialog.hidden = true;
    dialog.tabIndex = -1;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-labelledby', id + '-title');
    dialog.setAttribute('aria-describedby', id + '-help');

    const titleCap = element('div', 'cap row board-data-title');
    const title = element('span', 'board-data-heading', 'Program data');
    title.id = id + '-title';
    const file = element('span', 'board-data-file sub');
    const closeButton = button('round board-data-close', '×', 'Close data dashboard');
    titleCap.append(title, file, closeButton);

    const controls = element('div', 'board-data-controls');
    const searchCap = element('label', 'cap row board-data-search');
    searchCap.append(element('span', 'sub', 'Search'));
    const search = element('input');
    search.type = 'search';
    search.placeholder = 'Filter rows';
    search.autocomplete = 'off';
    search.setAttribute('aria-label', 'Search program data');
    searchCap.append(search);
    const summary = element('div', 'cap row board-data-summary');
    summary.setAttribute('aria-live', 'polite');
    const addColumnCap = element('div', 'cap row board-data-add-column');
    const addColumnButton = button('btn', '+ Column', 'Add a program data column');
    addColumnButton.title = 'Add a column for submodule counts, module dimensions, or other data';
    const columnName = element('input', 'board-data-column-input');
    columnName.type = 'text';
    columnName.maxLength = 96;
    columnName.autocomplete = 'off';
    columnName.spellcheck = false;
    columnName.placeholder = 'Column name';
    columnName.setAttribute('aria-label', 'New column name');
    columnName.hidden = true;
    const confirmColumn = button('btn', 'Add', 'Add this column');
    const cancelColumn = button('btn sub', 'Cancel', 'Cancel adding a column');
    confirmColumn.hidden = cancelColumn.hidden = true;
    addColumnCap.append(addColumnButton, columnName, confirmColumn, cancelColumn);
    controls.append(searchCap, summary, addColumnCap);

    const error = element('div', 'cap row board-data-error');
    error.hidden = true;
    error.setAttribute('role', 'alert');
    const scroller = element('div', 'board-data-table-wrap');
    scroller.tabIndex = 0;
    scroller.setAttribute('aria-label', 'Editable program table; scroll to see more columns');
    const table = element('table', 'board-data-table');
    const caption = element('caption', 'board-data-sr-only', 'Edit program values. Column tags control how the board interprets the table.');
    const head = element('thead');
    const body = element('tbody');
    table.append(caption, head, body);
    scroller.append(table);
    const empty = element('div', 'board-data-empty', 'No rows match this search.');
    empty.hidden = true;
    scroller.append(empty);

    const footer = element('div', 'board-data-footer');
    const help = element('div', 'cap row board-data-help', 'Tag columns · Enter saves · Esc reverts · Edits update the board');
    help.id = id + '-help';
    const commitButton = button('cap row board-data-commit', 'Commit', 'Commit data edits and close');
    commitButton.title = 'Validate the table, finish pending edits, and return to the board';
    footer.append(help, commitButton);
    const moduleHelp = element('div', 'cap row board-data-module-help', 'Count = exact cells · Width / depth = feet · Hard = exact modules · Loose = exact modules with grid off; grid on scales to grid · Source area is retained');
    dialog.append(titleCap, controls, error, scroller, footer, moduleHelp);
    document.body.append(dialog);

    const tagMenu = element('div', 'board-data-tags-menu');
    tagMenu.hidden = true;
    tagMenu.setAttribute('role', 'group');
    document.body.append(tagMenu);

    let opened = false;
    let destroyed = false;
    let returnFocus = null;
    let renderedModel = null;
    let renderedColumns = [];
    let renderedRows = [];
    let renderedRoles = '';
    let inputs = [];
    let active = null;
    let committing = false;
    let pending = null;
    let menuColumn = null;
    let menuAnchor = null;
    let rolesPending = false;
    let addingColumn = false;
    let columnPending = false;
    let commitPending = false;
    let commitPromise = null;
    let commitCallbackPending = false;

    if (anchor) {
      anchor.setAttribute('aria-controls', id);
      anchor.setAttribute('aria-expanded', 'false');
      anchor.setAttribute('aria-haspopup', 'dialog');
      anchor.addEventListener('click', toggle);
    }

    function reportError(message, input) {
      error.textContent = message || 'That change could not be applied.';
      error.hidden = false;
      if (input) input.setAttribute('aria-invalid', 'true');
    }

    function clearError(input) {
      error.hidden = true;
      error.textContent = '';
      if (input) input.removeAttribute('aria-invalid');
    }

    function modelNow() {
      const model = opts.getModel();
      return model && Array.isArray(model.columns) && Array.isArray(model.rows) ? model : null;
    }

    function beginAddColumn(name) {
      if (!opened || columnPending || rolesPending) return false;
      hideTags();
      addingColumn = true;
      addColumnButton.hidden = true;
      columnName.hidden = confirmColumn.hidden = cancelColumn.hidden = false;
      columnName.value = typeof name === 'string' ? name : '';
      clearError(columnName);
      columnName.focus();
      return true;
    }

    function cancelAddColumn(focus) {
      if (columnPending) return false;
      addingColumn = false;
      addColumnButton.hidden = false;
      columnName.hidden = confirmColumn.hidden = cancelColumn.hidden = true;
      columnName.value = '';
      clearError(columnName);
      if (focus !== false && opened) addColumnButton.focus();
      return true;
    }

    function commitNewColumn() {
      if (!addingColumn || columnPending || rolesPending) return false;
      const proceed = saved => {
        if (saved === false || !opened) return false;
        const model = modelNow();
        if (!model) return false;
        const name = columnName.value.trim();
        if (!name) { reportError('Enter a name for the new column.', columnName); return false; }
        if (model.columns.some(key => String(key).trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
          reportError('A column named “' + name + '” already exists.', columnName);
          return false;
        }
        columnPending = true;
        columnName.disabled = confirmColumn.disabled = cancelColumn.disabled = true;
        const failed = reason => {
          columnPending = false;
          columnName.disabled = confirmColumn.disabled = cancelColumn.disabled = false;
          reportError(reason && reason.message ? reason.message : String(reason || 'That column could not be added.'), columnName);
          return false;
        };
        const success = () => {
          columnPending = false;
          columnName.disabled = confirmColumn.disabled = cancelColumn.disabled = false;
          cancelAddColumn(false);
          refresh();
          const first = inputs.find(entry => entry.key === name);
          if (first) { first.input.focus(); first.input.select(); }
          else addColumnButton.focus();
          return true;
        };
        try {
          if (typeof opts.onAddColumn !== 'function') throw new Error('Adding columns is unavailable.');
          const result = opts.onAddColumn(name);
          if (result && typeof result.then === 'function') return Promise.resolve(result).then(outcome => outcome === false ? failed(new Error('That column could not be added.')) : success(), failed);
          return result === false ? failed(new Error('That column could not be added.')) : success();
        } catch (reason) { return failed(reason); }
      };
      const saved = commitActive();
      return saved && typeof saved.then === 'function' ? saved.then(proceed) : proceed(saved);
    }

    function filteredRows(model) {
      const query = search.value.trim().toLocaleLowerCase();
      const rows = [];
      model.rows.forEach((row, index) => {
        if (row.dropped) return;
        if (!query || model.columns.some((key) => rawValue(row, key).toLocaleLowerCase().indexOf(query) >= 0)) {
          rows.push({ row: row, index: index });
        }
      });
      return rows;
    }

    function paintSummary(model, roles, rows) {
      const allRows = model.rows.filter((row) => !row.dropped);
      const area = roles.areaKey ? rows.reduce((sum, item) => sum + Math.max(0, numeric(rawValue(item.row, roles.areaKey))), 0) : null;
      summary.textContent = rows.length + (rows.length === allRows.length ? '' : ' / ' + allRows.length)
        + ' row' + (allRows.length === 1 ? '' : 's')
        + (area == null ? ' · No area tag' : ' · ' + area.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' sf');
      file.textContent = model.fileName || '';
      file.title = file.textContent;
      addColumnButton.disabled = typeof opts.onAddColumn !== 'function' || columnPending || rolesPending || commitPending;
      commitButton.disabled = columnPending || rolesPending || commitPending;
      dialog.querySelectorAll('.board-data-module-toggle').forEach((node) => {
        const hard = roles.moduleLock === 'hard';
        const label = node.dataset.moduleLabel;
        node.textContent = hard ? 'Hard' : 'Loose';
        node.classList.toggle('on', hard);
        node.setAttribute('aria-pressed', String(hard));
        node.setAttribute('aria-label', label + ' lock: ' + (hard ? 'Hard' : 'Loose') + '. Switch to ' + (hard ? 'Loose' : 'Hard'));
        node.disabled = rolesPending || commitPending;
      });
    }

    function moduleToggle(tag, roles, key) {
      const hard = roles.moduleLock === 'hard';
      const toggleButton = button('board-data-module-toggle' + (hard ? ' on' : ''), hard ? 'Hard' : 'Loose',
        tag.label + ' lock: ' + (hard ? 'Hard' : 'Loose') + '. Switch to ' + (hard ? 'Loose' : 'Hard'));
      toggleButton.dataset.moduleLabel = tag.label;
      toggleButton.setAttribute('aria-pressed', String(hard));
      toggleButton.title = 'Hard: exact module dimensions. Loose: exact dimensions with grid off; grid on scales the whole sticky to grid increments. Applies to both module dimensions; source area is retained.';
      toggleButton.addEventListener('click', (event) => {
        event.stopPropagation();
        const model = modelNow();
        if (!model || rolesPending || commitPending) return;
        const next = roleConfig(model, engine);
        next.moduleLock = next.moduleLock === 'hard' ? 'loose' : 'hard';
        applyRoles(next, key);
      });
      return toggleButton;
    }

    function paintHeaders(model, roles) {
      head.textContent = '';
      const header = element('tr');
      const number = element('th', 'board-data-row-number', '#');
      number.scope = 'col';
      number.title = 'Spreadsheet row';
      header.append(number);
      model.columns.forEach((key) => {
        const th = element('th', 'board-data-column');
        th.scope = 'col';
        th.dataset.column = key;
        const label = element('span', 'board-data-column-name', key);
        label.title = key;
        const tagControls = element('div', 'board-data-tags-controls');
        const tagButton = button('board-data-tag-button', null, 'Column tags for ' + key);
        tagButton.title = 'Choose how the board interprets ' + key;
        tagButton.setAttribute('aria-expanded', 'false');
        const tags = TAGS.filter((tag) => hasRole(roles, tag, key));
        tags.forEach((tag) => {
          th.classList.add('role-' + tag.id);
          if (tag.id === 'width' || tag.id === 'depth') {
            const capsule = element('span', 'board-data-module-tag');
            const labelButton = button('board-data-module-label board-data-tag tag-' + tag.id, tag.label, 'Column tags for ' + key + ', ' + tag.label);
            labelButton.addEventListener('click', () => showTags(key, labelButton));
            capsule.append(labelButton, moduleToggle(tag, roles, key));
            tagControls.append(capsule);
          } else tagButton.append(element('span', 'board-data-tag tag-' + tag.id, tag.label));
        });
        tagButton.append(element('span', 'board-data-tag-add', tags.length ? '⌄' : '+ tag'));
        tagButton.addEventListener('click', () => {
          if (menuColumn === key && !tagMenu.hidden) hideTags();
          else showTags(key, tagButton);
        });
        tagControls.append(tagButton);
        th.append(label, tagControls);
        header.append(th);
      });
      head.append(header);
    }

    function makeInput(model, item, key, roles) {
      const input = element('input', 'board-data-cell');
      input.type = 'text';
      input.value = rawValue(item.row, key);
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.dataset.column = key;
      input.dataset.rowIndex = String(item.index);
      input.setAttribute('aria-label', 'Row ' + (item.index + 1) + ', ' + key);
      if (TAGS.some((tag) => tag.id !== 'group' && hasRole(roles, tag, key))) input.inputMode = 'decimal';
      const entry = { input: input, row: item.row, model: model, key: key, baseline: input.value };
      inputs.push(entry);
      input.addEventListener('focus', () => {
        // An invalid edit stays available to fix when focus returns.
        if (input.value === entry.baseline) {
          entry.baseline = rawValue(entry.row, entry.key);
          input.value = entry.baseline;
        }
        active = entry;
      });
      input.addEventListener('input', () => clearError(input));
      input.addEventListener('blur', () => {
        const saved = commitEntry(entry);
        if (active === entry && saved === true) active = null;
      });
      input.addEventListener('keydown', (event) => {
        if (event.isComposing) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          input.value = entry.baseline;
          clearError(input);
          input.blur();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          const done = commitEntry(entry);
          const advance = (success) => {
            if (success === false || !opened) return;
            const siblings = inputs.filter((next) => next.key === key);
            const current = siblings.findIndex((next) => next.row === entry.row);
            const next = siblings[current + (event.shiftKey ? -1 : 1)];
            if (next) { next.input.focus(); next.input.select(); }
            else input.blur();
          };
          if (done && typeof done.then === 'function') done.then(advance);
          else advance(done);
        }
      });
      return input;
    }

    function paintRows(model, roles, rows) {
      body.textContent = '';
      inputs = [];
      const fragment = document.createDocumentFragment();
      rows.forEach((item) => {
        const tr = element('tr');
        const number = element('th', 'board-data-row-number', String(item.index + 1));
        number.scope = 'row';
        tr.append(number);
        model.columns.forEach((key) => {
          const cell = element('td');
          TAGS.forEach((tag) => { if (hasRole(roles, tag, key)) cell.classList.add('role-' + tag.id); });
          cell.append(makeInput(model, item, key, roles));
          tr.append(cell);
        });
        fragment.append(tr);
      });
      body.append(fragment);
      empty.hidden = rows.length > 0;
    }

    function refresh() {
      if (!opened || destroyed || committing) return;
      const model = modelNow();
      if (!model) { finishClose(); return; }
      const roles = roleConfig(model, engine);
      const rows = filteredRows(model);
      const roleKey = JSON.stringify(roles);
      const columnsChanged = model.columns.length !== renderedColumns.length
        || model.columns.some((key, index) => key !== renderedColumns[index]);
      const rowsChanged = model !== renderedModel || rows.length !== renderedRows.length
        || rows.some((item, index) => item.row !== renderedRows[index].row || item.index !== renderedRows[index].index);
      const rolesChanged = roleKey !== renderedRoles;
      if (columnsChanged || rowsChanged || rolesChanged) {
        const focused = inputs.find((entry) => entry.input === document.activeElement);
        // A board refresh cannot discard a pending or invalid table edit.
        if (inputs.some((entry) => entry.model === model && entry.input.value !== entry.baseline)) {
          paintSummary(model, roles, rows);
          return;
        }
        hideTags();
        const scrollX = scroller.scrollLeft;
        const scrollY = scroller.scrollTop;
        paintHeaders(model, roles);
        paintRows(model, roles, rows);
        renderedModel = model;
        renderedColumns = model.columns.slice();
        renderedRows = rows;
        renderedRoles = roleKey;
        scroller.scrollLeft = scrollX;
        scroller.scrollTop = scrollY;
        if (focused) {
          const replacement = inputs.find((entry) => entry.row === focused.row && entry.key === focused.key);
          if (replacement) replacement.input.focus({ preventScroll: true });
          else if (focused.input === document.activeElement) search.focus();
        }
      } else {
        inputs.forEach((entry) => {
          if (entry.input === document.activeElement || entry.input.value !== entry.baseline) return;
          entry.input.value = rawValue(entry.row, entry.key);
          entry.baseline = entry.input.value;
        });
      }
      paintSummary(model, roles, rows);
    }

    function commitEntry(entry) {
      if (!entry || entry.input.value === entry.baseline) return true;
      if (pending) return pending;
      const model = modelNow();
      if (model !== entry.model) {
        entry.input.value = entry.baseline;
        refresh();
        return false;
      }
      const rowIndex = model.rows.indexOf(entry.row);
      if (rowIndex < 0 || entry.row.dropped) return false;
      const value = entry.input.value;
      committing = true;
      const success = () => {
        entry.baseline = rawValue(entry.row, entry.key);
        entry.input.value = entry.baseline;
        committing = false;
        pending = null;
        clearError(entry.input);
        refresh();
        return true;
      };
      const failed = (reason) => {
        committing = false;
        pending = null;
        reportError(reason && reason.message ? reason.message : String(reason || 'That value could not be saved.'), entry.input);
        return false;
      };
      try {
        if (typeof opts.onEdit !== 'function') throw new Error('Table editing is unavailable.');
        const result = opts.onEdit({ rowIndex: rowIndex, key: entry.key, value: value });
        if (result && typeof result.then === 'function') {
          pending = Promise.resolve(result).then((outcome) => outcome === false ? failed(new Error('That value could not be saved.')) : success(), failed);
          return pending;
        }
        return result === false ? failed(new Error('That value could not be saved.')) : success();
      } catch (reason) { return failed(reason); }
    }

    function commitActive() {
      if (pending) return pending.then((ok) => ok === false ? false : commitActive());
      let dirty = active && active.input.value !== active.baseline ? active
        : inputs.find((entry) => entry.input.value !== entry.baseline);
      while (dirty) {
        const saved = commitEntry(dirty);
        if (saved && typeof saved.then === 'function') return saved.then((ok) => ok === false ? false : commitActive());
        if (saved === false) {
          if (dirty.input.isConnected) dirty.input.focus({ preventScroll: true });
          return false;
        }
        dirty = inputs.find((entry) => entry.input.value !== entry.baseline);
      }
      return true;
    }

    // Focus can move to a header while an invalid value remains in a cell.
    // Shared views must defer replacing its source model until it is saved
    // or cancelled. A synchronous onCommit can persist the completed edits;
    // only an unresolved asynchronous Commit callback is still pending.
    function hasPendingEdits() {
      return !destroyed && !!(committing || pending || rolesPending || columnPending || addingColumn || commitCallbackPending
        || inputs.some(entry => entry.input.value !== entry.baseline));
    }

    function hideTags() {
      if (menuAnchor) menuAnchor.setAttribute('aria-expanded', 'false');
      tagMenu.hidden = true;
      menuColumn = null;
      menuAnchor = null;
    }

    function positionTags() {
      if (tagMenu.hidden || !menuAnchor) return;
      const rect = menuAnchor.getBoundingClientRect();
      const width = tagMenu.offsetWidth;
      const height = tagMenu.offsetHeight;
      const x = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left));
      let y = rect.bottom + 6;
      if (y + height > window.innerHeight - 8) y = Math.max(8, rect.top - height - 6);
      tagMenu.style.left = Math.round(x) + 'px';
      tagMenu.style.top = Math.round(y) + 'px';
    }

    function showTags(key, source) {
      const model = modelNow();
      if (!model || rolesPending) return;
      hideTags();
      const roles = roleConfig(model, engine);
      menuColumn = key;
      menuAnchor = source;
      source.setAttribute('aria-expanded', 'true');
      tagMenu.textContent = '';
      tagMenu.setAttribute('aria-label', 'Column tags for ' + key);
      const menuTitle = element('div', 'cap row board-data-tags-title', key);
      menuTitle.title = key;
      tagMenu.append(menuTitle);
      TAGS.forEach((tag) => {
        const on = hasRole(roles, tag, key);
        const module = tag.id === 'width' || tag.id === 'depth';
        const capsule = module ? element('div', 'cap row board-data-tag-option board-data-module-option' + (on ? ' on' : '')) : null;
        const option = button(module ? 'board-data-module-option-label' : 'cap row board-data-tag-option' + (on ? ' on' : ''), null, tag.label + ' tag for ' + key);
        option.setAttribute('aria-pressed', String(on));
        option.title = tag.hint;
        option.append(element('span', 'board-data-tag tag-' + tag.id, tag.label), element('span', 'board-data-tag-check', on ? '✓' : '+'));
        option.addEventListener('click', () => {
          const next = roleConfig(modelNow(), engine);
          if (tag.id === 'group') {
            next.groupKeys = next.groupKeys.filter((value) => value !== key);
            if (!on) next.groupKeys.push(key);
          } else next[tag.key] = on ? null : key;
          applyRoles(next, key);
        });
        if (capsule) {
          const lockToggle = moduleToggle(tag, roles, key);
          lockToggle.hidden = !on;
          capsule.append(option, lockToggle);
          tagMenu.append(capsule);
        } else tagMenu.append(option);
      });
      const none = button('cap row board-data-tag-option board-data-tag-none', 'None', 'Clear all tags from ' + key);
      none.title = 'Explicitly stop interpreting this column as area, group, count, or module dimensions.';
      none.addEventListener('click', () => {
        const next = roleConfig(modelNow(), engine);
        TAGS.forEach((tag) => {
          if (tag.id === 'group') next.groupKeys = next.groupKeys.filter((value) => value !== key);
          else if (next[tag.key] === key) next[tag.key] = null;
        });
        applyRoles(next, key);
      });
      tagMenu.append(none);
      tagMenu.hidden = false;
      positionTags();
      const first = tagMenu.querySelector('button');
      if (first) first.focus({ preventScroll: true });
    }

    function applyRoles(next, column) {
      if (rolesPending) return;
      const proceed = (saved) => {
        if (saved === false || !opened) return;
        rolesPending = true;
        tagMenu.querySelectorAll('button').forEach((node) => { node.disabled = true; });
        dialog.querySelectorAll('.board-data-module-toggle').forEach((node) => { node.disabled = true; });
        commitButton.disabled = true;
        const finish = () => {
          rolesPending = false;
          hideTags();
          clearError();
          refresh();
          if (column) {
            const header = Array.from(head.querySelectorAll('.board-data-column')).find((node) => node.dataset.column === column);
            if (header) header.querySelector('button').focus({ preventScroll: true });
          }
        };
        const failed = (reason) => {
          rolesPending = false;
          reportError(reason && reason.message ? reason.message : String(reason || 'These tags could not be applied.'));
          tagMenu.querySelectorAll('button').forEach((node) => { node.disabled = false; });
          dialog.querySelectorAll('.board-data-module-toggle').forEach((node) => { node.disabled = false; });
          commitButton.disabled = false;
        };
        try {
          if (typeof opts.onRoles !== 'function') throw new Error('Column tags are unavailable.');
          const result = opts.onRoles(next);
          if (result && typeof result.then === 'function') Promise.resolve(result).then((outcome) => outcome === false ? failed(new Error('These tags could not be applied.')) : finish(), failed);
          else if (result === false) failed(new Error('These tags could not be applied.'));
          else finish();
        } catch (reason) { failed(reason); }
      };
      const saved = commitActive();
      if (saved && typeof saved.then === 'function') saved.then(proceed);
      else proceed(saved);
    }

    function open() {
      if (destroyed) return false;
      if (!modelNow()) return false;
      if (opened) { search.focus(); return true; }
      returnFocus = document.activeElement;
      opened = true;
      dialog.hidden = false;
      if (anchor) anchor.setAttribute('aria-expanded', 'true');
      clearError();
      refresh();
      search.focus();
      return true;
    }

    function finishClose() {
      if (!opened) return;
      opened = false;
      hideTags();
      cancelAddColumn(false);
      dialog.hidden = true;
      if (anchor) anchor.setAttribute('aria-expanded', 'false');
      const target = anchor || returnFocus;
      if (target && target.isConnected && typeof target.focus === 'function') target.focus({ preventScroll: true });
      if (typeof opts.onClose === 'function') opts.onClose();
    }

    function close() {
      if (commitPending) return commitPromise || false;
      if (columnPending || rolesPending) return false;
      const saved = commitActive();
      if (saved && typeof saved.then === 'function') return saved.then((ok) => { if (ok !== false) finishClose(); return ok; });
      if (saved !== false) finishClose();
      return saved;
    }

    function commit() {
      if (commitPending) return commitPromise || false;
      if (!opened || destroyed || columnPending || rolesPending) return false;
      commitPending = true;
      commitButton.disabled = true;
      const release = () => {
        commitPending = false;
        commitCallbackPending = false;
        commitPromise = null;
        commitButton.disabled = false;
        refresh();
      };
      const failed = (reason) => {
        release();
        reportError(reason && reason.message ? reason.message : String(reason || 'The data edits could not be committed.'));
        return false;
      };
      const finish = () => {
        release();
        finishClose();
        return true;
      };
      const afterEdits = (saved) => {
        if (saved === false) { release(); return false; }
        try {
          const result = typeof opts.onCommit === 'function' ? opts.onCommit() : undefined;
          if (result && typeof result.then === 'function') {
            commitCallbackPending = true;
            return Promise.resolve(result).then((ok) => ok === false ? failed(new Error('The data edits could not be committed.')) : finish(), failed);
          }
          return result === false ? failed(new Error('The data edits could not be committed.')) : finish();
        } catch (reason) { return failed(reason); }
      };
      try {
        const saved = addingColumn ? commitNewColumn() : commitActive();
        const result = saved && typeof saved.then === 'function' ? saved.then(afterEdits, failed) : afterEdits(saved);
        if (result && typeof result.then === 'function') commitPromise = result;
        return result;
      } catch (reason) { return failed(reason); }
    }

    function toggle() { return opened ? close() : open(); }

    function outsideTags(event) {
      if (!tagMenu.hidden && !tagMenu.contains(event.target) && !(menuAnchor && menuAnchor.contains(event.target))) hideTags();
    }

    function keys(event) {
      event.stopPropagation();
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      if (!tagMenu.hidden) {
        const source = menuAnchor;
        hideTags();
        if (source) source.focus();
      } else if (addingColumn) cancelAddColumn();
      else close();
    }

    function searchRows() {
      hideTags();
      refresh();
    }

    dialog.addEventListener('keydown', keys);
    tagMenu.addEventListener('keydown', keys);
    ['pointerdown', 'click', 'dblclick', 'contextmenu'].forEach((name) => {
      dialog.addEventListener(name, (event) => event.stopPropagation());
      tagMenu.addEventListener(name, (event) => event.stopPropagation());
    });
    dialog.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
    closeButton.addEventListener('click', close);
    commitButton.addEventListener('click', commit);
    addColumnButton.addEventListener('click', () => beginAddColumn());
    confirmColumn.addEventListener('click', commitNewColumn);
    cancelColumn.addEventListener('click', () => cancelAddColumn());
    columnName.addEventListener('input', () => clearError(columnName));
    columnName.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (event.key === 'Enter') {
        event.preventDefault(); event.stopPropagation(); commitNewColumn();
      } else if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); cancelAddColumn();
      }
    });
    search.addEventListener('input', searchRows);
    scroller.addEventListener('scroll', hideTags, { passive: true });
    document.addEventListener('pointerdown', outsideTags, true);
    window.addEventListener('resize', hideTags);

    function destroy() {
      destroyed = true;
      opened = false;
      document.removeEventListener('pointerdown', outsideTags, true);
      window.removeEventListener('resize', hideTags);
      if (anchor) {
        anchor.removeEventListener('click', toggle);
        anchor.setAttribute('aria-expanded', 'false');
        anchor.removeAttribute('aria-controls');
      }
      dialog.remove();
      tagMenu.remove();
    }

    return { open: open, close: close, commit: commit, toggle: toggle, refresh: refresh, commitActive: commitActive, hasPendingEdits: hasPendingEdits, addColumn: beginAddColumn, commitNewColumn: commitNewColumn, isOpen: () => opened, destroy: destroy };
  }

  root.ProgramDataDashboard = { create: create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
