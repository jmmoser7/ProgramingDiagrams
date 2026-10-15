'use strict';

// Pack board. A second view of the same spreadsheet: tiles fill one frame,
// the frame's area is always the program, and the
// aspect ratio stays at whatever the user locked.

(function () {
  const PB = window.PackBoard;
  const Engine = window.ProgramBoard;
  const Appearance = window.ProgramAppearance;
  const PALETTE = ['#cad8e2', '#e4cdbb', '#ced8c5', '#d7cddd', '#e3dab8', '#c1d8d1', '#dcc4c5', '#c7cddf', '#d8d4bf', '#d9cbbd', '#c5d5d9', '#d6c4d0'];
  const LEGACY_PALETTE = ['#3d78b4', '#ef9633', '#2c5f8e', '#1e466c', '#e4c07a', '#8eb8d8', '#c9a36a', '#5d8eb4', '#d9843f', '#7ea894', '#6a7f99', '#e7c99a'];
  const STORE = 'program-board-v4';
  const LEGACY_STORE = 'pack-board-v1';
  const FRAME = '#ffffff';
  const $ = (id) => document.getElementById(id);

  const canvas = $('board');
  const ctx = canvas.getContext('2d');
  let viewW = 1;
  let viewH = 1;
  let dpr = 1;
  let model = null;
  let shared = { view: {}, camera: null };
  let sharedBase = null;
  let leaderThreshold = 0;
  let preparedColors = null;
  let leaders = { items: [] };
  let incomingPending = null;
  let sharedSaveTimer = 0;
  let order = [];
  let aspect = 1.6;
  let scale = 1;
  let algorithm = 'squarify';
  let nest = 'flat';
  let manual = null;
  let title = 'Program';
  let selected = new Set();
  let liveTiles = null;
  let anim = null;
  let drag = null;
  let camera = { x: 0, y: 0, z: 1 };
  let undoStack = [];
  let redoStack = [];
  let fresh = false;
  let space = false;
  let toastTimer = 0;
  let raf = 0;
  let nameEdit = null;
  let dataDashboard = null;
  let chrome = { title: null };
  let menuAt = null;
  let background = '#ffffff';
  let buffer = 0;
  let fillet = 0;
  let areaHits = new Map();
  let boardText = { face: 'std', size: 1, ink: null };
  let departmentColors = new Map();
  let colorSwatches = {fill: [], text: [], background: []};
  let backgroundSwatch = null;
  let departmentDividers = true;
  const copySwatches = () => Object.fromEntries(Object.entries(colorSwatches).map(([kind, list]) => [kind, list.map(entry => ({...entry}))]));
  const restoreSwatches = saved => Object.fromEntries(['fill', 'text', 'background'].map(kind => [kind, (saved?.[kind] || []).map(entry => ({...entry}))]));
  const FACES = { std: {label:'Std', css: "'Replica Std', 'Replica', 'PB Replica', 'Segoe UI', sans-serif"}, mono: {label:'Mono', css:"'Replica Mono', Consolas, monospace"}, sans: {label:'Sans', css:"system-ui, 'Segoe UI', sans-serif"} };
  const errors = PB.selfTest();
  if (errors.length) console.error('Pack engine\n' + errors.join('\n'));

  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  function fmt(n) {
    return Math.round(n).toLocaleString('en-US');
  }

  function typing() {
    const tag = document.activeElement && document.activeElement.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA';
  }

  function cell(row, key) {
    if (!row || !key) return '';
    const v = row.fields[key];
    return v == null ? '' : String(v).trim();
  }

  function sticky(id) {
    if (!model) return null;
    for (let i = 0; i < model.stickies.length; i++) if (model.stickies[i].id === id) return model.stickies[i];
    return null;
  }

  function rowOf(s) {
    return s ? model.rows[s.rowIndex] : null;
  }

  function kept(s) {
    const row = rowOf(s);
    return !!(row && !row.dropped);
  }

  function dataArea(s) {
    return Number((s.tw * s.th).toPrecision(12));
  }

  function setDataArea(s, area) {
    const a = Math.max(0, area);
    Engine.setAreaKeepingAspect(model,s,a);
    return a;
  }

  function totalArea() {
    let n = 0;
    for (let i = 0; i < order.length; i++) {
      const s = sticky(order[i]);
      if (s && kept(s)) n += dataArea(s);
    }
    return n;
  }

  function hiddenZeros() {
    if (!model) return 0;
    let n = 0;
    for (let i = 0; i < model.rows.length; i++) {
      const row = model.rows[i];
      if (row.dropped) continue;
      const drawn = model.stickies.some((s) => s.rowIndex === i && dataArea(s) > 0);
      if (!drawn) n += 1;
    }
    return n;
  }

  function normalizeAreas() {
    for (let i = 0; i < model.stickies.length; i++) {
      const s = model.stickies[i];
      const raw = Engine.num(rowOf(s).fields[model.areaKey]);
      setDataArea(s, Math.max(0, raw));
    }
  }

  function csv() {
    // ProgramBoard's export synchronizes and rounds sticky areas. Export a
    // row-only copy so pack's fractional areas and zero rows survive unchanged.
    return Engine.exportCsv(Object.assign({}, model, { stickies: [] }));
  }

  function modelFromMatrix(matrix, name) {
    const next = Engine.modelFromMatrix(matrix,name);
    if (next.stickies.length) { Engine.pack(next); Engine.frameAround(next); }
    return next;
  }

  function modelFromCsv(text, name) {
    return modelFromMatrix(Engine.parseCsv(text), name);
  }

  function items(orderIds, override) {
    const ids = orderIds || order;
    const out = [];
    for (let i = 0; i < ids.length; i++) {
      const s = sticky(ids[i]);
      if (!s || !kept(s)) continue;
      const row = rowOf(s);
      let dept = cell(row, model.deptKey);
      let group = cell(row, model.groupKey);
      if (override && override.id === s.id) {
        if (override.dept != null) dept = override.dept;
        if (override.group != null) group = override.group;
      }
      out.push({ id: s.id, area: dataArea(s), dept: dept, group: group });
    }
    return out;
  }

  function frameNow() {
    const area = totalArea();
    return PB.frameOf(area > 0 ? area : 1, aspect, scale);
  }

  function settled() {
    const frame = frameNow();
    if (!(totalArea() > 0)) return { frame: { x: 0, y: 0, w: 0, h: 0, area: 0 }, tiles: [], groups: [] };
    if (liveTiles) return { frame: frame, tiles: liveTiles, groups: [] };
    if (manual) {
      return {
        frame: frame,
        tiles: manual.map((m) => ({
          id: m.id,
          x: frame.x + m.u * frame.w,
          y: frame.y + m.v * frame.h,
          w: m.su * frame.w,
          h: m.sv * frame.h,
        })),
        groups: [],
      };
    }
    const laid = PB.pack(items(), frame, { algorithm: algorithm, nest: nest });
    return { frame: frame, tiles: laid.tiles, groups: laid.groups };
  }

  function snapshot() {
    return {
      board: Engine.capture(model), view: JSON.parse(JSON.stringify(shared.view || {})), leaderThreshold,
      columns: model.columns.slice(), groupKey: model.groupKey,
      rows: model.rows.map((r) => ({ id: r.id, fields: Object.assign({}, r.fields), dropped: !!r.dropped })),
      stickies: model.stickies.map((s) => ({ ...s, style: s.style ? { ...s.style } : undefined })),
      background, backgroundSwatch, departmentDividers, colorSwatches: copySwatches(), buffer, fillet, boardText: { ...boardText }, departmentColors: Array.from(departmentColors),
      order: order.slice(),
      aspect: aspect,
      scale: scale,
      algorithm: algorithm,
      nest: nest,
      manual: manual ? manual.map((m) => Object.assign({}, m)) : null,
      title: title,
    };
  }

  function restoreSnap(s) {
    if (s.board) model = Engine.restore(s.board);
    if (s.view) shared.view = JSON.parse(JSON.stringify(s.view));
    leaderThreshold = Number(s.leaderThreshold ?? s.view?.leaderThreshold) || 0;
    if (s.columns) model.columns = s.columns.slice();
    model.groupKey = s.groupKey;
    model.rows = s.rows.map((r) => ({ id: r.id, fields: Object.assign({}, r.fields), dropped: r.dropped }));
    model.stickies = s.stickies.map((st) => ({ ...st, style: st.style ? { ...st.style } : undefined }));
    Engine.ensureRowIds(model);
    background = s.background || '#ffffff';
    buffer = s.buffer || 0; fillet = s.fillet || 0;
    boardText = { face: 'std', size: 1, ink: null, ...s.boardText };
    departmentColors = new Map(s.departmentColors || []);
    colorSwatches = restoreSwatches(s.colorSwatches); backgroundSwatch = s.backgroundSwatch || null;
    departmentDividers = s.departmentDividers !== false;
    order = s.order.slice();
    aspect = s.aspect;
    scale = 1;
    algorithm = s.algorithm;
    nest = s.nest;
    manual = s.manual ? s.manual.map((m) => Object.assign({}, m)) : null;
    title = s.title;
    selected = new Set(Array.from(selected).filter((id) => sticky(id) && kept(sticky(id))));
    liveTiles = null;
    anim = null;
    nameEdit = null;
    $('name-input').hidden = true;
  }

  function pushUndo(before) {
    undoStack.push(before || snapshot());
    if (undoStack.length > 80) undoStack.shift();
    redoStack = [];
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    restoreSnap(undoStack.pop());
    persist();
    syncChrome();
    refreshSwatches();
    requestDraw();
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    restoreSnap(redoStack.pop());
    persist();
    syncChrome();
    refreshSwatches();
    requestDraw();
  }

  function exportedIndex() {
    const map = new Map();
    let n = 0;
    for (let i = 0; i < model.rows.length; i++) {
      if (model.rows[i].dropped) continue;
      map.set(i, n);
      n += 1;
    }
    return map;
  }

  function serialize() {
    return Engine.packLayout(model, { ...(shared.view || {}), leaderThreshold, pack: packSettings() }, shared.camera || null);
  }

  function packSettings() {
    return {
      version: 3,
      background, backgroundSwatch, departmentDividers, colorSwatches: copySwatches(), buffer, fillet, boardText, camera: {...camera}, departmentColors: Array.from(departmentColors),
      styles: Object.fromEntries(model.stickies.filter(kept).map(s => [s.id, s.style ? {...s.style} : null])),
      order: order.filter(id => sticky(id) && kept(sticky(id))),
      areas: Object.fromEntries(model.stickies.filter(kept).map(s => [s.id, dataArea(s)])),
      aspect: aspect,
      scale: scale,
      algorithm: algorithm,
      nest: nest,
      title: title,
      manual: manual ? manual.filter(m => sticky(m.id) && kept(sticky(m.id))).map(m => ({...m})) : null,
    };
  }

  function queueSharedPersist() {
    clearTimeout(sharedSaveTimer);
    sharedSaveTimer = setTimeout(persist, 400);
  }

  function persist() {
    clearTimeout(sharedSaveTimer);
    if (fresh || !model) return;
    if (dataDashboard?.hasPendingEdits()) { queueSharedPersist(); return; }
    let next = { ...shared, board: Engine.capture(model), view: { ...(shared.view || {}), leaderThreshold, pack: packSettings() } };
    const remote = incomingPending || window.ProgramModeState?.latest();
    if (remote && sharedBase?.board && window.ProgramModeState?.reconcile && JSON.stringify(remote) !== JSON.stringify(sharedBase)) {
      next = window.ProgramModeState.reconcile(sharedBase,next,remote);
      const keep=[...selected], undo=undoStack, redo=redoStack;
      applyShared(next); selected=new Set(keep.filter(id=>sticky(id)&&kept(sticky(id))));undoStack=undo;redoStack=redo;
    }
    incomingPending = null;
    shared = next;
    sharedBase = JSON.parse(JSON.stringify(next));
    try { localStorage.setItem(STORE, JSON.stringify(shared)); } catch (err) { /* full or private */ }
  }

  function applyShared(saved) {
    if (dataDashboard?.hasPendingEdits()) { incomingPending = saved; queueSharedPersist(); return false; }
    shared = JSON.parse(JSON.stringify(saved));
    sharedBase = JSON.parse(JSON.stringify(saved));
    shared.view = shared.view || {};
    leaderThreshold = Math.max(0,Math.min(120,Number(shared.view.leaderThreshold)||0));
    adopt(Engine.restore(saved.board), true);
    const p = shared.view.pack || {};
    background = p.background || '#ffffff'; buffer = Math.max(0, Math.min(5, Number(p.buffer) || 0)); fillet = Number(p.fillet) || 0;
    boardText = { face: 'std', size: 1, ink: null, ...(p.boardText || {}) };
    departmentColors = new Map(p.departmentColors || []); colorSwatches = restoreSwatches(p.colorSwatches);
    backgroundSwatch = p.backgroundSwatch || null; departmentDividers = p.departmentDividers !== false;
    for (const s of model.stickies) if (p.styles && p.styles[s.id]) s.style = {...p.styles[s.id]};
    const validIds = new Set(model.stickies.filter(kept).map(s => s.id));
    order = (p.order || []).filter((id, i, ids) => validIds.has(id) && ids.indexOf(id) === i);
    for (const s of model.stickies) if (kept(s) && !order.includes(s.id)) order.push(s.id);
    aspect = p.aspect > 0 ? p.aspect : 1.6; algorithm = PB.ALGORITHMS.some(a => a.id === p.algorithm) ? p.algorithm : 'squarify';
    nest = p.nest === 'both' ? 'dept' : p.nest || 'flat'; scale = 1;
    title = p.title || model.frame?.title || String(model.fileName || 'Program').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    const positive = new Set(items().filter(t => t.area > 0).map(t => t.id));
    const manualValid = Array.isArray(p.manual) && p.manual.length === positive.size && p.manual.every(m => positive.has(m.id) && ['u','v','su','sv'].every(k => Number.isFinite(m[k])) && (!p.areas || Math.abs((p.areas[m.id] || 0) - dataArea(sticky(m.id))) < 1e-7));
    manual = manualValid ? p.manual.map(m => ({...m})) : null;
    if (p.camera && ['x','y','z'].every(k => Number.isFinite(p.camera[k])) && p.camera.z > 0) camera = {...p.camera};
    else fitView();
    $('empty').hidden = !!model.rows.length;
    syncChrome(); requestDraw();
  }

  function flushEdits() {
    if (dataDashboard?.commitActive() === false) throw new Error('Correct the highlighted table value before continuing.');
    const active = document.activeElement;
    if (active && active !== document.body && typeof active.blur === 'function') active.blur();
    if (nameEdit) {
      if (nameEdit.title) { const value = $('name-input').value.trim(); if (value) title = value; nameEdit = null; $('name-input').hidden = true; }
      else { commitName(); if (nameEdit) { nameEdit = null; $('name-input').hidden = true; } }
    }
    if (drag) cancelDrag();
    anim = null; liveTiles = null;
    persist();
    return sharedState();
  }

  function sharedState() {
    return model ? { ...shared, board: Engine.capture(model), view: {...(shared.view || {}), leaderThreshold, pack: packSettings()}, camera: shared.camera || null, ephemeral: fresh || undefined } : null;
  }

  function applySaved(saved) {
    if (saved && saved.board) { applyShared(saved); sharedBase=null; return; }
    shared={view:{},camera:null};sharedBase=null;leaderThreshold=0;
    const next = modelFromCsv(saved.csv, saved.fileName || 'program.csv');
    adopt(next, false);
    undoStack = []; redoStack = []; selected.clear(); drag = null; anim = null; liveTiles = null;
    nameEdit = null; $('name-input').hidden = true;
    const byRow = new Map();
    for (let i = 0; i < model.stickies.length; i++) byRow.set(model.stickies[i].rowIndex, model.stickies[i]);
    background = saved.background || '#ffffff';
    buffer = Math.max(0, Math.min(5, Number(saved.buffer) || 0));
    fillet = Math.max(0, Math.min(30, Number(saved.fillet) || 0));
    boardText = { face: 'std', size: 1, ink: null, ...saved.boardText };
    departmentColors = new Map(saved.departmentColors || []);
    colorSwatches = restoreSwatches(saved.colorSwatches); backgroundSwatch = saved.backgroundSwatch || null;
    departmentDividers = saved.departmentDividers !== false;
    for (const entry of saved.styles || []) { const s = byRow.get(entry.row); if (s && entry.style) for (const [key,value] of Object.entries(entry.style)) setStyle(s,key,value); }
    const nextOrder = [];
    const listed = saved.order || [];
    for (let i = 0; i < listed.length; i++) {
      const s = byRow.get(listed[i]);
      if (s) nextOrder.push(s.id);
    }
    for (let i = 0; i < model.stickies.length; i++) if (nextOrder.indexOf(model.stickies[i].id) < 0) nextOrder.push(model.stickies[i].id);
    order = nextOrder;
    aspect = saved.aspect > 0 ? saved.aspect : aspect;
    scale = 1;
    algorithm = saved.algorithm || algorithm;
    nest = saved.nest === 'both' ? 'dept' : saved.nest || nest;
    title = saved.title || title;
    manual = null;
    if (saved.manual && saved.manual.length) {
      const held = [];
      for (let i = 0; i < saved.manual.length; i++) {
        const m = saved.manual[i];
        const s = byRow.get(m.row);
        if (!s) continue;
        held.push({ id: s.id, u: m.u, v: m.v, su: m.su, sv: m.sv });
      }
      if (held.length) manual = held;
    }
  }

  function adopt(next, resetView) {
    model = next;
    departmentColors = new Map();
    order = model.stickies.filter(kept).map((s) => s.id);
    if (resetView) {
      manual = null;
      liveTiles = null;
      anim = null;
      scale = 1;
      selected = new Set();
      undoStack = [];
      redoStack = [];
      title = String(model.fileName || 'Program').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    }
    $('empty').hidden = true;
    $('src-name').textContent = model.fileName || 'Program';
  }

  function openCsv(text, name) {
    if (dataDashboard?.close() === false) throw new Error('Correct the highlighted table value before opening another program.');
    const next = modelFromCsv(text, name);
    shared = { view: {}, camera: null };
    sharedBase=null;leaderThreshold=0;
    adopt(next, true);
    fitView();
    persist();
    syncChrome();
    const zeros = hiddenZeros();
    toast(order.length + ' spaces' + (zeros ? ' · ' + zeros + ' at 0 sf left out' : '') + ' · ' + PB.aspectLabel(aspect));
  }

  async function openFile(file) {
    if (dataDashboard?.close() === false) { toast('Correct the highlighted table value before opening another program.'); return; }
    const name = file.name || 'program.csv';
    try {
      if (/\.(zip|json)$/i.test(name)) {
        let saved;
        if (/\.zip$/i.test(name)) {
          const files = await Engine.unzip(await file.arrayBuffer(), 'a pack board');
          const key = Object.keys(files).find(n => /\.pack\.json$/i.test(n));
          if (key) saved = JSON.parse(new TextDecoder().decode(files[key]));
          else {
            const opened = Engine.openSave(await Engine.readSaveZip(await file.arrayBuffer()));
            saved = { board: Engine.capture(opened.model), view: opened.view || {}, camera: opened.camera };
          }
        } else saved = JSON.parse(await file.text());
        if (!saved.board && (saved.kind !== 'pack-board' || typeof saved.csv !== 'string')) throw new Error('Choose a saved program board.');
        applySaved(saved);
        persist(); syncChrome(); requestDraw(); toast('Pack board restored');
      }
      else if (/\.xlsx?$|\.xlsm$/i.test(name)) openCsvAwait(modelFromMatrix(await Engine.xlsxToMatrix(await file.arrayBuffer()), name));
      else openCsv(await file.text(), name);
    } catch (err) {
      toast(err && err.message ? err.message : 'Could not read that file.');
    }
  }

  function openCsvAwait(next) {
    if (dataDashboard?.close() === false) throw new Error('Correct the highlighted table value before opening another program.');
    shared = { view: {}, camera: null };
    sharedBase=null;leaderThreshold=0;
    adopt(next, true);
    fitView();
    persist();
    syncChrome();
  }

  async function loadSample() {
    const seed = window.ProgramBoardSeed || window.ProgramSeed;
    if (!seed || !seed.csv) {
      $('empty').hidden = false; syncChrome(); requestDraw(); return;
    }
    openCsv(seed.csv, seed.name || 'program.csv');
  }

  function palette() {
    const map = new Map();
    const list = model.stickies.slice().sort((a, b) => a.rowIndex - b.rowIndex);
    for (let i = 0; i < list.length; i++) {
      if (!kept(list[i])) continue;
      const dept = cell(rowOf(list[i]), model.deptKey) || '—';
      const linked = colorSwatches.fill.find(entry => entry.dept === dept);
      if (linked) departmentColors.set(dept, linked.color);
      if (!departmentColors.has(dept)) departmentColors.set(dept, PALETTE[departmentColors.size % PALETTE.length]);
      // Older saves carry the original saturated defaults, even when the
      // previous renderer displayed every card in neutral gray.
      const legacy = LEGACY_PALETTE.indexOf(departmentColors.get(dept));
      if (!linked && legacy >= 0) departmentColors.set(dept, PALETTE[legacy]);
      if (!map.has(dept)) map.set(dept, departmentColors.get(dept));
    }
    return map;
  }

  function mix(hex, toward, t) {
    const parse = (h) => parseInt(h.slice(1), 16);
    const a = parse(hex);
    const b = parse(toward);
    const ch = (shift) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
    return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0');
  }

  function vary(hex, salt) {
    let h = 0;
    const s = String(salt || '');
    for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
    const t = ((h % 100) / 100 - 0.5) * 0.16;
    return mix(hex, t >= 0 ? '#ffffff' : '#101216', Math.abs(t));
  }

  function luma(hex) {
    const n = parseInt(hex.slice(1), 16);
    return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  }

  function colorOf(s, bases) {
    return Appearance ? Appearance.fillFor(model, s) : s.color || '#dcd7cf';
  }

  function styleOf(s) {
    return { ...boardText, ...s?.style,
      fill: s?.color || null, fillet: s?.radius || 0, stroke: s?.stroke || 0,
      face: s?.textFace || shared.view?.face || boardText.face, size: s?.textScale || shared.view?.textScale || boardText.size, ink: s?.textColor || (Object.prototype.hasOwnProperty.call(shared.view || {},'textColor') ? shared.view.textColor : boardText.ink),
    };
  }

  function setStyle(s, key, value) {
    s.style = {...s.style, [key]: value};
    const field = {fill: 'color', fillet: 'radius', stroke: 'stroke', face: 'textFace', size: 'textScale', ink: 'textColor'}[key];
    if (field) s[field] = value == null || value === 'auto' ? (field === 'radius' || field === 'stroke' ? 0 : null) : value;
    if (key === 'fill' && Appearance) Appearance.clearGradient(model, [s]);
  }

  function cardRect(t) {
    const inset = Math.min(buffer * 10 / 2, t.w * 0.2, t.h * 0.2);
    return {...t, x: t.x + inset, y: t.y + inset, w: t.w - inset * 2, h: t.h - inset * 2};
  }

  function paintCard(g, t, s, bases) {
    const r = cardRect(t);
    g.beginPath(); g.roundRect(r.x, r.y, r.w, r.h, Math.min(s.radius ?? fillet, r.w / 2, r.h / 2));
    g.fillStyle = colorOf(s, bases); g.fill();
    const stroke = s.stroke || 0;
    if (stroke > 0) { g.strokeStyle = '#ffffff'; g.lineWidth = stroke; g.stroke(); }
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    canvas.style.width = viewW + 'px';
    canvas.style.height = viewH + 'px';
  }

  function s2w(x, y) {
    return { x: camera.x + (x - viewW / 2) / camera.z, y: camera.y + (y - viewH / 2) / camera.z };
  }

  function w2s(x, y) {
    return { x: viewW / 2 + (x - camera.x) * camera.z, y: viewH / 2 + (y - camera.y) * camera.z };
  }

  function fitView() {
    resize();
    const frame = frameNow();
    if (!(frame.w > 0) || !(totalArea() > 0)) return;
    const z = Math.min((viewW - 96) / frame.w, (viewH - 210) / frame.h);
    camera.z = Math.max(0.002, z);
    camera.x = frame.x + frame.w / 2;
    camera.y = frame.y + frame.h / 2 + 28 / camera.z;
    requestDraw();
  }

  function ease(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function requestDraw() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      draw();
      if (anim) requestDraw();
    });
  }

  function displayed() {
    const base = settled();
    if (!anim) return base;
    const u = ease(Math.min(1, (performance.now() - anim.t0) / anim.dur));
    if (u >= 1) { anim = null; return base; }
    const tiles = PB.layoutTree(anim.transition, items(), base.frame, u);
    return { frame: base.frame, tiles, groups: [] };
  }

  function beginAnim() {
    anim = null;
    canvas.animate?.([{ opacity: 0.6 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
    requestDraw();
  }

  function draw() {
    resize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, viewW, viewH);
    chrome = { title: null };
    if (!model || !(totalArea() > 0)) return;
    const view = drag?.copies ? (drag.preview ? {...drag.preview, groups: []} : {frame: drag.baseFrame, tiles: drag.baseTiles, groups: []}) : displayed();
    const bases = palette();
    leaders = leaderLayout(view, camera.z, w2s, {width: viewW, height: viewH});
    paintWorld(view, bases);
    paintLabels(view, bases, ctx, camera.z, w2s, dpr, 28, leaders);
    paintLeaders(ctx, leaders, dpr);
    paintChrome(view.frame);
    if (drag?.kind === 'marquee') {
      const box = drag.box;
      ctx.fillStyle = drag.crossing ? 'rgba(15,143,130,.12)' : 'rgba(55,112,171,.12)';
      ctx.strokeStyle = drag.crossing ? '#0f8f82' : '#3770ab'; ctx.lineWidth = 1;
      ctx.setLineDash(drag.crossing ? [5, 3] : []);
      ctx.fillRect(box.x, box.y, box.w, box.h); ctx.strokeRect(box.x, box.y, box.w, box.h);
      ctx.setLineDash([]);
    }
    if (nameEdit) placeNameInput(view);
  }

  function paintWorld(view, bases) {
    const z = camera.z;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (viewW / 2 - camera.x * z), dpr * (viewH / 2 - camera.y * z));
    const f = view.frame;
    ctx.fillStyle = FRAME;
    ctx.fillRect(f.x, f.y, f.w, f.h);
    for (let i = 0; i < view.tiles.length; i++) {
      const t = view.tiles[i];
      const s = sticky(t.id);
      if (!s) continue;
      paintCard(ctx, t, s, bases);
    }
    paintDepartmentDividers(ctx, view.tiles, 1.25 / z);
    if (drag?.preview?.target) {
      ctx.fillStyle = 'rgba(15,143,130,.16)'; ctx.strokeStyle = '#0f8f82'; ctx.lineWidth = 2 / z;
      for (const tile of drag.preview.tiles) if (drag.resultIds.includes(tile.id)) {
        const t = cardRect(tile);
        ctx.fillRect(t.x, t.y, t.w, t.h); ctx.strokeRect(t.x, t.y, t.w, t.h);
      }
    }
    if (view.ghost) {
      const g = view.ghost;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = colorOf(sticky(g.id), bases);
      ctx.fillRect(g.x, g.y, g.w, g.h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#0f8f82'; ctx.lineWidth = 2 / z;
      ctx.strokeRect(g.x, g.y, g.w, g.h);
    }
    ctx.lineWidth = 2 / z;
    ctx.strokeStyle = '#0f8f82';
    selected.forEach((id) => {
      for (const tile of view.tiles.filter(tile => tile.id === id)) {
        const t = cardRect(tile), s = sticky(id);
        ctx.beginPath(); ctx.roundRect(t.x, t.y, t.w, t.h, Math.min(s?.radius ?? fillet, t.w / 2, t.h / 2)); ctx.stroke();
      }
    });
  }

  function departmentSeams(tiles) {
    if (!departmentDividers || !model.deptKey) return [];
    const seams = [], epsilon = 1e-6;
    const depts = new Map(tiles.map(t => [t.id, cell(rowOf(sticky(t.id)), model.deptKey)]));
    for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) {
      const a = tiles[i], b = tiles[j];
      if (depts.get(a.id) === depts.get(b.id)) continue;
      for (const [left, right] of [[a,b],[b,a]]) {
        const top = Math.max(left.y, right.y), bottom = Math.min(left.y + left.h, right.y + right.h);
        if (Math.abs(left.x + left.w - right.x) < epsilon && bottom - top > epsilon) seams.push([right.x, top, right.x, bottom]);
        const x0 = Math.max(left.x, right.x), x1 = Math.min(left.x + left.w, right.x + right.w);
        if (Math.abs(left.y + left.h - right.y) < epsilon && x1 - x0 > epsilon) seams.push([x0, right.y, x1, right.y]);
      }
    }
    return seams;
  }

  function paintDepartmentDividers(g, tiles, width) {
    const seams = departmentSeams(tiles);
    if (!seams.length) return;
    g.beginPath(); g.strokeStyle = '#8c8880'; g.lineWidth = width;
    for (const [x0,y0,x1,y1] of seams) {g.moveTo(x0,y0); g.lineTo(x1,y1);}
    g.stroke();
  }

  function setDepartmentDividers(value) {
    if (departmentDividers === value) return;
    pushUndo(); departmentDividers = value; persist(); requestDraw();
  }

  function leaderLayout(view, zoom, project, viewport) {
    if (!window.ProgramLeaders || !leaderThreshold) return {items: []};
    const f = view.frame, a = project(f.x, f.y), b = project(f.x + f.w, f.y + f.h), ratio = zoom / camera.z;
    const points = view.tiles.map(tile => { const t = cardRect(tile), p = project(t.x, t.y); return {id:t.id,x:p.x,y:p.y,w:t.w*zoom,h:t.h*zoom,text:Engine.nameOf(model,sticky(t.id))}; });
    return window.ProgramLeaders.layout(points, viewport, {threshold: leaderThreshold * ratio, scale: ratio, frame:{x:a.x,y:a.y,w:b.x-a.x,h:b.y-a.y}, margin:9*ratio, top:10*ratio, bottom:10*ratio, labelWidth:140*ratio, labelHeight:22*ratio, gap:26*ratio});
  }

  function paintLeaders(g, scene, pixelRatio = 1) {
    g.save(); g.setTransform(pixelRatio,0,0,pixelRatio,0,0);
    for (const item of scene.items) {
      g.strokeStyle = '#7e85895c'; g.lineWidth = 0.75 * (scene.scale || 1); g.beginPath(); g.moveTo(item.anchor.x,item.anchor.y); g.lineTo(item.elbow.x,item.elbow.y); g.lineTo(item.end.x,item.end.y); g.stroke();
      const label = item.label, size = label.h / 2;
      g.fillStyle = '#ffffffeb'; g.fillRect(label.x-3,label.y,label.w+6,label.h);
      g.fillStyle = '#50585f'; g.font = size + 'px ' + FACES.std.css; g.textAlign = 'left'; g.textBaseline = 'middle';
      let text = item.text; while(text.length > 2 && g.measureText(text).width > label.w) text = text.slice(0,-2) + '…';
      g.fillText(text,label.x,label.y+label.h/2);
    }
    g.restore();
  }

  function paintLabels(view, bases, ctx = canvas.getContext('2d'), zoom = camera.z, project = w2s, pixelRatio = dpr, sizeCap = 28, callouts = {items: []}) {
    if (ctx === canvas.getContext('2d')) areaHits.clear();
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const labelTiles = view.tiles.filter((t) => t.id !== view.moving).concat(view.ghost ? [view.ghost] : []);
    const external = new Set(callouts.items.map(item => item.id));
    for (const tile of labelTiles) {
      if (external.has(tile.id)) continue;
      const t = cardRect(tile);
      const s = sticky(t.id);
      if (!s) continue;
      if (nameEdit && nameEdit.id === t.id) continue;
      const p = project(t.x, t.y);
      const pw = t.w * zoom;
      const ph = t.h * zoom;
      if (pw < 18 || ph < 14) continue;
      const fill = colorOf(s, bases);
      const style = styleOf(s);
      const ink = style.ink || (luma(fill) < 0.72 ? '#ffffff' : '#1b1e22');
      const face = (FACES[style.face] || FACES.std).css;
      const name = cell(rowOf(s), model.nameKey) || 'Untitled';
      const area = fmt(dataArea(s)) + ' sf';
      const pad = Math.max(4, Math.min(pw, ph) * 0.08);
      const maxW = pw - pad * 2;
      const maxH = ph - pad * 2;
      if (maxW <= 0 || maxH <= 0) continue;
      let size = Math.min(maxW * 0.16, maxH * 0.34, sizeCap) * (style.size || 1);
      let lines = [];
      let areaSize = size * 0.72;
      for (let attempt = 0; attempt < 24; attempt++) {
        ctx.font = size + 'px ' + face;
        lines = wrap(ctx, name, maxW);
        areaSize = size * 0.72;
        const block = lines.length * size * 1.15 + areaSize * 1.25;
        if ((block <= maxH && lines.every((line) => ctx.measureText(line).width <= maxW)) || size < 3) break;
        size *= 0.82;
      }
      if (size < 2.2) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(p.x + pad, p.y + pad, maxW, maxH);
      ctx.clip();
      ctx.fillStyle = ink;
      ctx.font = size + 'px ' + face;
      const block = lines.length * size * 1.15 + areaSize * 1.25;
      let y = p.y + pad + Math.max(0, maxH - block) * (style.valign === 'bottom' ? 1 : style.valign === 'middle' ? 0.5 : 0);
      const align = style.align || 'left';
      const x = p.x + (align === 'center' ? pw / 2 : align === 'right' ? pw - pad : pad);
      ctx.textAlign = align;
      for (let li = 0; li < lines.length; li++) {
        if (y + size > p.y + ph - pad) break;
        ctx.fillText(lines[li], x, y);
        y += size * 1.15;
      }
      if (y + areaSize <= p.y + ph - pad * 0.4) {
        ctx.globalAlpha = 0.78;
        ctx.font = areaSize + 'px ' + face;
        ctx.fillText(area, x, y + size * 0.08);
        if (ctx === canvas.getContext('2d')) areaHits.set(t.id, {x: p.x + pad, y: y - 2, w: maxW, h: Math.max(10, areaSize * 1.25)});
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
  }

  function wrap(c, text, maxW) {
    const words = [];
    for (const word of String(text).split(/\s+/).filter(Boolean)) {
      let part = '';
      for (const ch of word) {
        if (part && c.measureText(part + ch).width > maxW) { words.push(part); part = ''; }
        part += ch;
      }
      if (part) words.push(part);
    }
    if (!words.length) return [''];
    const lines = [];
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const trial = line + ' ' + words[i];
      if (c.measureText(trial).width <= maxW) line = trial;
      else {
        lines.push(line);
        line = words[i];
      }
    }
    lines.push(line);
    return lines;
  }

  function paintChrome(frame) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const origin = w2s(frame.x, frame.y);
    const far = w2s(frame.x + frame.w, frame.y + frame.h);
    ctx.fillStyle = '#1b1e22';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.font = '13px ' + getComputedStyle(document.body).fontFamily;
    const label = title + (Math.abs(scale - 1) > 0.015 ? '  ·  ' + scale.toFixed(2) + '×' : '');
    ctx.fillText(label, origin.x, origin.y - 8);
    const titleW = ctx.measureText(label).width;
    chrome.title = { x: origin.x, y: origin.y - 24, w: Math.max(40, titleW), h: 18 };

    ctx.fillStyle = '#8a9098';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '12px ' + getComputedStyle(document.body).fontFamily;
    const widthText = fmt(frame.w) + ' ft';
    const heightText = fmt(frame.h) + ' ft';
    const wx = (origin.x + far.x) / 2;
    const wy = far.y + 8;
    ctx.fillText(widthText, wx, wy);
    const ww = ctx.measureText(widthText).width;
    chrome.width = { x: wx - ww / 2 - 6, y: wy - 2, w: ww + 12, h: 18 };

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const hx = far.x + 8;
    const hy = (origin.y + far.y) / 2;
    ctx.fillText(heightText, hx, hy);
    const hw = ctx.measureText(heightText).width;
    chrome.height = { x: hx - 4, y: hy - 10, w: hw + 12, h: 20 };

  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function inBox(box, x, y) {
    return !!box && x >= box.x && y >= box.y && x <= box.x + box.w && y <= box.y + box.h;
  }

  function pickTile(tiles, wx, wy, skip) {
    for (let i = tiles.length - 1; i >= 0; i--) {
      const t = tiles[i];
      if (t.id === skip) continue;
      const r = cardRect(t);
      if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) return t;
    }
    return null;
  }

  function pointerBefore(tile, wx, wy) {
    if (tile.w >= tile.h) return wx < tile.x + tile.w / 2;
    return wy < tile.y + tile.h / 2;
  }

  function moveId(ids, id, targetId, before) {
    const next = ids.filter((item) => item !== id);
    let i = next.indexOf(targetId);
    if (i < 0) return ids.slice();
    if (!before) i += 1;
    next.splice(i, 0, id);
    return next;
  }

  function previewLayout(id, wx, wy) {
    const target = pickTile(drag.baseTiles.filter(t => drag.copies || !drag.ids.includes(t.id)), wx, wy);
    if (!target) return null;
    const dx = (wx - target.x) / target.w - 0.5, dy = (wy - target.y) / target.h - 0.5;
    const side = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'top' : 'bottom');
    const frame = frameNow();
    const laid = PB.localMoveMany(drag.baseTiles, items(), frame, drag.ids, target.id, side, drag.copies);
    if (!laid) return null;
    const nextOrder = order.filter(id => !drag.resultIds.includes(id));
    nextOrder.splice(nextOrder.indexOf(target.id) + (side === 'right' || side === 'bottom' ? 1 : 0), 0, ...drag.resultIds);
    return {...laid, frame, order: nextOrder, target, side};
  }

  function point(e) {
    const r = canvas.getBoundingClientRect();
    return {x: e.clientX - r.left, y: e.clientY - r.top};
  }

  function cursorFor(px, py) {
    if (!model) return 'default';
    if (inBox(chrome.title, px, py) || [...areaHits.values()].some(box => inBox(box, px, py))) return 'text';
    if (leaderAt(px,py)) return 'pointer';
    const w = s2w(px, py);
    return pickTile(settled().tiles, w.x, w.y) ? 'grab' : 'crosshair';
  }

  function leaderAt(x,y) { return leaders.items.find(item=>inBox(item.label,x,y)); }

  function cloneRows(ids) {
    const copies = new Map();
    const created = Engine.duplicateStickies(model, ids) || [];
    for (const copy of created) {
      const sourceId = copy.passId, source = sticky(sourceId);
      copy.style = source?.style ? {...source.style} : undefined;
      copy.passId = null; order.push(copy.id); copies.set(sourceId, copy.id);
    }
    if (created.length) Engine.placeCopies(model, created, Engine.gapOf(model));
    return copies;
  }

  function onDown(e) {
    if (!model || e.target !== canvas) return;
    if (dataDashboard?.commitActive() === false) return;
    closePops(); anim = null;
    const p = point(e);
    if (e.button === 1 || e.button === 2 || (e.button === 0 && space)) {
      drag = {kind: 'pan', x: p.x, y: p.y, cx: camera.x, cy: camera.y, moved: false, button: e.button};
      canvas.setPointerCapture(e.pointerId); return;
    }
    if (e.button !== 0) return;
    const w = s2w(p.x, p.y), laid = settled();
    const callout = leaderAt(p.x,p.y);
    const tile = callout ? laid.tiles.find(tile=>tile.id===callout.id) : pickTile(laid.tiles, w.x, w.y);
    if (tile) {
      if (!e.shiftKey && !selected.has(tile.id)) selected = new Set([tile.id]);
      const ids = selected.has(tile.id) ? [...selected] : [...selected, tile.id];
      drag = {kind: 'tile', baseFrame: {...laid.frame}, baseTiles: laid.tiles.map(t => ({...t})), id: tile.id, ids, resultIds: ids,
        x: p.x, y: p.y, moved: false, shift: e.shiftKey, duplicate: e.altKey, before: null, preview: null};
    } else {
      drag = {kind: 'marquee', x: p.x, y: p.y, base: e.shiftKey ? new Set(selected) : new Set(),
        box: {x: p.x, y: p.y, w: 0, h: 0}, crossing: false};
      selected = new Set(drag.base);
    }
    syncChrome(); canvas.setPointerCapture(e.pointerId); requestDraw();
  }

  function onMove(e) {
    const p = point(e);
    if (!drag) { canvas.style.cursor = cursorFor(p.x, p.y); return; }
    if (drag.kind === 'pan') {
      if (Math.hypot(p.x - drag.x, p.y - drag.y) > 3) drag.moved = true;
      camera.x = drag.cx - (p.x - drag.x) / camera.z; camera.y = drag.cy - (p.y - drag.y) / camera.z;
    } else if (drag.kind === 'marquee') {
      drag.crossing = p.x < drag.x;
      const box = drag.box = {x: Math.min(p.x, drag.x), y: Math.min(p.y, drag.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y)};
      selected = new Set(drag.base);
      for (const tile of settled().tiles) {
        const t = cardRect(tile);
        const q = w2s(t.x, t.y), right = q.x + t.w * camera.z, bottom = q.y + t.h * camera.z;
        const hit = drag.crossing ? right >= box.x && q.x <= box.x + box.w && bottom >= box.y && q.y <= box.y + box.h
          : q.x >= box.x && right <= box.x + box.w && q.y >= box.y && bottom <= box.y + box.h;
        if (hit) selected.add(t.id);
      }
    } else if (drag.kind === 'tile') {
      if (!drag.moved && Math.hypot(p.x - drag.x, p.y - drag.y) < 4) return;
      if (!drag.moved) {
        drag.before = snapshot();
        if (drag.duplicate || e.altKey) {
          drag.copies = cloneRows(drag.ids); drag.resultIds = [...drag.copies.values()];
        }
      }
      drag.moved = true; canvas.style.cursor = drag.copies ? 'copy' : 'grabbing';
      const w = s2w(p.x, p.y);
      drag.preview = previewLayout(drag.id, w.x, w.y);
    }
    requestDraw();
  }

  function onUp(e) {
    if (!drag) return;
    if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    const p = point(e);
    if (drag.kind === 'pan') {
      if (drag.button === 2 && !drag.moved) openMenu(p.x, p.y);
    } else if (drag.kind === 'tile') {
      if (!drag.moved) {
        if (drag.shift) { if (selected.has(drag.id)) selected.delete(drag.id); else selected.add(drag.id); }
      } else if (drag.preview) {
        const preview = drag.preview;
        order = preview.order;
        if (nest === 'dept' && model.deptKey) {
          const dept = cell(rowOf(sticky(preview.target.id)), model.deptKey);
          for (const id of drag.resultIds) rowOf(sticky(id)).fields[model.deptKey] = dept;
        }
        holdLayout(preview.tiles);
        undoStack.push(drag.before); redoStack = [];
        selected = new Set(drag.resultIds);
        if (!drag.copies) anim = {transition: preview.transition, t0: performance.now(), dur: 340};
        else beginAnim();
        persist();
      } else if (drag.before) restoreSnap(drag.before);
    }
    drag = null; canvas.style.cursor = cursorFor(p.x, p.y); syncChrome(); requestDraw();
  }

  function algoName() {
    const found = PB.ALGORITHMS.find((a) => a.id === algorithm);
    return found ? found.name : algorithm;
  }

  function openName(id, area = false) {
    const s = sticky(id);
    if (!s) return;
    nameEdit = { id: id, area, box: areaHits.get(id) };
    const input = $('name-input');
    input.value = area ? slideNumber(dataArea(s)) : cell(rowOf(s), model.nameKey);
    nameEdit.initialValue = input.value;
    input.setAttribute('aria-label', area ? 'Area in square feet' : 'Space name');
    input.inputMode = area ? 'decimal' : 'text';
    input.hidden = false;
    placeNameInput(settled());
    input.focus();
    input.select();
  }

  function placeNameInput(view) {
    if (!nameEdit) return;
    if (nameEdit.title) return;
    const t = view.tiles.find((tile) => tile.id === nameEdit.id);
    const input = $('name-input');
    if (!t) { input.hidden = true; return; }
    const p = w2s(t.x, t.y);
    const pad = Math.max(4, Math.min(t.w, t.h) * camera.z * 0.08);
    input.style.left = (p.x + pad) + 'px';
    input.style.top = (nameEdit.area && nameEdit.box ? nameEdit.box.y : p.y + pad) + 'px';
    input.style.width = Math.max(40, t.w * camera.z - pad * 2) + 'px';
    input.style.height = Math.max(16, Math.min(28, t.h * camera.z * 0.3)) + 'px';
    input.style.fontSize = Math.max(11, Math.min(22, t.w * camera.z * 0.08)) + 'px';
    input.style.color = luma(colorOf(sColorTarget(nameEdit.id), palette())) < 0.72 ? '#ffffff' : '#1b1e22';
  }

  function sColorTarget(id) {
    return sticky(id);
  }

  function commitName() {
    if (!nameEdit) return;
    const s = sticky(nameEdit.id);
    const value = $('name-input').value.trim();
    if (nameEdit.area) {
      if (value === nameEdit.initialValue) { nameEdit = null; $('name-input').hidden = true; requestDraw(); return; }
      const n = Number(value.replace(/,/g, ''));
      if (!value || !Number.isFinite(n) || n < 0) { toast('Enter zero or a positive area in square feet.'); $('name-input').focus(); return; }
      const tree = PB.treeOf(settled().tiles);
      if (s && n !== dataArea(s)) { pushUndo(); setDataArea(s, n); reflow(tree); persist(); syncChrome(); }
      nameEdit = null; $('name-input').hidden = true; requestDraw(); return;
    }
    $('name-input').hidden = true;
    const id = nameEdit.id;
    nameEdit = null;
    if (!s || !model.nameKey) return;
    if (cell(rowOf(s), model.nameKey) === value) { requestDraw(); return; }
    pushUndo();
    rowOf(s).fields[model.nameKey] = value;
    persist();
    syncChrome();
    selected = new Set([id]);
    requestDraw();
  }

  function openTitle() {
    const input = $('name-input');
    nameEdit = { id: null, title: true };
    input.value = title;
    input.hidden = false;
    input.style.left = chrome.title.x + 'px';
    input.style.top = chrome.title.y + 'px';
    input.style.width = Math.max(120, chrome.title.w) + 'px';
    input.style.height = '18px';
    input.style.fontSize = '13px';
    input.style.color = '#1b1e22';
    input.focus();
    input.select();
  }

  function holdLayout(tiles) {
    const f = frameNow();
    manual = tiles.map((t) => ({ id: t.id, u: (t.x - f.x) / f.w, v: (t.y - f.y) / f.h, su: t.w / f.w, sv: t.h / f.h }));
  }

  function reflow(tree) {
    const live = items().filter((t) => t.area > 0);
    const pruned = PB.pruneTree(tree, new Set(live.map((t) => t.id)));
    if (pruned) holdLayout(PB.layoutTree(pruned, live, frameNow()));
    else manual = null;
    requestDraw();
  }

  function duplicate(id) {
    duplicateMany([id]);
  }

  function duplicateMany(ids) {
    ids = ids.filter(id => sticky(id));
    if (!ids.length) return;
    pushUndo();
    const tiles = settled().tiles, copies = cloneRows(ids);
    const laid = PB.localMoveMany(tiles, items(), frameNow(), ids, ids[0], 'right', copies);
    if (laid) holdLayout(laid.tiles); else manual = null;
    selected = new Set(copies.values());
    persist();
    syncChrome();
    requestDraw();
  }

  function deleteIds(ids) {
    const drop = ids.filter((id) => sticky(id));
    if (!drop.length) return;
    const tree = PB.treeOf(settled().tiles);
    pushUndo();
    const gone = new Set(drop);
    for (let i = 0; i < drop.length; i++) {
      const s = sticky(drop[i]);
      if (s) Engine.dropSticky(model, s.id);
    }
    order = order.filter((id) => !gone.has(id));
    reflow(tree);
    selected.clear();
    persist();
    syncChrome();
    requestDraw();
  }

  function setAlgorithm(id) {
    if (!model) return;
    pushUndo(); holdLayout(settled().tiles);
    algorithm = id;
    persist(); syncChrome(); closePops();
    $('tb-repack').focus?.();
  }

  function setNest(id) {
    if (id === 'both') id = 'dept';
    if (!model || id === nest) return;
    pushUndo(); holdLayout(settled().tiles);
    nest = id;
    persist(); syncChrome(); requestDraw();
  }

  function setAspect(value) {
    if (!Number.isFinite(value) || !(value > 0) || Math.abs(value - aspect) < 1e-6) return;
    pushUndo();
    aspect = value;
    persist();
    syncChrome();
    requestDraw();
  }

  function fitArea() { fitView(); }

  function repack() {
    if (!model) return;
    const from = settled().tiles;
    pushUndo();
    manual = null;
    liveTiles = null;
    beginAnim(from);
    persist();
    syncStatus();
  }

  function resetOrder() {
    pushUndo();
    const from = settled().tiles;
    order = model.stickies.filter(kept).sort((a, b) => a.rowIndex - b.rowIndex).map((s) => s.id);
    manual = null;
    beginAnim(from);
    persist();
    syncChrome();
  }

  function syncStatus() {
    for (const id of ['tb-algo', 'tb-aspect', 'tb-fit', 'tb-repack', 'tb-save', 'tb-export', 'src-data']) $(id).disabled = !model;
    for (const button of $('nest').querySelectorAll('.seg')) button.disabled = !model;
    if (!model) { $('status').textContent = ''; return; }
    const zeros = hiddenZeros();
    const bits = [
      items().filter((item) => item.area > 0).length + ' spaces',
      fmt(totalArea()) + ' sf',
      PB.aspectLabel(aspect) + ' locked',
      algoName(),
    ];
    if (nest === 'dept') bits.push('by department');
    if (nest === 'both') bits.push('by department and group');
    if (Math.abs(scale - 1) > 0.012) bits.push(scale.toFixed(2) + '×');
    if (manual) bits.push('manual layout');
    if (zeros) bits.push(zeros + ' at 0 sf hidden');
    $('status').textContent = fmt(totalArea()) + ' sf';
    $('src').title = bits.join(' / ');
    $('aspect-label').textContent = PB.aspectLabel(aspect);
    $('tb-algo').textContent = algoName();
    $('tb-repack').disabled = !model || !(totalArea() > 0);
    const segs = $('nest').querySelectorAll('.seg');
    for (let i = 0; i < segs.length; i++) segs[i].classList.toggle('on', segs[i].dataset.nest === nest);
  }

  function syncChrome() {
    syncStatus();
    dataDashboard?.refresh();
  }

  function finishEditorMotion() {
    if (drag) cancelDrag();
    anim = null; liveTiles = null; space = false;
    closePops();
  }

  function finishTableChange(tree, beforeIds, beforeAreas) {
    const known = new Set(order);
    order = order.filter((id) => sticky(id) && kept(sticky(id)));
    for (const s of model.stickies) if (kept(s) && !known.has(s.id)) order.push(s.id);
    const nextItems = items().filter((item) => item.area > 0);
    const nextIds = new Set(nextItems.map((item) => item.id));
    // A dormant row has no tile in the prior tree. Build a complete layout
    // when it becomes active; ordinary area edits retain manual adjacency.
    if ([...nextIds].some((id) => !beforeIds.has(id))) manual = null;
    else if (nextIds.size !== beforeIds.size || nextItems.some((item) => Math.abs(item.area - (beforeAreas.get(item.id) || 0)) > 1e-8)) reflow(tree);
    selected = new Set([...selected].filter((id) => nextIds.has(id)));
    persist(); syncChrome(); requestDraw();
  }

  function wireDataDashboard() {
    $('src-data').addEventListener('click', finishEditorMotion, true);
    dataDashboard = window.ProgramDataDashboard.create({
      button: $('src-data'), getModel: () => model, engine: Engine,
      onEdit: ({ rowIndex, key, value }) => {
        finishEditorMotion();
        const before = snapshot();
        const laid = settled().tiles;
        const changed = Engine.editRowField(model, rowIndex, key, value);
        if (!changed) return;
        pushUndo(before);
        finishTableChange(PB.treeOf(laid), new Set(laid.map((tile) => tile.id)), new Map(before.stickies.map((s) => [s.id, s.tw * s.th])));
      },
      onRoles: (roles) => {
        finishEditorMotion();
        const before = snapshot();
        const laid = settled().tiles;
        Engine.setColumnRoles(model, roles);
        pushUndo(before);
        finishTableChange(PB.treeOf(laid), new Set(laid.map((tile) => tile.id)), new Map(before.stickies.map((s) => [s.id, s.tw * s.th])));
      },
      onAddColumn: (name) => {
        finishEditorMotion();
        const before = snapshot();
        Engine.ensureColumn(model, name);
        pushUndo(before);
        persist(); syncChrome(); requestDraw();
      },
      onCommit: () => { flushEdits(); toast('Program data committed.'); },
      onOpen: finishEditorMotion,
      onClose: () => { persist(); requestDraw(); },
    });
    const guardModeSwitch = (event) => {
      if (dataDashboard.commitActive() !== false) return;
      event.preventDefault(); event.stopImmediatePropagation();
      toast('Correct the highlighted table value before switching views.');
    };
    $('tb-display').addEventListener('click', guardModeSwitch, true);
    document.addEventListener('click', (event) => {
      if (event.target.closest?.('#display-mode-menu a')) guardModeSwitch(event);
    }, true);
  }

  function buildData(el) {
    if (!el) return;
    el.innerHTML = '';
    if (!selected.size) { el.hidden = true; return; }
    el.hidden = false;
    const ids = Array.from(selected);
    const one = ids.length === 1 ? sticky(ids[0]) : null;
    addField(el, 'Name', one ? cell(rowOf(one), model.nameKey) : mixed(ids, model.nameKey), (value) => {
      pushUndo();
      for (let i = 0; i < ids.length; i++) {
        const s = sticky(ids[i]);
        if (s && model.nameKey) rowOf(s).fields[model.nameKey] = value;
      }
      persist();
      requestDraw();
    });
    addField(el, 'Area', one ? slideNumber(dataArea(one)) : '', (value) => {
      const n = Number(value.replace(/,/g, '').trim());
      if (!Number.isFinite(n) || n < 0 || !value.trim()) { toast('Area has to be zero or a positive number of square feet.'); buildData(el); return; }
      pushUndo();
      const tree = PB.treeOf(settled().tiles);
      for (let i = 0; i < ids.length; i++) {
        const s = sticky(ids[i]);
        if (s) setDataArea(s, n);
      }
      reflow(tree);
      persist();
      syncChrome();
    }, 'sf');
    if (model.deptKey) {
      addField(el, 'Department', one ? cell(rowOf(one), model.deptKey) : mixed(ids, model.deptKey), (value) => {
        pushUndo();
        for (let i = 0; i < ids.length; i++) {
          const s = sticky(ids[i]);
          if (s) rowOf(s).fields[model.deptKey] = value;
        }
        persist();
        syncChrome(); requestDraw();
      });
    }
    if (model.groupKey) {
      addField(el, 'Group', one ? cell(rowOf(one), model.groupKey) : mixed(ids, model.groupKey), (value) => {
        pushUndo();
        for (let i = 0; i < ids.length; i++) {
          const s = sticky(ids[i]);
          if (s) rowOf(s).fields[model.groupKey] = value;
        }
        persist();
        syncChrome(); requestDraw();
      });
    }
    for (const key of model.columns) {
      if ([model.nameKey, model.areaKey, model.deptKey, model.groupKey].includes(key)) continue;
      addField(el, key, one ? cell(rowOf(one), key) : mixed(ids, key), (value) => {
        pushUndo(); for (const id of ids) rowOf(sticky(id)).fields[key] = value;
        persist(); requestDraw();
      });
    }
    const row = document.createElement('div'); row.className = 'cap row metadata-add';
    const input = document.createElement('input'); input.placeholder = 'New field name'; input.setAttribute('aria-label', 'New metadata field');
    const add = document.createElement('button'); add.type = 'button'; add.className = 'btn'; add.textContent = '+ Add'; add.setAttribute('aria-label', 'Add metadata field');
    const commit = () => {
      const name = addMetadataField(input.value);
      if (!name) {input.classList.add('bad'); toast('Enter a new, unique field name.'); input.focus(); return;}
      buildData(el); placeMenu();
      for (const field of el.querySelectorAll('input')) if (field.getAttribute('aria-label') === name) {field.focus(); break;}
    };
    input.addEventListener('input', () => input.classList.remove('bad'));
    input.addEventListener('keydown', e => {e.stopPropagation(); if (e.key === 'Enter') {e.preventDefault(); commit();}});
    add.addEventListener('click', commit); row.append(input, add); el.append(row);
  }

  function addMetadataField(value) {
    const name = value.trim();
    if (!name || /[\r\n]/.test(name) || model.columns.some(key => key.toLowerCase() === name.toLowerCase())) return null;
    pushUndo(); model.columns.push(name);
    for (const row of model.rows) row.fields[name] = '';
    persist(); return name;
  }

  function mixed(ids, key) {
    let first = null;
    for (let i = 0; i < ids.length; i++) {
      const v = cell(rowOf(sticky(ids[i])), key);
      if (first == null) first = v;
      else if (first !== v) return '';
    }
    return first || '';
  }

  function addField(el, label, value, onCommit, unit) {
    const row = document.createElement('div');
    row.className = 'cap row field';
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = label;
    const input = document.createElement('input');
    input.value = value;
    input.placeholder = idsMixed(label, value) ? 'Mixed' : '';
    input.setAttribute('aria-label', label);
    if (unit) {
      const u = document.createElement('span');
      u.className = 'sub';
      u.textContent = unit;
      row.append(k, input, u);
    } else row.append(k, input);
    const commit = () => {
      if (input.value === value) return;
      onCommit(input.value.trim());
      value = input.value;
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
      ev.stopPropagation();
    });
    input.addEventListener('blur', commit);
    el.appendChild(row);
  }

  function idsMixed(label, value) {
    return label && value === '' && selected.size > 1;
  }

  function closePops() {
    $('pop-algo').hidden = true;
    $('pop-aspect').hidden = true;
    $('pop-export').hidden = true;
    $('menu').hidden = true;
  }

  function placePop(pop, anchor) {
    pop.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    let left = Math.min(r.left, window.innerWidth - w - 8);
    left = Math.max(8, left);
    let top = r.top - 8 - h;
    if (top < 8) top = r.bottom + 8;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  function fillAlgoPop() {
    const pop = $('pop-algo');
    pop.innerHTML = '';
    for (let i = 0; i < PB.ALGORITHMS.length; i++) {
      const algo = PB.ALGORITHMS[i];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cap row item' + (algo.id === algorithm ? ' on' : '');
      b.title = algo.blurb;
      const name = document.createElement('span');
      name.textContent = algo.name;
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = algo.blurb;
      b.append(name, hint);
      b.addEventListener('click', () => setAlgorithm(algo.id));
      pop.appendChild(b);
    }
  }

  function fillAspectPop() {
    const pop = $('pop-aspect');
    pop.innerHTML = '';
    for (let i = 0; i < PB.ASPECTS.length; i++) {
      const preset = PB.ASPECTS[i];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cap row item' + (PB.aspectLabel(aspect) === preset.label ? ' on' : '');
      b.textContent = preset.label;
      b.addEventListener('click', () => { setAspect(preset.value); closePops(); });
      pop.appendChild(b);
    }
    const custom = document.createElement('div');
    custom.className = 'cap row field';
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = 'Custom';
    const input = document.createElement('input');
    input.id = 'aspect-input';
    input.placeholder = '3:2';
    input.setAttribute('aria-label', 'Custom aspect ratio');
    custom.append(k, input);
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key !== 'Enter') return;
      const value = PB.parseAspect(input.value);
      if (!value) { input.classList.add('bad'); return; }
      setAspect(value);
      closePops();
    });
    pop.appendChild(custom);
  }

  function fillExportPop() {
    const pop = $('pop-export');
    pop.innerHTML = '';
    const options = [
      ['csv', 'CSV', 'Spreadsheet with the areas and names as they are now'],
      ['png', 'PNG', 'The frame and its tiles'],
      ['svg', 'SVG', 'The same drawing as vectors'],
    ];
    for (let i = 0; i < options.length; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cap row item';
      b.textContent = options[i][1];
      b.title = options[i][2];
      b.addEventListener('click', () => { exportAs(options[i][0]); closePops(); });
      pop.appendChild(b);
    }
  }

  function placeMenu() {
    const menu = $('menu');
    if (!menuAt) return;
    menu.style.left = Math.max(8, Math.min(menuAt.x, viewW - menu.offsetWidth - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(menuAt.y, viewH - menu.offsetHeight - 8)) + 'px';
  }

  function menuButton(menu, label, fn, danger, hint) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cap row item' + (danger ? ' danger' : '');
    const text = document.createElement('span'); text.textContent = label; b.append(text);
    if (hint) { const h = document.createElement('span'); h.className = 'hint'; h.textContent = hint; b.append(h); }
    b.addEventListener('click', () => { closePops(); fn(); });
    menu.append(b); return b;
  }

  function dropdown(menu, label, hint, fill) {
    const head = document.createElement('button');
    head.type = 'button'; head.className = 'cap row item drop-head';
    const name = document.createElement('span'); name.textContent = label;
    const tail = document.createElement('span'); tail.className = 'drop-tail';
    if (hint) { const h = document.createElement('span'); h.className = 'hint'; h.textContent = hint; tail.append(h); }
    tail.innerHTML += '<svg class="chev" width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><path d="M1.6 2.9 4 5.3 6.4 2.9" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    head.append(name, tail); head.setAttribute('aria-expanded', 'false');
    const box = document.createElement('div'); box.className = 'drop'; box.hidden = true;
    const toggle = () => {
      box.hidden = !box.hidden; head.classList.toggle('open', !box.hidden);
      head.setAttribute('aria-expanded', String(!box.hidden));
      box.innerHTML = ''; if (!box.hidden) fill(box); placeMenu();
    };
    head.addEventListener('click', toggle); menu.append(head, box);
    return toggle;
  }

  function styleSelection(key, value, record = true) {
    if (record) pushUndo();
    for (const id of selected) { const s = sticky(id); if (s) setStyle(s, key, value); }
    persist(); requestDraw();
  }

  function ensureSwatches(kind, colors) {
    const list = colorSwatches[kind];
    if (kind === 'fill') for (const [dept, color] of palette()) {
      const id = 'dept:' + dept;
      if (!list.some(entry => entry.id === id)) list.push({id, color, dept});
    }
    for (const color of colors) if (color !== 'auto') {
      const id = kind + ':' + color;
      if (!list.some(entry => entry.id === id)) list.push({id, color});
    }
    return list;
  }

  function refreshSwatches() {
    for (const row of $('menu').querySelectorAll('.swatch-row, .canvas-divider')) row.refreshSwatches?.();
    placeMenu();
  }

  function applyColor(kind, color, swatchId, record = true) {
    if (record) pushUndo();
    const key = kind === 'fill' ? 'fill' : 'ink';
    for (const id of selected) {
      const s = sticky(id);
      if (s) { setStyle(s, key, color); s.style[key + 'Swatch'] = swatchId; }
    }
    persist(); requestDraw();
  }

  function editSwatch(kind, id, color) {
    const entry = colorSwatches[kind].find(entry => entry.id === id);
    if (!entry || entry.color === color) return;
    pushUndo();
    const previous = entry.color;
    entry.color = color;
    const key = kind === 'fill' ? 'fill' : 'ink', ref = key + 'Swatch';
    if (kind !== 'background') {
      for (const s of model.stickies) {
        if (s.style?.[ref] === id || (!s.style?.[ref] && s.style?.[key] === previous)) {
          setStyle(s, key, color); s.style[ref] = id;
        }
      }
      if (kind === 'text' && (boardText.inkSwatch === id || (!boardText.inkSwatch && boardText.ink === previous))) { boardText = {...boardText, ink: color, inkSwatch: id}; shared.view.textColor=color; }
    } else if (backgroundSwatch === id || (!backgroundSwatch && background === previous)) {
      background = color; backgroundSwatch = id;
    }
    if (entry.dept != null) {
      departmentColors.set(entry.dept, color);
      for (const s of model.stickies.filter(kept)) if ((cell(rowOf(s), model.deptKey) || '—') === entry.dept && (!s.color && !s.gradientId || s.style?.fillSwatch === id)) { setStyle(s, 'fill', color); s.style.fillSwatch = id; }
    }
    persist(); requestDraw(); refreshSwatches();
  }

  function addSwatch(kind, color, write) {
    pushUndo();
    const entry = {id: kind + ':custom:' + Math.random().toString(36).slice(2, 12), color};
    colorSwatches[kind].push(entry);
    write(color, entry.id, false);
    persist(); requestDraw(); refreshSwatches();
    return entry;
  }

  function swatches(menu, label, kind, colors, read, write) {
    ensureSwatches(kind, colors);
    const row = el('div', 'cap row spread swatch-row');
    const name = el('span', null, label), dots = el('span', 'swatches');
    function edit(entry) {
      $('menu').querySelectorAll('.swatch-editor').forEach(node => node.remove());
      const editor = el('div', 'cap row swatch-editor');
      const picker = el('input'); picker.type = 'color'; picker.value = entry?.color || read().color || '#dcd7cf'; picker.setAttribute('aria-label', 'Swatch color picker');
      const hex = textInput(); hex.value = picker.value; hex.setAttribute('aria-label', 'Swatch hex color'); hex.spellcheck = false;
      const apply = el('button', 'btn', entry ? 'Apply' : 'Add'), cancel = el('button', 'round', '×');
      apply.type = cancel.type = 'button'; cancel.title = 'Cancel color edit';
      picker.addEventListener('input', () => {hex.value = picker.value; hex.classList.remove('bad');});
      hex.addEventListener('input', () => {if (/^#[0-9a-f]{6}$/i.test(hex.value)) picker.value = hex.value; hex.classList.remove('bad');});
      const commit = () => {
        let color = hex.value.trim().toLowerCase();
        if (/^#[0-9a-f]{3}$/.test(color)) color = '#' + [...color.slice(1)].map(c => c + c).join('');
        if (!/^#[0-9a-f]{6}$/.test(color)) {hex.classList.add('bad'); hex.focus(); return;}
        if (entry) editSwatch(kind, entry.id, color); else addSwatch(kind, color, write);
        editor.remove(); placeMenu();
      };
      apply.addEventListener('click', commit);
      cancel.addEventListener('click', () => {editor.remove(); placeMenu();});
      hex.addEventListener('keydown', e => {e.stopPropagation(); if (e.key === 'Enter') {e.preventDefault(); commit();} if (e.key === 'Escape') {editor.remove(); placeMenu();}});
      editor.append(picker, hex, apply, cancel); row.after(editor); placeMenu(); hex.focus(); hex.select();
    }
    row.refreshSwatches = () => {
      dots.innerHTML = '';
      const current = read();
      if (colors.includes('auto')) {
        const auto = el('button', 'swatch auto'); auto.type = 'button'; auto.title = 'Automatic ' + kind + ' color'; auto.setAttribute('aria-label', auto.title);
        auto.classList.toggle('on', !current.color && !current.id);
        auto.addEventListener('click', () => {write(null, null); row.refreshSwatches();}); dots.append(auto);
      }
      for (const entry of colorSwatches[kind]) {
        const dot = el('button', 'swatch'); dot.type = 'button'; dot.style.background = entry.color;
        dot.title = (entry.dept != null ? entry.dept + ' · ' : '') + entry.color + ' · right-click to edit';
        dot.setAttribute('aria-label', kind + ' color ' + (entry.dept != null ? entry.dept + ' ' : '') + entry.color);
        dot.classList.toggle('on', current.id ? current.id === entry.id : current.color === entry.color);
        dot.addEventListener('click', () => {write(entry.color, entry.id); row.refreshSwatches();});
        // Native contextmenu is suppressed at window capture, so use pointerdown.
        dot.addEventListener('pointerdown', e => {if (e.button === 2) {e.preventDefault(); e.stopPropagation(); edit(entry);}});
        dots.append(dot);
      }
      const plus = el('button', 'swatch custom', '+'); plus.type = 'button'; plus.title = 'Add ' + kind + ' color'; plus.setAttribute('aria-label', plus.title);
      plus.addEventListener('click', () => edit(null)); dots.append(plus);
    };
    row.append(name, dots); menu.append(row); row.refreshSwatches();
  }

  // Same drag threshold, click-to-type, keyboard stepping, tip timing, and
  // capsule DOM as the program board's slider. Keep these behaviors aligned.
  function el(tag, cls, text) { const node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; }
  function textInput(cls) { const input = el('input', cls); input.type = 'text'; return input; }
  function sliderRow(menu, opts) {
    const row = el('div', 'cap row slide-row'); row.append(el('span', 'k', opts.label));
    const control = slideControl(opts); row.append(control.el); menu.append(row); return control;
  }
  const SLIDE_PAD = 12; // px from each end of the pill to the thumb's centre at 0 and 1
  const SLIDE_CLICK_PX = 3;
  const SLIDE_TIP_HOLD = 480; // ms the readout stays after release, then fades
  const slideTip = $('slide-tip');
  let slideTipTimer = 0;

  function slideT(slider, clientX) {
    const r = slider.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left - SLIDE_PAD) / Math.max(1, r.width - SLIDE_PAD * 2)));
  }

  function placeThumb(thumb, t) {
    thumb.style.left = 'calc(' + SLIDE_PAD + 'px + (100% - ' + SLIDE_PAD * 2 + 'px) * ' + t + ')';
  }

  function showSlideTip(thumb, text) {
    clearTimeout(slideTipTimer);
    slideTip.textContent = text;
    slideTip.classList.add('show');
    const a = thumb.getBoundingClientRect();
    const w = slideTip.offsetWidth;
    const h = slideTip.offsetHeight;
    const x = Math.min(viewW - w - 8, Math.max(8, a.left + a.width * 0.5 - w * 0.5));
    const y = a.top - h - 7 < 8 ? a.bottom + 7 : a.top - h - 7;
    slideTip.style.transform = 'translate(' + Math.round(x) + 'px, ' + Math.round(y) + 'px)';
  }

  function fadeSlideTip(now) {
    clearTimeout(slideTipTimer);
    if (now) slideTip.classList.remove('show');
    else slideTipTimer = setTimeout(() => slideTip.classList.remove('show'), SLIDE_TIP_HOLD);
  }

  // The typed form of a value: up to three decimals, no trailing zeros.
  function slideNumber(n) {
    return String(Number(n.toFixed(2)));
  }

  // opts: {
  //   label,                      the name, for the field's aria-label
  //   min, max: () => number, step,
  //   read: () => ({ value, mixed }),
  //   write: (v) => void,         applies without recording (the control checkpoints)
  //   done: () => void,           optional, after a drag or a typed commit
  //   format: (v) => string,      the readout ('3.25 ft', '40%', 'None')
  //   unit: 'ft' | '%',           shown beside the typed number
  //   factor,                     typed number = value x factor (100 for percents)
  //   exact,                      keep typed decimals as typed (else whole steps when step >= 1)
  //   typedMin, typedMax,         the typed range, when wider than the slider's
  //   toT, fromT,                 value <-> 0..1 when the travel is not linear
  // }
  // Returns { el, refresh(force) }. A drag or a typed commit is one undo step.
  function slideControl(opts) {
    const box = el('div', 'slide');
    const slider = el('div', 'slider');
    const thumb = el('span', 'thumb');
    slider.append(el('span', 'rail'), thumb);
    slider.tabIndex = 0;
    slider.setAttribute('role', 'slider');
    slider.setAttribute('aria-label', opts.label);
    slider.title = 'Drag to set, click to type';
    const entry = el('label', 'slide-entry');
    const input = textInput('slide-input');
    input.inputMode = 'decimal';
    input.setAttribute('aria-label', opts.label);
    entry.append(input, el('span', 'slide-unit', opts.unit || ''));
    entry.hidden = true;
    box.append(slider, entry);
    const factor = opts.factor || 1;
    const toT = opts.toT || ((v) => (v - opts.min) / Math.max(1e-9, opts.max() - opts.min));
    const fromT = opts.fromT || ((t) => {
      const max = opts.max();
      return Number((Math.round((opts.min + t * (max - opts.min)) / opts.step) * opts.step).toFixed(9));
    });
    const tip = () => {
      const cur = opts.read();
      showSlideTip(thumb, cur.mixed ? 'Mixed' : opts.format(cur.value));
    };
    const set = (v) => {
      opts.write(v);
      refresh();
      tip();
    };

    // Pointer: nothing changes until the press travels past the click slop.
    let press = null;
    slider.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      slider.setPointerCapture(event.pointerId);
      press = { x: event.clientX, y: event.clientY, scrub: false };
      tip();
    });
    slider.addEventListener('pointermove', (event) => {
      if (!press || !slider.hasPointerCapture(event.pointerId)) return;
      if (!press.scrub && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= SLIDE_CLICK_PX) return;
      if (!press.scrub) {
        press.scrub = true;
        pushUndo();
      }
      set(fromT(slideT(slider, event.clientX)));
    });
    const release = (cancelled) => {
      if (!press) return;
      const p = press;
      press = null;
      if (p.scrub) {
        if (opts.done) opts.done();
        fadeSlideTip(false);
      } else if (cancelled) {
        fadeSlideTip(true);
      } else {
        fadeSlideTip(true);
        openEntry();
      }
    };
    slider.addEventListener('pointerup', () => release(false));
    slider.addEventListener('pointercancel', () => release(true));

    // Keyboard, once the slider has focus (Tab): arrows step (Shift x10),
    // Home and End go to the ends, Enter types. A burst of keys is one undo step.
    let keyBurst = 0;
    slider.addEventListener('keydown', (event) => {
      const cur = opts.read();
      const t = cur.mixed ? 0.5 : toT(cur.value);
      const steps = (opts.fromT ? 1 / Math.max(1, opts.stops - 1) : opts.step / Math.max(1e-9, opts.max() - opts.min)) * (event.shiftKey ? 10 : 1);
      let next = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = Math.min(1, t + steps);
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = Math.max(0, t - steps);
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = 1;
      else if (event.key === 'Enter' || event.key === 'F2') {
        event.preventDefault();
        event.stopPropagation();
        openEntry();
        return;
      } else return;
      event.preventDefault();
      event.stopPropagation();
      if (!keyBurst) pushUndo();
      clearTimeout(keyBurst);
      keyBurst = setTimeout(() => {
        keyBurst = 0;
        if (opts.done) opts.done();
      }, 700);
      set(fromT(next));
      fadeSlideTip(false);
    });
    slider.addEventListener('blur', () => fadeSlideTip(false));

    // Click to type. Enter or a click away commits (clamped, one undo step),
    // Esc cancels, and a bad number shakes, reverts, and stays open.
    let open = false;
    let before = '';
    const outside = (event) => {
      if (!entry.contains(event.target)) commit(true);
    };
    function openEntry() {
      const cur = opts.read();
      before = cur.mixed ? '' : slideNumber(cur.value * factor);
      input.value = before;
      input.placeholder = cur.mixed ? 'Mixed' : '';
      entry.classList.remove('bad', 'shake');
      slider.hidden = true;
      entry.hidden = false;
      open = true;
      input.focus();
      input.select();
      document.addEventListener('pointerdown', outside, true);
      if ($('menu').contains(box)) placeMenu();
    }
    function close() {
      if (!open) return;
      open = false;
      document.removeEventListener('pointerdown', outside, true);
      entry.hidden = true;
      slider.hidden = false;
      refresh(true);
    }
    function parse() {
      const text = input.value.trim().replace(/\s*(ft|feet|'|%)\s*$/i, '');
      const n = Number(text);
      if (text === '' || !Number.isFinite(n)) return null;
      const lo = opts.typedMin != null ? opts.typedMin : opts.min;
      const hi = opts.typedMax != null ? opts.typedMax : opts.max();
      let v = Math.min(hi, Math.max(lo, n / factor));
      if (!opts.exact && opts.step >= 1) v = Math.min(hi, Math.max(lo, Math.round(v / opts.step) * opts.step));
      return Number(v.toFixed(9));
    }
    // `away`: the field lost the pointer; a bad number then just reverts.
    function commit(away) {
      if (!open) return;
      if (input.value.trim() === before) { close(); return; }
      const v = parse();
      if (v == null) {
        if (away || input.value.trim() === before) {
          close();
          return;
        }
        entry.classList.remove('shake');
        void entry.offsetWidth;
        entry.classList.add('bad', 'shake');
        input.value = before;
        input.select();
        return;
      }
      const cur = opts.read();
      if (cur.mixed || Math.abs(v - cur.value) > 1e-12) {
        pushUndo();
        opts.write(v);
        if (opts.done) opts.done();
      }
      close();
    }
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        commit(false);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    });
    input.addEventListener('input', () => entry.classList.remove('bad'));
    input.addEventListener('blur', () => commit(true));
    entry.addEventListener('animationend', () => entry.classList.remove('shake'));

    function refresh() {
      const cur = opts.read();
      placeThumb(thumb, cur.mixed ? 0.5 : Math.min(1, Math.max(0, toT(cur.value))));
      thumb.classList.toggle('mixed', cur.mixed);
      slider.setAttribute('aria-valuetext', cur.mixed ? 'Mixed' : opts.format(cur.value));
    }
    refresh();
    return { el: box, refresh: refresh };
  }

  function textRows(menu, all) {
    const first = () => styleOf(all ? null : sticky(Array.from(selected)[0]));
    const set = (key, value, record = true) => { if (all) { if (record) pushUndo(); boardText = { ...boardText, [key]: value }; const field = {face:'face',size:'textScale',ink:'textColor'}[key]; if (field) shared.view[field] = value; persist(); requestDraw(); } else styleSelection(key, value, record); };
    sliderRow(menu, {label:'Leaders',min:0,max:()=>120,step:1,unit:'px',read:()=>({value:leaderThreshold,mixed:false}),write:value=>{leaderThreshold=Math.max(0,Math.min(120,value));persist();requestDraw();},format:value=>value?slideNumber(value)+' px':'Off'});
    sliderRow(menu, { label: 'Size', min: 0.25, max: () => 3, step: 0.05, factor: 100, unit: '%', read: () => ({value: first().size || 1, mixed: false}), write: (v) => set('size', v, false), format: (v) => Math.round(v * 100) + '%' });
    const alignBar = el('div', 'cap row alignment');
    for (const [key, values] of [['align', ['left','center','right']], ['valign', ['top','middle','bottom']]]) {
      const group = el('span', 'segs');
      for (const value of values) {
        const b = el('button', 'seg'); b.type = 'button'; b.title = 'Align ' + value; b.setAttribute('aria-label', b.title);
        const vertical = key === 'valign', offset = values.indexOf(value) * 3;
        const lines = vertical ? `<path d="M3 ${3+offset}h12 M5 ${6+offset}h8 M6 ${9+offset}h6"/>`
          : `<path d="M3 4h12 M${3+offset} 8h6 M3 12h12"/>`;
        b.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">${lines}</svg>`;
        b.classList.toggle('on', (first()[key] || values[0]) === value);
        b.addEventListener('click', () => { set(key, value); for (const child of group.children) child.classList.toggle('on', child === b); });
        group.append(b);
      }
      alignBar.append(group);
    }
    menu.append(alignBar);
    swatches(menu, 'Color', 'text', ['auto', '#2a2926', '#6c675f', '#ffffff', '#1f6fb2', '#0f8f82', '#b0453a'], () => ({color: first().ink, id: first().inkSwatch}), (color, id, record = true) => {
      if (all) {if (record) pushUndo(); boardText = {...boardText, ink: color, inkSwatch: id}; shared.view.textColor=color; persist(); requestDraw();}
      else applyColor('text', color, id, record);
    });
    const row = document.createElement('div'); row.className = 'cap row spread';
    const name = document.createElement('span'); name.textContent = 'Typeface';
    const segs = document.createElement('span'); segs.className = 'segs';
    for (const [id, face] of Object.entries(FACES)) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'seg' + (first().face === id ? ' on' : ''); b.textContent = face.label; b.style.fontFamily = face.css;
      b.addEventListener('click', () => { set('face', id); for (const node of segs.children) node.classList.toggle('on', node === b); }); segs.append(b);
    }
    row.append(name, segs); menu.append(row);
    if (!all) menuButton(menu, 'Use board text', nullText, false);
  }

  function nullText() {
    pushUndo(); for (const id of selected) { const s = sticky(id); if (!s?.style) continue; for (const key of ['face', 'size', 'ink', 'inkSwatch', 'align', 'valign']) delete s.style[key]; }
    for (const id of selected) { const s = sticky(id); if (s) { s.textFace = null; s.textScale = null; s.textColor = null; } }
    persist(); requestDraw();
  }

  function groupSelection(clear) {
    pushUndo();
    if (!model.groupKey) { model.groupKey = 'Group'; if (!model.columns.includes('Group')) model.columns.push('Group'); }
    const value = clear ? '' : 'Group ' + (new Set(model.rows.map((r) => r.fields[model.groupKey]).filter(Boolean)).size + 1);
    for (const id of selected) rowOf(sticky(id)).fields[model.groupKey] = value;
    persist(); requestDraw();
  }

  function canvasRows(menu) {
    swatches(menu, 'Color', 'background', ['#ffffff', '#f6f5f2', '#ebe9e4', '#e8ecf0', '#1b1e22'],
      () => ({color: background, id: backgroundSwatch}), (color, id, record = true) => {
        if (record) pushUndo(); background = color; backgroundSwatch = id; persist(); requestDraw();
      });
    const toggle = el('button', 'cap row item canvas-divider'); toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Department dividers');
    const label = el('span', null, 'Department dividers'), state = el('span', 'hint');
    const refresh = () => {state.textContent = departmentDividers ? 'On' : 'Off'; toggle.setAttribute('aria-pressed', String(departmentDividers));};
    toggle.refreshSwatches = refresh;
    toggle.addEventListener('click', () => {setDepartmentDividers(!departmentDividers); refresh();});
    toggle.append(label, state); menu.append(toggle); refresh();
  }

  function gradientRows(menu) {
    if (!Appearance) return;
    const row = el('div','cap row spread'); row.append(el('span',null,'Color mode'));
    const controls = el('span','segs');
    for (const [label, mode] of [['Solid','solid'],['By size','gradient']]) {
      const button = el('button','seg',label); button.type='button'; button.addEventListener('click',()=>{pushUndo(); const list=[...selected].map(sticky); if(mode==='solid')Appearance.clearGradient(model,list);else Appearance.setGradient(model,list,Appearance.DEFAULT_START,Appearance.DEFAULT_END);persist();requestDraw();openMenu(menuAt.x,menuAt.y,false);}); controls.append(button);
    }
    row.append(controls); menu.append(row);
    const ramp = Appearance.commonGradient(model,[...selected].map(sticky));
    if (ramp) {
      const stops = el('div','cap row spread'); stops.append(el('span',null,'Small → large'));
      const a=el('input'),b=el('input'); a.type=b.type='color';a.value=ramp.start;b.value=ramp.end;a.setAttribute('aria-label','Small cell gradient color');b.setAttribute('aria-label','Large cell gradient color');
      for(const input of[a,b])input.addEventListener('change',()=>{pushUndo();Appearance.setGradient(model,[...selected].map(sticky),a.value,b.value);persist();requestDraw();});stops.append(a,b);menu.append(stops);
    }
  }

  function openMenu(x, y, metadata) {
    if (!model) return;
    const menu = $('menu'); menu.innerHTML = '';
    const w = s2w(x, y);
    const callout = leaderAt(x,y);
    const tile = metadata ? settled().tiles.find((t) => selected.has(t.id)) : callout ? settled().tiles.find(t=>t.id===callout.id) : pickTile(settled().tiles, w.x, w.y);
    if (tile) {
      if (!selected.has(tile.id)) selected = new Set([tile.id]);
      const openMetadata = dropdown(menu, 'Metadata', 'Enter', buildData);
      dropdown(menu, 'Text', null, (box) => textRows(box, false));
      dropdown(menu, 'Canvas', null, canvasRows);
      menuButton(menu, 'Duplicate', () => duplicateMany([...selected]), false, 'Ctrl D');
      if (selected.size > 1) menuButton(menu, 'Group', () => groupSelection(false), false, 'Ctrl G');
      swatches(menu, 'Color', 'fill', ['auto', '#e9e5de', '#cbc4b8', '#d2d8cf', '#d3dae1', '#e5d6c8', '#d8ccd3'], () => ({color: sticky(tile.id).color, id: sticky(tile.id).style?.fillSwatch}), (color, id, record) => applyColor('fill', color, id, record));
      gradientRows(menu);
      sliderRow(menu, { label: 'Stroke', min: 0, max: () => 4, step: 0.25, unit: 'ft', read: () => ({value: sticky(tile.id).stroke || 0, mixed:false}), write: (v) => styleSelection('stroke', v, false), format: (v) => v ? slideNumber(v) + ' ft' : 'None' });
      sliderRow(menu, {label: 'Fillet', min: 0, max: () => 30, step: 0.5, unit: 'ft', read: () => ({value: sticky(tile.id).radius || 0, mixed: false}), write: v => styleSelection('fillet', v, false), format: v => slideNumber(v) + ' ft'});
      menuButton(menu, 'Delete', () => deleteIds(Array.from(selected)), true, 'Del');
      if (metadata) openMetadata();
    } else {
      dropdown(menu, 'Text', null, (box) => textRows(box, true));
      dropdown(menu, 'Canvas', null, canvasRows);
      sliderRow(menu, {label: 'Fillet', min: 0, max: () => 30, step: 0.5, unit: 'ft', read: () => ({value: fillet, mixed: false}), write: v => {fillet = v; for(const s of Engine.alive(model))s.radius=v;persist(); requestDraw();}, format: v => slideNumber(v) + ' ft'});
      if (chrome.title) menuButton(menu, 'Rename frame', openTitle);
      menuButton(menu, 'Optimize layout', repack);
      menuButton(menu, 'Spreadsheet order', resetOrder);
      menuButton(menu, 'Fit viewport', fitView, false, 'F');
    }
    // Keep the saved multiplier for compatibility; expose actual feet in the UI.
    sliderRow(menu, {label: 'Buffer', min: 0, max: () => 5, step: 0.005, factor: 10, unit: 'ft',
      read: () => ({value: buffer, mixed: false}),
      write: v => {buffer = v; persist(); requestDraw();},
      format: v => slideNumber(v * 10) + ' ft'});
    menu.hidden = false; menuAt = { x, y }; placeMenu(); requestDraw();
  }

  async function buildPackSave() {
    flushEdits();
    return (await Engine.buildSave(model, sharedState().view, shared.camera, {app: 'Program board · Pack'})).bytes;
  }

  async function saveBoard() {
    if (!model) return;
    try { download(baseName() + '.pack.zip', new Blob([await buildPackSave()], {type: 'application/zip'})); }
    catch (err) { toast('Could not save: ' + err.message); }
  }

  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function baseName() {
    return String(model.fileName || 'program').replace(/\.[^.]+$/, '') || 'program';
  }

  function exportAs(kind) {
    if (!model) return;
    try { flushEdits(); } catch (err) { toast(err.message); return; }
    if (kind === 'csv') {
      download(baseName() + '.pack.csv', new Blob([csv()], { type: 'text/csv' }));
      return;
    }
    const view = settled();
    if (!view.tiles.length) { toast('There are no positive-area tiles to draw. Export CSV to keep the data.'); return; }
    const bases = palette();
    if (kind === 'png') exportPng(view, bases);
    else exportSvg(view, bases);
  }

  function exportPng(view, bases) {
    const f = view.frame;
    const long = Math.max(f.w, f.h);
    const px = Math.min(12, 4096 / long);
    const pad = 36 * px;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(f.w * px));
    c.height = Math.max(1, Math.round(f.h * px + pad));
    const g = c.getContext('2d');
    g.fillStyle = FRAME;
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#1b1e22';
    g.font = (16 * px) + 'px Segoe UI, sans-serif';
    g.textBaseline = 'middle';
    g.fillText(title, 8 * px, pad / 2);
    g.save(); g.translate(-f.x * px, pad - f.y * px); g.scale(px, px);
    for (const t of view.tiles) { const s = sticky(t.id); if (s) paintCard(g, t, s, bases); }
    paintDepartmentDividers(g, view.tiles, 0.75);
    g.restore();
    const project = (x,y)=>({x:(x-f.x)*px,y:pad+(y-f.y)*px});
    const callouts = leaderLayout(view,px,project,{width:c.width,height:c.height});
    paintLeaders(g,callouts);
    paintLabels(view, bases, g, px, project, 1, 112, callouts);
    c.toBlob((blob) => { if (blob) download(baseName() + '.pack.png', blob); });
  }

  function exportSvg(view, bases) {
    const f = view.frame;
    const callouts = leaderLayout(view,1,(x,y)=>({x:x-f.x,y:y-f.y+28}),{width:f.w,height:f.h+28});
    const external = new Set(callouts.items.map(item=>item.id));
    const parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + f.w + ' ' + (f.h + 28) + '">'];
    parts.push('<rect x="0" y="0" width="' + f.w + '" height="' + (f.h + 28) + '" fill="#ffffff"/>');
    parts.push('<text x="0" y="18" font-family="Segoe UI, sans-serif" font-size="14" fill="#1b1e22">' + xml(title) + '</text>');
    for (let i = 0; i < view.tiles.length; i++) {
      const t = cardRect(view.tiles[i]);
      const s = sticky(t.id);
      if (!s) continue;
      const fill = colorOf(s, bases);
      const style = styleOf(s);
      const face = (FACES[style.face] || FACES.std).css;
      const ink = style.ink || (luma(fill) < 0.72 ? '#ffffff' : '#1b1e22');
      const x = t.x - f.x;
      const y = t.y - f.y + 28;
      parts.push('<rect x="' + x + '" y="' + y + '" width="' + t.w + '" height="' + t.h + '" rx="' + Math.min(s.radius ?? fillet, t.w / 2, t.h / 2) + '" fill="' + fill + '" stroke="#ffffff" stroke-opacity="0.65" stroke-width="' + (s.stroke || 0) + '"/>');
      if (external.has(t.id)) continue;
      let size = Math.min(t.w * 0.12, t.h * 0.2, 16) * (style.size || 1);
      let lines;
      for (let attempt = 0; attempt < 24; attempt++) {
        ctx.font = size + 'px ' + face;
        lines = wrap(ctx, cell(rowOf(s), model.nameKey), t.w * 0.84);
        if ((lines.length + 1) * size * 1.2 <= t.h * 0.84) break;
        size *= 0.82;
      }
      parts.push('<clipPath id="tile-' + i + '"><rect x="' + x + '" y="' + y + '" width="' + t.w + '" height="' + t.h + '"/></clipPath><g clip-path="url(#tile-' + i + ')">');
      const tx = x + t.w * (style.align === 'center' ? 0.5 : style.align === 'right' ? 0.92 : 0.08);
      const ty = y + t.h * 0.08 + Math.max(0, t.h * 0.84 - (lines.length + 1) * size * 1.2) * (style.valign === 'bottom' ? 1 : style.valign === 'middle' ? 0.5 : 0);
      const anchor = style.align === 'center' ? 'middle' : style.align === 'right' ? 'end' : 'start';
      lines.concat([fmt(dataArea(s)) + ' sf']).forEach((line, li) => {
        parts.push('<text x="' + tx + '" y="' + (ty + size * (1 + li * 1.2)) + '" text-anchor="' + anchor + '" font-family="' + xml(face) + '" font-size="' + size + '" fill="' + ink + '">' + xml(line) + '</text>');
      });
      parts.push('</g>');
    }
    for (const [x0,y0,x1,y1] of departmentSeams(view.tiles)) parts.push(`<path d="M${x0-f.x} ${y0-f.y+28}L${x1-f.x} ${y1-f.y+28}" fill="none" stroke="#8c8880" stroke-width="0.75"/>`);
    for (const item of callouts.items) {
      const l=item.label;parts.push(`<path d="M${item.anchor.x} ${item.anchor.y}L${item.elbow.x} ${item.elbow.y}L${item.end.x} ${item.end.y}" fill="none" stroke="#7e8589" stroke-width="0.8"/><rect x="${l.x-3}" y="${l.y}" width="${l.w+6}" height="${l.h}" fill="#ffffff" fill-opacity="0.92"/><text x="${l.x}" y="${l.y+l.h*0.68}" fill="#50585f" font-family="Segoe UI,sans-serif" font-size="${l.h/2}" textLength="${Math.min(l.w,item.text.length*l.h*0.27)}" lengthAdjust="spacingAndGlyphs">${xml(item.text)}</text>`);
    }
    parts.push('</svg>');
    download(baseName() + '.pack.svg', new Blob([parts.join('')], { type: 'image/svg+xml' }));
  }

  function xml(text) {
    return String(text == null ? '' : text).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  function onKey(e) {
    if (!model) return;
    if (e.target.closest?.('.board-data-dashboard, .board-data-tags-menu')) return;
    if (e.code === 'Space' && !typing()) space = true;
    if (typing()) {
      if (e.key === 'Escape' && nameEdit) { e.preventDefault(); $('name-input').hidden = true; nameEdit = null; requestDraw(); }
      return;
    }
    const meta = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      if (dataDashboard?.isOpen()) { dataDashboard.close(); return; }
      cancelDrag(); closePops(); selected.clear(); syncChrome(); requestDraw();
    }
    else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); if (e.shiftKey) fitArea(); else fitView(); }
    else if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    else if (meta && e.key.toLowerCase() === 'g') { e.preventDefault(); if (selected.size && !e.shiftKey) groupSelection(false); }
    else if (meta && e.key.toLowerCase() === 'd') { e.preventDefault(); if (selected.size) duplicateMany([...selected]); }
    else if (meta && e.key.toLowerCase() === 's') { e.preventDefault(); saveBoard(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteIds(Array.from(selected)); }
    else if (e.key === 'Enter' && selected.size) { const t = settled().tiles.find((t) => selected.has(t.id)); if (t) { const p = w2s(t.x + t.w, t.y); openMenu(p.x, p.y, true); } }
    else if (e.key === '[') stepAspect(-1);
    else if (e.key === ']') stepAspect(1);
  }

  function stepAspect(dir) {
    let i = 0;
    let best = Infinity;
    for (let k = 0; k < PB.ASPECTS.length; k++) {
      const d = Math.abs(PB.ASPECTS[k].value - aspect);
      if (d < best) { best = d; i = k; }
    }
    const next = PB.ASPECTS[(i + dir + PB.ASPECTS.length) % PB.ASPECTS.length];
    setAspect(next.value);
  }

  $('tb-algo').addEventListener('click', () => {
    const open = $('pop-algo').hidden;
    closePops();
    if (!open) return;
    fillAlgoPop();
    placePop($('pop-algo'), $('tb-algo'));
  });
  $('tb-aspect').addEventListener('click', () => {
    const open = $('pop-aspect').hidden;
    closePops();
    if (!open) return;
    fillAspectPop();
    placePop($('pop-aspect'), $('tb-aspect'));
  });
  $('tb-export').addEventListener('click', () => {
    const open = $('pop-export').hidden;
    closePops();
    if (!open) return;
    fillExportPop();
    placePop($('pop-export'), $('tb-export'));
  });
  $('tb-fit').addEventListener('click', fitView);
  $('tb-save').addEventListener('click', saveBoard);
  $('tb-repack').addEventListener('click', repack);
  $('tb-min').addEventListener('click', () => { $('toolbar').hidden = true; $('blister').hidden = false; });
  $('blister').addEventListener('click', () => { $('toolbar').hidden = false; $('blister').hidden = true; });
  $('nest').addEventListener('click', (e) => {
    const b = e.target.closest('[data-nest]');
    if (b) setNest(b.dataset.nest);
  });
  $('src-open').addEventListener('click', () => $('file').click());
  $('src-sample').addEventListener('click', () => { loadSample().catch((err) => toast(err.message)); });
  $('empty-browse').addEventListener('click', () => $('file').click());
  $('empty').addEventListener('click', (e) => { if (e.target === $('empty')) $('file').click(); });
  $('file').addEventListener('change', () => {
    const file = $('file').files && $('file').files[0];
    $('file').value = '';
    if (file) openFile(file);
  });
  $('name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('name-input').blur(); }
    if (e.key === 'Escape') {
      e.preventDefault();
      nameEdit = null;
      $('name-input').hidden = true;
      requestDraw();
    }
    e.stopPropagation();
  });
  $('name-input').addEventListener('blur', () => {
    if (!nameEdit) return;
    if (nameEdit.title) {
      const value = $('name-input').value.trim();
      $('name-input').hidden = true;
      nameEdit = null;
      if (value && value !== title) { pushUndo(); title = value; persist(); }
      requestDraw();
      return;
    }
    commitName();
  });

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  function cancelDrag() {
    if (drag?.before) restoreSnap(drag.before);
    drag = null; liveTiles = null; anim = null;
    canvas.style.cursor = 'default'; syncChrome(); requestDraw();
  }
  canvas.addEventListener('pointercancel', cancelDrag);
  canvas.addEventListener('dblclick', (e) => {
    if (!model) return;
    const p = point(e);
    const w = s2w(p.x, p.y);
    const callout=leaderAt(p.x,p.y);
    const tile = callout ? settled().tiles.find(t=>t.id===callout.id) : pickTile(settled().tiles, w.x, w.y);
    if (tile) {
      selected = new Set([tile.id]);
      syncChrome();
      openName(tile.id, inBox(areaHits.get(tile.id), p.x, p.y));
    } else if (inBox(chrome.title, p.x, p.y)) openTitle();
  });
  window.addEventListener('contextmenu', (e) => {
    if (e.target.closest?.('.board-data-dashboard, .board-data-tags-menu')) return;
    e.preventDefault(); e.stopPropagation();
  }, true);
  document.addEventListener('mousedown', (e) => {
    if (e.target.closest?.('.board-data-dashboard, .board-data-tags-menu')) return;
    if (e.target.closest?.('button')) e.preventDefault();
  });
  canvas.addEventListener('wheel', (e) => {
    if (!model) return;
    e.preventDefault();
    const p = point(e);
    const w = s2w(p.x, p.y);
    const factor = Math.exp(-e.deltaY * 0.0012);
    const frame = frameNow();
    const minZ = Math.min(viewW, viewH) * 0.02 / Math.max(frame.w, frame.h, 1);
    camera.z = Math.max(minZ, Math.min(48, camera.z * factor));
    camera.x = w.x - (p.x - viewW / 2) / camera.z;
    camera.y = w.y - (p.y - viewH / 2) / camera.z;
    requestDraw();
  }, { passive: false });

  window.addEventListener('keydown', onKey);
  window.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 's') return;
    event.preventDefault(); event.stopPropagation(); saveBoard();
  }, true);
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') space = false; });
  window.addEventListener('resize', () => { resize(); fitView(); requestDraw(); });
  window.addEventListener('pointerdown', (e) => {
    if (e.target.closest('#pop-algo, #pop-aspect, #pop-export, #menu, #tb-algo, #tb-aspect, #tb-export, #src-data, .board-data-dashboard, .board-data-tags-menu')) return;
    closePops();
  });
  window.addEventListener('dragover', (e) => { e.preventDefault(); $('src').classList.add('drop'); $('empty').classList.add('drop'); });
  window.addEventListener('dragleave', () => { $('src').classList.remove('drop'); $('empty').classList.remove('drop'); });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    $('src').classList.remove('drop');
    $('empty').classList.remove('drop');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) openFile(file);
  });

  fresh = new URLSearchParams(location.search).has('fresh');
  wireDataDashboard();
  resize();
  if (errors.length) toast('Packing check failed: ' + errors[0]);
  const handoff = window.ProgramModeState && window.ProgramModeState.read();
  let saved = handoff;
  if (!saved && !fresh) { try { saved = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (err) { /* use the shared seed */ } }
  if (saved?.board) {
    try { fresh = fresh || !!saved.ephemeral; applyShared(saved); }
    catch (err) { toast('Could not restore the shared program: ' + err.message); $('empty').hidden = false; }
  } else loadSample().catch(() => { $('empty').hidden = false; syncStatus(); });
  window.__pack = {
    get model() { return model; }, get camera() { return camera; }, get view() { return sharedState()?.view || {}; },
    get modeState() { return sharedState(); }, get leaders() { return leaders; },
    get dataDashboard() { return dataDashboard; },
    flushEdits, persist, openCsv, openFile, serialize, applyShared, settled, csv, undo, redo,
    get selected() { return [...selected]; }, select(ids) { selected = new Set(Array.isArray(ids) ? ids : [ids]); syncChrome(); requestDraw(); },
  };
  window.addEventListener('beforeunload', flushEdits);
  window.addEventListener('storage', event => {
    if (fresh || event.key !== STORE || !event.newValue) return;
    let next; try { next = JSON.parse(event.newValue); } catch (err) { return; }
    if (!next?.board) return;
    if (drag || nameEdit || typing() || dataDashboard?.hasPendingEdits()) {
      incomingPending = next;
      if (dataDashboard?.hasPendingEdits()) queueSharedPersist();
      return;
    }
    const keep = [...selected]; applyShared(next); selected = new Set(keep.filter(id => sticky(id) && kept(sticky(id)))); syncChrome(); requestDraw();
  });
})();
