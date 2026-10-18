'use strict';

// Program board UI. Stickies are painted on one canvas; every floating
// surface is a stack of thin DOM capsules, rebuilt only when the selection or
// the column set changes. Model, packing, and physics live in engine.js.

(function () {
  const engine = window.ProgramBoard;
  const KEY = 'program-board-v4';
  // Boards saved before lines, texts, fudge, and the buffer still open.
  const LEGACY_KEYS = ['program-board-v3'];
  // Written into each saved zip's manifest.
  const APP_VERSION = 'program-board 2026.10.13';
  const PARAMS = new URLSearchParams(location.search);
  // ?fresh and ?perf are throwaway sessions: they never overwrite the saved board.
  const EPHEMERAL = PARAMS.has('fresh') || PARAMS.has('perf');

  const STICKY = engine.STICKY_FILL;
  const SWATCHES = [STICKY, '#e9e5de', '#cbc4b8', '#d2d8cf', '#d3dae1', '#e5d6c8', '#d8ccd3'];
  const BACKGROUNDS = ['#ffffff', '#f6f5f2', '#ebe9e4', '#e8ecf0', '#1b1e22'];
  const FRAME_FILL = engine.FRAME_FILL;
  // Picked colors join their row's swatches, newest last, oldest out.
  const CUSTOM_CAP = 6;
  const FRAME_COLORS = [FRAME_FILL, '#faf9f6', '#f3f1ec', '#eef1f4', '#2a2d33'];
  // Text ink: AUTO (no override, ink that follows the fill) then presets.
  const AUTO = 'auto';
  const TEXT_INKS = [AUTO, '#2a2926', '#6c675f', '#ffffff', '#1f6fb2', '#0f8f82', '#b0453a'];
  const GRID_STOPS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 75, 100];
  const GRID_EVERY = [2, 5, 10, 20, 50, 100, 200, 500, 1000];
  const FACES = {
    std: { label: 'Std', title: 'Replica Std', css: "'Replica Std', 'Replica', 'ReplicaStd', 'PB Replica', 'Segoe UI', sans-serif" },
    mono: { label: 'Mono', title: 'Replica Mono', css: "'Replica Mono', 'ReplicaMono', 'PB Replica Mono', ui-monospace, Consolas, monospace" },
    sans: { label: 'Sans', title: 'System sans', css: "system-ui, 'Segoe UI', sans-serif" },
  };

  const SELECT = '#0f8f82';
  const GROUP_SELECTED = 'rgba(15, 143, 130, 0.5)';
  const GROUP_HOVER = 'rgba(27, 30, 34, 0.22)';
  const HAIRLINE = 'rgba(50, 42, 32, 0.2)';
  const INK = '#2a2926';
  const INK_SUB = '#6c675f';
  const INK_LIGHT = '#f4f2ee';
  const INK_LIGHT_SUB = 'rgba(244, 242, 238, 0.72)';

  // Frame chrome, in world feet like Slate's units: an unboxed title just
  // outside the upper-left corner, and dimension stringers below and right.
  const FRAME_RADIUS = engine.FRAME_RADIUS;
  const FRAME_EDGE = 'rgba(27, 30, 34, 0.13)';
  const TITLE_INK = '#878e96';
  const TITLE_SIZE = 12;
  const TITLE_IN = 2;
  const TITLE_UP = 6;
  const DIM_INK = '#1f6fb2';
  const DIM_INK_DARK = '#7fb2e0';
  const DIM_OFFSET = 24;
  const DIM_FROM = 4;
  const DIM_PAST = 5;
  const DIM_TICK = 4;
  const DIM_BREAK = 5;
  const DIM_TEXT = 12;
  const DIM_LINE = 0.7;
  // Chrome is drawn at world size with no floor; only its hit targets keep
  // this many screen pixels, centred on the label.
  const CHROME_MIN_HIT = 16;
  // Slate's glyphs: a thin datum line plus two bars (distribute: two datums
  // and the bar spaced between them). 14 px, drawn in currentColor.
  const ALIGN = [
    { mode: 'left', label: 'Align left', line: 'M1.5 1v12', bars: 'M3.5 3h8v3h-8zM3.5 8h5v3h-5z' },
    { mode: 'hcenter', label: 'Align centers', line: 'M7 1v12', bars: 'M2.5 3h9v3h-9zM4.5 8h5v3h-5z' },
    { mode: 'right', label: 'Align right', line: 'M12.5 1v12', bars: 'M2.5 3h8v3h-8zM5.5 8h5v3h-5z' },
    null,
    { mode: 'top', label: 'Align top', line: 'M1 1.5h12', bars: 'M3 3.5h3v8H3zM8 3.5h3v5H8z' },
    { mode: 'vmiddle', label: 'Align middles', line: 'M1 7h12', bars: 'M3 2.5h3v9H3zM8 4.5h3v5H8z' },
    { mode: 'bottom', label: 'Align bottom', line: 'M1 12.5h12', bars: 'M3 2.5h3v8H3zM8 5.5h3v5H8z' },
    null,
    { mode: 'hdist', label: 'Distribute horizontally', line: 'M1.5 1v12M12.5 1v12', bars: 'M5.5 3.5h3v7h-3z' },
    { mode: 'vdist', label: 'Distribute vertically', line: 'M1 1.5h12M1 12.5h12', bars: 'M3.5 5.5h7v3h-7z' },
    null,
    { mode: 'areaasc', label: 'Sort by area, small to large', line: 'M1 12.5h12', bars: 'M2 9h2v2H2zM6 6h2v5H6zM10 2h2v9h-2z' },
    { mode: 'areadesc', label: 'Sort by area, large to small', line: 'M1 12.5h12', bars: 'M2 2h2v9H2zM6 6h2v5H6zM10 9h2v2h-2z' },
  ];

  // Text is measured once at REF px and drawn through a scaling transform, so
  // zooming never re-measures. Sticky label geometry is engine.LABEL.
  const REF = engine.LABEL.REF;
  const AREA = engine.LABEL.AREA;

  // The fillet grip is a handle, the same screen-sized square as the resize
  // handles. It rides the top edge at the radius from the NW corner, never
  // nearer than Slate's minimum inset (FILLET_GRIP_MIN_INSET_WORLD, 10 units
  // at Slate's 100% zoom, read here as 10 screen px). It shows only on a
  // sticky wide and tall enough that, at that inset, it clears the corner
  // and midpoint handles.
  const HANDLE_PX = 7;
  const FILLET_INSET_PX = 10;
  const FILLET_MIN_SIDE_PX = 2 * (FILLET_INSET_PX + HANDLE_PX) + 6;
  const GRIP_HOT = 'rgb(210, 230, 255)';
  // Slate's resize bands: corners within this many screen px, edges along
  // their whole length within the band.
  const CORNER_HIT_PX = 9;
  const EDGE_BAND_PX = 6;
  // Lines and text, as Slate draws them (line.md, text.md).
  const LINE_PICK_PX = 4;
  const LINE_GRIP_PX = 6;
  const TEXT_LEAD = 1.2;
  const STYLE_MAX = { stroke: 8, shadow: 30, radius: 60 };
  const STYLE_STEP = { stroke: 0.25, shadow: 0.5, radius: 0.5 };
  // A soft shadow of size S falls 0.4 S down, blurs by S, at this opacity.
  const SHADOW_DROP = 0.4;
  const SHADOW_ALPHA = 0.22;
  const BUFFER_MAX = 10;
  const MAX_ZOOM = 60;
  // Zoomed all the way out, the frame may shrink to this share of the
  // viewport's shorter side.
  const MIN_SCENE = 0.02;
  const DRAG_SLOP = 4;
  const EDGE = 8;
  const EXPORT_PAD = 24;
  const EXPORT_PX = 4096;
  const EXPORT_LINE = 2;
  // The PNG is drawn at PNG_SCALE x EXPORT_PX on the long side, in tiles no
  // canvas limit can refuse. The single-canvas fallback stays under the
  // strictest limits (16384 px a side; area well below 268 MP).
  const PNG_SCALE = 3;
  const PNG_TILE = 4096;
  const PNG_BAND = 1024;
  const PNG_MAX_SIDE = 16384;
  const PNG_SAFE_AREA = 64 * 1024 * 1024;
  const SVG_PX = 2048;
  const BUNDLE_FRAMES = 420;
  const BUNDLE_PULL = 0.1;
  const BUNDLE_EASE_IN = 18;
  const BUNDLE_SCREEN_PUSH = 9;
  const RESIZE_CURSORS = {
    n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
    ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
  };

  const $ = (id) => document.getElementById(id);
  const canvas = $('board');
  const ctx = canvas.getContext('2d', { alpha: false });
  const measure = document.createElement('canvas').getContext('2d');
  const srcEl = $('src');
  const srcName = $('src-name');
  const statusEl = $('status');
  const toastEl = $('toast');
  const toolbarEl = $('toolbar');
  const blisterEl = $('blister');
  const gridBtn = $('tb-grid');
  const exportBtn = $('tb-export');
  const gridPop = $('pop-grid');
  const exportPop = $('pop-export');
  const gridOn = $('grid-on');
  const gridOff = $('grid-off');
  let gridSlide = null; // the grid popover's slideControl
  const menuEl = $('menu');
  const dataEl = $('data');
  const fileInput = $('file');
  const saveBtn = $('tb-save');
  const alignEl = $('align');
  const alignTip = $('align-tip');
  const dimInput = $('dim-input');
  const titleInput = $('title-input');
  const textBox = $('text-input');
  const nameBox = $('name-input');
  const sfBox = $('sf-input');
  const sfUnit = $('sf-unit');
  const gridFudge = $('grid-fudge');
  const toolSegs = $('tools');
  const emptyEl = $('empty');

  let model = null;
  let liveList = null;
  let modelGen = 0; // the model object was replaced
  let textGen = 0; // some label text may have changed
  let selGen = 0; // the selection changed
  let colGen = 0; // a column was added from the metadata capsule
  // The page's embedded spreadsheet; blank on a published copy, which then
  // opens empty and waits for a drop.
  let seedText = '';
  let seedName = 'sample.csv';
  let camera = { x: 0, y: 0, z: 1 };
  let view = defaultView();
  let preparedColors = null;
  let viewW = 1;
  let viewH = 1;
  let dpr = 1;
  let selected = new Set();
  let selLines = new Set();
  let selTexts = new Set();
  let hoverGroup = null;
  let hoverSticky = null;
  let hoverBlob = null; // { key, value } under the pointer where nothing else is
  let hotGrip = false;
  let tool = 'select'; // 'select' | 'line' | 'text'
  // The line being drawn: { a, b, down, dragged, typed, lock } in feet.
  let draft = null;
  // The text being typed: { id (null when new), x, y, w, size }.
  let textEdit = null;
  // The sticky name being typed on the board: { id, raw, before, snap },
  // raw the cell as opened, snap the undo snapshot taken at the first change.
  let nameEdit = null;
  let namePlaced = '';
  // The area readout being typed on a sticky: { id, before } in whole sf.
  let areaEdit = null;
  let areaPlaced = '';
  let pointerWorld = null;
  let lastShift = false;
  // Modifier state from the latest pointer or key event, and where the
  // pointer last hovered, so a modifier alone can refresh the cursor.
  const mods = { shift: false, ctrl: false, alt: false };
  let hoverAt = null;
  let ghosting = false;
  let cadBusy = false;
  let cadScript = null;
  let pngBusy = false;
  const textLayouts = new Map();
  const shadowSprites = new Map();
  const strokeInks = new Map();
  let drag = null;
  let swallowClick = false;
  let spaceDown = false;
  let cursor = '';
  let settling = null; // engine.beginSettle state while the board comes to rest
  let lastJam = null;
  let maxPush = 8;
  let bundling = null;
  let raf = 0;
  let undoStack = [];
  let redoStack = [];
  let saveTimer = 0;
  let statusAt = 0;
  let statusTimer = 0;
  let statusText = '';
  let fontRef = '';
  let faceToken = 0;
  const widthCache = new Map();
  const labels = new Map();
  let leaderScene = { items: [], hidden: 0, hiddenIds: [] };
  const groupScratch = [];
  let pop = null; // the one open menu or popover: { el, anchor }
  let dataDashboard = null;
  let bookmarksPanel = null;
  let bookmarkTransition = null;
  let dataOpen = false;
  let dataKey = '';
  let dataIds = [];
  let dataW = 0;
  let dataH = 0;
  let dataX = NaN;
  let dataY = NaN;
  let areaInput = null;
  let areaReadout = null;
  let focusPlus = false;
  let editArmed = false;
  let pickerArmed = false;
  let frameSelected = false;
  let dimEdit = null; // 'w' | 'h' while a stringer label is an input
  let titleEditing = false;
  let alignKey = '';
  let alignShown = false;
  let alignX = NaN;
  let alignY = NaN;
  let fileHandle = null;
  let editGen = 0;
  let savedGen = 0;
  let savedFlash = 0;
  // Screen geometry of the frame chrome from the last paint, for hit tests.
  const chrome = {
    shown: false,
    title: { x: 0, y: 0, w: 0, h: 0 },
    w: { cx: 0, cy: 0, lw: 0, lh: 0, px: 0, text: '' },
    h: { cx: 0, cy: 0, lw: 0, lh: 0, px: 0, text: '' },
  };
  const dimWidths = new Map();

  // Ring buffers for ?perf: physics ms, paint ms, and the interval between
  // consecutive busy frames. Written in place, never allocated per frame.
  const PERF_N = 600;
  const perfStep = new Float32Array(PERF_N);
  const perfPaint = new Float32Array(PERF_N);
  const perfGap = new Float32Array(PERF_N);
  const perfBlob = new Float32Array(PERF_N);
  let perfCount = 0;
  let lastBusyAt = 0;

  // Category blobs: outlines cached per key + value (engine.blobCache).
  const BLOB_REBUILDS = 3;
  const BLOB_BUDGET_MS = 6;
  const BLOB_STEP = 0.05; // ft, the offset and stroke sliders' step
  const blobCache = engine.blobCache();
  let blobList = [];
  let blobMs = 0;
  let blobScope = 'one';
  const tints = new Map();

  function defaultView() {
    return {
      grid: false,
      gridStep: 10,
      background: '#ffffff',
      face: 'std',
      textScale: 1,
      textColor: null,
      leaderThreshold: 0,
      toolbarMin: false,
      lineWidth: engine.LINE_WIDTH,
      custom: { sticky: [], background: [], frame: [], blob: [], text: [], line: [] },
    };
  }

  const HEX = /^#[0-9a-f]{6}$/i;

  function normalizeView(src) {
    const out = defaultView();
    if (!src || typeof src !== 'object') return out;
    if (typeof src.grid === 'boolean') out.grid = src.grid;
    if (Number(src.gridStep) > 0) out.gridStep = Math.min(1000, Number(src.gridStep));
    if (HEX.test(src.background || '')) out.background = src.background.toLowerCase();
    if (FACES[src.face]) out.face = src.face;
    const ts = Number(src.textScale);
    if (ts > 0) out.textScale = Math.min(engine.TEXT_SCALE.MAX, Math.max(engine.TEXT_SCALE.MIN, ts));
    if (HEX.test(src.textColor || '')) out.textColor = src.textColor.toLowerCase();
    if (Number.isFinite(Number(src.leaderThreshold))) out.leaderThreshold = Math.max(0, Math.min(120, Number(src.leaderThreshold)));
    if (typeof src.toolbarMin === 'boolean') out.toolbarMin = src.toolbarMin;
    if (src.pack && typeof src.pack === 'object' && !Array.isArray(src.pack)) out.pack = JSON.parse(JSON.stringify(src.pack));
    if (src.mode === 'iso' || src.mode === 'board') out.mode = src.mode;
    if (['NW', 'NE', 'SE', 'SW'].includes(src.isoDirection)) out.isoDirection = src.isoDirection;
    if (src.isoCamera && typeof src.isoCamera === 'object' && !Array.isArray(src.isoCamera)) {
      out.isoCamera = {};
      for (const [key, value] of Object.entries(src.isoCamera)) {
        if (/^(x|y|z|zoom|panX|panY|cx|cy|scale|angle)$/.test(key) && Number.isFinite(value)) out.isoCamera[key] = value;
      }
      if (['NW', 'NE', 'SE', 'SW'].includes(src.isoCamera.direction)) out.isoCamera.direction = src.isoCamera.direction;
    }
    const lw = Number(src.lineWidth);
    if (lw > 0) out.lineWidth = Math.min(engine.LINE_MAX, Math.max(engine.LINE_MIN, lw));
    const custom = src.custom && typeof src.custom === 'object' ? src.custom : {};
    Object.keys(out.custom).forEach((kind) => {
      const list = Array.isArray(custom[kind]) ? custom[kind] : [];
      out.custom[kind] = list.filter((hex) => HEX.test(hex)).map((hex) => hex.toLowerCase()).slice(-CUSTOM_CAP);
    });
    return out;
  }

  // ---------------------------------------------------------------- helpers

  function fmt(n) {
    return Math.round(n).toLocaleString('en-US');
  }

  function fmtStep(n) {
    return String(Math.round(n * 100) / 100);
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function button(cls, text, onClick) {
    const node = el('button', cls, text);
    node.type = 'button';
    if (onClick) node.addEventListener('click', onClick);
    return node;
  }

  function toast(message) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      toastEl.hidden = true;
    }, 3600);
  }

  function typing(event) {
    const target = event.target;
    if (!target || !target.tagName) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function luma(hex) {
    const n = parseInt(String(hex).slice(1), 16);
    if (!Number.isFinite(n)) return 255;
    return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  }

  function isDark(hex) {
    return luma(hex) < 128;
  }

  function baseName() {
    return engine.baseName(model.fileName);
  }

  function xml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function save(name, blob) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  }

  // ----------------------------------------------------------------- camera

  function s2w(x, y) {
    return {
      x: (x - viewW * 0.5) / camera.z + camera.x,
      y: (y - viewH * 0.5) / camera.z + camera.y,
    };
  }

  // The frame with its title and stringers, or the stickies without one.
  function sceneBox() {
    const f = model.frame;
    if (!f) return engine.boundsOf(live());
    const top = TITLE_UP + TITLE_SIZE * 1.4;
    const side = DIM_OFFSET + DIM_TEXT * 1.4;
    return { x: f.x, y: f.y - top, w: f.w + side, h: f.h + top + side };
  }

  function minZoom() {
    const b = sceneBox();
    const side = Math.max(b.w, b.h);
    return side > 0 ? (MIN_SCENE * Math.min(viewW, viewH)) / side : 0.001;
  }

  function clampZoom(z) {
    return Math.min(MAX_ZOOM, Math.max(minZoom(), z));
  }

  function panBy(dx, dy) {
    camera.x -= dx / camera.z;
    camera.y -= dy / camera.z;
    persistSoon();
    kick();
  }

  function fit() {
    if (!model) return;
    const b = sceneBox();
    if (b.w < 1 || b.h < 1) return;
    const roomW = Math.max(viewW - 120, viewW * 0.6);
    const room = Math.min(roomW / b.w, Math.max(viewH - 150, viewH * 0.6) / b.h);
    camera = { x: b.x + b.w * 0.5, y: b.y + b.h * 0.5, z: clampZoom(room) };
    persistSoon();
    kick();
  }

  function resize() {
    finishBookmarkTransition(false);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    canvas.width = Math.max(1, Math.round(viewW * dpr));
    canvas.height = Math.max(1, Math.round(viewH * dpr));
    closePop();
    kick();
  }

  // -------------------------------------------------------------- selection

  function live() {
    if (!liveList) liveList = engine.alive(model);
    return liveList;
  }

  function touchList() {
    liveList = null;
  }

  // Stickies, lines, and texts select together; a new sticky selection
  // drops the others unless they are passed along.
  function setSelection(ids, lines, texts) {
    selected = new Set(ids);
    selLines = new Set(lines || []);
    selTexts = new Set(texts || []);
    if (selected.size || selLines.size || selTexts.size) frameSelected = false;
    selGen += 1;
  }

  function anySelected() {
    return selected.size > 0 || selLines.size > 0 || selTexts.size > 0;
  }

  function linesFor(ids) {
    return model.lines.filter((l) => ids.has(l.id));
  }

  function textsFor(ids) {
    return model.texts.filter((t) => ids.has(t.id));
  }

  function selectFrame(on) {
    if (on) setSelection([]);
    frameSelected = on;
    kick();
  }

  function stickiesFor(ids) {
    const want = ids instanceof Set ? ids : new Set(ids);
    return live().filter((s) => want.has(s.id));
  }

  function expanded() {
    return engine.expandToGroups(model, Array.from(selected));
  }

  function groupOf(id) {
    return engine.expandToGroups(model, [id]);
  }

  function bodyCount(list) {
    const groups = new Set();
    let loose = 0;
    for (let i = 0; i < list.length; i++) {
      if (list[i].group) groups.add(list[i].group);
      else loose += 1;
    }
    return loose + groups.size;
  }

  function sole() {
    if (selected.size !== 1) return null;
    return stickiesFor(selected)[0] || null;
  }

  function radiusOf(s) {
    return engine.capRadius(s.radius, s.w, s.h);
  }

  // Rounded corners are part of the shape: a click in the cut-away corner
  // misses. Collision stays rectangular.
  function insideRounded(s, wx, wy) {
    if (wx < s.x || wx > s.x + s.w || wy < s.y || wy > s.y + s.h) return false;
    const r = radiusOf(s);
    if (r <= 0) return true;
    const cx = Math.min(Math.max(wx, s.x + r), s.x + s.w - r);
    const cy = Math.min(Math.max(wy, s.y + r), s.y + s.h - r);
    return (wx - cx) * (wx - cx) + (wy - cy) * (wy - cy) <= r * r;
  }

  function hitSticky(wx, wy) {
    const list = live();
    for (let i = list.length - 1; i >= 0; i--) {
      if (insideRounded(list[i], wx, wy)) return list[i];
    }
    return null;
  }

  function segDistance(px, py, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - a[0]) * dx + (py - a[1]) * dy) / len2)) : 0;
    return Math.hypot(px - (a[0] + dx * t), py - (a[1] + dy * t));
  }

  // Slate's stroke-precise pick: on the stroke, with a few pixels of slop.
  function hitLine(wx, wy) {
    const slop = LINE_PICK_PX / camera.z;
    for (let i = model.lines.length - 1; i >= 0; i--) {
      const l = model.lines[i];
      for (let p = 0; p + 1 < l.points.length; p++) {
        if (segDistance(wx, wy, l.points[p], l.points[p + 1]) <= l.width * 0.5 + slop) return l;
      }
    }
    return null;
  }

  // Endpoint grips of the selected lines: { line, index } or null.
  function hitLineGrip(sx, sy) {
    if (!selLines.size) return null;
    const lines = linesFor(selLines);
    for (let i = lines.length - 1; i >= 0; i--) {
      const pts = lines[i].points;
      for (let k = 0; k < pts.length; k += pts.length - 1) {
        const q = toScreen(pts[k][0], pts[k][1]);
        if (Math.abs(sx - q.x) <= LINE_GRIP_PX && Math.abs(sy - q.y) <= LINE_GRIP_PX) return { line: lines[i], index: k };
      }
    }
    return null;
  }

  function hitText(wx, wy) {
    for (let i = model.texts.length - 1; i >= 0; i--) {
      const t = model.texts[i];
      if (textEdit && textEdit.id === t.id) continue;
      const lay = textLayout(t);
      if (wx >= t.x && wx <= t.x + lay.w && wy >= t.y && wy <= t.y + lay.h) return t;
    }
    return null;
  }

  // What the pointer is over, topmost first: text, sticky, then line.
  function pickAt(wx, wy) {
    const t = hitText(wx, wy);
    if (t) return { kind: 'text', item: t };
    const s = hitSticky(wx, wy);
    if (s) return { kind: 'sticky', item: s };
    const l = hitLine(wx, wy);
    if (l) return { kind: 'line', item: l };
    return null;
  }

  function toScreen(wx, wy) {
    return { x: (wx - camera.x) * camera.z + viewW * 0.5, y: (wy - camera.y) * camera.z + viewH * 0.5 };
  }

  function handlesFor(s) {
    const z = camera.z;
    const x = (s.x - camera.x) * z + viewW * 0.5;
    const y = (s.y - camera.y) * z + viewH * 0.5;
    const w = s.w * z;
    const h = s.h * z;
    return [
      { edge: 'nw', x: x, y: y, corner: true },
      { edge: 'ne', x: x + w, y: y, corner: true },
      { edge: 'se', x: x + w, y: y + h, corner: true },
      { edge: 'sw', x: x, y: y + h, corner: true },
      { edge: 'n', x: x + w * 0.5, y: y, corner: false },
      { edge: 'e', x: x + w, y: y + h * 0.5, corner: false },
      { edge: 's', x: x + w * 0.5, y: y + h, corner: false },
      { edge: 'w', x: x, y: y + h * 0.5, corner: false },
    ];
  }

  function showsHandles(s) {
    return !!s && s.w * camera.z >= 16 && s.h * camera.z >= 16;
  }

  // Corners win within their radius; each edge answers along its whole
  // length within the band, like Slate's resize bands.
  function hitHandle(sx, sy) {
    const s = sole();
    if (!showsHandles(s)) return null;
    const list = handlesFor(s);
    for (let i = 0; i < 4; i++) {
      if (Math.hypot(sx - list[i].x, sy - list[i].y) <= CORNER_HIT_PX) return { edge: list[i].edge, corner: true };
    }
    const x0 = list[0].x;
    const y0 = list[0].y;
    const x1 = list[2].x;
    const y1 = list[2].y;
    const inX = sx >= x0 && sx <= x1;
    const inY = sy >= y0 && sy <= y1;
    if (inX && Math.abs(sy - y0) <= EDGE_BAND_PX) return { edge: 'n', corner: false };
    if (inX && Math.abs(sy - y1) <= EDGE_BAND_PX) return { edge: 's', corner: false };
    if (inY && Math.abs(sx - x0) <= EDGE_BAND_PX) return { edge: 'w', corner: false };
    if (inY && Math.abs(sx - x1) <= EDGE_BAND_PX) return { edge: 'e', corner: false };
    return null;
  }

  // The sticky whose fillet grip shows: the sole selection, else the one
  // under the pointer.
  function filletTarget() {
    if ((drag && drag.kind !== 'fillet') || tool !== 'select') return null;
    const s = drag ? drag.s : sole() || (hoverSticky && !selected.size ? live().find((t) => t.id === hoverSticky) : null);
    return s && Math.min(s.w, s.h) * camera.z >= FILLET_MIN_SIDE_PX ? s : null;
  }

  // The grip's centre in feet: on the top edge, the radius in from the NW
  // corner, or the minimum inset while the radius is smaller.
  function filletGrip(s) {
    const r = radiusOf(s);
    return { x: s.x + Math.max(r, FILLET_INSET_PX / camera.z), y: s.y, half: HANDLE_PX / 2 };
  }

  // The grip's square plus half Slate's hit slop. It wins over the edge
  // band and the midpoint handle it may cover.
  function hitFillet(sx, sy) {
    const s = filletTarget();
    if (!s || drag) return null;
    const q = toScreen(filletGrip(s).x, s.y);
    const reach = HANDLE_PX / 2 + 4;
    return Math.abs(sx - q.x) <= reach && Math.abs(sy - q.y) <= reach ? s : null;
  }

  function hitTitle(sx, sy) {
    if (!chrome.shown || !model.frame || !model.frame.title) return false;
    const t = chrome.title;
    const hw = Math.max(t.w * 0.5 + 4, CHROME_MIN_HIT * 0.5);
    const hh = Math.max(t.h * 0.5 + 3, CHROME_MIN_HIT * 0.5);
    return Math.abs(sx - (t.x + t.w * 0.5)) <= hw && Math.abs(sy - (t.y + t.h * 0.5)) <= hh;
  }

  // Half-extents of a stringer label's hit box along and across its line.
  function dimReach(L) {
    return {
      along: Math.max(L.lw * 0.5 + 5, CHROME_MIN_HIT * 0.5),
      across: Math.max(L.lh * 0.5 + 4, CHROME_MIN_HIT * 0.5),
    };
  }

  // The stringer label under the pointer: 'w', 'h', or null.
  function hitDim(sx, sy) {
    if (!chrome.shown) return null;
    const w = chrome.w;
    const rw = dimReach(w);
    if (Math.abs(sx - w.cx) <= rw.along && Math.abs(sy - w.cy) <= rw.across) return 'w';
    const h = chrome.h;
    const rh = dimReach(h);
    if (Math.abs(sx - h.cx) <= rh.across && Math.abs(sy - h.cy) <= rh.along) return 'h';
    return null;
  }

  function insideFrame(wx, wy) {
    const f = model.frame;
    return !!f && wx >= f.x && wx <= f.x + f.w && wy >= f.y && wy <= f.y + f.h;
  }

  function innerWall() {
    return engine.frameInner(model.frame, engine.gapOf(model));
  }

  // Offset that keeps a box inside the frame's walls, per axis.
  function wallClamp(box, dx, dy) {
    const inner = innerWall();
    if (!inner) return { dx: dx, dy: dy };
    const lo = (a0, a1, d, min, max) => {
      if (a1 - a0 > max - min) return 0;
      return Math.min(max - a1, Math.max(min - a0, d));
    };
    return {
      dx: lo(box.x, box.x + box.w, dx, inner.x0, inner.x1),
      dy: lo(box.y, box.y + box.h, dy, inner.y0, inner.y1),
    };
  }

  function bringForward(ids) {
    const want = new Set(ids);
    const picked = [];
    const rest = [];
    for (let i = 0; i < model.stickies.length; i++) {
      const s = model.stickies[i];
      (want.has(s.id) ? picked : rest).push(s);
    }
    model.stickies = rest.concat(picked);
    touchList();
  }

  function clearDragFlags() {
    for (let i = 0; i < model.stickies.length; i++) {
      model.stickies[i].dragging = false;
      model.stickies[i].dragTarget = null;
    }
  }

  // What the user just placed stays exactly where it landed (on the grid, if
  // snapped) while its neighbours make room; it yields only if they cannot.
  // The board rests only once every pair keeps the buffer; a board that
  // cannot (too little room) says so instead of resting inside it.
  // `contain` lets a last bundle pull everything inside moved walls.
  function settle(held, contain) {
    settling = engine.beginSettle(model, held || [], {
      contain: !!contain,
      bundlePush: Math.max(2, BUNDLE_SCREEN_PUSH / camera.z),
    });
    kick();
  }

  function finishSettle() {
    lastJam = settling.jam;
    settling = null;
    if (lastJam) toast(jamText(lastJam));
    persistSoon();
  }

  function jamText(j) {
    const parts = [];
    if (j.outside) parts.push(j.outside + (j.outside === 1 ? ' space' : ' spaces') + ' outside the frame');
    if (j.pairs) parts.push(j.pairs + (j.pairs === 1 ? ' pair' : ' pairs') + ' closer than the buffer');
    if (j.lines) parts.push(j.lines + (j.lines === 1 ? ' space' : ' spaces') + ' pressed against a line');
    return 'Not enough room: ' + parts.join(', ') + '. Enlarge the frame or move a line.';
  }

  // A new press takes over from a settle still running: what it held is
  // free again, and the release starts a fresh one.
  function stopSettle() {
    if (!settling) return;
    settling = null;
    clearDragFlags();
  }

  // ------------------------------------------------------ model and history

  function modelChanged() {
    modelGen += 1;
    textGen += 1;
    labels.clear();
    touchList();
    dataDashboard?.refresh();
    bookmarksPanel?.refresh();
  }

  // The buffer is a whole number of grid steps, and fudging draws whole
  // cells only while the grid is on. The grid step, shown or not, also
  // decides whether a line collides at its centreline or its edges.
  // Returns whether any drawn size, the buffer, or the grid changed.
  function syncParams() {
    const gap = model.bufferMul * view.gridStep;
    const before = model.gap;
    const grid = model.grid;
    const changed = engine.setParams(model, gap, model.fudge && view.grid ? view.gridStep : 0, view.gridStep, view.grid);
    if (changed.length) textGen += 1;
    return changed.length > 0 || before !== gap || grid !== model.grid;
  }

  // After the buffer, fudge, or grid changes: everything relaxes to the new
  // spacing inside the walls.
  function applyParams() {
    touchList();
    if (syncParams()) {
      model.lineGen += 1;
      containFrame();
    }
    kick();
  }

  function install(next) {
    finishBookmarkTransition(false);
    dataDashboard?.close();
    bookmarksPanel?.close();
    closeData();
    endChromeEdits(false);
    cancelDraft();
    finishTextEdit(false);
    finishNameEdit(false);
    finishAreaEdit(false);
    if (!next.frame) engine.frameAround(next);
    model = next;
    syncParams();
    modelChanged();
    setSelection([]);
    frameSelected = false;
    fileHandle = null;
    editGen += 1;
    savedGen = editGen;
    hoverGroup = null;
    bundling = null;
    settling = null;
    lastJam = null;
    drag = null;
    syncChrome();
    kick();
  }

  function markDirty() {
    editGen += 1;
    syncChrome();
  }

  // Snapshots include the complete view and selection as well as the model,
  // so bookmarks and Undo restore the same board settings and viewport.
  function snapshot() {
    return JSON.stringify({ board: engine.capture(model), view, camera, selection: [...selected], selLines: [...selLines], selTexts: [...selTexts], tool });
  }

  function checkpoint() {
    pushUndo(snapshot());
  }

  // `snap` may be taken ahead of time (a rename snapshots at its first
  // keystroke and records only if it commits).
  function pushUndo(snap) {
    editGen += 1;
    if (undoStack.length && undoStack[undoStack.length - 1] === snap) return;
    undoStack.push(snap);
    if (undoStack.length > 80) undoStack.shift();
    redoStack.length = 0;
    syncChrome();
    persistSoon();
  }

  function restoreSnap(snap) {
    finishBookmarkTransition(false);
    const keep = Array.from(selected);
    const keepLines = Array.from(selLines);
    const keepTexts = Array.from(selTexts);
    endChromeEdits(false);
    cancelDraft();
    finishTextEdit(false);
    finishNameEdit(false);
    finishAreaEdit(false);
    clearDragFlags();
    drag = null;
    editGen += 1;
    const data = JSON.parse(snap);
    const faceWas = view.face;
    if (data.view) view = normalizeView(data.view);
    if (data.camera) camera = {...data.camera};
    if (data.grid !== undefined) view.grid = !!data.grid;
    view.gridStep = data.gridStep > 0 ? data.gridStep : view.gridStep;
    if (Number.isFinite(data.leaderThreshold)) view.leaderThreshold = Math.max(0, Math.min(120, data.leaderThreshold));
    else if (!data.view) view.leaderThreshold = 0;
    if (data.custom) view.custom = normalizeView({ custom: data.custom }).custom;
    if (data.text) {
      const tv = normalizeView({ face: data.text[0], textScale: data.text[1], textColor: data.text[2] });
      view.face = tv.face;
      view.textScale = tv.textScale;
      view.textColor = tv.textColor;
    }
    model = engine.restore(data.board);
    if (!model.frame) engine.frameAround(model);
    camera.z = clampZoom(camera.z);
    syncParams();
    modelChanged();
    syncSwatchRows();
    if (view.face !== faceWas) useFace(view.face);
    const lineIds = new Set(model.lines.map((l) => l.id));
    const textIds = new Set(model.texts.map((t) => t.id));
    setSelection(stickiesFor(data.selection || keep).map((s) => s.id), (data.selLines || keepLines).filter((id) => lineIds.has(id)), (data.selTexts || keepTexts).filter((id) => textIds.has(id)));
    if (data.tool) tool = data.tool;
    bundling = null;
    settling = null;
    syncChrome();
    persistSoon();
    kick();
  }

  // A name or area still being typed commits first, so Undo takes it back whole.
  function undo() {
    blurData();
    finishNameEdit(true);
    finishAreaEdit(true);
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    restoreSnap(undoStack.pop());
  }

  function redo() {
    blurData();
    finishNameEdit(true);
    finishAreaEdit(true);
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    restoreSnap(redoStack.pop());
  }

  function persistSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 400);
  }

  let sharedBase = null;
  let pendingShared = null;
  function sharedState() { return model ? {board:engine.capture(model),camera:{...camera},view:JSON.parse(JSON.stringify(view)),ephemeral:EPHEMERAL||undefined} : null; }
  function sharedBusy() { return !!(bookmarkTransition || drag || bundling || settling || nameEdit || areaEdit || textEdit || dimEdit || titleEditing || dataDashboard?.hasPendingEdits() || document.activeElement?.closest('input,textarea,[contenteditable]')); }
  function acceptShared(state) {
    finishBookmarkTransition(false);
    const keep=[...selected], keepLines=[...selLines], keepTexts=[...selTexts], oldFace=view.face, oldFile=model?.fileName;
    model=engine.restore(state.board);view=normalizeView(state.view);
    if(!model.frame && engine.alive(model).length)engine.frameAround(model);
    syncParams();modelChanged();
    const lineIds=new Set(model.lines.map(l=>l.id)),textIds=new Set(model.texts.map(t=>t.id));
    setSelection(keep.filter(id=>engine.alive(model).some(s=>s.id===id)),keepLines.filter(id=>lineIds.has(id)),keepTexts.filter(id=>textIds.has(id)));
    if(oldFile!==model.fileName)fileHandle=null;
    syncChrome();syncSwatchRows();if(view.face!==oldFace)useFace(view.face);kick();
  }
  function flushEdits() {
    if (dataDashboard?.commitActive() === false) throw new Error('Correct the highlighted table value before continuing.');
    blurData();finishNameEdit(true);finishAreaEdit(true);finishTextEdit(true);endChromeEdits(true);
    const active=document.activeElement;if(active && active!==document.body && typeof active.blur==='function')active.blur();
    finishBoardMotion();
    persist();return sharedState();
  }

  function finishBoardMotion() {
    finishBookmarkTransition(true);
    if (!model || (!bundling && !settling)) return;
    clearDragFlags();
    if (bundling?.kind === 'groups') {
      const bounds = engine.boundsOf(live());
      for (let i = 0; i < 850 && !bundling.state.done; i++) {
        window.ProgramGroupBundle.step(bundling.state, {pull: 0.18, maxPush: Math.max(9, Math.max(bounds.w, bounds.h) / 80)});
      }
    } else if (bundling) engine.bundle(model, bundling.ids);
    bundling = null;
    settling = null;
    const result = engine.settleNow(model);
    lastJam = result.jam;
    if (lastJam) toast(jamText(lastJam));
    kick();
  }

  function finishBookmarkTransition(repaint) {
    if (!bookmarkTransition) return;
    bookmarkTransition = null;
    touchList();
    labels.clear();
    persistSoon();
    if (repaint && model) draw();
    kick();
  }

  function presentedState() {
    const presentation = bookmarkTransition?.plan;
    return {board: engine.capture(presentation?.model || model), camera: {...(presentation?.camera || camera)}, view: {...view}};
  }

  function animateBookmark(from, surface) {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const board = engine.capture(model);
    board.bookmarks = [];
    const plan = window.ProgramBoardTransition.create(from, engine.restore(board), camera);
    plan.apply(0);
    bookmarkTransition = {plan, start: performance.now(), eased: 0,
      surface: plan.needsCrossfade || from.view.background !== view.background ? surface : null};
    kick();
  }

  function persist() {
    if (!model || EPHEMERAL) return;
    if(sharedBusy()) { persistSoon(); return; }
    try {
      let current=sharedState();
      const remote=pendingShared || window.ProgramModeState?.latest();
      if(remote && sharedBase && window.ProgramModeState?.reconcile && JSON.stringify(remote)!==JSON.stringify(sharedBase)) {
        current=window.ProgramModeState.reconcile(sharedBase,current,remote);
        current.camera={...camera};acceptShared(current);
      }
      pendingShared=null;sharedBase=sharedState();
      localStorage.setItem(KEY, JSON.stringify(sharedBase));
    } catch (err) {
      /* a full or blocked store must not stop the board */
    }
  }

  // ------------------------------------------------------------- typefaces

  // Canvas text follows the face at once; when the browser confirms the face
  // is ready, every cached measurement is dropped and re-taken.
  function useFace(face) {
    const token = ++faceToken;
    const css = FACES[face].css;
    document.documentElement.style.setProperty('--font', css);
    const apply = () => {
      if (token !== faceToken) return;
      fontRef = '400 ' + REF + 'px ' + css;
      measure.font = fontRef;
      boardKit = { face: face, font: fontRef, css: css, measure: measureCached };
      widthCache.clear();
      labels.clear();
      dimWidths.clear();
      textLayouts.clear();
      dataKey = '';
      kick();
    };
    apply();
    if (!document.fonts || !document.fonts.load) return;
    Promise.race([document.fonts.load('400 16px ' + css), new Promise((done) => setTimeout(done, 2500))])
      .then(apply, apply);
  }

  function setFace(face) {
    if (!FACES[face] || face === view.face) return;
    view.face = face;
    markDirty();
    persistSoon();
    useFace(face);
  }

  // The board's type defaults as one text item, so the canvas menu's Text
  // dropdown is the same textRows a sticky's is. Every sticky without its
  // own setting follows these.
  const boardText = {
    get textFace() { return view.face; },
    set textFace(v) { setFace(v || 'std'); },
    get textScale() { return view.textScale; },
    set textScale(v) { view.textScale = v || 1; boardTextChanged(); },
    get textColor() { return view.textColor; },
    set textColor(v) { view.textColor = v || null; boardTextChanged(); },
  };

  function boardTextChanged() {
    labels.clear();
    markDirty();
  }

  // An item's own face measures on its own context, cached per string, and
  // refits once the browser confirms the face is ready. The board's face
  // is boardKit (measureCached).
  let boardKit = null;
  const faceKits = new Map();

  function faceKit(face) {
    if (!FACES[face] || (boardKit && face === boardKit.face)) return boardKit;
    let kit = faceKits.get(face);
    if (kit) return kit;
    const c = document.createElement('canvas').getContext('2d');
    const widths = new Map();
    const css = FACES[face].css;
    kit = {
      face: face,
      font: '400 ' + REF + 'px ' + css,
      css: css,
      measure: (text) => {
        let w = widths.get(text);
        if (w == null) {
          if (widths.size > 4000) widths.clear();
          w = c.measureText(text).width;
          widths.set(text, w);
        }
        return w;
      },
    };
    c.font = kit.font;
    faceKits.set(face, kit);
    if (document.fonts && document.fonts.load) {
      document.fonts.load('400 16px ' + css).then(() => {
        c.font = kit.font;
        widths.clear();
        labels.clear();
        textLayouts.clear();
        kick();
      }, () => {});
    }
    return kit;
  }

  // ---------------------------------------------------------------- labels

  function textWidth(text) {
    return measure.measureText(text).width;
  }

  // Canvas widths at REF px, cached per string until the typeface changes.
  function measureCached(text) {
    let w = widthCache.get(text);
    if (w == null) {
      w = textWidth(text);
      if (widthCache.size > 8000) widthCache.clear();
      widthCache.set(text, w);
    }
    return w;
  }

  // Per-sticky label cache. The world-space fit is redone only when the
  // name, the sticky's size, its own face or scale, or the board's face
  // changes (a board face change clears the map); steady-state frames read
  // numbers from here and draw. `font` / `css` / `measure` are the face
  // the label is set in; `own` is the sticky's own ink, if any.
  function labelFor(s) {
    let e = labels.get(s.id);
    if (!e) {
      e = {
        gen: -1, name: '', w: -1, h: -1, areaText: '', fill: '', own: null, ink: INK, sub: INK_SUB,
        lines: null, f: 0, area: false, lineH: 0, y0: 0, areaY: 0,
        rawFace: -1, rawScale: -1, font: fontRef, css: '', measure: measureCached,
      };
      labels.set(s.id, e);
    }
    if (e.gen !== textGen || e.w !== s.w || e.h !== s.h || e.rawFace !== s.textFace || e.rawScale !== s.textScale) {
      if (e.gen !== textGen) {
        const value = model.rows[s.rowIndex].fields[model.nameKey];
        e.name = value == null ? '' : String(value).trim();
      }
      e.gen = textGen;
      e.w = s.w;
      e.h = s.h;
      e.rawFace = s.textFace;
      e.rawScale = s.textScale;
      const style = engine.textStyleOf(s, view);
      const kit = faceKit(style.face);
      e.font = kit.font;
      e.css = kit.css;
      e.measure = kit.measure;
      e.areaText = fmt(engine.trueArea(s)) + ' sf';
      const fit = engine.fitLabel(e.name, e.areaText, s.w, s.h, kit.measure, style.scale);
      e.lines = fit.lines;
      e.f = fit.f;
      e.area = fit.area;
      e.lineH = fit.lineH;
      e.y0 = fit.y0;
      e.areaY = fit.areaY;
    }
    const fill = stickyFill(s);
    const own = s.textColor || view.textColor || null;
    if (fill !== e.fill || own !== e.own) {
      const dark = isDark(fill);
      e.fill = fill;
      e.own = own;
      e.ink = own || (dark ? INK_LIGHT : INK);
      e.sub = own ? tint(own, 0.72) : dark ? INK_LIGHT_SUB : INK_SUB;
    }
    return e;
  }

  // --------------------------------------------------------------- drawing

  function leaderLayout(list, z, ox, oy, width, height, size, board) {
    if (!window.ProgramLeaders || !view.leaderThreshold) return { items: [], hidden: 0, hiddenIds: [] };
    const points = list.map((s) => {
      const e = labelFor(s);
      return { id: s.id, x: s.x * z + ox, y: s.y * z + oy, w: s.w * z, h: s.h * z, text: e.name, area: e.areaText, css: e.css, ink: e.own, sticky: s };
    });
    const result = window.ProgramLeaders.layout(points, { width: width, height: height }, {
      threshold: view.leaderThreshold * size, scale: size,
      frame: model.frame ? { x: model.frame.x * z + ox, y: model.frame.y * z + oy, w: model.frame.w * z, h: model.frame.h * z } : null,
      margin: 9 * size, top: 10 * size, bottom: 10 * size,
    });
    result.ids = new Set(result.items.map((e) => e.id));
    result.size = size;
    return result;
  }

  function paintLeaderLines(c, scene, scale, dx, dy) {
    if (!scene.items.length) return;
    const dark = isDark(view.background);
    c.save();
    c.setTransform(scale, 0, 0, scale, scale * (dx || 0), scale * (dy || 0));
    c.lineWidth = 0.75 * scene.size;
    c.strokeStyle = dark ? 'rgba(244,242,238,0.5)' : 'rgba(75,78,80,0.46)';
    c.lineJoin = 'round';
    c.beginPath();
    scene.items.forEach((e) => {
      c.moveTo(e.anchor.x, e.anchor.y);
      c.lineTo(e.elbow.x, e.elbow.y);
      c.lineTo(e.end.x, e.end.y);
    });
    c.stroke();
    c.restore();
  }

  function fitCalloutText(c, text, maxWidth) {
    if (c.measureText(text).width <= maxWidth) return text;
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (c.measureText(text.slice(0, mid) + '\u2026').width <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    return text.slice(0, lo).trimEnd() + '\u2026';
  }

  function paintLeaderLabels(c, scene, scale, dx, dy, board) {
    if (!scene.items.length && !scene.hidden) return;
    const size = scene.size || 1;
    const dark = isDark(view.background);
    c.save();
    c.setTransform(scale, 0, 0, scale, scale * (dx || 0), scale * (dy || 0));
    c.textBaseline = 'middle';
    scene.items.forEach((e) => {
      const b = e.label;
      // A small paper backing keeps type quiet over a nearby cell or line.
      c.globalAlpha = 0.94;
      c.fillStyle = view.background;
      c.fillRect(b.x - 4 * size, b.y - 2 * size, b.w + 8 * size, b.h + 4 * size);
      c.globalAlpha = 1;
      const selectedLabel = board && selected.has(e.id);
      c.fillStyle = selectedLabel ? SELECT : e.source.ink || (dark ? INK_LIGHT : INK);
      c.font = (11 * size) + 'px ' + e.source.css;
      c.textAlign = e.side === 'left' ? 'right' : 'left';
      const x = e.side === 'left' ? b.x + b.w : b.x;
      const typed = board && nameEdit && nameEdit.id === e.id;
      if (!typed) c.fillText(fitCalloutText(c, e.text, b.w), x, b.y + 6 * size);
      c.fillStyle = selectedLabel ? SELECT : dark ? INK_LIGHT_SUB : INK_SUB;
      c.font = (9 * size) + 'px ' + e.source.css;
      if (!(board && areaEdit && areaEdit.id === e.id)) c.fillText(e.source.area, x, b.y + 18 * size);
    });
    if (board && scene.hidden) {
      c.font = '10px ' + FACES[view.face].css;
      c.fillStyle = dark ? INK_LIGHT_SUB : INK_SUB;
      c.textAlign = 'right';
      c.fillText('+' + scene.hidden + ' callouts \u00b7 zoom in to separate', viewW - 20, viewH - 44);
    }
    c.restore();
  }

  function hitLeader(sx, sy) {
    const e = leaderScene.items.find((e) => sx >= e.label.x - 4 && sx <= e.label.x + e.label.w + 4 && sy >= e.label.y - 3 && sy <= e.label.y + e.label.h + 3);
    return e ? { kind: 'sticky', item: e.source.sticky } : null;
  }

  function offscreen(s, z, ox, oy, margin) {
    const x = s.x * z + ox;
    const y = s.y * z + oy;
    return x > viewW + margin || y > viewH + margin || x + s.w * z < -margin || y + s.h * z < -margin;
  }

  // One routine for the board and the PNG. World units map to device pixels
  // by `scale * (world * z + o)`. Labels are the cached world-space fit drawn
  // through the current transform: never floored, never culled for size, and
  // always inside their own sticky. `cull` skips stickies wholly off screen
  // (the board, not the PNG).
  function paintStickies(c, list, scale, z, ox, oy, linePx, cull, leaders) {
    const k = scale * z;
    const tx = scale * ox;
    const ty = scale * oy;
    const px = linePx / z;
    // Shadows first, all of them, so no shadow falls across a neighbour.
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!(s.shadow > 0)) continue;
      if (cull && offscreen(s, z, ox, oy, s.shadow * 3)) continue;
      paintShadow(c, s, k, tx, ty, cull && ghosting && s.dragging ? 0.5 : 1);
    }
    c.setTransform(k, 0, 0, k, tx, ty);
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (cull && offscreen(s, z, ox, oy, 0)) continue;
      const faded = cull && ghosting && s.dragging;
      if (faded) c.globalAlpha = 0.5;
      const fill = stickyFill(s);
      const r = radiusOf(s);
      c.fillStyle = fill;
      if (r > 0) {
        c.beginPath();
        c.roundRect(s.x, s.y, s.w, s.h, r);
        c.fill();
      } else {
        c.fillRect(s.x, s.y, s.w, s.h);
      }
      paintModules(c, s, z, r);
      // A stroke is drawn inside the edge, so the box never grows.
      const sw = s.stroke > 0 ? Math.min(s.stroke, Math.min(s.w, s.h) * 0.5) : px;
      c.lineWidth = sw;
      c.strokeStyle = s.stroke > 0 ? strokeInk(fill) : HAIRLINE;
      const half = sw * 0.5;
      if (r > 0) {
        c.beginPath();
        c.roundRect(s.x + half, s.y + half, Math.max(0, s.w - sw), Math.max(0, s.h - sw), Math.max(0, r - half));
        c.stroke();
      } else {
        c.strokeRect(s.x + half, s.y + half, Math.max(0, s.w - sw), Math.max(0, s.h - sw));
      }
      if (faded) c.globalAlpha = 1;
    }
    let font = fontRef;
    c.font = font;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (cull && offscreen(s, z, ox, oy, 0)) continue;
      if (leaders && leaders.ids && leaders.ids.has(s.id)) continue;
      const e = labelFor(s);
      if (e.font !== font) {
        font = e.font;
        c.font = font;
      }
      paintLabel(c, s, e, k, tx, ty);
    }
  }

  function paintModules(c, sticky, z, radius) {
    const layout = engine.moduleLayout(model, sticky);
    if (!layout?.lines.length) return;
    c.save();
    c.beginPath();
    c.roundRect(sticky.x, sticky.y, sticky.w, sticky.h, radius);
    c.clip();
    c.lineWidth = 0.65 / z;
    c.strokeStyle = isDark(stickyFill(sticky)) ? 'rgba(255,255,255,0.25)' : 'rgba(50,42,32,0.22)';
    c.beginPath();
    layout.lines.forEach(line => {
      c.moveTo(sticky.x + line.x1, sticky.y + line.y1);
      c.lineTo(sticky.x + line.x2, sticky.y + line.y2);
    });
    c.stroke();
    c.restore();
  }

  // The fill, darkened: a stroke reads as the sticky's own edge.
  function strokeInk(hex) {
    let ink = strokeInks.get(hex);
    if (!ink) {
      const n = parseInt(hex.slice(1), 16);
      const f = isDark(hex) ? 1.6 : 0.62;
      const ch = (v) => Math.max(0, Math.min(255, Math.round(v * f + (f > 1 ? 24 : 0))));
      ink = 'rgb(' + ch((n >> 16) & 255) + ',' + ch((n >> 8) & 255) + ',' + ch(n & 255) + ')';
      strokeInks.set(hex, ink);
    }
    return ink;
  }

  // A blurred square, rendered once per blur size and drawn nine-sliced
  // around each sticky, so no frame ever pays for a canvas shadowBlur.
  // Sprites stop at SPRITE_MAX px of blur; larger blurs scale a sprite.
  const SPRITE_MAX = 96;

  function shadowSprite(q) {
    let sp = shadowSprites.get(q);
    if (sp) return sp;
    const pad = Math.ceil(q * 1.5) + 2;
    const core = pad * 2 + 2;
    const size = core + pad * 2;
    const cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    const g = cv.getContext('2d');
    g.shadowColor = '#000000';
    g.shadowBlur = q;
    g.shadowOffsetX = size * 2;
    g.fillStyle = '#000000';
    g.fillRect(pad - size * 2, pad, core, core);
    sp = { cv: cv, pad: pad, cut: pad * 2, size: size };
    shadowSprites.set(q, sp);
    return sp;
  }

  function paintShadow(c, s, k, tx, ty, alpha) {
    const blur = s.shadow * k;
    if (blur < 0.5) return;
    const q = Math.max(1, Math.min(SPRITE_MAX, Math.round(blur)));
    const sp = shadowSprite(q);
    const f = blur / q;
    const pad = sp.pad * f;
    const cut = sp.cut * f;
    const x = tx + s.x * k - pad;
    const y = ty + (s.y + s.shadow * SHADOW_DROP) * k - pad;
    const w = s.w * k + pad * 2;
    const h = s.h * k + pad * 2;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = SHADOW_ALPHA * alpha;
    if (w < cut * 2 || h < cut * 2) {
      c.drawImage(sp.cv, x, y, w, h);
    } else {
      const S = sp.size;
      const C = sp.cut;
      const M = S - C * 2;
      const mw = w - cut * 2;
      const mh = h - cut * 2;
      c.drawImage(sp.cv, 0, 0, C, C, x, y, cut, cut);
      c.drawImage(sp.cv, C, 0, M, C, x + cut, y, mw, cut);
      c.drawImage(sp.cv, S - C, 0, C, C, x + w - cut, y, cut, cut);
      c.drawImage(sp.cv, 0, C, C, M, x, y + cut, cut, mh);
      c.drawImage(sp.cv, S - C, C, C, M, x + w - cut, y + cut, cut, mh);
      c.drawImage(sp.cv, 0, S - C, C, C, x, y + h - cut, cut, cut);
      c.drawImage(sp.cv, C, S - C, M, C, x + cut, y + h - cut, mw, cut);
      c.drawImage(sp.cv, S - C, S - C, C, C, x + w - cut, y + h - cut, cut, cut);
      c.drawImage(sp.cv, C, C, M, M, x + cut, y + cut, mw, mh);
    }
    c.globalAlpha = 1;
  }

  function paintLabel(c, s, e, k, tx, ty) {
    const lines = e.lines;
    if (!lines.length) return;
    const cx = tx + (s.x + s.w * 0.5) * k;
    const cy = ty + (s.y + s.h * 0.5) * k;
    const sc = (k * e.f) / REF;
    c.fillStyle = e.ink;
    // A name or area being typed shows in its editor on the board, not twice.
    const typed = c === ctx && nameEdit && nameEdit.id === s.id;
    for (let i = 0; i < lines.length && !typed; i++) {
      c.setTransform(sc, 0, 0, sc, cx, cy + (e.y0 + i * e.lineH) * k);
      c.fillText(lines[i], 0, 0);
    }
    if (!e.area || (c === ctx && areaEdit && areaEdit.id === s.id)) return;
    const sa = sc * AREA;
    c.fillStyle = e.sub;
    c.setTransform(sa, 0, 0, sa, cx, cy + e.areaY * k);
    c.fillText(e.areaText, 0, 0);
  }

  function draw() {
    if (!bookmarkTransition) { drawScene(); return; }
    const transition = bookmarkTransition;
    const canonical = {model, camera, list: liveList};
    model = transition.plan.model;
    camera = transition.plan.camera;
    liveList = engine.alive(model);
    try {
      drawScene();
      if (transition.surface) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1 - transition.eased;
        ctx.drawImage(transition.surface, 0, 0);
        ctx.restore();
      }
    } finally {
      model = canonical.model;
      camera = canonical.camera;
      liveList = canonical.list;
    }
  }

  function drawScene() {
    preparedColors = window.ProgramAppearance.prepare(model);
    const z = camera.z;
    const ox = viewW * 0.5 - camera.x * z;
    const oy = viewH * 0.5 - camera.y * z;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = view.background;
    ctx.fillRect(0, 0, viewW, viewH);
    paintFrame(ctx, dpr, z, ox, oy, 1, true);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (view.grid) drawGrid(z, ox, oy);
    paintBlobs(ctx, syncBlobs(), dpr, z, ox, oy);
    const list = live();
    leaderScene = leaderLayout(list, z, ox, oy, viewW, viewH, 1, true);
    paintLines(ctx, model.lines, dpr, z, ox, oy);
    paintLeaderLines(ctx, leaderScene, dpr);
    paintStickies(ctx, list, dpr, z, ox, oy, 1, true, leaderScene);
    paintTexts(ctx, dpr, z, ox, oy);
    paintLeaderLabels(ctx, leaderScene, dpr, 0, 0, true);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawFrameChrome(z, ox, oy);
    drawGroups(list, z, ox, oy);
    drawSelection(list, z, ox, oy);
    if (drag && drag.kind === 'marquee' && drag.moved) drawMarquee();
    drawHandles();
    drawFillet();
    drawLineGrips();
    drawDraft(z, ox, oy);
    drawTextGhost(z, ox, oy);
  }

  function inkFor(fillHex) {
    return isDark(fillHex) ? INK_LIGHT : INK;
  }

  // Outlines rebuild when a member moves. While anything is moving they
  // rebuild every frame, at most BLOB_REBUILDS at a time and none past the
  // first once BLOB_BUDGET_MS is spent (the longest-waiting first), and a
  // frame that left one stale asks for the next.
  function syncBlobs() {
    if (!model.blobs || !model.blobs.on.length) {
      blobList = [];
      blobMs = 0;
      return blobList;
    }
    const moving = !!bookmarkTransition || !!(drag && drag.moved) || !!settling || !!bundling;
    const t0 = performance.now();
    blobList = moving ? blobCache.update(model, BLOB_REBUILDS, BLOB_BUDGET_MS) : blobCache.update(model);
    blobMs = performance.now() - t0;
    if (blobCache.stale) kick();
    return blobList;
  }

  function blobPath(e) {
    if (e.pathV === e.version) return e.path;
    const path = new Path2D();
    const loops = e.shape.loops;
    // Lines and true arcs, so the outline stays crisp at any zoom.
    if (window.ProgramBoardBlob) window.ProgramBoardBlob.trace(loops, path);
    else {
      for (let i = 0; i < loops.length; i++) {
        const pts = loops[i].points;
        path.moveTo(pts[0][0], pts[0][1]);
        for (let p = 1; p < pts.length; p++) path.lineTo(pts[p][0], pts[p][1]);
        path.closePath();
      }
    }
    e.path = path;
    e.pathV = e.version;
    return path;
  }

  function tint(hex, alpha) {
    const key = hex + alpha;
    let css = tints.get(key);
    if (!css) {
      const n = parseInt(hex.slice(1), 16);
      css = 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + Math.round(alpha * 1000) / 1000 + ')';
      tints.set(key, css);
    }
    return css;
  }

  function blobEdgeAlpha(alpha) {
    return Math.min(0.9, alpha * 3 + 0.15);
  }

  // The title sits just above the outline's top-left, like a Grasshopper
  // group's name.
  function blobLabelPos(e) {
    const at = e.shape.label;
    return { x: at.x + engine.BLOB_LABEL * 0.4, y: at.y - engine.BLOB_LABEL * 0.3 };
  }

  // Every shown title's baseline start, in draw order. A title that would
  // overprint an earlier one steps right past it. Shared by the board, the
  // PNG, and the SVG. [{ e, x, y }].
  function blobLabels(list) {
    const size = engine.BLOB_LABEL;
    const k = size / REF;
    const placed = [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.style.label || !e.shape.label) continue;
      const at = blobLabelPos(e);
      const w = measureCached(e.value) * k;
      let x = at.x;
      for (let pass = 0; pass < placed.length; pass++) {
        const hit = placed.find((p) => x < p.x + p.w + size * 0.5 && x + w > p.x - size * 0.5 && Math.abs(at.y - p.y) < size * 1.1);
        if (!hit) break;
        x = hit.x + hit.w + size * 0.6;
      }
      placed.push({ e: e, x: x, y: at.y, w: w });
    }
    return placed;
  }

  // Beneath lines and stickies: a translucent fill, an outline in the same
  // hue, and the value as a title, all at world size. Shared by the board
  // and the PNG.
  function paintBlobs(c, list, scale, z, ox, oy) {
    if (!list.length) return;
    const k = scale * z;
    const tx = scale * ox;
    const ty = scale * oy;
    c.setTransform(k, 0, 0, k, tx, ty);
    c.lineJoin = 'round';
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.shape.loops.length) continue;
      const path = blobPath(e);
      c.fillStyle = tint(e.style.color, e.style.alpha);
      c.fill(path, 'evenodd');
      if (!(e.style.stroke > 0)) continue;
      c.lineWidth = e.style.stroke;
      c.strokeStyle = tint(e.style.color, blobEdgeAlpha(e.style.alpha));
      c.stroke(path);
    }
    c.lineJoin = 'miter';
    c.font = fontRef;
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    const sc = (k * engine.BLOB_LABEL) / REF;
    const labels = blobLabels(list);
    for (let i = 0; i < labels.length; i++) {
      const at = labels[i];
      c.fillStyle = tint(at.e.style.color, 0.92);
      c.setTransform(sc, 0, 0, sc, tx + at.x * k, ty + at.y * k);
      c.fillText(at.e.value, 0, 0);
    }
  }

  // The blob under a world point, by fill or outline (4 px of slop): the
  // smallest that holds it (engine.blobPick), so a nested blob stays
  // reachable. { kind: 'blob', key, value, members } or null.
  function blobAt(wx, wy) {
    if (!blobList.length) return null;
    const e = engine.blobPick(blobList, wx, wy, Math.max(engine.BLOB_LINE * 0.5, 4 / camera.z));
    return e ? { kind: 'blob', key: e.key, value: e.value, members: e.members } : null;
  }

  // A line's own colour, else the ink of whatever it sits on.
  function lineInk(l) {
    return l.color || inkFor(model.frame ? frameFill() : view.background);
  }

  // Lines are world-width strokes, square-ended unless they carry end caps
  // (engine.lineShape draws both), in their own colour.
  function paintLines(c, lines, scale, z, ox, oy) {
    if (!lines.length) return;
    c.setTransform(scale * z, 0, 0, scale * z, scale * ox, scale * oy);
    c.lineCap = 'butt';
    c.lineJoin = 'miter';
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const shape = engine.lineShape(l);
      const ink = lineInk(l);
      c.strokeStyle = ink;
      c.fillStyle = ink;
      c.lineWidth = l.width;
      strokePts(c, shape.path, false);
      for (let k = 0; k < shape.caps.length; k++) {
        const cap = shape.caps[k];
        if (cap.k === 'dot') {
          c.beginPath();
          c.arc(cap.x, cap.y, cap.r, 0, Math.PI * 2);
          c.fill();
        } else if (cap.k === 'fill') {
          strokePts(c, cap.pts, true);
        } else {
          c.lineWidth = cap.w;
          strokePts(c, cap.pts, false);
        }
      }
    }
  }

  function strokePts(c, pts, fill) {
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let p = 1; p < pts.length; p++) c.lineTo(pts[p][0], pts[p][1]);
    if (fill) {
      c.closePath();
      c.fill();
    } else c.stroke();
  }

  // A text block's lines and extent in feet, cached per content and face.
  function textLayout(t) {
    const kit = faceKit(engine.textStyleOf(t, view).face);
    const key = t.text + '|' + t.size + '|' + (t.w || 0) + '|' + kit.font;
    let lay = textLayouts.get(t.id);
    if (lay && lay.key === key) return lay;
    const width = kit.measure;
    const k = t.size / REF;
    const lines = [];
    let widest = 0;
    const paras = String(t.text).split('\n');
    for (let p = 0; p < paras.length; p++) {
      if (!(t.w > 0)) {
        lines.push(paras[p]);
        widest = Math.max(widest, width(paras[p]) * k);
        continue;
      }
      const words = paras[p].split(/\s+/).filter(Boolean);
      let line = '';
      for (let i = 0; i < words.length; i++) {
        const next = line ? line + ' ' + words[i] : words[i];
        if (line && width(next) * k > t.w) {
          lines.push(line);
          widest = Math.max(widest, width(line) * k);
          line = words[i];
        } else {
          line = next;
        }
      }
      lines.push(line);
      widest = Math.max(widest, width(line) * k);
    }
    lay = { key: key, lines: lines, w: Math.max(t.w || 0, widest, t.size * 0.5), h: lines.length * t.size * TEXT_LEAD, font: kit.font, css: kit.css, measure: kit.measure };
    textLayouts.set(t.id, lay);
    return lay;
  }

  // Its own ink, else the ink of what it sits on.
  function textInk(t) {
    return t.textColor || inkFor(textPaper(t));
  }

  function paintTexts(c, scale, z, ox, oy) {
    if (!model.texts.length) return;
    const k = scale * z;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    for (let i = 0; i < model.texts.length; i++) {
      const t = model.texts[i];
      if (textEdit && textEdit.id === t.id) continue;
      const lay = textLayout(t);
      const sc = (k * t.size) / REF;
      c.font = lay.font;
      c.fillStyle = textInk(t);
      for (let j = 0; j < lay.lines.length; j++) {
        c.setTransform(sc, 0, 0, sc, scale * ox + t.x * k, scale * oy + (t.y + t.size * TEXT_LEAD * (j + 0.5)) * k);
        c.fillText(lay.lines[j], 0, 0);
      }
    }
  }

  // What a text sits on decides its ink: a sticky, the frame, or the board.
  function textPaper(t) {
    const s = hitSticky(t.x + 0.01, t.y + t.size * 0.5);
    if (s) return stickyFill(s);
    return insideFrame(t.x, t.y) ? frameFill() : view.background;
  }

  function drawFillet() {
    const s = filletTarget();
    if (!s) return;
    const q = toScreen(filletGrip(s).x, s.y);
    const x = Math.round(q.x - HANDLE_PX / 2) + 0.5;
    const y = Math.round(q.y - HANDLE_PX / 2) + 0.5;
    ctx.fillStyle = hotGrip ? GRIP_HOT : '#ffffff';
    ctx.strokeStyle = SELECT;
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, HANDLE_PX, HANDLE_PX);
    ctx.strokeRect(x, y, HANDLE_PX, HANDLE_PX);
  }

  // Slate shows a selected line by its endpoint grips alone, no box.
  function drawLineGrips() {
    if (!selLines.size) return;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = SELECT;
    ctx.lineWidth = 1;
    const lines = linesFor(selLines);
    for (let i = 0; i < lines.length; i++) {
      const pts = lines[i].points;
      for (let k = 0; k < pts.length; k += pts.length - 1) {
        const q = toScreen(pts[k][0], pts[k][1]);
        const x = Math.round(q.x - 3.5) + 0.5;
        const y = Math.round(q.y - 3.5) + 0.5;
        ctx.fillRect(x, y, 7, 7);
        ctx.strokeRect(x, y, 7, 7);
      }
    }
  }

  // The rubber band: the segment at its real width, faint, with square
  // screen-sized markers at its ends (Slate's draft markers).
  function drawDraft(z, ox, oy) {
    if (!draft || !draft.b) return;
    const a = draft.a;
    const b = draft.b;
    ctx.save();
    ctx.globalAlpha = 0.45;
    paintLines(ctx, [{ points: [a, b], width: view.lineWidth }], dpr, z, ox, oy);
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = SELECT;
    ctx.lineWidth = 1;
    const ends = [a, b];
    for (let i = 0; i < 2; i++) {
      const x = Math.round(ends[i][0] * z + ox - 3) + 0.5;
      const y = Math.round(ends[i][1] * z + oy - 3) + 0.5;
      ctx.fillRect(x, y, 6, 6);
      ctx.strokeRect(x, y, 6, 6);
    }
  }

  // Text armed: a faint sample of what a click will place, at world size.
  function drawTextGhost(z, ox, oy) {
    if (tool !== 'text' || textEdit || !pointerWorld || drag) return;
    const size = engine.TEXT_SIZE;
    const sc = (dpr * z * size) / REF;
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.font = fontRef;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = INK;
    ctx.setTransform(sc, 0, 0, sc, dpr * (pointerWorld.x * z + ox), dpr * ((pointerWorld.y + size * TEXT_LEAD * 0.5) * z + oy));
    ctx.fillText('Text', 0, 0);
    ctx.restore();
  }

  // A plate only needs an edge where it would vanish into the board.
  function frameNeedsEdge() {
    return Math.abs(luma(frameFill()) - luma(view.background)) < 12;
  }

  function titleWidth(title) {
    const key = 't|' + title;
    let w = dimWidths.get(key);
    if (w == null) {
      w = textWidth(title);
      dimWidths.set(key, w);
    }
    return w;
  }

  // Slate's frame: a rounded plate and an unboxed title just outside its
  // upper-left corner, at world size like every canvas object. Shared by the
  // board and the PNG.
  function paintFrame(c, scale, z, ox, oy, linePx, edge) {
    const f = model.frame;
    if (!f) return 0;
    const k = scale * z;
    const tx = scale * ox;
    const ty = scale * oy;
    c.setTransform(k, 0, 0, k, tx, ty);
    c.beginPath();
    c.roundRect(f.x, f.y, f.w, f.h, FRAME_RADIUS);
    c.fillStyle = frameFill();
    c.fill();
    if (edge && frameNeedsEdge()) {
      c.strokeStyle = FRAME_EDGE;
      c.lineWidth = linePx / z;
      c.stroke();
    }
    if (!f.title || titleEditing) return;
    const sc = (k * TITLE_SIZE) / REF;
    c.font = fontRef;
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    c.fillStyle = TITLE_INK;
    c.setTransform(sc, 0, 0, sc, tx + (f.x + TITLE_IN) * k, ty + (f.y - TITLE_UP) * k);
    c.fillText(f.title, 0, 0);
  }

  function dimWidth(text) {
    let w = dimWidths.get(text);
    if (w == null) {
      w = textWidth(text);
      if (dimWidths.size > 400) dimWidths.clear();
      dimWidths.set(text, w);
    }
    return w;
  }

  // Title hit area, the selected outline, and Slate's dimension stringers:
  // width below, height to the right, never on top.
  function drawFrameChrome(z, ox, oy) {
    const f = model.frame;
    chrome.shown = !!f;
    if (!f) return;
    const size = TITLE_SIZE;
    const t = chrome.title;
    t.x = (f.x + TITLE_IN) * z + ox;
    t.h = size * z * 1.25;
    t.y = (f.y - TITLE_UP) * z + oy - size * z;
    t.w = f.title ? (titleWidth(f.title) * size * z) / REF : 60;
    if (frameSelected) {
      ctx.strokeStyle = SELECT;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(f.x * z + ox, f.y * z + oy, f.w * z, f.h * z, FRAME_RADIUS * z);
      ctx.stroke();
    }
    const ink = isDark(view.background) ? DIM_INK_DARK : DIM_INK;
    const dim = DIM_TEXT * z;
    const x0 = f.x * z + ox;
    const x1 = (f.x + f.w) * z + ox;
    const y0 = f.y * z + oy;
    const y1 = (f.y + f.h) * z + oy;
    const off = DIM_OFFSET * z;
    const from = DIM_FROM * z;
    const past = DIM_PAST * z;
    const tick = DIM_TICK * z;
    const pad = DIM_BREAK * z;
    const wl = chrome.w;
    const hl = chrome.h;
    wl.text = fmt(f.w) + ' ft';
    hl.text = fmt(f.h) + ' ft';
    wl.lw = (dimWidth(wl.text) * dim) / REF;
    hl.lw = (dimWidth(hl.text) * dim) / REF;
    wl.lh = hl.lh = dim;
    wl.px = hl.px = dim;
    wl.cx = (x0 + x1) * 0.5;
    wl.cy = y1 + off;
    hl.cx = x1 + off;
    hl.cy = (y0 + y1) * 0.5;
    ctx.strokeStyle = ink;
    ctx.lineWidth = DIM_LINE * z;
    ctx.beginPath();
    // Witness lines.
    ctx.moveTo(x0, y1 + from);
    ctx.lineTo(x0, wl.cy + past);
    ctx.moveTo(x1, y1 + from);
    ctx.lineTo(x1, wl.cy + past);
    ctx.moveTo(x1 + from, y0);
    ctx.lineTo(hl.cx + past, y0);
    ctx.moveTo(x1 + from, y1);
    ctx.lineTo(hl.cx + past, y1);
    // Dimension lines, broken around their labels.
    const wg = wl.lw * 0.5 + pad;
    if (wl.cx - wg > x0) {
      ctx.moveTo(x0, wl.cy);
      ctx.lineTo(wl.cx - wg, wl.cy);
      ctx.moveTo(wl.cx + wg, wl.cy);
      ctx.lineTo(x1, wl.cy);
    }
    const hg = hl.lw * 0.5 + pad;
    if (hl.cy - hg > y0) {
      ctx.moveTo(hl.cx, y0);
      ctx.lineTo(hl.cx, hl.cy - hg);
      ctx.moveTo(hl.cx, hl.cy + hg);
      ctx.lineTo(hl.cx, y1);
    }
    // 45-degree slash ticks.
    ctx.moveTo(x0 - tick, wl.cy + tick);
    ctx.lineTo(x0 + tick, wl.cy - tick);
    ctx.moveTo(x1 - tick, wl.cy + tick);
    ctx.lineTo(x1 + tick, wl.cy - tick);
    ctx.moveTo(hl.cx - tick, y0 + tick);
    ctx.lineTo(hl.cx + tick, y0 - tick);
    ctx.moveTo(hl.cx - tick, y1 + tick);
    ctx.lineTo(hl.cx + tick, y1 - tick);
    ctx.stroke();
    ctx.font = fontRef;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ink;
    const s = (dpr * dim) / REF;
    if (dimEdit !== 'w') {
      ctx.setTransform(s, 0, 0, s, dpr * wl.cx, dpr * wl.cy);
      ctx.fillText(wl.text, 0, 0);
    }
    if (dimEdit !== 'h') {
      // Rotated -90 degrees: reads bottom to top.
      ctx.setTransform(0, -s, s, 0, dpr * hl.cx, dpr * hl.cy);
      ctx.fillText(hl.text, 0, 0);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawGrid(z, ox, oy) {
    let step = view.gridStep;
    for (let i = 0; i < GRID_EVERY.length && step * z < 6; i++) step = view.gridStep * GRID_EVERY[i];
    const darkBoard = isDark(view.background);
    ctx.lineWidth = 1;
    traceGrid(step, z, ox, oy);
    ctx.strokeStyle = gridInk(darkBoard);
    ctx.stroke();
    // On a plate of the opposite lightness the board's grid ink vanishes, so
    // the same lines are stroked again, clipped to the plate, in its ink.
    const f = model.frame;
    if (f && isDark(frameFill()) !== darkBoard) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(f.x * z + ox, f.y * z + oy, f.w * z, f.h * z, FRAME_RADIUS * z);
      ctx.clip();
      traceGrid(step, z, ox, oy);
      ctx.strokeStyle = gridInk(!darkBoard);
      ctx.stroke();
      ctx.restore();
    }
  }

  function traceGrid(step, z, ox, oy) {
    const x0 = Math.floor(-ox / z / step) * step;
    const y0 = Math.floor(-oy / z / step) * step;
    ctx.beginPath();
    for (let x = x0; x * z + ox <= viewW; x += step) {
      const sx = Math.round(x * z + ox) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, viewH);
    }
    for (let y = y0; y * z + oy <= viewH; y += step) {
      const sy = Math.round(y * z + oy) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(viewW, sy);
    }
  }

  function gridInk(dark) {
    return dark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(27, 30, 34, 0.07)';
  }

  // A faint outline around a group's bounds while it is selected or hovered.
  function drawGroups(list, z, ox, oy) {
    groupScratch.length = 0;
    if (selected.size) {
      for (let i = 0; i < list.length; i++) {
        const g = list[i].group;
        if (g && selected.has(list[i].id) && groupScratch.indexOf(g) < 0) groupScratch.push(g);
      }
    }
    const selectedCount = groupScratch.length;
    if (hoverGroup && groupScratch.indexOf(hoverGroup) < 0) groupScratch.push(hoverGroup);
    ctx.lineWidth = 1;
    for (let g = 0; g < groupScratch.length; g++) {
      const gid = groupScratch[g];
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (s.group !== gid) continue;
        x0 = Math.min(x0, s.x);
        y0 = Math.min(y0, s.y);
        x1 = Math.max(x1, s.x + s.w);
        y1 = Math.max(y1, s.y + s.h);
      }
      if (x0 === Infinity) continue;
      const l = Math.round(x0 * z + ox) - 5.5;
      const t = Math.round(y0 * z + oy) - 5.5;
      const w = Math.round((x1 - x0) * z) + 11;
      const h = Math.round((y1 - y0) * z) + 11;
      ctx.strokeStyle = g < selectedCount ? GROUP_SELECTED : GROUP_HOVER;
      ctx.beginPath();
      ctx.roundRect(l, t, w, h, 5);
      ctx.stroke();
    }
  }

  function drawSelection(list, z, ox, oy) {
    ctx.strokeStyle = SELECT;
    ctx.lineWidth = 1.5;
    if (selected.size) {
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (!selected.has(s.id)) continue;
        const r = radiusOf(s);
        if (r > 0) {
          ctx.beginPath();
          ctx.roundRect(s.x * z + ox, s.y * z + oy, s.w * z, s.h * z, r * z);
          ctx.stroke();
        } else {
          ctx.strokeRect(s.x * z + ox, s.y * z + oy, s.w * z, s.h * z);
        }
      }
    }
    if (selTexts.size) {
      ctx.lineWidth = 1;
      const texts = textsFor(selTexts);
      for (let i = 0; i < texts.length; i++) {
        const t = texts[i];
        if (textEdit && textEdit.id === t.id) continue;
        const lay = textLayout(t);
        ctx.strokeRect(Math.round(t.x * z + ox) - 2.5, Math.round(t.y * z + oy) - 2.5, Math.round(lay.w * z) + 5, Math.round(lay.h * z) + 5);
      }
    }
  }

  function drawMarquee() {
    const z = camera.z;
    const x = (Math.min(drag.wx0, drag.wx1) - camera.x) * z + viewW * 0.5;
    const y = (Math.min(drag.wy0, drag.wy1) - camera.y) * z + viewH * 0.5;
    const w = Math.abs(drag.wx1 - drag.wx0) * z;
    const h = Math.abs(drag.wy1 - drag.wy0) * z;
    ctx.fillStyle = 'rgba(15, 143, 130, 0.06)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = SELECT;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
  }

  function drawHandles() {
    const s = sole();
    if (!showsHandles(s)) return;
    const list = handlesFor(s);
    const fillet = filletTarget() === s ? toScreen(filletGrip(s).x, s.y) : null;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = SELECT;
    ctx.lineWidth = 1;
    for (let i = 0; i < list.length; i++) {
      // The fillet grip covers the top midpoint at a half-side radius.
      if (fillet && list[i].edge === 'n' && Math.abs(list[i].x - fillet.x) < HANDLE_PX + 2) continue;
      const x = Math.round(list[i].x - HANDLE_PX / 2) + 0.5;
      const y = Math.round(list[i].y - HANDLE_PX / 2) + 0.5;
      ctx.fillRect(x, y, HANDLE_PX, HANDLE_PX);
      ctx.strokeRect(x, y, HANDLE_PX, HANDLE_PX);
    }
  }

  // ------------------------------------------------------------ frame loop

  function kick() {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function frame(now) {
    raf = 0;
    if (!model) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = view.background;
      ctx.fillRect(0, 0, viewW, viewH);
      return;
    }
    const t0 = performance.now();
    let busy = false;
    if (bookmarkTransition) {
      const progress = (now - bookmarkTransition.start) / 480;
      bookmarkTransition.eased = bookmarkTransition.plan.apply(progress);
      if (progress >= 1) finishBookmarkTransition(false);
      else busy = true;
    } else if (drag && drag.moved && (drag.kind === 'move' || drag.kind === 'resize')) {
      engine.step(model, dragStepOpts(lastBusyAt ? now - lastBusyAt : 0));
      busy = true;
    } else if (drag && drag.moved && drag.kind === 'grip') {
      // What the swinging end carried settles against its neighbours.
      engine.step(model, { iters: 6, contactEase: 1, maxPush: Math.max(maxPush, 3), drag: false });
      busy = true;
    } else if (bundling?.kind === 'groups') {
      const progress = window.ProgramGroupBundle.step(bundling.state, {pull: BUNDLE_PULL, maxPush: Math.max(2, BUNDLE_SCREEN_PUSH / camera.z)});
      if (progress.done) endBundle();
      busy = true;
    } else if (bundling) {
      const ease = Math.min(1, (bundling.frames + 1) / BUNDLE_EASE_IN);
      const moved = engine.bundleStep(model, bundling.ids, {
        pull: BUNDLE_PULL * ease,
        maxPush: Math.max(2, BUNDLE_SCREEN_PUSH / camera.z) * ease,
      });
      bundling.frames += 1;
      if (bundling.frames > BUNDLE_EASE_IN && (moved < 0.05 || bundling.frames >= BUNDLE_FRAMES)) endBundle();
      busy = true;
    } else if (settling) {
      busy = engine.settleStep(model, settling);
      if (!busy) finishSettle();
    }
    const t1 = performance.now();
    draw();
    placeData();
    placeAlign();
    placeChromeEdit();
    placeTextEdit();
    placeNameEdit();
    placeAreaEdit();
    updateStatus();
    const t2 = performance.now();
    if (busy) {
      const slot = perfCount % PERF_N;
      perfStep[slot] = t1 - t0;
      perfPaint[slot] = t2 - t1;
      perfGap[slot] = lastBusyAt ? now - lastBusyAt : 0;
      perfBlob[slot] = blobMs;
      perfCount += 1;
      lastBusyAt = now;
      kick();
    } else {
      lastBusyAt = 0;
    }
  }

  // `dt` (ms since the last stepped frame) times the crowd's liquefaction.
  function dragStepOpts(dt) {
    return {
      iters: 6,
      contactEase: 1,
      maxPush: Math.max(maxPush, 3),
      drag: drag.kind === 'move',
      isolate: drag.mode === 'isolate',
      ghost: drag.mode === 'ghost',
      dt: dt || 0,
    };
  }

  function perfStats() {
    const n = Math.min(perfCount, PERF_N);
    const pick = (buf, skipZero) => {
      const vals = [];
      for (let i = 0; i < n; i++) if (!skipZero || buf[i] > 0) vals.push(buf[i]);
      vals.sort((a, b) => a - b);
      if (!vals.length) return null;
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      const round = (v) => Math.round(v * 100) / 100;
      return { avg: round(avg), p95: round(vals[Math.floor(vals.length * 0.95)]), max: round(vals[vals.length - 1]) };
    };
    const gap = pick(perfGap, true);
    return {
      frames: n,
      stickies: live().length,
      stepMs: pick(perfStep, false),
      paintMs: pick(perfPaint, false),
      blobMs: pick(perfBlob, false),
      blobs: blobList.length,
      frameGapMs: gap,
      fps: gap ? Math.round(10000 / gap.avg) / 10 : null,
    };
  }

  function updateStatus() {
    if (!model) {
      statusEl.textContent = '';
      return;
    }
    const now = performance.now();
    if (now - statusAt < 200) {
      if (!statusTimer) {
        statusTimer = setTimeout(() => {
          statusTimer = 0;
          updateStatus();
        }, 220);
      }
      return;
    }
    statusAt = now;
    const list = live();
    let count = 0;
    let area = 0;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (selected.size && !selected.has(s.id)) continue;
      count += 1;
      area += engine.trueArea(s);
    }
    let text = (selected.size ? count + ' selected' : count + ' spaces') + ' \u00b7 ' + fmt(area) + ' sf';
    const mode = modeText();
    if (mode) text = mode;
    if (text !== statusText) {
      statusText = text;
      statusEl.textContent = text;
    }
  }

  // --------------------------------------------------------------- actions

  function bundle(all) {
    if (dataDashboard?.commitActive() === false) return;
    let ids = [];
    if (!all && selected.size) {
      ids = expanded();
      if (bodyCount(stickiesFor(ids)) < 2) {
        toast('Select two or more spaces to bundle, or none to bundle everything.');
        return;
      }
    }
    if (bodyCount(live()) < 2) return;
    closePop();
    checkpoint();
    startBundle(ids);
  }

  function bundleByGroup() {
    if (!model) return;
    if (dataDashboard?.commitActive() === false) return;
    clearDragFlags();
    const state = window.ProgramGroupBundle.begin(engine, model);
    if (!state.grouped) { toast('Tag a grouping column in the data viewer to cluster siblings.'); return; }
    closePop();
    checkpoint();
    settling = null;
    bundling = {kind: 'groups', state};
    toast('Clustering ' + state.grouped + ' sibling groups.');
    kick();
  }

  function startBundle(ids) {
    clearDragFlags();
    bundling = { ids: ids, frames: 0 };
    settling = null;
    kick();
  }

  // Stopping early can leave a pair inside the buffer; the settle closes it
  // (and lands fudged stickies on whole cells).
  function endBundle() {
    bundling = null;
    settle([]);
    persistSoon();
  }

  // The status pill names a drag's modifier or the armed tool's readout.
  function modeText() {
    if (drag && drag.kind === 'move' && drag.moved) {
      if (drag.dup) return 'Duplicate \u00b7 ' + drag.items.length + ' new row' + (drag.items.length === 1 ? '' : 's');
      if (drag.mode === 'ghost') return 'Ghost \u00b7 others make room on release';
      if (drag.mode === 'isolate') return 'Isolated \u00b7 others hold still';
      if (drag.axis) return 'Axis lock \u00b7 ' + (drag.axis === 'x' ? 'horizontal' : 'vertical');
      return '';
    }
    if (tool === 'line' && draft && draft.b) {
      const dx = draft.b[0] - draft.a[0];
      const dy = draft.b[1] - draft.a[1];
      const deg = Math.round((Math.atan2(-dy, dx) * 180) / Math.PI);
      const len = draft.typed ? draft.typed + '_' : fmtStep(Math.hypot(dx, dy));
      return 'Line ' + len + ' ft \u00b7 ' + (deg < 0 ? deg + 360 : deg) + '\u00b0' + (draft.lock ? ' \u00b7 locked' : '');
    }
    if (tool === 'line') return 'Draw \u00b7 click or drag \u00b7 ' + fmtStep(view.lineWidth) + ' ft wide';
    if (tool === 'text') return 'Type \u00b7 click to place, drag to set a width';
    return '';
  }

  function canGroup(list) {
    if (list.length < 2) return false;
    const first = list[0].group;
    return !(first && list.every((s) => s.group === first));
  }

  function groupSelection() {
    const ids = expanded();
    if (!canGroup(stickiesFor(ids))) return;
    checkpoint();
    if (engine.groupStickies(model, ids)) setSelection(ids);
    persistSoon();
    kick();
  }

  function ungroupSelection() {
    const ids = expanded();
    if (!stickiesFor(ids).some((s) => s.group)) return;
    checkpoint();
    engine.ungroupStickies(model, ids);
    persistSoon();
    kick();
  }

  // The selection is exactly one whole group.
  function isOneGroup(list) {
    return list.length >= 2 && !!list[0].group && list.every((s) => s.group === list[0].group);
  }

  // Ctrl+G: ungroups one selected group, otherwise groups the selection.
  function toggleGroup() {
    if (isOneGroup(stickiesFor(expanded()))) ungroupSelection();
    else groupSelection();
  }

  // Ctrl+D and the menu: copies (new rows, right after their sources) land
  // at the nearest free spot one buffer away and become the selection. One
  // undo step.
  function duplicateSelection() {
    const list = stickiesFor(expanded());
    if (!list.length) return;
    if (live().length + list.length > engine.MAX_STICKIES) {
      toast('A board holds at most ' + engine.MAX_STICKIES + ' stickies.');
      return;
    }
    checkpoint();
    const copies = engine.duplicateStickies(model, list.map((s) => s.id));
    copies.forEach((c) => {
      c.passId = null;
    });
    const placed = engine.placeCopies(model, copies, engine.gapOf(model));
    touchList();
    textGen += 1;
    colGen += 1;
    closeData();
    setSelection(copies.map((s) => s.id));
    if (!placed) settle(copies);
    // The nearest free spot on a packed board can be off screen.
    const b = engine.boundsOf(copies);
    const a = toScreen(b.x, b.y);
    const z = toScreen(b.x + b.w, b.y + b.h);
    if (a.x < 0 || a.y < 0 || z.x > viewW || z.y > viewH) camera = { x: b.x + b.w * 0.5, y: b.y + b.h * 0.5, z: camera.z };
    persistSoon();
    kick();
  }

  function removeSelection() {
    const ids = expanded();
    if (!ids.length && !selLines.size && !selTexts.size) return;
    checkpoint();
    for (let i = 0; i < ids.length; i++) engine.dropSticky(model, ids[i]);
    if (selLines.size) {
      model.lines = model.lines.filter((l) => !selLines.has(l.id));
      model.lineGen += 1;
    }
    if (selTexts.size) model.texts = model.texts.filter((t) => !selTexts.has(t.id));
    touchList();
    closeData();
    setSelection([]);
    persistSoon();
    kick();
  }

  function selectAll() {
    setSelection(live().map((s) => s.id), model.lines.map((l) => l.id), model.texts.map((t) => t.id));
    kick();
  }

  function offsetLine(l, dx, dy) {
    for (let p = 0; p < l.points.length; p++) {
      l.points[p][0] += dx;
      l.points[p][1] += dy;
    }
  }

  function nudge(key, shift, repeat) {
    const list = stickiesFor(expanded());
    const lines = linesFor(selLines);
    const texts = textsFor(selTexts);
    if (!list.length && !lines.length && !texts.length) return;
    if (!repeat) checkpoint();
    const step = (view.grid ? view.gridStep : 8) * (shift ? 5 : 1);
    let dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
    let dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
    if (list.length) {
      const move = wallClamp(engine.boundsOf(list), dx, dy);
      dx = move.dx;
      dy = move.dy;
    }
    // A nudge is one drag step: what it moves is swept against lines and
    // neighbours like any drag, so it never hops a line.
    stopSettle();
    for (let i = 0; i < list.length; i++) {
      list[i].dragging = true;
      list[i].dragTarget = { x: list[i].x + dx, y: list[i].y + dy };
    }
    for (let i = 0; i < lines.length; i++) {
      lines[i].dragging = true;
      lines[i].dragTarget = { x: lines[i].points[0][0] + dx, y: lines[i].points[0][1] + dy };
    }
    if (lines.length) model.lineGen += 1;
    if (list.length || lines.length) engine.step(model, { iters: 6, contactEase: 1, maxPush: Math.max(3, Math.hypot(dx, dy)), drag: true });
    for (let i = 0; i < lines.length; i++) {
      lines[i].dragging = false;
      lines[i].dragTarget = null;
    }
    for (let i = 0; i < texts.length; i++) {
      texts[i].x += dx;
      texts[i].y += dy;
    }
    if (lines.length) model.lineGen += 1;
    settle(list);
    persistSoon();
  }

  function selectionColor(list) {
    if (list.some((s) => s.gradientId)) return null;
    const first = list.length ? list[0].color || STICKY : STICKY;
    return list.every((s) => (s.color || STICKY) === first) ? first : null;
  }

  function stickyFill(s) {
    return window.ProgramAppearance.fillFor(model, s, preparedColors);
  }

  // A ramp belongs to the selected set, including all members of a selected
  // group. Every fill reads the live areas, so resizing an area updates it.
  function gradientRows() {
    const appearance = window.ProgramAppearance;
    const read = () => {
      const list = stickiesFor(expanded());
      const first = list.length && appearance.gradientFor(model, list[0]);
      return first && list.every((s) => s.gradientId === list[0].gradientId) ? first : null;
    };
    const row = addRow(el('div', 'cap row spread'));
    row.appendChild(el('span', null, 'Color mode'));
    row.classList.add('gradient-mode');
    row.refresh = refresh;
    const segs = el('span', 'segs');
    const solid = button('seg', 'Solid', () => {
      const list = stickiesFor(expanded());
      if (!list.some((s) => s.gradientId)) return;
      checkpoint();
      appearance.clearGradient(model, list);
      changed();
    });
    const bySize = button('seg', 'By size', () => {
      if (read()) return;
      apply('#ff3d9a', '#ff927f', true);
    });
    segs.append(solid, bySize);
    row.appendChild(segs);
    const ends = addRow(el('div', 'cap row spread gradient-ends'));
    const start = el('input');
    const end = el('input');
    start.type = end.type = 'color';
    start.setAttribute('aria-label', 'Smallest rectangle color');
    end.setAttribute('aria-label', 'Largest rectangle color');
    start.title = 'Smallest rectangle';
    end.title = 'Largest rectangle';
    const preview = el('span', 'gradient-preview');
    ends.append(el('span', 'sub', 'Small'), start, preview, end, el('span', 'sub', 'Large'));
    const presets = addRow(el('div', 'cap row spread gradient-presets'));
    presets.appendChild(el('span', null, 'Palettes'));
    const swatches = el('span', 'swatches');
    for (const [name, a, b] of [
      ['Pink to salmon', '#ff3d9a', '#ff927f'],
      ['Ocean', '#2b87b7', '#a7dfcb'],
      ['Clay', '#b76852', '#efd7ad'],
      ['Lavender', '#8270c2', '#ecc7de'],
      ['Forest', '#3b7c68', '#d4df98'],
    ]) {
      const swatch = button('swatch gradient-swatch', null, () => apply(a, b, true));
      swatch.title = name;
      swatch.setAttribute('aria-label', name + ' size gradient');
      swatch.style.background = 'linear-gradient(110deg,' + a + ',' + b + ')';
      swatches.appendChild(swatch);
    }
    presets.appendChild(swatches);
    const note = addRow(el('div', 'cap row gradient-note', 'Area maps small → large · selected group'));
    function refresh() {
      const ramp = read();
      const on = !!ramp;
      const mixed = stickiesFor(expanded()).some((s) => s.gradientId);
      solid.classList.toggle('on', !mixed);
      bySize.classList.toggle('on', on);
      solid.setAttribute('aria-pressed', String(!mixed));
      bySize.setAttribute('aria-pressed', String(on));
      ends.hidden = presets.hidden = note.hidden = !on;
      start.value = ramp ? ramp.start : '#ff3d9a';
      end.value = ramp ? ramp.end : '#ff927f';
      preview.style.background = 'linear-gradient(90deg,' + start.value + ',' + end.value + ')';
    }
    function changed() {
      refresh();
      syncSwatchRows('sticky');
      persistSoon();
      placeMenu();
      kick();
    }
    function apply(a, b, record) {
      const list = stickiesFor(expanded());
      if (!list.length) return;
      if (record) checkpoint();
      appearance.setGradient(model, list, a, b);
      changed();
    }
    for (const input of [start, end]) {
      let armed = true;
      input.addEventListener('click', () => { armed = true; });
      input.addEventListener('input', () => {
        apply(start.value, end.value, armed);
        armed = false;
      });
      input.addEventListener('change', () => { armed = true; });
    }
    refresh();
  }

  function setColor(hex) {
    const list = stickiesFor(expanded());
    if (!list.length) return;
    const next = hex === STICKY ? null : hex;
    if (list.every((s) => !s.gradientId && (s.color || null) === next)) return;
    checkpoint();
    window.ProgramAppearance.clearGradient(model, list);
    for (let i = 0; i < list.length; i++) list[i].color = next;
    syncSwatchRows('sticky');
    persistSoon();
    kick();
  }

  function setBackground(hex) {
    if (view.background === hex) return;
    view.background = hex;
    markDirty();
    persistSoon();
    kick();
  }

  function frameFill() {
    return (model && model.frame && model.frame.color) || FRAME_FILL;
  }

  function applyFrameColor(hex) {
    if (!model.frame) return;
    model.frame.color = hex === FRAME_FILL ? null : hex;
    persistSoon();
    kick();
  }

  function setFrameColor(hex) {
    if (!model.frame || frameFill() === hex) return;
    checkpoint();
    applyFrameColor(hex);
  }

  // ---------------------------------------------------- popovers and menu

  function showPop(node, anchor) {
    pop = { el: node, anchor: anchor };
    if (anchor?.hasAttribute('aria-expanded')) anchor.setAttribute('aria-expanded', 'true');
    node.hidden = false;
  }

  function closePop() {
    hideBlobTip();
    if (!pop) return;
    const node = pop.el;
    if (pop.anchor?.hasAttribute('aria-expanded')) pop.anchor.setAttribute('aria-expanded', 'false');
    pop = null;
    if (dataDocked) closeData();
    if (node.contains(document.activeElement)) document.activeElement.blur();
    node.hidden = true;
  }

  function togglePop(node, anchor) {
    if (pop && pop.el === node) {
      closePop();
      return;
    }
    closePop();
    showPop(node, anchor);
    const bar = toolbarEl.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    const w = node.offsetWidth;
    node.style.left = Math.min(viewW - w - EDGE, Math.max(EDGE, a.left + a.width * 0.5 - w * 0.5)) + 'px';
    node.style.bottom = viewH - bar.top + 6 + 'px';
  }

  // Menu rows land in the menu, or in the dropdown being filled (into).
  let rowHost = null;

  function addRow(node) {
    (rowHost || menuEl).appendChild(node);
    return node;
  }

  function into(box, build) {
    const outer = rowHost;
    rowHost = box;
    try {
      build();
    } finally {
      rowHost = outer;
    }
  }

  function menuItem(label, hint, action, cls) {
    const item = button('cap row item' + (cls ? ' ' + cls : ''), null, () => {
      closePop();
      action();
    });
    item.appendChild(el('span', null, label));
    if (hint) item.appendChild(el('span', 'hint', hint));
    return addRow(item);
  }

  const CHEVRON_SVG = '<svg class="chev" width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><path d="M1.6 2.9 4 5.3 6.4 2.9" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // The one dropdown: a darker capsule whose chevron turns as it drops its
  // own capsules open right beneath it, inside the menu. `fill(box)` builds
  // them on open; `empty()` runs before they go.
  function dropdown(label, hint, fill, empty) {
    let open = false;
    const head = button('cap row item drop-head', null, () => set(!open));
    const tail = el('span', 'drop-tail');
    if (hint) tail.appendChild(el('span', 'hint', hint));
    tail.insertAdjacentHTML('beforeend', CHEVRON_SVG);
    head.append(el('span', null, label), tail);
    head.setAttribute('aria-expanded', 'false');
    const box = el('div', 'drop');
    box.hidden = true;
    addRow(head);
    addRow(box);
    function set(next) {
      if (next === open) return;
      open = next;
      head.classList.toggle('open', open);
      head.setAttribute('aria-expanded', String(open));
      if (open) {
        box.hidden = false;
        into(box, () => fill(box));
      } else {
        if (empty) empty();
        box.textContent = '';
        box.hidden = true;
      }
      placeMenu();
    }
    return { head: head, box: box, set: set };
  }

  // Where the menu was opened, so it can re-place as dropdowns grow.
  let menuAt = null;

  // A dropdown grows the menu down; the menu rises only as far as it must
  // to stay on screen, and past the screen's height it scrolls.
  function placeMenu(first) {
    if (!menuAt || !pop || pop.el !== menuEl) return;
    menuEl.classList.remove('scroll');
    let x = menuAt.x;
    let y = menuAt.y;
    const w = menuEl.offsetWidth;
    const h = menuEl.offsetHeight;
    if (x + w > viewW - EDGE) x -= w;
    if (y + h > viewH - EDGE) y = first ? y - h : viewH - EDGE - h;
    if (h > viewH - EDGE * 2) menuEl.classList.add('scroll');
    menuEl.style.transform = 'translate(' + Math.round(Math.max(EDGE, x)) + 'px, ' + Math.round(Math.max(EDGE, y)) + 'px)';
  }

  // `hit` is a pickAt result ({ kind, item }), 'title' for the frame's
  // title, 'frame' for its empty plate, or null for the open board.
  // `onLabel`: the press was on the label of an already selected sticky,
  // which opens its Text dropdown.
  function openMenu(x, y, hit, onLabel) {
    closePop();
    endChromeEdits(true);
    menuEl.textContent = '';
    menuEl.style.removeProperty('--scope');
    if (hit === 'title') {
      selectFrame(true);
      frameMenu();
    } else if (hit && hit.kind === 'sticky') {
      if (!selected.has(hit.item.id)) {
        closeData();
        setSelection(groupOf(hit.item.id));
      }
      stickyMenu(!!onLabel);
    } else if (hit && hit.kind === 'line') {
      if (!selLines.has(hit.item.id)) setSelection([], [hit.item.id]);
      lineMenu();
    } else if (hit && hit.kind === 'text') {
      if (!selTexts.has(hit.item.id)) setSelection([], [], [hit.item.id]);
      textMenu(hit.item);
    } else if (hit && hit.kind === 'blob') {
      blobMenu(hit);
    } else {
      boardMenu(hit === 'frame');
    }
    showPop(menuEl, null);
    menuAt = { x: x, y: y };
    placeMenu(true);
    kick();
  }

  // Every menu opens with its dropdowns, always in the order Metadata,
  // Blobs, Text; the plain capsules follow.
  function stickyMenu(onLabel) {
    const list = stickiesFor(expanded());
    dropdown('Metadata', 'Enter', (box) => dockData(box), closeData);
    const text = dropdown('Text', null, () => textRows(() => stickiesFor(expanded()), true));
    if (onLabel) text.set(true);
    menuItem('Duplicate', 'Ctrl D', duplicateSelection);
    if (bodyCount(list) >= 2) menuItem('Bundle selection', 'B', () => bundle(false));
    bundleMenuRow();
    const one = isOneGroup(list);
    if (canGroup(list)) menuItem('Group', 'Ctrl G', groupSelection);
    if (list.some((s) => s.group)) menuItem('Ungroup', one ? 'Ctrl G' : 'Ctrl Shift G', ungroupSelection);
    swatchRow('Color', 'sticky', SWATCHES, () => selectionColor(stickiesFor(expanded())), setColor, applyStickyColor);
    gradientRows();
    styleRow('Stroke', 'stroke', 'ft');
    styleRow('Shadow', 'shadow', 'ft');
    styleRow('Corner', 'radius', 'ft');
    menuItem('Delete', 'Del', removeSelection, 'danger');
  }

  function boardMenu(onFrame) {
    blobsDropdown();
    boardTextDropdown();
    bundleMenuRow();
    if (onFrame) menuItem('Rename frame', null, startTitleEdit);
    if (onFrame) swatchRow('Frame', 'frame', FRAME_COLORS, frameFill, setFrameColor, applyFrameColor);
    swatchRow('Background', 'background', BACKGROUNDS, () => view.background, setBackground, null);
    gridRows();
    bufferRow();
    menuItem('Fit viewport', 'F', fit);
  }

  // The canvas menu's Text: the board's size, ink, and typeface, in the
  // rows a sticky's own Text uses. Clear overrides, offered only while
  // some sticky has its own type, returns them all to these.
  function boardTextDropdown() {
    dropdown('Text', null, () => {
      textRows(() => [boardText], true, true);
      leaderRow();
      const own = live().filter((s) => s.textFace || s.textScale || s.textColor);
      if (!own.length) return;
      menuItem('Clear overrides', own.length + (own.length === 1 ? ' sticky' : ' stickies'), () => {
        checkpoint();
        ['face', 'scale', 'color'].forEach((prop) => engine.setTextStyle(own, prop, null));
        persistSoon();
        kick();
      });
    });
  }

  function bundleMenuRow() {
    const row = addRow(el('div', 'cap row spread'));
    row.appendChild(el('span', null, 'Bundle'));
    const actions = el('span', 'segs');
    actions.appendChild(button('seg', 'All', () => bundle(true)));
    actions.appendChild(button('seg', 'By group', bundleByGroup));
    row.appendChild(actions);
  }

  function frameMenu() {
    menuItem('Rename', 'Double-click', startTitleEdit);
    swatchRow('Frame color', 'frame', FRAME_COLORS, frameFill, setFrameColor, applyFrameColor);
    bufferRow();
    menuItem('Fit viewport', 'F', fit);
  }

  // No Delete capsule: Delete or Backspace removes a selected line.
  function lineMenu() {
    lineWidthRow();
    swatchRow('Color', 'line', TEXT_INKS, () => {
      const c = commonOf(linesFor(selLines), (l) => l.color || null);
      return c.mixed ? null : c.value || AUTO;
    }, (hex) => {
      const c = commonOf(linesFor(selLines), (l) => l.color || null);
      if (!c.mixed && (c.value || AUTO) === hex) return;
      checkpoint();
      setLineColor(hex);
    }, setLineColor);
    lineEndRows();
  }

  // A text block is all type, so its Text dropdown starts open.
  function textMenu(t) {
    dropdown('Text', null, () => textRows(() => textsFor(selTexts), false)).set(true);
    menuItem('Edit text', 'Double-click', () => startTextEdit(t));
    menuItem('Delete', 'Del', removeSelection, 'danger');
  }

  // ------------------------------------------------------ category blobs

  const CHECK_SVG = '<svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><path d="M1.6 4.2 3.3 5.8 6.4 2.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // Keys offered for blobs: the ones that look like categories, plus any
  // already on, in column order. [{ key, groups }].
  function blobKeys() {
    const cats = engine.categoricalKeys(model);
    const have = new Set(cats.map((c) => c.key));
    const on = model.blobs ? model.blobs.on : [];
    for (let i = 0; i < on.length; i++) {
      if (have.has(on[i]) || model.columns.indexOf(on[i]) < 0) continue;
      const values = new Set();
      live().forEach((s) => {
        const v = engine.fieldText(model, s, on[i]).trim();
        if (v) values.add(v);
      });
      cats.push({ key: on[i], groups: values.size });
    }
    return cats.sort((a, b) => model.columns.indexOf(a.key) - model.columns.indexOf(b.key));
  }

  function blobTipText(key, groups) {
    return 'Blob by ' + key + ' \u00b7 ' + groups + (groups === 1 ? ' group' : ' groups');
  }

  function showBlobTip(anchor, text) {
    const tip = document.getElementById('blob-tip');
    tip.textContent = text;
    tip.hidden = false;
    const a = anchor.getBoundingClientRect();
    const w = tip.offsetWidth;
    const x = Math.min(viewW - w - EDGE, Math.max(EDGE, a.left + a.width * 0.5 - w * 0.5));
    const y = a.top - 24 < EDGE ? a.bottom + 6 : a.top - 24;
    tip.style.transform = 'translate(' + Math.round(x) + 'px, ' + Math.round(y) + 'px)';
  }

  function hideBlobTip() {
    document.getElementById('blob-tip').hidden = true;
  }

  function blobCheck(key, groups) {
    const check = button('blob-check' + (engine.blobOn(model, key) ? ' on' : ''), null, (event) => {
      event.stopPropagation();
      toggleBlob(key);
    });
    check.innerHTML = CHECK_SVG;
    check.dataset.blobKey = key;
    check.setAttribute('aria-label', blobTipText(key, groups));
    check.addEventListener('pointerenter', () => showBlobTip(check, blobTipText(key, groups)));
    check.addEventListener('pointerleave', hideBlobTip);
    return check;
  }

  function refreshBlobChecks() {
    document.querySelectorAll('.blob-check[data-blob-key]').forEach((check) => {
      check.classList.toggle('on', engine.blobOn(model, check.dataset.blobKey));
    });
  }

  function blobsChanged() {
    persistSoon();
    kick();
  }

  function toggleBlob(key, on) {
    const next = on == null ? !engine.blobOn(model, key) : !!on;
    if (next === engine.blobOn(model, key)) return;
    checkpoint();
    engine.setBlobOn(model, key, next);
    refreshBlobChecks();
    blobsChanged();
  }

  // The board menu's Blobs dropdown: one capsule per category key, its
  // name and circle check the same toggle the Metadata rows carry.
  function blobsDropdown() {
    const keys = blobKeys();
    if (!keys.length) return;
    dropdown('Blobs', null, () => {
      keys.forEach((c) => {
        const row = addRow(el('div', 'cap row blob-row'));
        const name = button('blob-name', c.key, () => toggleBlob(c.key));
        name.title = blobTipText(c.key, c.groups);
        row.append(name, el('span', 'hint', String(c.groups)), blobCheck(c.key, c.groups));
      });
    });
  }

  // The blobs a blob-menu edit reaches: this one, or every drawn blob of
  // its key. Settings are read fresh from the board, not the cache.
  function blobTargets(hit) {
    return blobList
      .filter((e) => e.key === hit.key && (blobScope === 'all' || e.value === hit.value))
      .map((e) => engine.blobStyle(model, e.key, e.value, e.style.palette));
  }

  function commonBlob(hit, prop) {
    const list = blobTargets(hit);
    if (!list.length) return { value: 0, mixed: false };
    const first = list[0][prop];
    for (let i = 1; i < list.length; i++) {
      const v = list[i][prop];
      if (typeof first === 'number' ? Math.abs(v - first) > 1e-9 : v !== first) return { value: first, mixed: true };
    }
    return { value: first, mixed: false };
  }

  function setBlobProp(hit, prop, value) {
    engine.setBlobStyle(model, hit.key, blobScope === 'all' ? null : hit.value, prop, value);
    blobsChanged();
  }

  function toggleRow(label, read, write) {
    const row = addRow(el('div', 'cap row spread'));
    row.appendChild(el('span', null, label));
    const toggle = button('toggle', null, () => {
      checkpoint();
      write(!read());
      row.refresh();
    });
    toggle.appendChild(el('span', 'knob'));
    row.appendChild(toggle);
    row.refresh = () => toggle.classList.toggle('on', read());
    row.refresh();
    return row;
  }

  // A blob's own menu. Offset and stroke are floats in feet: their sliders
  // move in BLOB_STEP (never snapped to the grid) and a click types any
  // decimal; a stroke of 0 draws no outline. Apply to switches in place: in
  // All <key> the capsules the scope reaches (offset, colour, opacity,
  // stroke, label) take the
  // blob's colour as a cast, so the reach of an edit shows before it lands.
  function blobMenu(hit) {
    const head = addRow(el('div', 'cap row blob-head'));
    head.append(el('span', 'k', hit.key), el('span', 'v', hit.value));
    const scope = addRow(el('div', 'cap row spread blob-scope'));
    scope.appendChild(el('span', null, 'Apply to'));
    const segs = el('span', 'segs');
    const reach = [];
    const sync = () => {
      const all = blobScope === 'all';
      segs.querySelectorAll('.seg').forEach((seg) => seg.classList.toggle('on', seg.dataset.scope === blobScope));
      const e = blobList.find((b) => b.key === hit.key && b.value === hit.value);
      menuEl.style.setProperty('--scope', engine.blobStyle(model, hit.key, hit.value, e ? e.style.palette : null).color);
      reach.forEach((row) => {
        row.classList.toggle('scoped', all);
        row.refresh(true);
      });
    };
    [['one', 'This group'], ['all', 'All ' + hit.key]].forEach((pair) => {
      const seg = button('seg', pair[1], () => {
        if (blobScope === pair[0]) return;
        blobScope = pair[0];
        sync();
      });
      seg.dataset.scope = pair[0];
      seg.title = pair[0] === 'one' ? 'Only the ' + hit.value + ' blob' : 'Every ' + hit.key + ' blob';
      segs.appendChild(seg);
    });
    scope.appendChild(segs);
    reach.push(sliderRow({
      label: 'Offset',
      min: 0,
      step: BLOB_STEP,
      max: () => Math.max(20, engine.gapOf(model) * 2),
      read: () => commonBlob(hit, 'offset'),
      write: (v) => setBlobProp(hit, 'offset', v),
      format: (v) => slideNumber(v) + ' ft',
      unit: 'ft',
      exact: true,
      typedMax: engine.BLOB_OFFSET_MAX,
    }));
    const paint = (hex) => {
      setBlobProp(hit, 'color', hex);
      sync();
    };
    reach.push(swatchRow('Color', 'blob', engine.BLOB_PALETTE, () => {
      const c = commonBlob(hit, 'color');
      return c.mixed ? null : c.value;
    }, (hex) => {
      const c = commonBlob(hit, 'color');
      if (!c.mixed && c.value === hex) return;
      checkpoint();
      paint(hex);
    }, paint));
    reach.push(sliderRow({
      label: 'Opacity',
      min: 0.04,
      step: 0.01,
      max: () => 0.6,
      read: () => commonBlob(hit, 'alpha'),
      write: (v) => setBlobProp(hit, 'alpha', v),
      format: (v) => Math.round(v * 100) + '%',
      unit: '%',
      factor: 100,
    }));
    reach.push(sliderRow({
      label: 'Stroke',
      min: 0,
      step: BLOB_STEP,
      max: () => 4,
      read: () => commonBlob(hit, 'stroke'),
      write: (v) => setBlobProp(hit, 'stroke', v),
      format: (v) => (v > 0 ? slideNumber(v) + ' ft' : 'None'),
      unit: 'ft',
      exact: true,
      typedMax: engine.BLOB_STROKE_MAX,
    }));
    reach.push(toggleRow('Label', () => {
      const c = commonBlob(hit, 'label');
      return !c.mixed && !!c.value;
    }, (on) => setBlobProp(hit, 'label', on)));
    toggleRow('Single stickies', () => {
      const k = model.blobs.keys[hit.key];
      return !k || k.singles !== false;
    }, (on) => {
      engine.setBlobStyle(model, hit.key, null, 'singles', on);
      blobsChanged();
    });
    sync();
  }

  // ---------------------------------------------------------- the slider
  // One slider everywhere (menu rows and the grid popover), after Slate's
  // rails: at rest a white inset pill with a hairline edge, a soft rail, and
  // a pill-shaped accent thumb, and no number. The value shows only while
  // the slider is pressed, dragged, or stepped from the keyboard, in a small
  // capsule riding above the thumb, and fades after release. A press that
  // moves more than SLIDE_CLICK_PX scrubs; one that does not is a click,
  // which turns the pill into a field for an exact number.
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
    const x = Math.min(viewW - w - EDGE, Math.max(EDGE, a.left + a.width * 0.5 - w * 0.5));
    const y = a.top - h - 7 < EDGE ? a.bottom + 7 : a.top - h - 7;
    slideTip.style.transform = 'translate(' + Math.round(x) + 'px, ' + Math.round(y) + 'px)';
  }

  function fadeSlideTip(now) {
    clearTimeout(slideTipTimer);
    if (now) slideTip.classList.remove('show');
    else slideTipTimer = setTimeout(() => slideTip.classList.remove('show'), SLIDE_TIP_HOLD);
  }

  // The typed form of a value: up to three decimals, no trailing zeros.
  function slideNumber(n) {
    return String(Number(n.toFixed(3)));
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
        checkpoint();
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
      if (!keyBurst) checkpoint();
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
      if (menuEl.contains(box)) placeMenu();
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
      const text = input.value.trim().replace(/\s*(ft|feet|px|'|%)\s*$/i, '');
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
        checkpoint();
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
      slider.setAttribute('aria-valuemin', String(opts.min));
      slider.setAttribute('aria-valuemax', String(opts.max()));
      if (cur.mixed) slider.removeAttribute('aria-valuenow');
      else slider.setAttribute('aria-valuenow', String(cur.value));
      slider.setAttribute('aria-valuetext', cur.mixed ? 'Mixed' : opts.format(cur.value));
    }
    refresh();
    return { el: box, refresh: refresh };
  }

  // --------------------------------------------------- slider menu rows
  // One capsule: the label and the slider. Values that differ across the
  // selection read "Mixed" and the thumb goes hollow until the slider is
  // touched. The row's `refresh()` re-reads.
  function sliderRow(opts) {
    const row = addRow(el('div', 'cap row slide-row'));
    row.appendChild(el('span', 'k', opts.label));
    const control = slideControl(opts);
    row.appendChild(control.el);
    row.refresh = () => {
      control.refresh();
      if (opts.after) opts.after(opts.read());
    };
    row.refresh();
    return row;
  }

  // The shared value of `key` across the list, or mixed.
  function common(list, get) {
    if (!list.length) return { value: 0, mixed: false };
    const first = get(list[0]);
    for (let i = 1; i < list.length; i++) if (Math.abs(get(list[i]) - first) > 1e-9) return { value: first, mixed: true };
    return { value: first, mixed: false };
  }

  // Zero is none.
  function leaderRow() {
    const row = sliderRow({
      label: 'Leaders', min: 0, max: () => 120, step: 1, unit: 'px',
      read: () => ({ value: view.leaderThreshold, mixed: false }),
      write: setLeaderThreshold,
      format: (v) => v ? 'Cells below ' + v + ' screen px' : 'Off',
    });
    row.title = 'Move labels on small cells into aligned side stacks. Threshold is the cell\'s shorter screen edge. 0 turns leaders off. All leaders use 45\u00b0 elbows.';
    return row;
  }

  function setLeaderThreshold(value) {
    const wasOn = view.leaderThreshold > 0;
    view.leaderThreshold = Math.max(0, Math.min(120, Number(value) || 0));
    if (wasOn !== (view.leaderThreshold > 0)) fit();
    syncChrome();
    persistSoon();
    kick();
  }

  // Zero is none.
  function styleRow(label, key, unit) {
    sliderRow({
      label: label,
      min: 0,
      step: STYLE_STEP[key],
      max: () => {
        if (key !== 'radius') return STYLE_MAX[key];
        const list = stickiesFor(expanded());
        let half = 0;
        for (let i = 0; i < list.length; i++) half = Math.max(half, Math.min(list[i].w, list[i].h) * 0.5);
        return Math.max(1, Math.min(STYLE_MAX.radius, half));
      },
      read: () => common(stickiesFor(expanded()), (s) => (key === 'radius' ? radiusOf(s) : s[key] || 0)),
      write: (v) => {
        const list = stickiesFor(expanded());
        for (let i = 0; i < list.length; i++) list[i][key] = v;
        persistSoon();
        kick();
      },
      format: (v) => (v > 0 ? fmtStep(v) + ' ' + unit : 'None'),
      unit: unit,
    });
  }

  function lineWidthRow() {
    sliderRow({
      label: 'Width',
      min: engine.LINE_MIN,
      step: 0.5,
      max: () => 20,
      read: () => common(linesFor(selLines), (l) => l.width),
      write: (v) => setLineWidths(linesFor(selLines), v),
      done: relaxAroundLines,
      format: (v) => fmtStep(v) + ' ft',
      unit: 'ft',
    });
  }

  function setLineColor(hex) {
    engine.setLineStyle(linesFor(selLines), 'color', hex === AUTO ? null : hex);
    persistSoon();
    kick();
  }

  // Small icons for the end caps, drawn at the right end of a short line
  // (mirrored while Start is the target); the same 1.2 stroke as the
  // menu's other glyphs.
  const END_ICONS = {
    none: '<path d="M3 6h18"/>',
    arrow: '<path d="M3 6h13"/><path d="M21 6 15 2.8v6.4z" fill="currentColor" stroke="none"/>',
    open: '<path d="M3 6h17M15.5 2.8 20.5 6l-5 3.2"/>',
    square: '<path d="M3 6h14"/><rect x="15.5" y="3.5" width="5" height="5" fill="currentColor" stroke="none"/>',
    dot: '<path d="M3 6h14"/><circle cx="18" cy="6" r="2.6" fill="currentColor" stroke="none"/>',
    tick: '<path d="M3 6h18M16 9.5l5-7"/>',
    bar: '<path d="M3 6h16M19 2.2v7.6"/>',
  };
  const END_TITLES = { none: 'None', arrow: 'Arrow', open: 'Open arrow', square: 'Square', dot: 'Dot', tick: 'Tick', bar: 'Bar' };
  let lineEndTarget = 'both';

  // Ends: which end an icon sets (Start, End, or Both), then one icon per
  // cap. The current cap of the targeted end(s) is filled; a selection
  // that differs marks nothing and reads Mixed.
  function lineEndRows() {
    const head = addRow(el('div', 'cap row spread'));
    const name = el('span', null, 'Ends');
    const mixed = el('span', 'hint', 'Mixed');
    name.appendChild(mixed);
    head.appendChild(name);
    const segs = el('span', 'segs');
    const icons = addRow(el('div', 'cap row line-ends'));
    const props = () => (lineEndTarget === 'both' ? ['start', 'end'] : [lineEndTarget]);
    const current = () => {
      const lines = linesFor(selLines);
      const ends = [];
      props().forEach((prop) => lines.forEach((l) => ends.push(l[prop] || 'none')));
      return commonOf(ends, (v) => v);
    };
    const refresh = () => {
      const c = current();
      segs.querySelectorAll('.seg').forEach((seg) => seg.classList.toggle('on', seg.dataset.end === lineEndTarget));
      icons.classList.toggle('start', lineEndTarget === 'start');
      icons.querySelectorAll('.end-btn').forEach((b) => b.classList.toggle('on', !c.mixed && c.value === b.dataset.end));
      mixed.hidden = !c.mixed;
    };
    [['start', 'Start'], ['end', 'End'], ['both', 'Both']].forEach((pair) => {
      const seg = button('seg', pair[1], () => {
        lineEndTarget = pair[0];
        refresh();
      });
      seg.dataset.end = pair[0];
      seg.title = pair[0] === 'both' ? 'Set both ends' : 'Set the ' + pair[1].toLowerCase() + ' of the line';
      segs.appendChild(seg);
    });
    head.appendChild(segs);
    engine.LINE_ENDS.forEach((kind) => {
      const b = button('end-btn', null, () => {
        const c = current();
        if (!c.mixed && c.value === kind) return;
        checkpoint();
        const lines = linesFor(selLines);
        props().forEach((prop) => engine.setLineStyle(lines, prop, kind === 'none' ? null : kind));
        persistSoon();
        kick();
        refresh();
      });
      b.dataset.end = kind;
      b.title = END_TITLES[kind];
      b.innerHTML = '<svg width="24" height="12" viewBox="0 0 24 12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="butt">' + END_ICONS[kind] + '</svg>';
      icons.appendChild(b);
    });
    refresh();
  }

  function textSizeRow() {
    return sliderRow({
      label: 'Size',
      min: 2,
      step: 1,
      max: () => 96,
      read: () => common(textsFor(selTexts), (t) => t.size),
      write: (v) => {
        const texts = textsFor(selTexts);
        for (let i = 0; i < texts.length; i++) texts[i].size = Math.max(1, v);
        persistSoon();
        kick();
      },
      format: (v) => fmtStep(v) + ' ft',
      unit: 'ft',
    });
  }

  const RESET_SVG = '<svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M2.3 4.6a2.9 2.9 0 1 1 .9 2.6" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><path d="M1.7 2.3v2.5h2.5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // One shared reading of a string field: { value, mixed }.
  function commonOf(list, get) {
    const first = list.length ? get(list[0]) : null;
    for (let i = 1; i < list.length; i++) if (get(list[i]) !== first) return { value: first, mixed: true };
    return { value: first, mixed: false };
  }

  // The Text dropdown: size, colour, and typeface for the selection's own
  // type (engine.textStyleOf). A set value overrides the board's for those
  // items alone, and the small reset mark beside a row's name, shown only
  // while one is set, returns them to the board's. Stickies size by a
  // multiplier on the width-first fit; text blocks keep their size in feet.
  // `board` edits boardText instead: the defaults themselves, no resets.
  function textRows(items, sticky, board) {
    const rows = [];
    const styled = () => {
      persistSoon();
      kick();
      rows.forEach((row) => row.refresh(true));
    };
    const set = (prop, value) => {
      engine.setTextStyle(items(), prop, value);
      styled();
    };
    const withReset = (row, field, prop, what) => {
      if (board) {
        row.refresh();
        rows.push(row);
        return;
      }
      const mark = button('reset', null, (event) => {
        event.stopPropagation();
        if (!items().some((it) => it[field] != null)) return;
        checkpoint();
        set(prop, null);
      });
      mark.innerHTML = RESET_SVG;
      mark.title = 'Use the board\u2019s ' + what;
      row.firstChild.appendChild(mark);
      const refresh = row.refresh;
      row.refresh = (force) => {
        refresh(force);
        mark.hidden = !items().some((it) => it[field] != null);
      };
      row.refresh();
      rows.push(row);
    };
    if (sticky) {
      withReset(sliderRow({
        label: 'Size',
        min: engine.TEXT_SCALE.MIN,
        step: 0.05,
        max: () => engine.TEXT_SCALE.MAX,
        read: () => common(items(), (s) => s.textScale || view.textScale),
        write: (v) => set('scale', v),
        format: (v) => Math.round(v * 100) + '%',
        unit: '%',
        factor: 100,
      }), 'textScale', 'size', 'fitted size');
    } else {
      rows.push(textSizeRow());
    }
    const ink = (hex) => set('color', hex === AUTO ? null : hex);
    withReset(swatchRow('Color', 'text', TEXT_INKS, () => {
      const c = commonOf(items(), (it) => it.textColor || null);
      return c.mixed ? null : c.value || AUTO;
    }, (hex) => {
      const c = commonOf(items(), (it) => it.textColor || null);
      if (!c.mixed && (c.value || AUTO) === hex) return;
      checkpoint();
      ink(hex);
    }, ink), 'textColor', 'color', 'ink');
    const faceRow = addRow(el('div', 'cap row spread'));
    faceRow.appendChild(el('span', null, 'Typeface'));
    const segs = el('span', 'segs');
    Object.keys(FACES).forEach((face) => {
      const seg = button('seg', FACES[face].label, () => {
        const c = commonOf(items(), (it) => it.textFace || null);
        if (!c.mixed && c.value === face) return;
        checkpoint();
        set('face', face);
      });
      seg.dataset.ownFace = face;
      seg.title = FACES[face].title;
      seg.style.fontFamily = FACES[face].css;
      segs.appendChild(seg);
    });
    faceRow.appendChild(segs);
    // The board's face, where nothing overrides it, shows as a ring.
    faceRow.refresh = () => {
      const c = commonOf(items(), (it) => it.textFace || null);
      segs.querySelectorAll('.seg').forEach((seg) => {
        const face = seg.dataset.ownFace;
        seg.classList.toggle('on', !c.mixed && c.value === face);
        seg.classList.toggle('inherit', !c.mixed && !c.value && face === view.face);
      });
    };
    withReset(faceRow, 'textFace', 'face', 'typeface');
  }

  function setLineWidths(lines, v) {
    const w = Math.min(engine.LINE_MAX, Math.max(engine.LINE_MIN, v));
    for (let i = 0; i < lines.length; i++) lines[i].width = w;
    model.lineGen += 1;
    persistSoon();
    kick();
  }

  // Stickies inside a line's envelope (its collision radius plus the
  // buffer) step clear of it; the line stays put.
  function relaxAroundLines() {
    touchList();
    settle([]);
  }

  // The buffer: a whole number of grid steps between stickies, and between
  // a sticky and the frame edge or a line.
  function bufferRow() {
    const row = addRow(el('div', 'cap row spread'));
    row.appendChild(el('span', null, 'Buffer'));
    const right = el('span', 'stepper');
    const minus = button('round', '\u2212', () => setBuffer(model.bufferMul - 1));
    const val = el('span', 'val readout');
    const plus = button('round', '+', () => setBuffer(model.bufferMul + 1));
    minus.title = 'Less space between stickies';
    plus.title = 'More space between stickies';
    right.append(minus, val, plus);
    row.appendChild(right);
    row.refresh = () => {
      val.textContent = model.bufferMul + '\u00d7 \u00b7 ' + fmtStep(model.bufferMul * view.gridStep) + ' ft';
      minus.disabled = model.bufferMul <= 0;
      plus.disabled = model.bufferMul >= BUFFER_MAX;
    };
    bufferRow.current = row;
    row.refresh();
  }

  function setBuffer(n) {
    const next = Math.max(0, Math.min(BUFFER_MAX, Math.round(n)));
    if (next === model.bufferMul) return;
    checkpoint();
    model.bufferMul = next;
    applyParams();
    if (bufferRow.current && bufferRow.current.isConnected) bufferRow.current.refresh();
  }

  function applyStickyColor(hex) {
    const list = stickiesFor(expanded());
    window.ProgramAppearance.clearGradient(model, list);
    for (let i = 0; i < list.length; i++) list[i].color = hex === STICKY ? null : hex;
    syncSwatchRows('sticky');
    persistSoon();
    kick();
  }

  // A labelled row of color dots plus a custom picker. With `live` (which
  // applies a color without recording it) the picker is undoable: one undo
  // step per visit to the system color dialog. A color chosen in the
  // dialog joins this kind's row (view.custom[kind]) for next time.
  // Right-click a custom dot to ask to remove it (undoable); presets stay put.
  // AUTO in `colors` is a split dot meaning no colour of its own.
  function swatchRow(label, kind, colors, current, pick, live) {
    const undoable = !!live;
    const row = addRow(el('div', 'cap row spread swatch-row'));
    row.appendChild(el('span', null, label));
    const dots = el('span', 'swatches');
    const refresh = () => markSwatches(dots, current());
    const addDot = (hex, extra) => {
      const swatch = button('swatch' + (extra ? ' extra' : '') + (hex === AUTO ? ' auto' : ''), null, () => {
        pick(hex);
        refresh();
      });
      if (hex !== AUTO) swatch.style.background = hex;
      swatch.dataset.hex = hex;
      swatch.title = hex === AUTO ? 'Auto: follows the fill' : extra ? hex + ' \u00b7 right-click to delete' : hex;
      // The window swallows `contextmenu` before it reaches here, so the
      // right button is read on pointerdown.
      swatch.addEventListener('pointerdown', (event) => {
        if (event.button !== 2) return;
        event.preventDefault();
        event.stopPropagation();
        if (extra && !swatch.classList.contains('going')) askForgetColor(swatch, kind, hex);
      });
      dots.insertBefore(swatch, dots.querySelector('.custom'));
    };
    const extras = () => view.custom[kind].filter((hex) => colors.indexOf(hex) < 0);
    const custom = el('label', 'swatch custom');
    dots.appendChild(custom);
    const syncExtras = () => {
      dots.querySelectorAll('.extra').forEach((dot) => dot.remove());
      extras().forEach((hex) => addDot(hex, true));
      refresh();
    };
    row.dataset.kind = kind;
    row.syncExtras = syncExtras;
    row.refresh = refresh;
    for (let i = 0; i < colors.length; i++) addDot(colors[i], false);
    syncExtras();
    custom.title = 'Custom color';
    custom.innerHTML = '<svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><path d="M4 1v6M1 4h6" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>';
    const picker = el('input');
    picker.type = 'color';
    const now = current();
    picker.value = HEX.test(now || '') ? now : colors.find((hex) => HEX.test(hex));
    picker.addEventListener('click', () => {
      pickerArmed = undoable;
    });
    picker.addEventListener('input', () => {
      if (pickerArmed) {
        checkpoint();
        pickerArmed = false;
      }
      const hex = picker.value.toLowerCase();
      if (undoable) live(hex);
      else pick(hex);
      refresh();
    });
    picker.addEventListener('change', () => {
      rememberColor(kind, picker.value.toLowerCase(), colors);
      syncExtras();
    });
    custom.appendChild(picker);
    row.appendChild(dots);
    refresh();
    return row;
  }

  // De-duplicated, newest last, oldest out past the cap; presets never
  // repeat as customs.
  function rememberColor(kind, hex, presets) {
    if (!HEX.test(hex) || presets.indexOf(hex) >= 0) return;
    const list = view.custom[kind].filter((c) => c !== hex);
    list.push(hex);
    while (list.length > CUSTOM_CAP) list.shift();
    view.custom[kind] = list;
    persistSoon();
  }

  const TRASH_SVG = '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 2.75h7M3.75 2.75v-1.1h2.5v1.1M2.5 2.75l.45 5.75h4.1l.45-5.75M4.25 4.5v2.4M5.75 4.5v2.4" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  let swatchAsk = null;

  // A mini capsule under a right-clicked custom dot with one Delete. It
  // lives inside the menu, so the menu stays open; any other press or Esc
  // dismisses it without deleting.
  function askForgetColor(swatch, kind, hex) {
    closeSwatchAsk();
    const ask = el('div', 'cap row swatch-ask');
    const del = button('ask-del', null, () => {
      closeSwatchAsk();
      swatch.classList.add('going');
      setTimeout(() => forgetColor(kind, hex), 120);
    });
    del.innerHTML = TRASH_SVG;
    del.appendChild(el('span', null, 'Delete'));
    ask.append(el('span', 'ask-hex', hex), del);
    menuEl.appendChild(ask);
    const m = menuEl.getBoundingClientRect();
    const s = swatch.getBoundingClientRect();
    const row = swatch.closest('.swatch-row').getBoundingClientRect();
    const w = ask.offsetWidth;
    const left = Math.min(m.right - 6 - w, Math.max(m.left + 6, s.left + s.width * 0.5 - w * 0.5));
    ask.style.left = Math.round(left - m.left) + 'px';
    ask.style.top = Math.round(row.bottom - 6 - m.top) + 'px';
    const away = (event) => {
      if (!ask.contains(event.target)) closeSwatchAsk();
    };
    document.addEventListener('pointerdown', away, true);
    swatchAsk = { el: ask, away: away };
  }

  // True when there was a popover to close.
  function closeSwatchAsk() {
    if (!swatchAsk) return false;
    const open = swatchAsk.el.isConnected && !menuEl.hidden;
    document.removeEventListener('pointerdown', swatchAsk.away, true);
    swatchAsk.el.remove();
    swatchAsk = null;
    return open;
  }

  // Drops a custom color from its kind's list, as one undo step. Stickies,
  // frames, and blobs already wearing it keep it.
  function forgetColor(kind, hex) {
    if (view.custom[kind].indexOf(hex) < 0) return;
    checkpoint();
    view.custom[kind] = view.custom[kind].filter((c) => c !== hex);
    persistSoon();
    syncSwatchRows(kind);
  }

  // Rebuilds the custom dots of every open swatch row (of one kind, or all).
  function syncSwatchRows(kind) {
    menuEl.querySelectorAll('.swatch-row').forEach((row) => {
      if ((!kind || row.dataset.kind === kind) && row.syncExtras) row.syncExtras();
    });
    if (!kind || kind === 'sticky') {
      menuEl.querySelectorAll('.gradient-mode').forEach((row) => { if (row.refresh) row.refresh(); });
    }
  }

  function markSwatches(dots, hex) {
    let preset = false;
    dots.querySelectorAll('[data-hex]').forEach((swatch) => {
      const on = swatch.dataset.hex === hex;
      swatch.classList.toggle('on', on);
      preset = preset || on;
    });
    const custom = dots.querySelector('.custom');
    const own = !preset && !!hex;
    custom.classList.toggle('on', own);
    custom.style.background = own ? hex : '';
  }

  // ------------------------------------------------------ metadata capsule

  // The same capsules drop open inside the sticky menu's Metadata
  // dropdown (docked), or float beside the selection (Enter).
  let dataDocked = false;

  function dockData(box) {
    if (!stickiesFor(selected).length) return;
    closeData();
    box.appendChild(dataEl);
    dataEl.classList.add('docked');
    dataEl.style.transform = '';
    dataDocked = true;
    dataOpen = true;
    dataEl.hidden = false;
    dataKey = '';
    placeData();
  }

  function openData(focus) {
    if (!stickiesFor(selected).length) return;
    closePop();
    dataOpen = true;
    dataEl.hidden = false;
    dataKey = '';
    placeData();
    if (focus) {
      const first = dataEl.querySelector('input');
      if (first) {
        first.focus();
        first.select();
      }
    }
  }

  function blurData() {
    if (dataEl.contains(document.activeElement)) document.activeElement.blur();
  }

  function closeData() {
    if (!dataOpen) return;
    blurData();
    dataOpen = false;
    dataKey = '';
    dataIds = [];
    areaInput = null;
    areaReadout = null;
    dataX = NaN;
    dataY = NaN;
    dataEl.hidden = true;
    dataEl.textContent = '';
    hideBlobTip();
    if (dataDocked) {
      dataDocked = false;
      dataEl.classList.remove('docked');
      menuEl.after(dataEl);
    }
  }

  // Runs every frame while open: rebuilds only when the selection, model, or
  // columns change; otherwise refreshes the area and follows the selection.
  function placeData() {
    if (!dataOpen) return;
    const list = stickiesFor(selected);
    if (!list.length) {
      closeData();
      return;
    }
    const key = modelGen + ':' + selGen + ':' + colGen;
    if (key !== dataKey) {
      dataKey = key;
      rebuildData(list);
      if (dataDocked) placeMenu();
    }
    refreshArea(list);
    if (dataDocked) return;
    const b = engine.boundsOf(list);
    const z = camera.z;
    const left = (b.x - camera.x) * z + viewW * 0.5;
    const top = (b.y - camera.y) * z + viewH * 0.5;
    let x = left + b.w * z + 14;
    if (x + dataW > viewW - EDGE) x = left - 14 - dataW;
    x = Math.round(Math.max(EDGE, Math.min(viewW - dataW - EDGE, x)));
    const y = Math.round(Math.max(EDGE, Math.min(viewH - dataH - EDGE, top)));
    if (x !== dataX || y !== dataY) {
      dataX = x;
      dataY = y;
      dataEl.style.transform = 'translate(' + x + 'px, ' + y + 'px)';
    }
  }

  function rebuildData(list) {
    blurData();
    dataIds = list.map((s) => s.id);
    areaInput = null;
    areaReadout = null;
    dataEl.textContent = '';
    hideBlobTip();
    const groups = new Map(blobKeys().map((c) => [c.key, c.groups]));
    textRow('Name', model.nameKey, groups.get(model.nameKey));
    areaRow(list);
    for (let i = 0; i < model.columns.length; i++) {
      const col = model.columns[i];
      if (col !== model.nameKey && col !== model.areaKey) textRow(col, col, groups.get(col));
    }
    const plus = button('cap row plus', '+');
    plus.title = 'Add a field. It becomes a column in the exported CSV.';
    plus.addEventListener('click', () => openAddRow(plus));
    dataEl.appendChild(plus);
    dataW = dataEl.offsetWidth;
    dataH = dataEl.offsetHeight;
    if (focusPlus) {
      focusPlus = false;
      plus.focus();
    }
  }

  function fieldRow(label) {
    const row = el('div', 'cap row field');
    const k = el('span', 'k', label);
    k.title = label;
    row.appendChild(k);
    dataEl.appendChild(row);
    return row;
  }

  function textInput(cls) {
    const input = el('input', cls);
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    return input;
  }

  // A key empty on every selected sticky reads grey (still editable);
  // Mixed is not empty.
  function fillValue(input) {
    const common = engine.commonField(model, dataIds, input.dataset.key);
    input.value = common.mixed || common.value == null ? '' : String(common.value);
    input.placeholder = common.mixed ? 'Mixed' : '';
    markEmpty(input, !common.mixed && !input.value.trim());
  }

  function markEmpty(input, empty) {
    const row = input.closest('.field');
    if (row) row.classList.toggle('empty', empty);
  }

  // The first keystroke after focusing a field records one undo step.
  function beforeEdit() {
    if (!editArmed) return;
    editArmed = false;
    checkpoint();
  }

  function writeField(key, value) {
    beforeEdit();
    if (key === model.nameKey) {
      writeName(dataIds, value);
      return;
    }
    engine.setField(model, dataIds, key, value);
    textGen += 1;
    persistSoon();
    kick();
  }

  // Every rename lands here, from the capsule's Name row or the editor on
  // the sticky: the name cell, those stickies' labels refitted, and the
  // capsule's Name row refilled (Mixed included) unless it is being typed.
  function writeName(ids, value) {
    const key = model.nameKey;
    engine.setName(model, ids, value);
    if (model.nameKey !== key) colGen += 1;
    for (let i = 0; i < ids.length; i++) labels.delete(ids[i]);
    if (dataOpen) {
      dataEl.querySelectorAll('input.v').forEach((input) => {
        if (input.dataset.key === model.nameKey && input !== document.activeElement) fillValue(input);
      });
    }
    persistSoon();
    kick();
  }

  // A category key (`groups` given) ends in a circle check that blobs it.
  function textRow(label, key, groups) {
    const row = fieldRow(label);
    const input = textInput('v');
    input.dataset.key = key;
    row.appendChild(input);
    fillValue(input);
    input.addEventListener('input', () => {
      writeField(key, input.value);
      markEmpty(input, !input.value.trim());
    });
    if (groups != null) row.appendChild(blobCheck(key, groups));
  }

  // The one place a sticky's area changes. One sticky: an Area row. Several:
  // a read-only Total, then Each, which shows their common area (placeholder
  // "Mixed" while they differ) and sets every one of them to a typed value.
  function areaRow(list) {
    if (list.length > 1) {
      const total = fieldRow('Total');
      areaReadout = el('span', 'readout');
      total.append(areaReadout, el('span', 'unit', 'sf'));
    }
    const row = fieldRow(list.length > 1 ? 'Each' : 'Area');
    areaInput = textInput('v num');
    areaInput.inputMode = 'decimal';
    areaInput.addEventListener('input', () => {
      markArea(row, areaInput.value.trim() !== '' && !(areaValue(areaInput.value) > 0));
      sizeArea(areaInput);
    });
    areaInput.addEventListener('change', commitArea);
    // Leaving a field that still holds a bad value puts the area back.
    areaInput.addEventListener('blur', () => {
      if (!row.classList.contains('bad')) return;
      markArea(row, false);
      areaInput.value = '';
      refreshArea(stickiesFor(dataIds));
    });
    areaInput.commit = commitArea;
    row.append(areaInput, el('span', 'unit', 'sf'));
    refreshArea(list);
  }

  function markArea(row, bad) {
    row.classList.toggle('bad', bad);
  }

  // A whole number of square feet, or NaN for anything that is not a number.
  // Thousands commas and a trailing unit ('2,500 sf') are fine.
  function areaValue(text) {
    const bare = String(text).replace(/,/g, '').replace(/\s*(sf?|sq\.?(\s*ft\.?)?|ft2|ft²)\s*$/i, '').trim();
    const n = bare ? Number(bare) : NaN;
    return Number.isFinite(n) ? Math.round(n) : NaN;
  }

  function sizeArea(input) {
    input.style.width = Math.max(input.placeholder ? 5 : 2, input.value.length + 0.4) + 'ch';
  }

  // Areas all within half a square foot of each other read as one.
  function commonArea(list) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < list.length; i++) {
      const a = engine.trueArea(list[i]);
      lo = Math.min(lo, a);
      hi = Math.max(hi, a);
    }
    return hi - lo > 0.5 ? null : Math.round((lo + hi) / 2);
  }

  function refreshArea(list) {
    if (areaReadout) {
      let sum = 0;
      for (let i = 0; i < list.length; i++) sum += engine.trueArea(list[i]);
      const text = fmt(sum);
      if (areaReadout.textContent !== text) areaReadout.textContent = text;
    }
    if (!areaInput || areaInput === document.activeElement) return;
    const same = commonArea(list);
    const value = same == null ? '' : String(same);
    const hold = same == null ? 'Mixed' : '';
    if (areaInput.value !== value || areaInput.placeholder !== hold) {
      areaInput.value = value;
      areaInput.placeholder = hold;
      sizeArea(areaInput);
    }
  }

  // Returns false when the value is refused, so Enter keeps the field.
  function commitArea() {
    const input = areaInput;
    const list = stickiesFor(dataIds);
    if (!input || !list.length) return true;
    const row = input.parentNode;
    if (input.value.trim() === '') {
      markArea(row, false);
      refreshArea(list);
      return true;
    }
    const value = areaValue(input.value);
    if (!(value > 0)) {
      markArea(row, true);
      return false;
    }
    markArea(row, false);
    if (list.some((s) => Math.abs(engine.trueArea(s) - value) > 1e-6)) {
      beforeEdit();
      writeAreas(dataIds, value);
    }
    input.value = '';
    input.placeholder = '';
    refreshArea(list);
    return true;
  }

  // Every area change lands here, from the capsule's Area / Each row or the
  // readout on a sticky: each sticky keeps its aspect and centre (and its
  // fudge cells), its row takes the whole square feet, and neighbours
  // settle. The capsule's rows follow on the next frame (placeData).
  function writeAreas(ids, value) {
    engine.setField(model, ids, model.areaKey, String(value));
    textGen += 1;
    touchList();
    settle([]);
    persistSoon();
  }

  function openAddRow(plus) {
    const row = el('div', 'cap row field');
    const keyInput = textInput('key');
    const valInput = textInput('v');
    keyInput.placeholder = 'Field';
    valInput.placeholder = 'Value';
    row.append(keyInput, valInput);
    row.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
      const key = keyInput.value.trim();
      if (!key) {
        keyInput.focus();
        return;
      }
      beforeEdit();
      engine.setField(model, dataIds, key, valInput.value);
      textGen += 1;
      colGen += 1;
      focusPlus = true;
      persistSoon();
      placeData();
    });
    row.addEventListener('focusout', (event) => {
      if (row.contains(event.relatedTarget) || keyInput.value.trim() || !row.isConnected) return;
      row.replaceWith(plus);
    });
    plus.replaceWith(row);
    keyInput.focus();
  }

  function focusStep(from, dir) {
    const list = Array.from(dataEl.querySelectorAll('input, .plus'));
    const next = list[list.indexOf(from) + dir];
    if (next) next.focus();
    else from.blur();
  }

  function wireData() {
    dataEl.addEventListener('focusin', (event) => {
      if (event.target.tagName === 'INPUT') editArmed = true;
    });
    // Keys typed in the capsule never reach the board shortcuts.
    dataEl.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        if (dataDocked) closePop();
        else closeData();
      } else if (event.key === 'Enter' && event.target.tagName === 'INPUT') {
        event.preventDefault();
        if (event.target.commit && event.target.commit() === false) return;
        focusStep(event.target, event.shiftKey ? -1 : 1);
      }
    });
  }

  // ----------------------------------------------------------------- align

  // Slate's align strip: one thin capsule of screen-sized glyphs,
  // centred under the selection whenever it holds two or more bodies.
  function buildAlign() {
    for (let i = 0; i < ALIGN.length; i++) {
      const a = ALIGN[i];
      if (!a) {
        alignEl.appendChild(el('span', 'sep'));
        continue;
      }
      const b = button('ico');
      b.dataset.mode = a.mode;
      b.setAttribute('aria-label', a.label);
      b.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">'
        + '<path d="' + a.line + '" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>'
        + '<path d="' + a.bars + '" fill="currentColor"/></svg>';
      // Fires on press, so the click can never begin a move on the board.
      b.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.button === 0 && !b.disabled) doAlign(a.mode);
      });
      b.addEventListener('click', event => {
        if (event.detail === 0 && !b.disabled) doAlign(a.mode);
      });
      b.addEventListener('pointerenter', () => showTip(b, a.label));
      b.addEventListener('pointerleave', hideTip);
      alignEl.appendChild(b);
    }
  }

  function showTip(b, label) {
    if (b.disabled) label += ' (needs 3)';
    alignTip.textContent = label;
    alignTip.hidden = false;
    const r = b.getBoundingClientRect();
    const a = alignEl.getBoundingClientRect();
    const w = alignTip.offsetWidth;
    const x = Math.min(viewW - w - EDGE, Math.max(EDGE, r.left + r.width * 0.5 - w * 0.5));
    alignTip.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(a.bottom + 5) + 'px)';
  }

  function hideTip() {
    alignTip.hidden = true;
  }

  const ALIGN_BOX = { x0: 0, y0: 0, x1: 0, y1: 0 };

  // Screen bounds of the selection, without allocating.
  function selectionScreenBox() {
    const list = live();
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!selected.has(s.id)) continue;
      if (s.x < x0) x0 = s.x;
      if (s.y < y0) y0 = s.y;
      if (s.x + s.w > x1) x1 = s.x + s.w;
      if (s.y + s.h > y1) y1 = s.y + s.h;
    }
    const z = camera.z;
    ALIGN_BOX.x0 = (x0 - camera.x) * z + viewW * 0.5;
    ALIGN_BOX.x1 = (x1 - camera.x) * z + viewW * 0.5;
    ALIGN_BOX.y0 = (y0 - camera.y) * z + viewH * 0.5;
    ALIGN_BOX.y1 = (y1 - camera.y) * z + viewH * 0.5;
    return ALIGN_BOX;
  }

  let alignBodies = 0;

  function placeAlign() {
    const key = selGen + ':' + modelGen + ':' + undoStack.length;
    if (key !== alignKey) {
      alignKey = key;
      alignBodies = selected.size >= 2 ? bodyCount(stickiesFor(selected)) : 0;
      const dist = alignEl.querySelectorAll('[data-mode$="dist"]');
      for (let i = 0; i < dist.length; i++) dist[i].disabled = alignBodies < 3;
    }
    const show = alignBodies >= 2 && !drag && !bundling && !dimEdit && !titleEditing && !(pop && pop.el === menuEl);
    if (!show) {
      if (alignShown) {
        alignShown = false;
        alignEl.hidden = true;
        hideTip();
      }
      return;
    }
    if (!alignShown) {
      alignShown = true;
      alignEl.hidden = false;
      alignX = NaN;
    }
    const b = selectionScreenBox();
    const w = alignEl.offsetWidth;
    const h = alignEl.offsetHeight;
    const x = Math.round(Math.min(viewW - w - EDGE, Math.max(EDGE, (b.x0 + b.x1) * 0.5 - w * 0.5)));
    let y = b.y1 + 12;
    if (y + h > viewH - 64) y = b.y0 - 12 - h;
    y = Math.round(Math.min(viewH - h - 64, Math.max(EDGE + 44, y)));
    if (x === alignX && y === alignY) return;
    alignX = x;
    alignY = y;
    alignEl.style.transform = 'translate(' + x + 'px,' + y + 'px)';
  }

  // Groups align as their rigid bounds; one press is one undo step.
  function doAlign(mode) {
    if (dataDashboard?.commitActive() === false) return;
    const ids = expanded();
    if (!engine.alignPlan(model, ids, mode).length) {
      if (mode === 'areaasc' || mode === 'areadesc') toast('Already sorted, or more room is needed inside the frame.');
      return;
    }
    closeData();
    checkpoint();
    engine.alignSelection(model, ids, mode);
    settle(stickiesFor(ids));
    persistSoon();
  }

  // ---------------------------------------------------------- chrome edits

  // A stringer label becomes an input in place: Enter or a press outside
  // commits, Escape cancels, a value that is not a positive number turns red.
  function startDimEdit(axis) {
    if (!model.frame) return;
    closePop();
    endChromeEdits(true);
    dimEdit = axis;
    dimInput.classList.remove('bad');
    dimInput.value = String(Math.round(axis === 'w' ? model.frame.w : model.frame.h));
    dimInput.hidden = false;
    dimInput.dataset.axis = axis;
    chromePlaced = '';
    draw();
    placeChromeEdit();
    dimInput.focus();
    dimInput.select();
    kick();
  }

  function dimValue() {
    const raw = dimInput.value.trim().replace(/\s*(ft|feet|')$/i, '').replace(/,/g, '');
    const v = raw === '' ? NaN : Number(raw);
    return Number.isFinite(v) && v > 0 ? v : NaN;
  }

  function commitDim(fromBlur) {
    const axis = dimEdit;
    if (!axis) return true;
    const v = dimValue();
    if (!(v > 0)) {
      if (fromBlur) return false;
      dimInput.classList.add('bad');
      dimInput.focus();
      return false;
    }
    finishDim();
    const f = model.frame;
    if (Math.abs(v - (axis === 'w' ? f.w : f.h)) < 0.5) return true;
    checkpoint();
    const got = engine.resizeFrame(model, axis, v);
    if (got > v + 0.5) toast('The program needs at least ' + fmt(got) + ' ft here, so the frame stops there.');
    containFrame();
    return true;
  }

  // After the walls move, stickies left outside glide back in; if that
  // cannot restore the buffer, the settle bundles inside the new walls.
  function containFrame() {
    touchList();
    settle([], true);
    persistSoon();
  }

  function finishDim() {
    dimEdit = null;
    dimInput.hidden = true;
    dimInput.classList.remove('bad');
    if (document.activeElement === dimInput) dimInput.blur();
    kick();
  }

  function startTitleEdit() {
    if (!model.frame) return;
    closePop();
    endChromeEdits(true);
    titleEditing = true;
    titleInput.value = model.frame.title || '';
    titleInput.hidden = false;
    chromePlaced = '';
    draw();
    placeChromeEdit();
    titleInput.focus();
    titleInput.select();
    kick();
  }

  // An empty title keeps the old one.
  function commitTitle() {
    if (!titleEditing) return;
    const v = titleInput.value.trim().slice(0, 120);
    finishTitle();
    if (!v || v === model.frame.title) return;
    checkpoint();
    model.frame.title = v;
    persistSoon();
    kick();
  }

  function finishTitle() {
    titleEditing = false;
    titleInput.hidden = true;
    if (document.activeElement === titleInput) titleInput.blur();
    kick();
  }

  function endChromeEdits(commit) {
    if (dimEdit) {
      if (!commit || !commitDim(true)) finishDim();
    }
    if (titleEditing) {
      if (commit) commitTitle();
      else finishTitle();
    }
  }

  let chromePlaced = '';

  // Keeps the open input glued to its label as the camera moves.
  function placeChromeEdit() {
    let css = '';
    let input = null;
    if (dimEdit) {
      input = dimInput;
      const L = chrome[dimEdit];
      const font = Math.max(11, L.px);
      const w = Math.max(56, Math.round((textWidth(dimInput.value) * font) / REF + font * 2));
      const h = Math.round(font * 1.55 + 4);
      css = 'translate(' + Math.round(L.cx - w * 0.5) + 'px,' + Math.round(L.cy - h * 0.5) + 'px)'
        + (dimEdit === 'h' ? ' rotate(-90deg)' : '') + '|' + w + '|' + h + '|' + font;
    } else if (titleEditing) {
      input = titleInput;
      const t = chrome.title;
      const font = Math.max(11, t.h / 1.25);
      const w = Math.min(viewW - EDGE - t.x, Math.max(140, Math.round((textWidth(titleInput.value) * font) / REF + font * 2.5)));
      const h = Math.round(font * 1.5 + 4);
      css = 'translate(' + Math.round(t.x - 6) + 'px,' + Math.round(t.y + t.h * 0.5 - h * 0.5) + 'px)|' + w + '|' + h + '|' + font;
    }
    if (!input || css === chromePlaced) return;
    chromePlaced = css;
    const parts = css.split('|');
    input.style.transform = parts[0];
    input.style.width = parts[1] + 'px';
    input.style.height = parts[2] + 'px';
    input.style.fontSize = parts[3] + 'px';
  }

  function wireChromeEdits() {
    dimInput.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        commitDim(false);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finishDim();
      }
    });
    dimInput.addEventListener('input', () => {
      if (dimInput.classList.contains('bad') && dimValue() > 0) dimInput.classList.remove('bad');
      placeChromeEdit();
    });
    titleInput.addEventListener('input', placeChromeEdit);
    dimInput.addEventListener('blur', () => {
      if (dimEdit && !commitDim(true)) finishDim();
    });
    titleInput.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        commitTitle();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finishTitle();
      }
    });
    titleInput.addEventListener('blur', commitTitle);
  }

  // ------------------------------------------------------------------ save

  function layoutText() {
    return JSON.stringify(engine.packLayout(model, view, camera), null, 1);
  }

  // Save writes one zip: the spreadsheet clone and the layout, which only
  // make sense together. The first save asks where (before the zip is
  // built, while the click still counts as a gesture); later saves
  // overwrite that file silently. Without the File System Access API
  // (Firefox, Safari, some file:// hosts) the zip downloads instead.
  async function saveBoard() {
    if (!model) return;
    if (dataDashboard?.commitActive() === false) return;
    finishBoardMotion();
    endChromeEdits(true);
    if (typeof window.showSaveFilePicker === 'function' && !fileHandle) {
      try {
        fileHandle = await window.showSaveFilePicker({
          suggestedName: baseName() + '.zip',
          types: [{ description: 'Program board (spreadsheet + layout)', accept: { 'application/zip': ['.zip'] } }],
        });
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        fileHandle = null;
      }
    }
    const gen = editGen;
    let saved;
    try {
      saved = await engine.buildSave(model, view, camera, { app: APP_VERSION });
    } catch (err) {
      toast('Could not build the zip: ' + (err && err.message ? err.message : err));
      return;
    }
    if (!EPHEMERAL) {
      try {
        localStorage.setItem(KEY + ':saved', saved.layoutText);
      } catch (err) {
        /* storage full or disabled: the file still saves */
      }
    }
    if (fileHandle) {
      try {
        const out = await fileHandle.createWritable();
        await out.write(saved.bytes);
        await out.close();
        markSaved(gen);
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        fileHandle = null;
      }
    }
    save(saved.name, new Blob([saved.bytes], { type: 'application/zip' }));
    markSaved(gen);
    toast('Downloaded ' + saved.name + '. Drop it on the board to restore this board.');
  }

  // Edits made while the file was being written stay unsaved.
  function markSaved(gen) {
    savedGen = gen;
    savedFlash = performance.now();
    syncChrome();
    clearTimeout(markSaved.timer);
    markSaved.timer = setTimeout(() => {
      savedFlash = 0;
      syncChrome();
    }, 1400);
  }

  function syncSave() {
    const dirty = editGen !== savedGen;
    const label = savedFlash ? 'Saved' : 'Save';
    const state = label + (dirty && !savedFlash ? '*' : '') + (fileHandle ? fileHandle.name : '');
    if (saveBtn.dataset.state === state) return;
    saveBtn.dataset.state = state;
    saveBtn.textContent = '';
    saveBtn.classList.toggle('saved', !!savedFlash);
    if (savedFlash) saveBtn.appendChild(el('span', 'check'));
    saveBtn.appendChild(document.createTextNode(label));
    if (dirty && !savedFlash) saveBtn.appendChild(el('span', 'dot unsaved'));
    saveBtn.title = (fileHandle ? 'Save to ' + fileHandle.name : 'Save the spreadsheet and layout as one .zip') + ' (Ctrl+S)';
  }

  // ------------------------------------------------------ toolbar and grid

  function syncChrome() {
    toolbarEl.hidden = view.toolbarMin;
    blisterEl.hidden = !view.toolbarMin;
    gridBtn.textContent = '';
    if (view.grid) gridBtn.appendChild(el('span', 'dot'));
    gridBtn.appendChild(document.createTextNode('Grid'));
    syncSave();
    // Until something loads, only the drop zone and the file pill work.
    emptyEl.hidden = !!model;
    [gridBtn, $('tb-fit'), saveBtn, exportBtn, $('src-data'), $('tb-bookmarks')].forEach((b) => { b.disabled = !model; });
    toolSegs.querySelectorAll('[data-tool]').forEach((seg) => { seg.disabled = !model; });
    $('src-sample').hidden = $('src-div').hidden = !seedText;
    if (model) {
      srcName.textContent = model.fileName;
      srcEl.title = model.fileName;
    } else {
      srcName.textContent = 'Open a spreadsheet';
      srcEl.title = '';
    }
    syncGrid();
    syncTools();
  }

  function syncTools() {
    toolSegs.querySelectorAll('[data-tool]').forEach((seg) => {
      seg.classList.toggle('on', seg.dataset.tool === tool);
    });
  }

  function nearestStop(step) {
    let best = 0;
    for (let i = 1; i < GRID_STOPS.length; i++) {
      if (Math.abs(Math.log(GRID_STOPS[i] / step)) < Math.abs(Math.log(GRID_STOPS[best] / step))) best = i;
    }
    return best;
  }

  // Grid controls outside the popover (the board menu's rows) that follow
  // every grid change: [{ node, refresh }], dropped once off the page.
  const gridViews = new Set();

  function syncGrid() {
    gridOn.classList.toggle('on', view.grid);
    gridOff.classList.toggle('on', !view.grid);
    if (gridSlide) gridSlide.refresh();
    gridViews.forEach((v) => (v.node.isConnected ? v.refresh() : gridViews.delete(v)));
    const fudge = !!(model && model.fudge);
    gridFudge.classList.toggle('on', fudge);
    gridFudge.title = fudge
      ? 'Stickies draw as whole grid cells; areas stay true. Click to draw true sizes.'
      : 'Round each sticky to whole grid cells (closest area); areas stay true';
  }

  // The grid sets the buffer (a multiple of the step) and the fudge cell,
  // so a grid change moves stickies and is one undo step. The slider
  // records its step once, on press.
  function setGrid(on, step, record) {
    const next = step > 0 ? step : view.gridStep;
    if (on === view.grid && next === view.gridStep) return;
    if (record !== false) checkpoint();
    view.grid = on;
    view.gridStep = next;
    editGen += 1;
    applyParams();
    syncChrome();
    persistSoon();
    kick();
  }

  // The grid slider travels the stops; a typed step may be any size.
  function gridSlider() {
    const last = GRID_STOPS.length - 1;
    return slideControl({
      label: 'Grid size',
      min: 0.1,
      max: () => 1000,
      step: 0.1,
      stops: GRID_STOPS.length,
      toT: (v) => nearestStop(v) / last,
      fromT: (t) => GRID_STOPS[Math.round(t * last)],
      read: () => ({ value: view.gridStep, mixed: false }),
      write: (v) => {
        if (v !== view.gridStep || !view.grid) setGrid(true, v, false);
      },
      format: (v) => fmtStep(v) + ' ft',
      unit: 'ft',
      exact: true,
    });
  }

  // The board menu's compact grid: the popover's own slider (gridSlider)
  // with an on/off toggle in one capsule, then Fudge to grid beneath. The
  // same setters drive both, so each follows the other.
  function gridRows() {
    const row = addRow(el('div', 'cap row slide-row grid-row'));
    row.appendChild(el('span', 'k', 'Grid'));
    const slide = gridSlider();
    const on = button('toggle', null, () => setGrid(!view.grid));
    on.appendChild(el('span', 'knob'));
    on.title = 'Grid on or off (G)';
    row.append(slide.el, on);
    const fudge = toggleRow('Fudge to grid', () => !!model.fudge, setFudge);
    fudge.title = 'Round each sticky to whole grid cells (closest area); areas stay true';
    const refresh = () => {
      slide.refresh();
      on.classList.toggle('on', view.grid);
      row.classList.toggle('off', !view.grid);
      fudge.refresh();
    };
    refresh();
    gridViews.add({ node: row, refresh: refresh });
  }

  // Fudge draws whole cells only while the grid shows, so switching it on
  // turns the grid on too. Turning it off restores every true size.
  function setFudge(on) {
    if (!!model.fudge === on) return;
    checkpoint();
    model.fudge = on;
    if (on && !view.grid) view.grid = true;
    applyParams();
    syncChrome();
    persistSoon();
  }

  // ------------------------------------------------------------------ tools

  function setTool(next) {
    if (tool === next) return;
    cancelDraft();
    finishTextEdit(true);
    tool = next;
    closePop();
    syncTools();
    setCursor(tool === 'line' ? 'crosshair' : tool === 'text' ? 'text' : 'default');
    statusAt = 0;
    updateStatus();
    kick();
  }

  function setToolbarMin(min) {
    closePop();
    view.toolbarMin = min;
    syncChrome();
    persistSoon();
  }

  function wireToolbar() {
    gridBtn.addEventListener('click', () => togglePop(gridPop, gridBtn));
    $('tb-fit').addEventListener('click', fit);
    saveBtn.addEventListener('click', saveBoard);
    exportBtn.addEventListener('click', () => togglePop(exportPop, exportBtn));
    $('tb-min').addEventListener('click', () => setToolbarMin(true));
    blisterEl.addEventListener('click', () => setToolbarMin(false));
    gridOn.addEventListener('click', () => setGrid(true));
    gridOff.addEventListener('click', () => setGrid(false));
    gridFudge.addEventListener('click', () => setFudge(!model.fudge));
    toolSegs.addEventListener('click', (event) => {
      const seg = event.target.closest('[data-tool]');
      if (seg) setTool(seg.dataset.tool);
    });
    gridSlide = gridSlider();
    gridOff.parentNode.after(gridSlide.el);
    exportPop.addEventListener('click', (event) => {
      const kind = event.target.dataset && event.target.dataset.export;
      if (!kind) return;
      if (dataDashboard?.commitActive() === false) return;
      finishBoardMotion();
      if (kind === '3dm') {
        export3dm(event.target);
        return;
      }
      closePop();
      if (kind === 'csv') exportCsv();
      else if (kind === 'png') exportPng();
      else exportSvg();
    });
    $('src-open').addEventListener('click', () => fileInput.click());
    emptyEl.addEventListener('click', () => fileInput.click());
    emptyEl.addEventListener('keydown', (event) => {
      if (event.target !== emptyEl || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      fileInput.click();
    });
    $('src-sample').addEventListener('click', () => loadSeed(true));
    fileInput.addEventListener('change', () => {
      const files = Array.from(fileInput.files || []);
      fileInput.value = '';
      loadFiles(files);
    });
    wireBoardPanels();
  }

  function wireBoardPanels() {
    dataDashboard = window.ProgramDataDashboard.create({
      button: $('src-data'), getModel: () => model, engine,
      onEdit: ({rowIndex, key, value}) => {
        finishBoardMotion();
        const before = snapshot();
        const changed = engine.editRowField(model, rowIndex, key, value);
        if (!changed) return;
        pushUndo(before);
        modelChanged();
        colGen += 1;
        if (!model.frame) engine.frameAround(model);
        settle([]);
        syncChrome(); persistSoon(); kick();
      },
      onAddColumn: name => {
        finishBoardMotion();
        const before = snapshot();
        engine.ensureColumn(model, name);
        pushUndo(before);
        modelChanged(); colGen += 1;
        persistSoon(); kick();
      },
      onRoles: config => {
        finishBoardMotion();
        const before = snapshot();
        engine.setColumnRoles(model, config);
        pushUndo(before);
        modelChanged(); colGen += 1;
        syncParams(); settle([]);
        persistSoon(); kick();
      },
      onCommit: () => {
        flushEdits();
        toast('Data committed.');
      },
    });
    bookmarksPanel = window.ProgramBookmarks.create({
      button: $('tb-bookmarks'),
      getBookmarks: () => model?.bookmarks || [],
      setBookmarks: list => { checkpoint(); model.bookmarks = list; persistSoon(); kick(); },
      getState: () => {
        flushEdits();
        const state = JSON.parse(snapshot());
        delete state.board.bookmarks;
        return state;
      },
      restoreState: state => {
        if (dataDashboard.close() === false) throw new Error('Correct the highlighted table value before restoring a bookmark.');
        closeData();
        const from = presentedState();
        const surface = document.createElement('canvas');
        surface.width = canvas.width; surface.height = canvas.height;
        surface.getContext('2d').drawImage(canvas, 0, 0);
        flushEdits();
        const catalog = model.bookmarks;
        checkpoint();
        state.board.bookmarks = catalog;
        restoreSnap(JSON.stringify(state));
        animateBookmark(from, surface);
        toast('Bookmark restored. Ctrl+Z returns to the previous board.');
      },
    });
    $('src-data').addEventListener('click', () => {
      if (!dataDashboard.isOpen()) finishBoardMotion();
      closePop(); bookmarksPanel.close();
    }, true);
    $('tb-bookmarks').addEventListener('click', event => {
      if (dataDashboard.close() === false) { event.stopImmediatePropagation(); return; }
      closePop();
    }, true);
    $('tb-display').addEventListener('click', event => {
      if (dataDashboard.commitActive() === false) {
        event.stopImmediatePropagation();
        toast('Correct the highlighted table value before switching views.');
      }
    }, true);
  }

  // ---------------------------------------------------------------- export

  // Cropped to the frame and its title; stringers are board-only chrome.
  function exportBox() {
    const f = model.frame;
    let box;
    if (!f) {
      const b = engine.boundsOf(live());
      box = { x: b.x - EXPORT_PAD, y: b.y - EXPORT_PAD, w: b.w + EXPORT_PAD * 2, h: b.h + EXPORT_PAD * 2 };
    } else {
      const top = TITLE_UP + TITLE_SIZE * 1.4;
      const pad = 2;
      box = { x: f.x - pad, y: f.y - top - pad, w: f.w + pad * 2, h: f.h + top + pad * 2 };
    }
    // A blob that reaches past the frame is not cut off.
    const blobs = exportBlobs();
    if (!blobs.length) return leaderExportBox(box);
    let x0 = box.x;
    let y0 = box.y;
    let x1 = box.x + box.w;
    let y1 = box.y + box.h;
    blobs.forEach((e) => {
      const edge = e.style.stroke;
      e.shape.loops.forEach((l) => l.points.forEach((p) => {
        x0 = Math.min(x0, p[0] - edge);
        y0 = Math.min(y0, p[1] - edge);
        x1 = Math.max(x1, p[0] + edge);
        y1 = Math.max(y1, p[1] + edge);
      }));
    });
    blobLabels(blobs).forEach((at) => {
      y0 = Math.min(y0, at.y - engine.BLOB_LABEL - 1);
      x1 = Math.max(x1, at.x + at.w + 1);
    });
    return leaderExportBox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }

  function leaderExportBox(box) {
    return box;
  }

  function exportLeaderScene(box, z) {
    return leaderLayout(live(), z, -box.x * z, -box.y * z, box.w * z, box.h * z, z / camera.z, false);
  }

  // Every blob with an up-to-date outline, for the exports.
  function exportBlobs() {
    if (!model.blobs || !model.blobs.on.length) return [];
    blobList = blobCache.update(model);
    return blobList;
  }

  function exportCsv() {
    const name = baseName() + '.clone.csv';
    save(name, new Blob([engine.exportCsv(model)], { type: 'text/csv;charset=utf-8' }));
    toast('Downloaded ' + name + '. The original spreadsheet is unchanged.');
  }

  // The canvas background is never painted; the frame plate and title are,
  // so the stickies keep the paper they were laid out on.
  // The scale goes through the paint transform, never a bitmap resize.
  function renderPng() {
    return renderPngInfo().then((r) => (r ? r.blob : null));
  }

  // Resolves to { blob, w, h, scale, tiled, ms, base: { w, h } } or null.
  async function renderPngInfo() {
    const t0 = performance.now();
    const box = exportBox();
    const z = EXPORT_PX / Math.max(box.w, box.h);
    let r = null;
    if (typeof CompressionStream !== 'undefined') {
      try {
        r = await tiledPng(box, z, PNG_SCALE);
      } catch (err) {
        r = null;
      }
    }
    if (!r) r = await canvasPng(box, z, safePngScale(box, z));
    if (!r) return null;
    r.box = box;
    r.z = z;
    r.base = pngSize(box, z, 1);
    r.ms = Math.round(performance.now() - t0);
    return r;
  }

  function pngSize(box, z, scale) {
    return { w: Math.max(1, Math.round(box.w * z * scale)), h: Math.max(1, Math.round(box.h * z * scale)) };
  }

  // Paints the export into c, whose top-left is image pixel (x, y).
  function paintExport(c, box, z, scale, x, y, blobs) {
    preparedColors = window.ProgramAppearance.prepare(model);
    const ox = -box.x * z - x / scale;
    const oy = -box.y * z - y / scale;
    paintFrame(c, scale, z, ox, oy, EXPORT_LINE, false);
    paintBlobs(c, blobs, scale, z, ox, oy);
    paintLines(c, model.lines, scale, z, ox, oy);
    const leaders = exportLeaderScene(box, z);
    paintLeaderLines(c, leaders, scale, -x / scale, -y / scale);
    paintStickies(c, live(), scale, z, ox, oy, EXPORT_LINE, false, leaders);
    paintTexts(c, scale, z, ox, oy);
    paintLeaderLabels(c, leaders, scale, -x / scale, -y / scale, false);
  }

  // Bands of PNG_BAND rows, each painted in tiles of PNG_TILE columns and
  // streamed (Up-filtered) through zlib, so memory is one band, no canvas
  // passes PNG_TILE a side, and the page breathes between tiles.
  async function tiledPng(box, z, scale) {
    const { w, h } = pngSize(box, z, scale);
    const tw = Math.min(w, PNG_TILE);
    const th = Math.min(h, PNG_BAND);
    const tile = document.createElement('canvas');
    tile.width = tw;
    tile.height = th;
    const c = tile.getContext('2d', { willReadFrequently: true });
    if (!c) return null;
    const blobs = exportBlobs();
    const zlib = new CompressionStream('deflate');
    const writer = zlib.writable.getWriter();
    const packed = new Response(zlib.readable).arrayBuffer();
    const stride = w * 4 + 1;
    let above = new Uint8Array(w * 4);
    for (let y = 0; y < h; y += th) {
      const rows = Math.min(th, h - y);
      const band = new Uint8Array(rows * stride);
      for (let x = 0; x < w; x += tw) {
        const cols = Math.min(tw, w - x);
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalAlpha = 1;
        c.clearRect(0, 0, tw, th);
        paintExport(c, box, z, scale, x, y, blobs);
        const px = c.getImageData(0, 0, cols, rows).data;
        const span = cols * 4;
        for (let r = 0; r < rows; r++) band.set(px.subarray(r * span, r * span + span), r * stride + 1 + x * 4);
        await new Promise((done) => setTimeout(done, 0));
      }
      const last = band.slice((rows - 1) * stride + 1, rows * stride);
      for (let r = rows - 1; r >= 0; r--) {
        const at = r * stride;
        band[at] = 2;
        if (r > 0) for (let i = 1; i < stride; i++) band[at + i] -= band[at - stride + i];
        else for (let i = 1; i < stride; i++) band[i] -= above[i - 1];
      }
      above = last;
      await writer.ready;
      writer.write(band);
    }
    writer.close();
    const idat = new Uint8Array(await packed);
    const head = new Uint8Array(13);
    const v = new DataView(head.buffer);
    v.setUint32(0, w);
    v.setUint32(4, h);
    head.set([8, 6, 0, 0, 0], 8);
    const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const blob = new Blob([sig, pngChunk('IHDR', head), pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0))], { type: 'image/png' });
    return { blob, w, h, scale, tiled: true };
  }

  function pngChunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    v.setUint32(8 + data.length, engine.crc32(out.subarray(4, 8 + data.length)));
    return out;
  }

  // Without CompressionStream: one canvas at the largest scale every browser
  // holds, and 1x if even that is refused.
  function canvasPng(box, z, scale) {
    const { w, h } = pngSize(box, z, scale);
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const c = out.getContext('2d');
    if (!c) return Promise.resolve(scale > 1 ? canvasPng(box, z, 1) : null);
    paintExport(c, box, z, scale, 0, 0, exportBlobs());
    return new Promise((done) => out.toBlob(done, 'image/png')).then((blob) => {
      if (blob) return { blob, w, h, scale, tiled: false };
      return scale > 1 ? canvasPng(box, z, 1) : null;
    });
  }

  function safePngScale(box, z) {
    const one = pngSize(box, z, 1);
    const fit = Math.min(PNG_SCALE, PNG_MAX_SIDE / Math.max(one.w, one.h), Math.sqrt(PNG_SAFE_AREA / (one.w * one.h)));
    return Math.max(1, Math.floor(fit * 10) / 10);
  }

  // cad.js is loaded on first use only, and only once; a missing file can
  // be added and tried again without reloading the board.
  function loadCad() {
    if (window.ProgramBoardCad) return Promise.resolve(window.ProgramBoardCad);
    if (cadScript) return cadScript;
    cadScript = new Promise((done, fail) => {
      const tag = document.createElement('script');
      tag.src = 'cad.js';
      tag.onload = () => {
        if (window.ProgramBoardCad && typeof window.ProgramBoardCad.export3dm === 'function') done(window.ProgramBoardCad);
        else {
          cadScript = null;
          fail(new Error('cad.js loaded but has no export3dm'));
        }
      };
      tag.onerror = () => {
        cadScript = null;
        tag.remove();
        fail(new Error('cad.js is missing next to index.html'));
      };
      document.head.appendChild(tag);
    });
    return cadScript;
  }

  function cadScene() {
    const scene = engine.buildCadScene(model, { font: FACES[view.face].title });
    // Wrapped text goes out as the lines the board shows, in its own face.
    for (let i = 0; i < scene.texts.length; i++) {
      scene.texts[i].text = textLayout(model.texts[i]).lines.join('\n');
      scene.texts[i].font = FACES[engine.textStyleOf(model.texts[i], view).face].title;
    }
    // Each sticky's label goes out at the size and wrap the board fitted,
    // with its own ink when it has one (else cad.js follows the fill).
    const list = live();
    for (let i = 0; i < scene.stickies.length; i++) {
      const e = labelFor(list[i]);
      scene.stickies[i].label = {
        size: e.f, lines: e.lines.slice(), lineH: e.lineH, y0: e.y0,
        area: e.area, areaText: e.areaText, areaSize: e.f * AREA, areaY: e.areaY, color: e.own,
      };
    }
    return scene;
  }

  async function export3dm(seg) {
    if (cadBusy || !live().length) return;
    cadBusy = true;
    const label = seg.textContent;
    seg.textContent = 'Preparing 3DM\u2026';
    seg.disabled = true;
    try {
      const cad = await loadCad();
      const scene = cadScene();
      const bytes = await cad.export3dm(scene);
      if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error('cad.js returned no bytes');
      const name = baseName() + '.3dm';
      save(name, new Blob([bytes], { type: 'application/octet-stream' }));
      toast('Downloaded ' + name + '.');
    } catch (err) {
      toast('3DM export failed: ' + (err && err.message ? err.message : String(err)));
    } finally {
      cadBusy = false;
      seg.textContent = label;
      seg.disabled = false;
      closePop();
    }
  }

  function exportPng() {
    if (pngBusy || !live().length) return;
    pngBusy = true;
    const name = baseName() + '.png';
    toast('Rendering ' + name + '\u2026');
    renderPngInfo().then((r) => {
      if (!r) {
        toast('Could not render the PNG.');
        return;
      }
      save(name, r.blob);
      const limit = r.scale < PNG_SCALE ? ' at ' + r.scale.toFixed(1) + '\u00d7 (browser limit)' : '';
      toast('Downloaded ' + name + limit + ', ' + r.w + ' \u00d7 ' + r.h + ' px.');
    }, () => toast('Could not render the PNG.')).then(() => {
      pngBusy = false;
    });
  }

  function num2(n) {
    return String(Math.round(n * 100) / 100);
  }

  // Small stickies carry sub-foot type, so text keeps four decimals.
  function num4(n) {
    return String(Math.round(n * 10000) / 10000);
  }

  // `family`, when given, overrides the group's font.
  function svgText(x, y, size, fill, text, family) {
    return '<text x="' + num4(x) + '" y="' + num4(y) + '" font-size="' + num4(size) + '" fill="' + fill + '"'
      + (family ? ' font-family="' + xml(family) + '"' : '') + '>' + xml(text) + '</text>';
  }

  // The same fitted world-space labels as the PNG and the board.
  function svgMarkup() {
    preparedColors = window.ProgramAppearance.prepare(model);
    const list = live();
    const box = exportBox();
    const leaders = exportLeaderScene(box, 1);
    const long = Math.max(box.w, box.h);
    const px = SVG_PX / long;
    const out = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + [box.x, box.y, box.w, box.h].map(num2).join(' ')
        + '" width="' + num2(box.w * px) + '" height="' + num2(box.h * px) + '">',
    ];
    const f = model.frame;
    if (f) {
      out.push('<rect x="' + num2(f.x) + '" y="' + num2(f.y) + '" width="' + num2(f.w) + '" height="' + num2(f.h)
        + '" rx="' + FRAME_RADIUS + '" fill="' + frameFill() + '"/>');
      if (f.title) {
        out.push('<text x="' + num2(f.x + TITLE_IN) + '" y="' + num2(f.y - TITLE_UP) + '" font-family="'
          + xml(FACES[view.face].css) + '" font-weight="400" font-size="' + num2(TITLE_SIZE)
          + '" fill="' + TITLE_INK + '">' + xml(f.title) + '</text>');
      }
    }
    const blobs = exportBlobs();
    if (blobs.length) {
      out.push('<g stroke-linejoin="round" fill-rule="evenodd">');
      blobs.forEach((e) => {
        if (!e.shape.loops.length) return;
        // Real lines and arcs, the same contour the board and the PNG draw.
        const d = window.ProgramBoardBlob
          ? window.ProgramBoardBlob.svgPath(e.shape.loops, num4)
          : e.shape.loops.map((l) => 'M' + l.points.map((p) => num2(p[0]) + ' ' + num2(p[1])).join('L') + 'Z').join('');
        // A zero stroke writes no stroke at all.
        const edge = e.style.stroke > 0 ? '" stroke="' + e.style.color + '" stroke-width="' + num4(e.style.stroke)
          + '" stroke-opacity="' + num2(blobEdgeAlpha(e.style.alpha)) : '';
        out.push('<path d="' + d + '" fill="' + e.style.color + '" fill-opacity="' + num2(e.style.alpha) + edge + '"/>');
      });
      out.push('</g>', '<g font-family="' + xml(FACES[view.face].css) + '" font-weight="400" text-anchor="start">');
      blobLabels(blobs).forEach((at) => {
        out.push('<text x="' + num4(at.x) + '" y="' + num4(at.y) + '" font-size="' + num4(engine.BLOB_LABEL) + '" fill="' + at.e.style.color
          + '" fill-opacity="0.92">' + xml(at.e.value) + '</text>');
      });
      out.push('</g>');
    }
    if (model.lines.length) {
      // The same stroke and end caps the board draws (engine.lineShape), as
      // explicit geometry rather than markers.
      const pts = (list) => list.map((p) => num4(p[0]) + ',' + num4(p[1])).join(' ');
      out.push('<g stroke-linecap="butt" stroke-linejoin="miter">');
      for (let i = 0; i < model.lines.length; i++) {
        const l = model.lines[i];
        const shape = engine.lineShape(l);
        const ink = lineInk(l);
        out.push('<polyline points="' + pts(shape.path) + '" fill="none" stroke="' + ink + '" stroke-width="' + num4(l.width) + '"/>');
        shape.caps.forEach((cap) => {
          if (cap.k === 'dot') out.push('<circle class="line-end" cx="' + num4(cap.x) + '" cy="' + num4(cap.y) + '" r="' + num4(cap.r) + '" fill="' + ink + '"/>');
          else if (cap.k === 'fill') out.push('<polygon class="line-end" points="' + pts(cap.pts) + '" fill="' + ink + '"/>');
          else out.push('<polyline class="line-end" points="' + pts(cap.pts) + '" fill="none" stroke="' + ink + '" stroke-width="' + num4(cap.w) + '"/>');
        });
      }
      out.push('</g>');
    }
    if (leaders.items.length) {
      const leaderInk = isDark(view.background) ? '#f4f2ee' : '#4b4e50';
      out.push('<g fill="none" stroke="' + leaderInk + '" stroke-opacity="0.46" stroke-width="' + num4(0.75 * leaders.size) + '" stroke-linejoin="round">');
      leaders.items.forEach((e) => {
        const p = [e.anchor, e.elbow, e.end].map((p) => num4(p.x + box.x) + ',' + num4(p.y + box.y)).join(' ');
        out.push('<polyline class="auto-leader" points="' + p + '"/>');
      });
      out.push('</g>');
    }
    // One drop-shadow filter per shadow size, its region the whole drawing
    // so a small sticky's blur is never clipped.
    const shadows = new Map();
    for (let i = 0; i < list.length; i++) {
      const S = list[i].shadow;
      if (S > 0 && !shadows.has(S)) shadows.set(S, 'sh' + shadows.size);
    }
    if (shadows.size) {
      out.push('<defs>');
      shadows.forEach((id, S) => {
        out.push('<filter id="' + id + '" filterUnits="userSpaceOnUse" x="' + num2(box.x) + '" y="' + num2(box.y) + '" width="' + num2(box.w)
          + '" height="' + num2(box.h) + '"><feDropShadow dx="0" dy="' + num4(S * SHADOW_DROP) + '" stdDeviation="' + num4(S / 2)
          + '" flood-color="#000000" flood-opacity="' + SHADOW_ALPHA + '"/></filter>');
      });
      out.push('</defs>');
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (!(s.shadow > 0)) continue;
        out.push('<rect x="' + num2(s.x) + '" y="' + num2(s.y) + '" width="' + num2(s.w) + '" height="' + num2(s.h) + '" rx="' + num2(radiusOf(s))
          + '" fill="' + stickyFill(s) + '" filter="url(#' + shadows.get(s.shadow) + ')"/>');
      }
    }
    out.push('<g>');
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const r = radiusOf(s);
      const fill = stickyFill(s);
      const rx = r > 0 ? '" rx="' + num2(r) : '';
      out.push('<rect x="' + num2(s.x) + '" y="' + num2(s.y) + '" width="' + num2(s.w) + '" height="' + num2(s.h) + rx
        + '" fill="' + fill + '" stroke="#322a20" stroke-opacity="0.2" stroke-width="1" vector-effect="non-scaling-stroke"/>');
      const modules = engine.moduleLayout(model, s);
      if (modules?.lines.length) {
        const clip = 'module-clip-' + i;
        out.push('<defs><clipPath id="' + clip + '"><rect x="' + num4(s.x) + '" y="' + num4(s.y) + '" width="' + num4(s.w) + '" height="' + num4(s.h) + '" rx="' + num4(r) + '"/></clipPath></defs>');
        const path = modules.lines.map(l => 'M' + num4(s.x + l.x1) + ' ' + num4(s.y + l.y1) + 'L' + num4(s.x + l.x2) + ' ' + num4(s.y + l.y2)).join('');
        out.push('<path class="module-cells" d="' + path + '" clip-path="url(#' + clip + ')" fill="none" stroke="' + (isDark(fill) ? '#ffffff' : '#322a20') + '" stroke-opacity="0.22" stroke-width="0.65" vector-effect="non-scaling-stroke"/>');
      }
      if (s.stroke > 0) {
        const sw = Math.min(s.stroke, Math.min(s.w, s.h) * 0.5);
        const h = sw / 2;
        out.push('<rect x="' + num4(s.x + h) + '" y="' + num4(s.y + h) + '" width="' + num4(Math.max(0, s.w - sw)) + '" height="' + num4(Math.max(0, s.h - sw))
          + (r > 0 ? '" rx="' + num4(Math.max(0, r - h)) : '') + '" fill="none" stroke="' + strokeInk(fill) + '" stroke-width="' + num4(sw) + '"/>');
      }
    }
    const boardFont = FACES[view.face].css;
    const own = (css) => (css !== boardFont ? css : null);
    out.push('</g>', '<g font-family="' + xml(boardFont) + '" font-weight="400" text-anchor="middle" dominant-baseline="central">');
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (leaders.ids && leaders.ids.has(s.id)) continue;
      const e = labelFor(s);
      const cx = s.x + s.w * 0.5;
      const cy = s.y + s.h * 0.5;
      for (let j = 0; j < e.lines.length; j++) {
        out.push(svgText(cx, cy + e.y0 + j * e.lineH, e.f, e.ink, e.lines[j], own(e.css)));
      }
      if (e.area) out.push(svgText(cx, cy + e.areaY, e.f * AREA, e.sub, e.areaText, own(e.css)));
    }
    out.push('</g>');
    if (model.texts.length) {
      out.push('<g font-family="' + xml(boardFont) + '" font-weight="400" text-anchor="start" dominant-baseline="central">');
      for (let i = 0; i < model.texts.length; i++) {
        const t = model.texts[i];
        const lay = textLayout(t);
        for (let j = 0; j < lay.lines.length; j++) {
          out.push(svgText(t.x, t.y + t.size * TEXT_LEAD * (j + 0.5), t.size, textInk(t), lay.lines[j], own(lay.css)));
        }
      }
      out.push('</g>');
    }
    if (leaders.items.length) {
      const size = leaders.size;
      const dark = isDark(view.background);
      out.push('<g class="auto-leader-labels" dominant-baseline="central">');
      leaders.items.forEach((e) => {
        const b = e.label;
        const x = box.x + (e.side === 'left' ? b.x + b.w : b.x);
        const measureFont = measure.font;
        measure.font = (11 * size) + 'px ' + e.source.css;
        const name = fitCalloutText(measure, e.text, b.w);
        measure.font = measureFont;
        out.push('<rect x="' + num4(box.x + b.x - 4 * size) + '" y="' + num4(box.y + b.y - 2 * size) + '" width="' + num4(b.w + 8 * size) + '" height="' + num4(b.h + 4 * size) + '" fill="' + view.background + '" fill-opacity="0.94"/>');
        out.push('<g text-anchor="' + (e.side === 'left' ? 'end' : 'start') + '" font-family="' + xml(e.source.css) + '">');
        out.push(svgText(x, box.y + b.y + 6 * size, 11 * size, e.source.ink || (dark ? INK_LIGHT : INK), name));
        out.push(svgText(x, box.y + b.y + 18 * size, 9 * size, dark ? '#b9b8b5' : INK_SUB, e.source.area));
        out.push('</g>');
      });
      out.push('</g>');
    }
    out.push('</svg>', '');
    return out.join('\n');
  }

  function exportSvg() {
    if (!live().length) return;
    const name = baseName() + '.svg';
    save(name, new Blob([svgMarkup()], { type: 'image/svg+xml' }));
    toast('Downloaded ' + name + '.');
  }

  // --------------------------------------------------------------- loading

  function fileKind(file) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.pboard') || lower.endsWith('.zip')) return 'zip';
    if (lower.endsWith('.json')) return 'layout';
    if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) return 'xlsx';
    return 'csv';
  }

  // One drop or one pick: a saved .pboard or .zip; a spreadsheet and a .layout.json
  // together (the same as the zip); a spreadsheet alone (a fresh packed
  // board); or a layout alone (it carries its own rows).
  async function loadFiles(list) {
    const files = Array.from(list || []);
    if (!files.length) return;
    if (dataDashboard?.commitActive() === false) return;
    try {
      const zipFile = files.find((f) => fileKind(f) === 'zip');
      let parts;
      let label;
      if (zipFile) {
        parts = await engine.readSaveZip(await zipFile.arrayBuffer());
        label = zipFile.name;
      } else {
        const sheet = files.find((f) => fileKind(f) === 'csv' || fileKind(f) === 'xlsx');
        const layout = files.find((f) => fileKind(f) === 'layout');
        parts = {};
        if (sheet) {
          const bytes = new Uint8Array(await sheet.arrayBuffer());
          parts.csvName = sheet.name;
          if (fileKind(sheet) === 'xlsx') parts.matrix = await engine.xlsxToMatrix(bytes.buffer);
          else {
            parts.csvBytes = bytes;
            parts.csvText = new TextDecoder().decode(bytes);
          }
        }
        if (layout) parts.layout = await layout.text();
        label = [sheet, layout].filter(Boolean).map((f) => f.name).join(' + ');
      }
      opened(engine.openSave(parts), label);
    } catch (err) {
      toast(err && err.message ? err.message : 'Could not read that file.');
    }
  }

  // A layout brings back the frame, stickies, groups, lines, text,
  // typeface, background, grid, and camera; its custom swatches join
  // yours. New or resized stickies from an edited sheet then settle.
  function opened(res, label) {
    if (model) checkpoint();
    if (res.view) {
      const theirs = normalizeView(res.view).custom;
      const custom = {};
      Object.keys(view.custom).forEach((kind) => {
        custom[kind] = view.custom[kind].filter((hex) => theirs[kind].indexOf(hex) < 0).concat(theirs[kind]);
      });
      view = normalizeView(Object.assign({}, view, { textScale: 1, textColor: null }, res.view, { toolbarMin: view.toolbarMin, custom: custom }));
    }
    install(res.model);
    useFace(view.face);
    syncChrome();
    if (res.camera) camera = { x: res.camera.x, y: res.camera.y, z: clampZoom(res.camera.z) };
    else fit();
    const s = res.summary;
    if (!s.exact && (s.added || s.resized)) containFrame();
    persist();
    kick();
    if (!res.view) {
      toast('Loaded ' + live().length + ' spaces from ' + model.fileName + '. Ctrl+Z brings the last board back.');
      return;
    }
    const bits = ['Restored ' + s.restored];
    if (s.added) bits.push(s.added + ' new');
    if (s.removed) bits.push(s.removed + ' removed');
    if (s.resized) bits.push(s.resized + (s.resized === 1 ? ' area' : ' areas') + ' updated');
    toast(bits.join(' \u00b7 ') + (s.exact ? ' from ' + label : '') + '. Ctrl+Z brings the last board back.');
  }

  function loadSeed(force) {
    if (!seedText) return;
    const next = engine.modelFromCsv(seedText, seedName);
    engine.pack(next);
    if (force && model) checkpoint();
    install(next);
    fit();
    persist();
    if (force) toast('Sample reloaded. Ctrl+Z brings your board back.');
  }

  // ?perf: the sample's drawable rows repeated to the sticky limit.
  function perfModel() {
    const matrix = engine.parseCsv(seedText);
    const header = matrix[0];
    const areaCol = header.indexOf('SubTotal');
    const drawn = matrix.slice(1).filter((row) => engine.num(row[areaCol]) > 0);
    const rows = [header];
    for (let i = 0; i < engine.MAX_STICKIES; i++) rows.push(drawn[i % drawn.length].slice());
    const next = engine.modelFromMatrix(rows, 'perf-' + engine.MAX_STICKIES + '.csv');
    engine.pack(next);
    return next;
  }

  // ------------------------------------------------------ pointer and keys

  function setCursor(value) {
    if (cursor === value) return;
    cursor = value;
    canvas.style.cursor = value;
  }

  function noteMods(event) {
    mods.shift = !!event.shiftKey;
    mods.ctrl = !!(event.ctrlKey || event.metaKey);
    mods.alt = !!event.altKey;
  }

  function hover(sx, sy) {
    const p = s2w(sx, sy);
    pointerWorld = p;
    hoverAt = { x: sx, y: sy };
    if (spaceDown) {
      setCursor('grab');
      return;
    }
    if (tool === 'line') {
      if (draft && !draft.down) updateDraft(p, lastShift);
      setCursor('crosshair');
      kick();
      return;
    }
    if (tool === 'text') {
      setCursor('text');
      kick();
      return;
    }
    const fillet = hitFillet(sx, sy);
    const handle = fillet ? null : hitHandle(sx, sy);
    const grip = fillet || handle ? null : hitLineGrip(sx, sy);
    const hit = fillet || handle || grip ? null : hitLeader(sx, sy) || pickAt(p.x, p.y);
    const callout = hitLeader(sx, sy);
    canvas.title = callout ? labelFor(callout.item).name + ' \u00b7 ' + labelFor(callout.item).areaText : '';
    const sticky = hit && hit.kind === 'sticky' ? hit.item : null;
    const group = sticky && sticky.group ? sticky.group : null;
    const over = sticky ? sticky.id : fillet ? fillet.id : hoverSticky && handle ? hoverSticky : null;
    const dim = !hit && !fillet && !handle && !grip && hitDim(sx, sy);
    const title = !hit && !fillet && !handle && !grip && !dim && hitTitle(sx, sy);
    const blob = hit || fillet || handle || grip || dim || title ? null : blobAt(p.x, p.y);
    const blobMoved = blob ? !hoverBlob || blob.key !== hoverBlob.key || blob.value !== hoverBlob.value : !!hoverBlob;
    if (group !== hoverGroup || over !== hoverSticky || !!fillet !== hotGrip || blobMoved) {
      hoverGroup = group;
      hoverSticky = over;
      hotGrip = !!fillet;
      hoverBlob = blob ? { key: blob.key, value: blob.value } : null;
      kick();
    }
    if (fillet) setCursor('pointer');
    else if (handle) setCursor(RESIZE_CURSORS[handle.edge]);
    else if (grip) setCursor('crosshair');
    else if (hit || blob) setCursor(mods.alt ? 'copy' : mods.ctrl ? 'move' : 'grab');
    else if (dim) setCursor('text');
    else if (title) setCursor('move');
    else setCursor('default');
  }

  function onPointerDown(event) {
    finishBookmarkTransition(true);
    if (!model) return;
    if (swallowClick) {
      swallowClick = false;
      return;
    }
    const sx = event.clientX;
    const sy = event.clientY;
    noteMods(event);
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (err) {
      /* synthetic events have no pointer to capture */
    }
    if (event.button === 2) {
      drag = { kind: 'right', x0: sx, y0: sy, lx: sx, ly: sy, moved: false };
      return;
    }
    if (event.button === 1 || (event.button === 0 && spaceDown)) {
      event.preventDefault();
      drag = { kind: 'pan', lx: sx, ly: sy, moved: true };
      setCursor('grabbing');
      return;
    }
    if (event.button !== 0) return;
    if (bundling) endBundle();
    lastShift = event.shiftKey;
    const p = s2w(sx, sy);
    if (tool === 'line') {
      linePress(p, sx, sy, event.shiftKey);
      return;
    }
    if (tool === 'text') {
      event.preventDefault();
      if (textEdit) {
        finishTextEdit(true);
        if (tool !== 'text') return;
      }
      drag = { kind: 'text', wx0: p.x, wy0: p.y, wx1: p.x, x0: sx, y0: sy, moved: false };
      return;
    }
    const fillet = hitFillet(sx, sy);
    if (fillet) {
      // Anchored at the press, so grabbing the grip never jumps the radius.
      drag = {
        kind: 'fillet', s: fillet, x0: sx, y0: sy, moved: false,
        grab: radiusOf(fillet) - (p.x - fillet.x),
      };
      if (!selected.has(fillet.id)) setSelection([fillet.id]);
      return;
    }
    const handle = hitHandle(sx, sy);
    if (handle) {
      const s = sole();
      drag = {
        kind: 'resize', edge: handle.edge, corner: handle.corner, s: s,
        origin: { x: s.x, y: s.y, w: s.w, h: s.h, tw: s.tw, th: s.th }, x0: sx, y0: sy, moved: false,
      };
      return;
    }
    const grip = hitLineGrip(sx, sy);
    if (grip) {
      drag = { kind: 'grip', line: grip.line, index: grip.index, x0: sx, y0: sy, moved: false };
      return;
    }
    const hit = hitLeader(sx, sy) || pickAt(p.x, p.y);
    if (!hit || hit.kind !== 'sticky' || !selected.has(hit.item.id)) closeData();
    if (hit) {
      if (event.altKey) event.preventDefault();
      startMove(hit, p, event);
      return;
    }
    const dim = hitDim(sx, sy);
    if (dim) {
      // Suppresses the press's default focus change, which would blur (and
      // so commit) the input this press just opened.
      event.preventDefault();
      drag = null;
      startDimEdit(dim);
      return;
    }
    if (hitTitle(sx, sy)) {
      startFrameMove(p, sx, sy);
      return;
    }
    const blob = blobAt(p.x, p.y);
    if (blob && blob.members.length) {
      if (event.altKey) event.preventDefault();
      startMove(blob, p, event);
      return;
    }
    if (!event.shiftKey) {
      if (anySelected()) setSelection([]);
      selectFrame(false);
    }
    drag = {
      kind: 'marquee', wx0: p.x, wy0: p.y, wx1: p.x, wy1: p.y,
      base: event.shiftKey ? Array.from(selected) : [],
      baseLines: event.shiftKey ? Array.from(selLines) : [],
      baseTexts: event.shiftKey ? Array.from(selTexts) : [],
      x0: sx, y0: sy, moved: false,
    };
    kick();
  }

  // A press on a sticky, line, or text starts a move of the whole
  // selection. Modifiers held at the press are drag modifiers, the same as
  // ones pressed later: a Shift press toggles membership only if it ends
  // without moving (a click); moved, it is an axis-locked (or, with Ctrl,
  // ghost) drag of what a plain press would move. Alt duplicates. A blob
  // (a blobAt hit) moves as its member stickies, with their groups: the
  // press selects them all, and a click on it collapses to just them.
  function startMove(hit, p, event) {
    const blob = hit.kind === 'blob';
    const item = hit.item;
    const kind = blob ? 'sticky' : hit.kind;
    const set = kind === 'sticky' ? selected : kind === 'line' ? selLines : selTexts;
    const own = blob ? engine.expandToGroups(model, hit.members.map((s) => s.id)) : kind === 'sticky' ? groupOf(item.id) : [item.id];
    const had = blob ? own.every((id) => selected.has(id)) : set.has(item.id);
    let collapse = null;
    let toggle = null;
    if (event.shiftKey) {
      toggle = { kind: kind, own: own, had: had, prev: [Array.from(selected), Array.from(selLines), Array.from(selTexts)] };
    }
    if (had) {
      if (!toggle && selected.size + selLines.size + selTexts.size > own.length) collapse = blob ? { kind: 'blob', own: own } : hit;
    } else {
      if (kind === 'sticky') setSelection(own);
      else if (kind === 'line') setSelection([], own);
      else setSelection([], [], own);
    }
    const items = stickiesFor(expanded()).map((s) => ({ s: s, x: s.x, y: s.y }));
    const lines = linesFor(selLines).map((l) => ({ l: l, pts: l.points.map((q) => [q[0], q[1]]) }));
    const texts = textsFor(selTexts).map((t) => ({ t: t, x: t.x, y: t.y }));
    const anchor = blob
      ? engine.boundsOf(hit.members)
      : kind === 'sticky'
        ? { x: item.x, y: item.y, w: item.w, h: item.h, sticky: item }
        : kind === 'line'
          ? { x: item.points[0][0], y: item.points[0][1], w: 0, h: 0 }
          : { x: item.x, y: item.y, w: 0, h: 0 };
    drag = {
      kind: 'move', anchor: anchor, items: items, lines: lines, texts: texts,
      ax: p.x, ay: p.y, x0: event.clientX, y0: event.clientY, moved: false, axis: null, collapse: collapse,
      toggle: toggle, mode: dragMode(event), dup: false, lx: event.clientX, ly: event.clientY,
    };
    armDuplicate(event);
    setCursor(dragCursor(event.shiftKey));
    kick();
  }

  // Alt decides duplication until the drag begins (at the press or while
  // still inside the slop); after that the copy either exists or does not.
  function armDuplicate(event) {
    if (drag && drag.kind === 'move' && !drag.moved) drag.dup = !!event.altKey && drag.items.length + drag.lines.length > 0;
  }

  // A Shift press that never moved was a click: toggle membership.
  function applyToggle(t) {
    const pick = (list, kind) => {
      if (t.kind !== kind) return list;
      const next = new Set(list);
      for (let i = 0; i < t.own.length; i++) {
        if (t.had) next.delete(t.own[i]);
        else next.add(t.own[i]);
      }
      return next;
    };
    setSelection(pick(t.prev[0], 'sticky'), pick(t.prev[1], 'line'), pick(t.prev[2], 'text'));
  }

  // Alt-drag: the selection's stickies (new rows) and lines are copied
  // where they stand, and the copies are what moves. Each sticky passes
  // through its original until dropped; lines never meet lines.
  function beginDuplicate() {
    let copies = [];
    if (drag.items.length) {
      copies = engine.duplicateStickies(model, drag.items.map((item) => item.s.id));
      if (!copies) {
        toast('A board holds at most ' + engine.MAX_STICKIES + ' stickies.');
        drag.dup = false;
        return;
      }
      touchList();
      textGen += 1;
      colGen += 1;
    }
    const lineCopies = drag.lines.map((it) => {
      const copy = { id: engine.uid('l'), points: it.pts.map((q) => [q[0], q[1]]), width: it.l.width };
      ['color', 'start', 'end'].forEach((prop) => engine.setLineStyle([copy], prop, it.l[prop]));
      return copy;
    });
    if (lineCopies.length) {
      for (let i = 0; i < lineCopies.length; i++) model.lines.push(lineCopies[i]);
      model.lineGen += 1;
    }
    drag.items = copies.map((s) => ({ s: s, x: s.x, y: s.y }));
    drag.lines = lineCopies.map((l) => ({ l: l, pts: l.points.map((q) => [q[0], q[1]]) }));
    drag.texts = [];
    setSelection(copies.map((s) => s.id), lineCopies.map((l) => l.id));
  }

  // Ctrl holds everyone else still; Ctrl+Shift ghosts through; Shift alone
  // locks the axis.
  function dragMode(event) {
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl && event.shiftKey) return 'ghost';
    if (ctrl) return 'isolate';
    return 'normal';
  }

  // Before the axis is known, held Shift already shows the axis family.
  function dragCursor(shift) {
    if (drag.dup) return 'copy';
    if (drag.mode === 'isolate') return 'move';
    if (drag.mode === 'ghost') return 'grabbing';
    if (drag.axis === 'x') return 'ew-resize';
    if (drag.axis === 'y') return 'ns-resize';
    if (shift) return 'all-scroll';
    return 'grabbing';
  }

  // The title is the frame's handle: a click selects it, a drag carries the
  // frame and every sticky whose centre is inside it.
  function startFrameMove(p, sx, sy) {
    const f = model.frame;
    setSelection([]);
    selectFrame(true);
    drag = {
      kind: 'frame', ax: p.x, ay: p.y, fx: f.x, fy: f.y, x0: sx, y0: sy, moved: false,
      items: engine.frameMembers(model).map((s) => ({ s: s, x: s.x, y: s.y })),
      lines: model.lines.filter((l) => lineInFrame(l, f)).map((l) => ({ l: l, pts: l.points.map((q) => [q[0], q[1]]) })),
    };
    kick();
  }

  // Lines that touch the frame travel with it, so what they separate
  // inside stays separated.
  function lineInFrame(l, f) {
    const pts = l.points;
    for (let i = 0; i + 1 < pts.length; i++) {
      if (engine.cutsBox(f.x, f.y, f.x + f.w, f.y + f.h, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])) return true;
    }
    return false;
  }

  function moveFrameTo(sx, sy) {
    const f = model.frame;
    const p = s2w(sx, sy);
    let dx = p.x - drag.ax;
    let dy = p.y - drag.ay;
    if (view.grid) {
      const snap = engine.snapDelta(drag.fx + dx, drag.fy + dy, f.w, f.h, view.gridStep);
      dx += snap.dx;
      dy += snap.dy;
    }
    f.x = drag.fx + dx;
    f.y = drag.fy + dy;
    for (let i = 0; i < drag.items.length; i++) {
      const item = drag.items[i];
      item.s.x = item.x + dx;
      item.s.y = item.y + dy;
    }
    for (let i = 0; i < drag.lines.length; i++) {
      const it = drag.lines[i];
      for (let p = 0; p < it.pts.length; p++) {
        it.l.points[p][0] = it.pts[p][0] + dx;
        it.l.points[p][1] = it.pts[p][1] + dy;
      }
    }
    if (drag.lines.length) model.lineGen += 1;
  }

  function onPointerMove(event) {
    const sx = event.clientX;
    const sy = event.clientY;
    lastShift = event.shiftKey;
    noteMods(event);
    if (!drag) {
      if (model) hover(sx, sy);
      return;
    }
    if (drag.kind === 'line') {
      lineDragTo(sx, sy, event.shiftKey);
      return;
    }
    if (drag.kind === 'right' && !drag.moved) {
      if (Math.hypot(sx - drag.x0, sy - drag.y0) < DRAG_SLOP) return;
      drag.moved = true;
      closePop();
      setCursor('grabbing');
    }
    if (drag.kind === 'right' || drag.kind === 'pan') {
      panBy(sx - drag.lx, sy - drag.ly);
      drag.lx = sx;
      drag.ly = sy;
      return;
    }
    if (!drag.moved) {
      if (drag.kind === 'move') {
        drag.mode = dragMode(event);
        armDuplicate(event);
        setCursor(dragCursor(event.shiftKey));
      }
      if (Math.hypot(sx - drag.x0, sy - drag.y0) < DRAG_SLOP) return;
      drag.moved = true;
      if (drag.kind === 'move' || drag.kind === 'resize' || drag.kind === 'grip' || drag.kind === 'frame') stopSettle();
      if (drag.kind === 'move') {
        checkpoint();
        if (drag.dup) beginDuplicate();
        bringForward(drag.items.map((item) => item.s.id));
        for (let i = 0; i < drag.lines.length; i++) drag.lines[i].l.dragging = true;
        if (drag.lines.length) model.lineGen += 1;
      } else if (drag.kind === 'resize' || drag.kind === 'fillet' || drag.kind === 'grip') {
        checkpoint();
      } else if (drag.kind === 'frame') {
        checkpoint();
        setCursor('move');
      }
    }
    maxPush = Math.max(2, Math.hypot(event.movementX || 0, event.movementY || 0) / camera.z);
    if (drag.kind === 'move') {
      drag.lx = sx;
      drag.ly = sy;
      drag.mode = dragMode(event);
      moveTo(sx, sy, event.shiftKey && drag.mode === 'normal');
    } else if (drag.kind === 'frame') moveFrameTo(sx, sy);
    else if (drag.kind === 'resize') resizeTo(sx, sy);
    else if (drag.kind === 'fillet') filletTo(sx, sy);
    else if (drag.kind === 'grip') gripTo(sx, sy, event.shiftKey);
    else if (drag.kind === 'text') drag.wx1 = s2w(sx, sy).x;
    else if (drag.kind === 'marquee') marqueeTo(sx, sy);
    kick();
  }

  // A modifier pressed or released during a press or drag takes effect at
  // once; without a drag it refreshes the hover cursor.
  function remodDrag(event) {
    if (!drag) {
      if (hoverAt && model) hover(hoverAt.x, hoverAt.y);
      return;
    }
    if (drag.kind !== 'move') return;
    drag.mode = dragMode(event);
    if (!drag.moved) {
      armDuplicate(event);
      setCursor(dragCursor(event.shiftKey));
      return;
    }
    moveTo(drag.lx, drag.ly, event.shiftKey && drag.mode === 'normal');
    setCursor(dragCursor(event.shiftKey));
    kick();
  }

  // Every dragged sticky and line gets a target; the engine moves them
  // there, stops the stickies an obstacle blocks, and has the lines herd
  // what they reach. With the grid on, the grabbed item's nearest edges
  // land on grid lines.
  function moveTo(sx, sy, shift) {
    const p = s2w(sx, sy);
    let dx = p.x - drag.ax;
    let dy = p.y - drag.ay;
    if (shift) {
      if (!drag.axis) drag.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    } else {
      drag.axis = null;
    }
    if (drag.axis === 'x') dy = 0;
    if (drag.axis === 'y') dx = 0;
    let module = drag.anchor.sticky && engine.moduleForSticky(model, drag.anchor.sticky);
    let moduleAnchor = drag.anchor;
    if (module?.lock !== 'hard') {
      const item = drag.items.find(entry => engine.moduleForSticky(model, entry.s)?.lock === 'hard');
      if (item) {
        module = engine.moduleForSticky(model, item.s);
        moduleAnchor = {x: item.x, y: item.y, w: item.s.w, h: item.s.h};
      }
    }
    if (module?.lock === 'hard') {
      const a = moduleAnchor;
      const snapX = engine.snapDelta(a.x + dx, a.y + dy, a.w, a.h, module.width);
      const snapY = engine.snapDelta(a.x + dx, a.y + dy, a.w, a.h, module.depth);
      if (drag.axis !== 'y') dx += snapX.dx;
      if (drag.axis !== 'x') dy += snapY.dy;
    } else if (view.grid) {
      const a = drag.anchor;
      const snap = engine.snapDelta(a.x + dx, a.y + dy, a.w, a.h, view.gridStep);
      if (drag.axis !== 'y') dx += snap.dx;
      if (drag.axis !== 'x') dy += snap.dy;
    }
    ghosting = drag.mode === 'ghost';
    for (let i = 0; i < drag.items.length; i++) {
      const item = drag.items[i];
      const target = item.s.dragTarget || (item.s.dragTarget = { x: 0, y: 0 });
      target.x = item.x + dx;
      target.y = item.y + dy;
      item.s.dragging = true;
    }
    for (let i = 0; i < drag.lines.length; i++) {
      const it = drag.lines[i];
      const target = it.l.dragTarget || (it.l.dragTarget = { x: 0, y: 0 });
      target.x = it.pts[0][0] + dx;
      target.y = it.pts[0][1] + dy;
    }
    for (let i = 0; i < drag.texts.length; i++) {
      drag.texts[i].t.x = drag.texts[i].x + dx;
      drag.texts[i].t.y = drag.texts[i].y + dy;
    }
    setCursor(dragCursor());
  }

  // An edge stretches its axis and squishes the other so the area holds;
  // a corner follows the pointer's aspect. Area only ever changes in the
  // metadata capsule.
  function resizeTo(sx, sy) {
    const s = drag.s;
    const p = s2w(sx, sy);
    const r = engine.stretchBox(drag.origin, drag.edge, p.x, p.y, {
      step: view.grid ? view.gridStep : 0,
      cell: model.cell,
      wall: innerWall(),
      module: engine.moduleForSticky(model, s),
      gridActive: view.grid,
    });
    s.x = r.x;
    s.y = r.y;
    s.w = r.w;
    s.h = r.h;
    s.tw = r.tw;
    s.th = r.th;
    s.dragging = true;
  }

  // The radius follows the pointer along the top edge from the NW corner,
  // anchored at the press as in Slate, capped at half the shorter side. It
  // applies to every selected sticky.
  function filletTo(sx, sy) {
    const s = drag.s;
    const p = s2w(sx, sy);
    const want = Math.max(0, p.x - s.x + drag.grab);
    const r = Math.round(Math.min(want, Math.min(s.w, s.h) * 0.5) * 100) / 100;
    const list = selected.has(s.id) ? stickiesFor(expanded()) : [s];
    for (let i = 0; i < list.length; i++) list[i].radius = r;
    hotGrip = true;
  }

  // Held Shift projects onto the nearest 45-degree axis, as in Slate.
  function snap45(a, p) {
    const dx = p.x - a[0];
    const dy = p.y - a[1];
    const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const t = dx * ux + dy * uy;
    return { x: a[0] + ux * t, y: a[1] + uy * t };
  }

  function gridPoint(p) {
    if (!view.grid) return p;
    return { x: engine.snapEdge(p.x, view.gridStep), y: engine.snapEdge(p.y, view.gridStep) };
  }

  // The end swings toward the pointer, herding what it meets; a sticky that
  // cannot go stops it (engine.gripLine), so the line never passes over.
  function gripTo(sx, sy, shift) {
    const pts = drag.line.points;
    const other = pts[drag.index === 0 ? pts.length - 1 : 0];
    let p = gridPoint(s2w(sx, sy));
    if (shift) p = snap45(other, p);
    engine.gripLine(model, drag.line, drag.index, p.x, p.y);
    model.lineGen += 1;
  }

  function marqueeTo(sx, sy) {
    const p = s2w(sx, sy);
    drag.wx1 = p.x;
    drag.wy1 = p.y;
    const x0 = Math.min(drag.wx0, drag.wx1);
    const y0 = Math.min(drag.wy0, drag.wy1);
    const x1 = Math.max(drag.wx0, drag.wx1);
    const y1 = Math.max(drag.wy0, drag.wy1);
    const hits = [];
    const list = live();
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.x < x1 && s.x + s.w > x0 && s.y < y1 && s.y + s.h > y0) hits.push(s.id);
    }
    const lines = [];
    for (let i = 0; i < model.lines.length; i++) {
      const pts = model.lines[i].points;
      for (let k = 0; k + 1 < pts.length; k++) {
        if (segmentHitsRect(pts[k], pts[k + 1], x0, y0, x1, y1)) {
          lines.push(model.lines[i].id);
          break;
        }
      }
    }
    const texts = [];
    for (let i = 0; i < model.texts.length; i++) {
      const t = model.texts[i];
      const lay = textLayout(t);
      if (t.x < x1 && t.x + lay.w > x0 && t.y < y1 && t.y + lay.h > y0) texts.push(t.id);
    }
    setSelection(drag.base.concat(engine.expandToGroups(model, hits)), drag.baseLines.concat(lines), drag.baseTexts.concat(texts));
  }

  // Liang-Barsky: does segment a-b cross the rectangle?
  function segmentHitsRect(a, b, x0, y0, x1, y1) {
    let t0 = 0;
    let t1 = 1;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const p = [-dx, dx, -dy, dy];
    const q = [a[0] - x0, x1 - a[0], a[1] - y0, y1 - a[1]];
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) {
        if (q[i] < 0) return false;
        continue;
      }
      const r = q[i] / p[i];
      if (p[i] < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return false;
    }
    return true;
  }

  // -------------------------------------------------------------- line tool
  // Slate's Line (line.md): one shot, then back to Select. Click-move-click
  // or press-drag-release; Shift snaps to 45 degrees; the grid snaps both
  // ends; Tab locks the direction; digits type the length; Escape clears
  // the entry, then the first point, then disarms.

  function linePress(p, sx, sy, shift) {
    const q = gridPoint(p);
    if (!draft) {
      draft = { a: [q.x, q.y], b: [q.x, q.y], down: true, dragged: false, typed: '', lock: null, sx: sx, sy: sy };
      drag = { kind: 'line', x0: sx, y0: sy, moved: false };
      kick();
      return;
    }
    // The second click of click-move-click.
    updateDraft(p, shift);
    commitDraft();
  }

  function updateDraft(p, shift) {
    if (!draft) return;
    let q = gridPoint(p);
    if (draft.lock) {
      const t = (q.x - draft.a[0]) * draft.lock[0] + (q.y - draft.a[1]) * draft.lock[1];
      q = { x: draft.a[0] + draft.lock[0] * t, y: draft.a[1] + draft.lock[1] * t };
    } else if (shift) {
      q = snap45(draft.a, q);
    }
    if (draft.typed) {
      const len = engine.num(draft.typed);
      const dx = q.x - draft.a[0];
      const dy = q.y - draft.a[1];
      const d = Math.hypot(dx, dy);
      const ux = d > 1e-9 ? dx / d : draft.lock ? draft.lock[0] : 1;
      const uy = d > 1e-9 ? dy / d : draft.lock ? draft.lock[1] : 0;
      if (len > 0) q = { x: draft.a[0] + ux * len, y: draft.a[1] + uy * len };
    }
    draft.b = [q.x, q.y];
    kick();
  }

  function lineDragTo(sx, sy, shift) {
    if (!draft) return;
    if (!draft.dragged && Math.hypot(sx - draft.sx, sy - draft.sy) >= DRAG_SLOP) draft.dragged = true;
    updateDraft(s2w(sx, sy), shift);
  }

  // Press-drag-release commits on release; a click leaves the first point
  // down and waits for the second.
  function lineRelease(sx, sy, shift) {
    if (!draft) return;
    draft.down = false;
    if (draft.dragged) {
      updateDraft(s2w(sx, sy), shift);
      commitDraft();
    }
  }

  function commitDraft() {
    const a = draft.a;
    const b = draft.b;
    draft = null;
    drag = null;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) {
      kick();
      return;
    }
    checkpoint();
    const line = { id: engine.uid('l'), points: [a, b], width: view.lineWidth };
    model.lines.push(line);
    model.lineGen += 1;
    setTool('select');
    setSelection([], [line.id]);
    relaxAroundLines();
    persistSoon();
    kick();
  }

  function cancelDraft() {
    draft = null;
    if (drag && drag.kind === 'line') drag = null;
  }

  // Keys while a line is being drawn. Returns whether the key was used.
  function draftKey(event) {
    if (tool !== 'line') return false;
    const key = event.key;
    if (key === 'Escape') {
      if (draft && draft.typed) draft.typed = '';
      else if (draft) cancelDraft();
      else setTool('select');
      kick();
      return true;
    }
    if (!draft) return false;
    if (key === 'Tab') {
      const dx = draft.b[0] - draft.a[0];
      const dy = draft.b[1] - draft.a[1];
      const d = Math.hypot(dx, dy);
      draft.lock = draft.lock || d < 1e-9 ? null : [dx / d, dy / d];
      return true;
    }
    if (/^[0-9.]$/.test(key)) {
      draft.typed += key;
      if (pointerWorld) updateDraft(pointerWorld, event.shiftKey);
      return true;
    }
    if (key === 'Backspace') {
      draft.typed = draft.typed.slice(0, -1);
      if (pointerWorld) updateDraft(pointerWorld, event.shiftKey);
      return true;
    }
    if (key === 'Enter' && draft.typed) {
      commitDraft();
      return true;
    }
    return false;
  }

  // Slate's brush width: [ and ] step the on-screen width through tiers
  // (1 px under 10, 5 under 50, 10 under 100, then 25), converted back to
  // feet. Selected lines change (one undo step per press run); otherwise
  // the width the next line is drawn at.
  function brushTier(px) {
    return px < 10 ? 1 : px < 50 ? 5 : px < 100 ? 10 : 25;
  }

  function brushStep(width, up) {
    const px = width * camera.z;
    const next = up ? px + brushTier(px) : Math.max(1, px - brushTier(px - 0.01));
    return Math.min(engine.LINE_MAX, Math.max(engine.LINE_MIN, next / camera.z));
  }

  function brushKey(up, repeat) {
    const lines = linesFor(selLines);
    if (lines.length) {
      if (!repeat) checkpoint();
      for (let i = 0; i < lines.length; i++) lines[i].width = brushStep(lines[i].width, up);
      model.lineGen += 1;
      relaxAroundLines();
      persistSoon();
      toast('Line width ' + fmtWidth(lines[0].width) + ' ft');
    } else {
      view.lineWidth = brushStep(view.lineWidth, up);
      persistSoon();
      toast('Brush \u2192 ' + fmtWidth(view.lineWidth) + ' ft');
    }
    statusAt = 0;
    kick();
  }

  function fmtWidth(w) {
    return w < 10 ? w.toFixed(1) : String(Math.round(w));
  }

  // -------------------------------------------------------------- text tool
  // Slate's Text (text.md): click places a block that sizes to its text,
  // a drag past the slop sets the wrap width; typing is inline; a click
  // away or Escape commits; an empty block is discarded with no undo step
  // and Text stays armed; a commit returns to Select. Double-click edits.

  function startTextEdit(t, at) {
    closePop();
    finishTextEdit(true);
    textEdit = t
      ? { id: t.id, x: t.x, y: t.y, w: t.w || 0, size: t.size }
      : { id: null, x: at.x, y: at.y, w: at.w || 0, size: engine.TEXT_SIZE };
    textBox.value = t ? t.text : '';
    textBox.hidden = false;
    textPlaced = '';
    placeTextEdit();
    textBox.focus();
    if (t) textBox.select();
    kick();
  }

  function finishTextEdit(commit) {
    if (!textEdit) return;
    const edit = textEdit;
    textEdit = null;
    const value = textBox.value.replace(/\s+$/, '');
    textBox.hidden = true;
    if (document.activeElement === textBox) textBox.blur();
    kick();
    if (!commit) return;
    if (edit.id) {
      const t = model.texts.find((x) => x.id === edit.id);
      if (!t || t.text === value) return;
      checkpoint();
      if (value) t.text = value;
      else model.texts = model.texts.filter((x) => x.id !== edit.id);
      persistSoon();
      return;
    }
    if (!value) return;
    checkpoint();
    const t = { id: engine.uid('t'), x: edit.x, y: edit.y, text: value, size: edit.size, w: edit.w };
    model.texts.push(t);
    setTool('select');
    setSelection([], [], [t.id]);
    persistSoon();
  }

  let textPlaced = '';

  // The editor sits on the block at the block's own size on screen.
  function placeTextEdit() {
    if (!textEdit) return;
    const q = toScreen(textEdit.x, textEdit.y);
    const font = Math.max(11, textEdit.size * camera.z);
    const t = textEdit.id ? model.texts.find((x) => x.id === textEdit.id) : null;
    const kit = faceKit(t ? engine.textStyleOf(t, view).face : view.face);
    const lines = textBox.value.split('\n');
    let widest = 4;
    for (let i = 0; i < lines.length; i++) widest = Math.max(widest, (kit.measure(lines[i]) * font) / REF);
    const w = textEdit.w > 0 ? textEdit.w * camera.z : widest + font;
    const h = Math.max(1, lines.length) * font * TEXT_LEAD + 6;
    const ink = (t && t.textColor) || '';
    const css = [Math.round(q.x - 4), Math.round(q.y - 3), Math.round(w + 10), Math.round(h), font, kit.face, ink].join('|');
    if (css === textPlaced) return;
    textPlaced = css;
    textBox.style.transform = 'translate(' + Math.round(q.x - 4) + 'px,' + Math.round(q.y - 3) + 'px)';
    textBox.style.width = Math.round(w + 10) + 'px';
    textBox.style.height = Math.round(h) + 'px';
    textBox.style.fontSize = font + 'px';
    textBox.style.lineHeight = String(TEXT_LEAD);
    textBox.style.fontFamily = kit.css;
    textBox.style.color = ink;
  }

  function wireTextEdit() {
    textBox.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        finishTextEdit(true);
      }
    });
    textBox.addEventListener('input', placeTextEdit);
    textBox.addEventListener('blur', () => finishTextEdit(true));
  }

  // ----------------------------------------------------------- sticky names
  // Double-click a sticky to type its name in place. The editor wears the
  // label's own fit (labelFor, so engine.fitLabel), which keeps type, size,
  // wrapping, and centring identical and refits as you type. Enter or a
  // click away commits one undo step; Esc puts the name back; Shift+Enter
  // does nothing, since a label has no line breaks. Pan, zoom, and physics
  // carry the editor along. Blank is allowed, as in the metadata capsule.

  function startNameEdit(s) {
    closePop();
    finishNameEdit(true);
    finishAreaEdit(true);
    const raw = model.nameKey ? model.rows[s.rowIndex].fields[model.nameKey] : '';
    nameEdit = {
      id: s.id,
      raw: raw == null ? '' : String(raw),
      before: engine.nameOf(model, s).replace(/\s+/g, ' '),
      snap: null,
    };
    nameBox.value = nameEdit.before;
    nameBox.hidden = false;
    namePlaced = '';
    placeNameEdit();
    nameBox.focus({ preventScroll: true });
    nameBox.select();
    kick();
  }

  // A name typed back to what it was restores the cell exactly as opened.
  function finishNameEdit(commit) {
    if (!nameEdit) return;
    const edit = nameEdit;
    nameEdit = null;
    nameBox.hidden = true;
    if (document.activeElement === nameBox) nameBox.blur();
    kick();
    const s = live().find((t) => t.id === edit.id);
    if (!s) return;
    const typed = nameBox.value.replace(/\s+/g, ' ').trim();
    const renamed = commit && typed !== edit.before;
    const want = renamed ? typed : edit.raw;
    const cell = model.nameKey ? model.rows[s.rowIndex].fields[model.nameKey] : '';
    if ((cell == null ? '' : String(cell)) !== want) writeName([edit.id], want);
    if (renamed && edit.snap) pushUndo(edit.snap);
  }

  function onNameInput() {
    if (!nameEdit) return;
    if (/[\r\n]/.test(nameBox.value)) {
      const at = nameBox.selectionStart;
      nameBox.value = nameBox.value.replace(/[\r\n]+/g, ' ');
      nameBox.setSelectionRange(at, at);
    }
    if (!nameEdit.snap) nameEdit.snap = snapshot();
    writeName([nameEdit.id], nameBox.value);
    placeNameEdit();
  }

  // The box is the label's name block on screen plus room for the focus
  // ring. An empty name borrows the fit of its placeholder.
  function placeNameEdit() {
    if (!nameEdit) return;
    const s = live().find((t) => t.id === nameEdit.id);
    if (!s) {
      finishNameEdit(false);
      return;
    }
    let e = labelFor(s);
    const ink = e.ink;
    const face = e.css;
    const measureFace = e.measure;
    if (!e.lines.length) e = engine.fitLabel(nameBox.placeholder, '', s.w, s.h, measureFace, engine.textStyleOf(s, view).scale);
    const z = camera.z;
    const font = e.f * z;
    let widest = 0;
    for (let i = 0; i < e.lines.length; i++) widest = Math.max(widest, measureFace(e.lines[i]));
    const pad = Math.min(8, Math.max(2, font * 0.3));
    const w = (widest * font) / REF + font * 0.06 + 2 + pad * 2;
    const h = e.lines.length * e.lineH * z + pad * 2;
    const x = (s.x + s.w * 0.5 - camera.x) * z + viewW * 0.5 - w * 0.5;
    const y = (s.y + s.h * 0.5 + e.y0 - e.lineH * 0.5 - camera.y) * z + viewH * 0.5 - pad;
    const r = (v) => Math.round(v * 100) / 100;
    const css = [r(x), r(y), r(w), r(h), r(font), r(e.lineH * z), r(pad), ink, face].join('|');
    if (css === namePlaced) return;
    namePlaced = css;
    nameBox.style.fontFamily = face;
    nameBox.style.transform = 'translate(' + r(x) + 'px,' + r(y) + 'px)';
    nameBox.style.width = r(w) + 'px';
    nameBox.style.height = r(h) + 'px';
    nameBox.style.fontSize = r(font) + 'px';
    nameBox.style.lineHeight = r(e.lineH * z) + 'px';
    nameBox.style.padding = r(pad) + 'px';
    nameBox.style.borderRadius = r(pad + 1) + 'px';
    nameBox.style.color = ink;
    nameBox.scrollTop = 0;
  }

  function wireNameEdit() {
    nameBox.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        finishNameEdit(false);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (!event.shiftKey) finishNameEdit(true);
      } else if (event.key === 'Tab') {
        // Tab keeps the name and moves on to the area readout, if shown.
        event.preventDefault();
        const s = live().find((t) => t.id === nameEdit.id);
        finishNameEdit(true);
        if (s && !event.shiftKey && areaBox(s)) startAreaEdit(s);
      }
    });
    nameBox.addEventListener('input', onNameInput);
    nameBox.addEventListener('blur', () => finishNameEdit(true));
    nameBox.addEventListener('wheel', onWheel, { passive: false });
  }

  // ----------------------------------------------------------- sticky areas
  // Double-click the area readout ('2,500 sf') to type a new area in place:
  // the bare number, all selected, over the readout at the readout's own
  // size, with 'sf' beside it. Enter or a click away commits through
  // writeAreas, the capsule's setter, as one undo step; Esc cancels. On
  // Enter a value that is not a positive number rings red, shakes, and
  // reverts; blur just reverts. Shift+Tab goes back to the name.

  // The readout's box in feet from the label's own fit, or null when the
  // sticky shows no area line. `gap` is the space above it, to the name.
  function areaBox(s) {
    const e = labelFor(s);
    if (!e.area) return null;
    const size = e.f * AREA;
    const w = (e.measure(e.areaText) * size) / REF;
    const h = size * engine.LABEL.LEAD;
    return { x: s.x + (s.w - w) * 0.5, y: s.y + s.h * 0.5 + e.areaY - h * 0.5, w: w, h: h, size: size, gap: engine.LABEL.GAP * e.f };
  }

  // A few pixels of slop, but never reaching up into the name.
  function onAreaReadout(s, wx, wy) {
    const b = areaBox(s);
    if (!b) return false;
    const sx = 3 / camera.z;
    const sy = Math.min(sx, b.gap * 0.5);
    return wx >= b.x - sx && wx <= b.x + b.w + sx && wy >= b.y - sy && wy <= b.y + b.h + sx;
  }

  function startAreaEdit(s) {
    closePop();
    finishNameEdit(true);
    finishAreaEdit(true);
    const before = Math.max(1, Math.round(engine.trueArea(s)));
    areaEdit = { id: s.id, before: before };
    sfBox.value = String(before);
    sfBox.classList.remove('bad', 'shake');
    sfBox.hidden = false;
    sfUnit.hidden = false;
    areaPlaced = '';
    placeAreaEdit();
    sfBox.focus({ preventScroll: true });
    sfBox.select();
    kick();
  }

  function finishAreaEdit(commit) {
    if (!areaEdit) return;
    const edit = areaEdit;
    areaEdit = null;
    sfBox.hidden = true;
    sfUnit.hidden = true;
    clearTimeout(refuseArea.timer);
    if (document.activeElement === sfBox) sfBox.blur();
    kick();
    const value = areaValue(sfBox.value);
    if (!commit || !(value > 0) || value === edit.before || !live().some((t) => t.id === edit.id)) return;
    checkpoint();
    writeAreas([edit.id], value);
  }

  function refuseArea() {
    sfBox.value = String(areaEdit.before);
    sfBox.classList.remove('shake');
    void sfBox.offsetWidth;
    sfBox.classList.add('bad', 'shake');
    sfBox.select();
    placeAreaEdit();
    clearTimeout(refuseArea.timer);
    refuseArea.timer = setTimeout(() => sfBox.classList.remove('bad', 'shake'), 650);
  }

  // The number's box is centred with the unit beside it, where the readout
  // was; the ring clears the unit.
  function placeAreaEdit() {
    if (!areaEdit) return;
    const s = live().find((t) => t.id === areaEdit.id);
    const b = s && areaBox(s);
    if (!b) {
      finishAreaEdit(false);
      return;
    }
    const e = labelFor(s);
    const z = camera.z;
    const font = b.size * z;
    const lineH = b.h * z;
    const em = font / REF;
    const pad = Math.min(6, Math.max(2, font * 0.3));
    const boxW = e.measure(sfBox.value || '0') * em + font * 0.06 + 2 + pad * 2;
    const gap = Math.max(e.measure(' ') * em - pad, Math.min(4, font * 0.25) + 1);
    const unitW = e.measure('sf') * em;
    const x = (s.x + s.w * 0.5 - camera.x) * z + viewW * 0.5 - (boxW + gap + unitW) * 0.5;
    const y = (b.y - camera.y) * z + viewH * 0.5 - pad;
    const r = (v) => Math.round(v * 100) / 100;
    const css = [r(x), r(y), r(boxW), r(font), r(lineH), r(pad), e.ink, e.sub, e.css].join('|');
    if (css === areaPlaced) return;
    areaPlaced = css;
    sfBox.style.fontFamily = e.css;
    sfUnit.style.fontFamily = e.css;
    sfBox.style.transform = 'translate(' + r(x) + 'px,' + r(y) + 'px)';
    sfBox.style.width = r(boxW) + 'px';
    sfBox.style.height = r(lineH + pad * 2) + 'px';
    sfBox.style.fontSize = r(font) + 'px';
    sfBox.style.lineHeight = r(lineH) + 'px';
    sfBox.style.padding = r(pad) + 'px';
    sfBox.style.borderRadius = r(pad + 1) + 'px';
    sfBox.style.color = e.ink;
    sfUnit.style.transform = 'translate(' + r(x + boxW + gap) + 'px,' + r(y + pad) + 'px)';
    sfUnit.style.fontSize = r(font) + 'px';
    sfUnit.style.lineHeight = r(lineH) + 'px';
    sfUnit.style.color = e.sub;
  }

  function wireAreaEdit() {
    sfBox.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        finishAreaEdit(false);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const text = sfBox.value.trim();
        if (text && !(areaValue(text) > 0)) refuseArea();
        else finishAreaEdit(true);
      } else if (event.key === 'Tab') {
        event.preventDefault();
        const s = live().find((t) => t.id === areaEdit.id);
        finishAreaEdit(true);
        if (s && event.shiftKey) startNameEdit(s);
      }
    });
    sfBox.addEventListener('input', () => {
      const text = sfBox.value.trim();
      clearTimeout(refuseArea.timer);
      sfBox.classList.remove('shake');
      sfBox.classList.toggle('bad', text !== '' && !(areaValue(text) > 0));
      placeAreaEdit();
    });
    sfBox.addEventListener('blur', () => finishAreaEdit(true));
    sfBox.addEventListener('wheel', onWheel, { passive: false });
  }

  function onPointerUp(event, cancelled) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (d.kind === 'right') {
      if (!d.moved && !cancelled) {
        const sx = event.clientX;
        const sy = event.clientY;
        const p = s2w(sx, sy);
        openMenu(sx, sy, menuHit(sx, sy, p), onSelectedLabel(p));
      }
    } else if (d.kind === 'line') {
      drag = null;
      if (cancelled) cancelDraft();
      else lineRelease(event.clientX, event.clientY, event.shiftKey);
    } else if (d.kind === 'text') {
      if (!cancelled) {
        const x0 = Math.min(d.wx0, d.wx1);
        startTextEdit(null, { x: x0, y: d.wy0, w: d.moved ? Math.abs(d.wx1 - d.wx0) : 0 });
      }
    } else if (d.kind === 'move') {
      if (d.moved) {
        // One last solve at the final pointer, then the pile stays as it
        // lies: blocked members where they stopped, the rest packed.
        drag = d;
        engine.step(model, dragStepOpts());
        drag = null;
        ghosting = false;
        for (let i = 0; i < d.items.length; i++) d.items[i].s.passId = null;
        for (let i = 0; i < d.lines.length; i++) {
          d.lines[i].l.dragging = false;
          d.lines[i].l.dragTarget = null;
        }
        if (d.lines.length) model.lineGen += 1;
        touchList();
        settle(d.items.map((item) => item.s));
      } else {
        clearDragFlags();
        const c = d.collapse;
        if (d.toggle && !cancelled) applyToggle(d.toggle);
        else if (c && c.kind === 'blob') setSelection(c.own);
        else if (c && c.kind === 'sticky') setSelection(groupOf(c.item.id));
        else if (c && c.kind === 'line') setSelection([], [c.item.id]);
        else if (c && c.kind === 'text') setSelection([], [], [c.item.id]);
      }
    } else if (d.kind === 'resize') {
      if (d.moved) {
        engine.writeArea(model, d.s);
        settle([d.s]);
      } else {
        clearDragFlags();
      }
    } else if (d.kind === 'grip') {
      model.lineGen += 1;
      if (d.moved) relaxAroundLines();
    } else if (d.kind === 'frame') {
      if (d.moved) relaxAroundLines();
    }
    if (d.moved) persistSoon();
    hover(event.clientX, event.clientY);
    kick();
  }

  // What a right-click opens a menu for, topmost first.
  function menuHit(sx, sy, p) {
    return hitLeader(sx, sy) || pickAt(p.x, p.y) || (hitTitle(sx, sy) ? 'title' : blobAt(p.x, p.y) || (insideFrame(p.x, p.y) ? 'frame' : null));
  }

  // Whether a board point is on the label (name lines and area line, with a
  // few pixels of slop) of a sticky that is already selected.
  function onSelectedLabel(p) {
    const s = hitSticky(p.x, p.y);
    if (!s || !selected.has(s.id) || hitText(p.x, p.y)) return false;
    const e = labelFor(s);
    const n = e.lines.length;
    if (!n) return false;
    const k = e.f / REF;
    let w = 0;
    for (let i = 0; i < n; i++) w = Math.max(w, e.measure(e.lines[i]) * k);
    if (e.area) w = Math.max(w, e.measure(e.areaText) * k * AREA);
    const cx = s.x + s.w * 0.5;
    const cy = s.y + s.h * 0.5;
    const top = cy + e.y0 - e.lineH * 0.5;
    const bottom = cy + (e.area ? e.areaY + e.f * AREA * engine.LABEL.LEAD * 0.5 : e.y0 + (n - 0.5) * e.lineH);
    const slop = 3 / camera.z;
    return Math.abs(p.x - cx) <= w * 0.5 + slop && p.y >= top - slop && p.y <= bottom + slop;
  }

  function onDoubleClick(event) {
    finishBookmarkTransition(true);
    if (!model || tool !== 'select') return;
    const p = s2w(event.clientX, event.clientY);
    const t = hitText(p.x, p.y);
    if (t) {
      startTextEdit(t);
      return;
    }
    const leader = hitLeader(event.clientX, event.clientY);
    const hit = leader ? leader.item : hitSticky(p.x, p.y);
    if (!hit) {
      if (hitTitle(event.clientX, event.clientY)) startTitleEdit();
      return;
    }
    if (!selected.has(hit.id)) setSelection(groupOf(hit.id));
    // On a resize handle or the fillet grip it still opens the metadata;
    // on the sticky itself it renames the one clicked, even inside a group.
    const sx = event.clientX;
    const sy = event.clientY;
    if (hitFillet(sx, sy) || hitHandle(sx, sy)) openData(false);
    else if (onAreaReadout(hit, p.x, p.y)) startAreaEdit(hit);
    else startNameEdit(hit);
    kick();
  }

  function onWheel(event) {
    finishBookmarkTransition(true);
    event.preventDefault();
    if (!model) return;
    if (pop && pop.el === menuEl) closePop();
    const before = s2w(event.clientX, event.clientY);
    const speed = event.deltaMode === 1 ? 0.05 : 0.00115;
    camera.z = clampZoom(camera.z * Math.exp(-event.deltaY * speed));
    camera.x = before.x - (event.clientX - viewW * 0.5) / camera.z;
    camera.y = before.y - (event.clientY - viewH * 0.5) / camera.z;
    persistSoon();
    kick();
  }

  function escape() {
    if (closeSwatchAsk()) return;
    if (dataDashboard?.isOpen()) { dataDashboard.close(); return; }
    bookmarksPanel?.close();
    if (pop) closePop();
    else if (dataOpen) closeData();
    else if (tool !== 'select') setTool('select');
    else if (anySelected()) setSelection([]);
    else if (frameSelected) selectFrame(false);
    kick();
  }

  // Ctrl+S saves from anywhere, including while a field has focus.
  function onSaveKey(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 's') return;
    event.preventDefault();
    event.stopPropagation();
    saveBoard();
  }

  function onKeyDown(event) {
    if (typing(event) || !model) return;
    finishBookmarkTransition(true);
    const key = event.key.toLowerCase();
    noteMods(event);
    if (key === 'shift' || key === 'control' || key === 'meta' || key === 'alt') {
      // Alt alone would otherwise hand focus to the browser's menu.
      if (key === 'alt') event.preventDefault();
      lastShift = event.shiftKey;
      remodDrag(event);
      if (draft && !draft.down && pointerWorld) updateDraft(pointerWorld, event.shiftKey);
      return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      if (!spaceDown) {
        spaceDown = true;
        if (!drag) setCursor('grab');
      }
      return;
    }
    if (draftKey(event)) {
      event.preventDefault();
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      if (key === 'z') {
        if (event.shiftKey) redo();
        else undo();
      } else if (key === 'y') redo();
      else if (key === 'a') selectAll();
      else if (key === 'd') duplicateSelection();
      else if (key === 'g') {
        if (event.shiftKey) ungroupSelection();
        else toggleGroup();
      } else return;
      event.preventDefault();
      return;
    }
    if (event.altKey) return;
    if (key === 'escape') escape();
    else if (key === 'delete' || key === 'backspace') removeSelection();
    else if (key === 'enter') openData(true);
    else if (key === 'f') fit();
    else if (key === 'g') setGrid(!view.grid);
    else if (key === 'b') bundle(false);
    else if (key === 'v') setTool('select');
    else if (key === 'l' || key === 'd') setTool('line');
    else if (key === 't' || key === 'y') setTool('text');
    else if (key === '[' || key === ']') brushKey(key === ']', event.repeat);
    else if (key === 'arrowleft' || key === 'arrowright' || key === 'arrowup' || key === 'arrowdown') {
      nudge(key, event.shiftKey, event.repeat);
    } else return;
    event.preventDefault();
  }

  function onKeyUp(event) {
    const key = event.key.toLowerCase();
    noteMods(event);
    if (key === 'shift' || key === 'control' || key === 'meta' || key === 'alt') {
      if (key === 'alt' && !typing(event)) event.preventDefault();
      lastShift = event.shiftKey;
      remodDrag(event);
      if (draft && !draft.down && pointerWorld) updateDraft(pointerWorld, event.shiftKey);
      return;
    }
    if (event.code !== 'Space') return;
    spaceDown = false;
    if (!drag) setCursor(tool === 'line' ? 'crosshair' : tool === 'text' ? 'text' : 'default');
  }

  // A press outside the open menu or popover closes it. A left press that
  // only dismisses the context menu does nothing else.
  function onAnyPointerDown(event) {
    if (!event.target.closest?.('#board-bookmarks')) finishBookmarkTransition(true);
    if (!pop || pop.el.contains(event.target) || (pop.anchor && pop.anchor.contains(event.target))) return;
    const wasMenu = pop.el === menuEl;
    closePop();
    if (wasMenu && event.target === canvas && event.button === 0) swallowClick = true;
  }

  // A file dragged over the window lights the spreadsheet portal.
  function wireDrop() {
    let depth = 0;
    const hasFiles = (event) => event.dataTransfer && Array.from(event.dataTransfer.types || []).indexOf('Files') >= 0;
    window.addEventListener('dragenter', (event) => {
      if (!hasFiles(event)) return;
      depth += 1;
      srcEl.classList.add('drop');
      emptyEl.classList.add('drop');
    });
    window.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (depth) return;
      srcEl.classList.remove('drop');
      emptyEl.classList.remove('drop');
    });
    window.addEventListener('dragover', (event) => event.preventDefault());
    window.addEventListener('drop', (event) => {
      event.preventDefault();
      depth = 0;
      srcEl.classList.remove('drop');
      emptyEl.classList.remove('drop');
      loadFiles(event.dataTransfer && event.dataTransfer.files);
    });
  }

  // --------------------------------------------------------------- startup

  // The current board, else the newest older one (restore migrates it).
  function readSaved() {
    const handoff = window.ProgramModeState && window.ProgramModeState.read();
    if (handoff) return handoff;
    if (EPHEMERAL) return null;
    const keys = [KEY].concat(LEGACY_KEYS);
    for (let i = 0; i < keys.length; i++) {
      try {
        const saved = JSON.parse(localStorage.getItem(keys[i]) || 'null');
        if (saved && saved.board && Array.isArray(saved.board.stickies) && Array.isArray(saved.board.rows)) return saved;
      } catch (err) {
        /* try the next */
      }
    }
    return null;
  }

  function boot() {
    const seedEl = $('seed');
    const sharedSeed=window.ProgramBoardSeed;
    seedText = sharedSeed ? sharedSeed.csv : seedEl ? seedEl.textContent.trim() : '';
    seedName = sharedSeed?.name || (seedEl && seedEl.dataset.name) || seedName;
    const saved = readSaved();
    if (PARAMS.has('perf') && seedText) {
      install(perfModel());
      fit();
    } else if (saved) {
      try {
        view = normalizeView(saved.view);
        install(engine.restore(saved.board));
        const cam = saved.camera;
        if (cam && cam.z > 0) camera = { x: Number(cam.x) || 0, y: Number(cam.y) || 0, z: clampZoom(cam.z) };
        else fit();
      } catch (err) {
        model = null;
      }
    }
    if (!model) loadSeed(false);
    syncChrome();
    useFace(view.face);
    sharedBase=sharedState();
    if(!EPHEMERAL && model)persist();
    window.ProgramModeState?.subscribe(next=>{
      if(EPHEMERAL || !next?.board)return;
      pendingShared=next;
      if(sharedBusy()) { persistSoon(); return; }
      const local=sharedState(), merged=sharedBase && local ? window.ProgramModeState.reconcile(sharedBase,local,next) : next;
      acceptShared(merged);sharedBase=sharedState();pendingShared=null;
    });
    window.__board = {
      get model() { return model; },
      get camera() { return camera; },
      get view() { return view; },
      get modeState() { return sharedState(); },
      flushEdits:flushEdits,
      get leaders() { return leaderScene; },
      setLeaders: setLeaderThreshold,
      get selected() { return Array.from(selected); },
      get undoDepth() { return undoStack.length; },
      get bundling() { return !!bundling; },
      get settled() { return !bundling && !settling && !drag; },
      get jam() { return lastJam; },
      get blobs() {
        return blobList.map((e) => ({ key: e.key, value: e.value, members: e.members.map((s) => s.id), loops: e.shape.loops.length, version: e.version, style: e.style, label: e.shape.label }));
      },
      get blobCache() { return { computed: blobCache.computed, stale: blobCache.stale, ms: blobMs }; },
      blobKeys: blobKeys,
      toggleBlob: toggleBlob,
      blobAt: blobAt,
      blobGrab: (value) => {
        const e = blobList.find((b) => b.value === value);
        return e ? e.members.map((s) => s.id) : null;
      },
      openMenuAt: (sx, sy) => {
        const p = s2w(sx, sy);
        openMenu(sx, sy, menuHit(sx, sy, p), onSelectedLabel(p));
      },
      engine: engine,
      fit: fit,
      kick: kick,
      toScreen: (wx, wy) => ({ x: (wx - camera.x) * camera.z + viewW * 0.5, y: (wy - camera.y) * camera.z + viewH * 0.5 }),
      setCamera: (next) => {
        camera = { x: next.x, y: next.y, z: clampZoom(next.z) };
        kick();
      },
      select: (ids, lines, texts) => {
        setSelection(Array.isArray(ids) ? ids : [ids], lines, texts);
        kick();
      },
      openData: () => openData(false),
      bundle: (all) => bundle(!!all),
      bundleByGroup,
      get dataDashboard() { return dataDashboard; },
      get bookmarksPanel() { return bookmarksPanel; },
      get transitioning() { return !!bookmarkTransition; },
      perfStats: perfStats,
      perfReset: () => {
        perfCount = 0;
        lastBusyAt = 0;
      },
      pngBlob: renderPng,
      pngExport: renderPngInfo,
      pngAt: (scale) => {
        const box = exportBox();
        const z = EXPORT_PX / Math.max(box.w, box.h);
        return canvasPng(box, z, scale);
      },
      svgText: svgMarkup,
      csvText: () => engine.exportCsv(model),
      get frame() { return model.frame; },
      get frameSelected() { return frameSelected; },
      get dimEdit() { return dimEdit; },
      get titleEditing() { return titleEditing; },
      get dirty() { return editGen !== savedGen; },
      get chrome() { return chrome; },
      hitDim: hitDim,
      hitTitle: hitTitle,
      align: doAlign,
      saveBoard: saveBoard,
      loadFiles: loadFiles,
      get toast() { return toastEl.hidden ? '' : toastEl.textContent; },
      layoutText: layoutText,
      editDim: startDimEdit,
      editTitle: startTitleEdit,
      label: (id) => {
        const s = live().find((t) => t.id === id);
        return s ? labelFor(s) : null;
      },
      get font() { return fontRef; },
      get filletShown() { const s = filletTarget(); return s ? s.id : null; },
      get tool() { return tool; },
      get draft() { return draft; },
      get selLines() { return Array.from(selLines); },
      get selTexts() { return Array.from(selTexts); },
      get textEdit() { return textEdit; },
      get nameEdit() { return nameEdit; },
      get areaEdit() { return areaEdit; },
      editArea: (id) => {
        const s = live().find((t) => t.id === id);
        if (s && areaBox(s)) startAreaEdit(s);
      },
      areaReadout: (id) => {
        const s = live().find((t) => t.id === id);
        const b = s && areaBox(s);
        if (!b) return null;
        const p = toScreen(b.x, b.y);
        return { x: p.x, y: p.y, w: b.w * camera.z, h: b.h * camera.z };
      },
      editName: (id) => {
        const s = live().find((t) => t.id === id);
        if (s) startNameEdit(s);
      },
      get dragMode() { return drag ? drag.mode : null; },
      get cursor() { return cursor; },
      get status() { return statusEl.textContent; },
      setTool: setTool,
      setGrid: setGrid,
      setFudge: setFudge,
      setBuffer: setBuffer,
      toggleGroup: toggleGroup,
      filletGrip: (id) => {
        const s = live().find((t) => t.id === id);
        return s ? filletGrip(s) : null;
      },
      cadScene: cadScene,
      loadCsvText: (text, name) => {
        const next = engine.modelFromCsv(text, name || 'test.csv');
        engine.pack(next);
        install(next);
        fit();
      },
      snapshotCount: () => undoStack.length,
    };
  }

  function init() {
    buildAlign();
    wireToolbar();
    wireData();
    wireChromeEdits();
    wireTextEdit();
    wireNameEdit();
    wireAreaEdit();
    wireDrop();
    window.addEventListener('keydown', onSaveKey, true);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', (event) => onPointerUp(event, false));
    canvas.addEventListener('pointercancel', (event) => onPointerUp(event, true));
    canvas.addEventListener('pointerleave', () => {
      if (!drag && (hoverGroup || hoverBlob)) {
        hoverGroup = null;
        hoverBlob = null;
        kick();
      }
    });
    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', (event) => {
      if (event.button === 1) event.preventDefault();
    });
    document.addEventListener('pointerdown', onAnyPointerDown, true);
    // Buttons never take focus, so Space and Enter stay board shortcuts.
    document.addEventListener('mousedown', (event) => {
      if (event.target.closest && event.target.closest('button')) event.preventDefault();
    });
    // This board may live inside a host app; its right button belongs here.
    window.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
    }, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => {
      spaceDown = false;
      mods.shift = mods.ctrl = mods.alt = false;
    });
    window.addEventListener('resize', resize);
    window.addEventListener('beforeunload', () => { finishBookmarkTransition(false); persist(); });
    resize();
    boot();
  }

  init();
})();
