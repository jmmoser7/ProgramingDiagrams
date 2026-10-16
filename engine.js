'use strict';

// Program board model, packing, and collision.
// Motion is position-only. Nothing stores velocity, and contacts never bounce.
// Slate's bumper cars use restitution 0.5 plus a throw; that is the ricochet
// this solver is built to avoid. Each step moves a body toward a legal
// position by a fraction, and a per-frame cap stops a chain from launching.
// A body is one ungrouped sticky or every alive member of a group; a body
// only ever translates as a whole, so grouped offsets never drift.

(function (root, factory) {
  const api = factory(typeof module !== 'undefined' && module.exports ? require('./appearance.js') : root.ProgramAppearance);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProgramBoard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (appearance) {
  // The buffer between two stickies, and between a sticky and the frame
  // edge or a line. The board sets it (model.gap) as a whole multiple of its
  // grid; this is only the default for a bare model.
  const CONTACT_GAP = 4;
  const FRAME_MIN = 8;
  const STICKY_FILL = '#dcd7cf';
  const FRAME_FILL = '#ffffff';
  const FRAME_RADIUS = 8;
  // Shortest side a stretch may leave (never more than the square's side).
  const STRETCH_MIN = 4;
  const LINE_MIN = 0.5;
  const LINE_MAX = 400;
  const LINE_WIDTH = 2;
  const TEXT_SIZE = 12;
  // A frame never shrinks below the room the program needs at this fill of
  // its inner area. Denser than this, contacts alone jam at 200 stickies and
  // the stickies would have to be bundled to fit.
  const FRAME_PACK = 0.33;
  const PACK_GAP = 26;
  const MAX_STICKIES = 200;
  const BUNDLE_PUSH = 14;
  const SIZE_LAG = 0.4;
  const TOUCH_SLACK = 0.5;
  const RIGHT = 0;
  const LEFT = 1;
  const DOWN = 2;
  const UP = 3;

  let seq = 1;
  function uid(prefix) {
    seq += 1;
    return prefix + seq.toString(36);
  }

  // Rows need identities even while their area is zero and no sticky exists.
  // Legacy snapshots derive the same ids in every view; the shared uid counter
  // would give those rows different identities depending on what opened first.
  function ensureRowIds(model) {
    const rows = model.rows || [];
    const stickyIds = new Map();
    (model.stickies || []).forEach((s) => {
      if (s && typeof s.id === 'string' && s.id && !stickyIds.has(s.rowIndex)) stickyIds.set(s.rowIndex, s.id);
    });
    const valid = (id) => typeof id === 'string' && id.trim() !== '';
    const reserved = new Set(rows.map((row) => row.id).filter(valid));
    const used = new Set();
    rows.forEach((row, index) => {
      let id = valid(row.id) ? row.id : null;
      if (!id || used.has(id)) {
        const base = stickyIds.has(index) ? 'row-' + stickyIds.get(index) : 'row-legacy-' + index.toString(36);
        id = base;
        let suffix = 1;
        while (reserved.has(id) || used.has(id)) id = base + '-' + (++suffix);
        row.id = id;
        reserved.add(id);
      }
      used.add(id);
    });
    return rows;
  }

  function num(value) {
    if (value == null) return 0;
    const n = Number(String(value).replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : 0;
  }

  function parseCsv(text) {
    const src = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let field = '';
    let quote = false;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === '"') {
          if (src[i + 1] === '"') {
            field += '"';
            i += 1;
          } else quote = false;
        } else field += c;
      } else if (c === '"') quote = true;
      else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
      } else if (c !== '\r') field += c;
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
  }

  function csvEscape(value) {
    const s = value == null ? '' : String(value);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function matrixToCsv(matrix) {
    return matrix.map((row) => row.map(csvEscape).join(',')).join('\r\n') + '\r\n';
  }

  function findKey(columns, names) {
    const lower = columns.map((c) => String(c).trim().toLowerCase());
    for (let n = 0; n < names.length; n++) {
      const i = lower.indexOf(names[n]);
      if (i >= 0) return columns[i];
    }
    return null;
  }

  function emptyModel(fileName) {
    return {
      frame: null,
      fileName: fileName || 'program.csv',
      columns: [],
      nameKey: null,
      areaKey: null,
      deptKey: null,
      groupKey: null,
      sfKey: null,
      qtyKey: null,
      // Null keeps the imported sheet's automatic interpretation. A chosen
      // configuration is authored data, just like the board's other settings.
      columnRoles: null,
      bookmarks: [],
      rows: [],
      stickies: [],
      lines: [],
      texts: [],
      // Authored board settings (journaled with the board).
      fudge: false,
      bufferMul: 1,
      blobs: { on: [], keys: {} },
      gradients: {},
      // Derived from those and the grid by setParams; never stored.
      gap: CONTACT_GAP,
      cell: 0,
      grid: 0,
      moduleGridActive: false,
      lineGen: 0,
    };
  }

  // x, y, w, h are the drawn box that collides and paints. tw x th is the
  // true size, whose product is the row's area; w, h differ from it only
  // while the board fudges sizes to whole grid cells.
  function newSticky(rowIndex, x, y, w, h, color) {
    return {
      id: uid('s'),
      rowIndex: rowIndex,
      x: x,
      y: y,
      w: w,
      h: h,
      tw: w,
      th: h,
      color: color || null,
      gradientId: null,
      height: 8,
      z: 0,
      material: 'matte',
      locked: false,
      radius: 0,
      stroke: 0,
      shadow: 0,
      textFace: null,
      textScale: null,
      textColor: null,
      dragging: false,
      dragTarget: null,
      passId: null,
      group: null,
    };
  }

  function trueArea(s) {
    return s.tw * s.th;
  }

  function gapOf(model) {
    return model && model.gap >= 0 ? model.gap : CONTACT_GAP;
  }

  function modelFromMatrix(matrix, fileName) {
    if (!matrix.length) throw new Error('That spreadsheet is empty.');
    const width = matrix.reduce((m, row) => Math.max(m, row.length), 0);
    const columns = [];
    for (let c = 0; c < width; c++) {
      const header = String(matrix[0][c] == null ? '' : matrix[0][c]).trim();
      columns.push(header || 'Column ' + (c + 1));
    }
    const model = emptyModel(fileName);
    model.columns = columns;
    model.nameKey = findKey(columns, ['space', 'name', 'room', 'program', 'room name', 'space name']);
    model.areaKey = findKey(columns, ['subtotal', 'sub total', 'area', 'asf', 'nsf', 'total sf', 'total']);
    model.sfKey = findKey(columns, ['sf', 'unit sf', 'asf each', 'area each']);
    model.qtyKey = findKey(columns, ['qty', 'quantity', 'count']);
    model.deptKey = findKey(columns, ['department', 'dept', 'program area']);
    model.groupKey = findKey(columns, ['group', 'subgroup', 'category']);
    if (!model.nameKey) throw new Error('No name column. Expected a header like Space, Name, or Room.');
    if (!model.areaKey && !(model.sfKey && model.qtyKey) && !model.sfKey) {
      throw new Error('No area column. Expected SubTotal, Area, or SF.');
    }
    if (!model.areaKey) {
      model.areaKey = 'SubTotal';
      if (model.columns.indexOf(model.areaKey) < 0) model.columns.push(model.areaKey);
    }

    for (let r = 1; r < matrix.length; r++) {
      const fields = {};
      for (let c = 0; c < columns.length; c++) {
        fields[columns[c]] = matrix[r][c] == null ? '' : String(matrix[r][c]);
      }
      let area = num(fields[model.areaKey]);
      if (!(area > 0) && String(fields[model.areaKey] || '').trim() === '') {
        const sf = model.sfKey ? num(fields[model.sfKey]) : 0;
        const qty = model.qtyKey ? num(fields[model.qtyKey]) : 1;
        if (sf > 0 && qty > 0) {
          area = sf * qty;
          fields[model.areaKey] = String(Math.round(area));
        }
      }
      const rowIndex = model.rows.length;
      model.rows.push({ id: uid('r'), fields: fields, dropped: false });
      if (!(area > 0)) continue;
      const side = Math.sqrt(area);
      model.stickies.push(newSticky(rowIndex, 0, 0, side, side, null));
    }
    if (!model.rows.length) throw new Error('That spreadsheet has no program rows.');
    if (model.stickies.length > MAX_STICKIES) {
      throw new Error('This sheet wants ' + model.stickies.length + ' stickies. Stay under ' + MAX_STICKIES + '.');
    }
    return model;
  }

  function modelFromCsv(text, fileName) {
    return modelFromMatrix(parseCsv(text), fileName);
  }

  function cleanColumnRoles(model, value) {
    const src = value || {};
    const key = (v) => typeof v === 'string' && model.columns.indexOf(v) >= 0 ? v : null;
    const area = key(src.areaKey);
    return {
      areaKey: area,
      groupKeys: Array.from(new Set((Array.isArray(src.groupKeys) ? src.groupKeys : []).map(key).filter((k) => k && k !== area))),
      countKey: key(src.countKey),
      moduleWidthKey: key(src.moduleWidthKey),
      moduleDepthKey: key(src.moduleDepthKey),
      moduleLock: src.moduleLock === 'hard' ? 'hard' : 'loose',
    };
  }

  function getColumnRoles(model) {
    if (model.columnRoles) return cleanColumnRoles(model, model.columnRoles);
    return cleanColumnRoles(model, {
      areaKey: model.areaKey,
      groupKeys: categoricalOf(model, alive(model).map((s) => sFields(model, s))).map((c) => c.key),
    });
  }

  function getColumnTags(model) {
    const roles = getColumnRoles(model);
    const out = {};
    model.columns.forEach((key) => {
      const tags = [];
      if (roles.areaKey === key) tags.push('area');
      if (roles.groupKeys.indexOf(key) >= 0) tags.push('group');
      if (roles.countKey === key) tags.push('count');
      if (roles.moduleWidthKey === key) tags.push('moduleWidth');
      if (roles.moduleDepthKey === key) tags.push('moduleDepth');
      out[key] = tags;
    });
    return out;
  }

  // A tag changes the interpretation of existing cells. It never discards a
  // zero-area row, and a row that becomes drawable reuses its former sticky.
  function setColumnRoles(model, update) {
    const requested = Object.assign(getColumnRoles(model), update || {});
    const keys = ['areaKey', 'countKey', 'moduleWidthKey', 'moduleDepthKey'];
    keys.forEach((name) => {
      if (requested[name] != null && model.columns.indexOf(requested[name]) < 0) throw new Error('Unknown column: ' + requested[name]);
    });
    if (!Array.isArray(requested.groupKeys) || requested.groupKeys.some((key) => model.columns.indexOf(key) < 0)) throw new Error('Choose existing columns for the group tags.');
    const next = cleanColumnRoles(model, requested);
    const areaChanged = model.areaKey !== next.areaKey;
    if (areaChanged && next.areaKey) {
      const count = model.rows.filter((row) => !row.dropped && num(row.fields[next.areaKey]) > 0).length;
      if (count > MAX_STICKIES) throw new Error('This selection wants ' + count + ' stickies. Stay under ' + MAX_STICKIES + '.');
    }
    ensureRowIds(model);
    const clearances = groupClearances(model, alive(model));
    model.columnRoles = next;
    model.areaKey = next.areaKey;
    model.deptKey = next.groupKeys[0] || null;
    model.groupKey = next.groupKeys[1] || null;
    if (areaChanged && next.areaKey) {
      model.rows.forEach((row, rowIndex) => {
        if (!row.dropped) applyRowArea(model, rowIndex, Math.max(0, num(row.fields[next.areaKey])));
      });
    }
    model.stickies.forEach((s) => refit(model, s, false));
    respaceGroups(clearances);
    return getColumnRoles(model);
  }

  function rowModule(model, sticky) {
    const roles = model.columnRoles;
    if (!roles || !roles.moduleWidthKey || !roles.moduleDepthKey || !model.rows || !model.rows[sticky.rowIndex]) return null;
    const fields = model.rows[sticky.rowIndex].fields;
    const width = num(fields[roles.moduleWidthKey]);
    const depth = num(fields[roles.moduleDepthKey]);
    const count = roles.countKey ? num(fields[roles.countKey]) : 0;
    return width > 0 && depth > 0 ? { width: width, depth: depth, lock: roles.moduleLock === 'hard' ? 'hard' : 'loose',
      count: Number.isInteger(count) && count > 0 && count <= 10000 ? count : 0 } : null;
  }

  function moduleArrangement(sticky, module) {
    if (module.count) {
      let best = null;
      for (let columns = 1; columns <= module.count; columns++) {
        if (module.count % columns) continue;
        const rows = module.count / columns;
        const score = Math.abs(Math.log((columns * module.width / (rows * module.depth)) / (sticky.tw / sticky.th)));
        if (!best || score < best.score) best = { columns: columns, rows: rows, score: score };
      }
      return best;
    }
    return { columns: Math.max(1, Math.ceil(sticky.tw / module.width - 1e-9)), rows: Math.max(1, Math.ceil(sticky.th / module.depth - 1e-9)) };
  }

  function moduleSize(sticky, module, grid, gridActive) {
    const arrangement = moduleArrangement(sticky, module);
    let width = arrangement.columns * module.width;
    let height = arrangement.rows * module.depth;
    if (module.lock === 'loose' && gridActive && grid > 0) {
      width = Math.max(1, Math.round(width / grid)) * grid;
      height = Math.max(1, Math.round(height / grid)) * grid;
    }
    return [width, height];
  }

  function moduleDrawnSize(model, sticky) {
    const module = rowModule(model, sticky);
    if (!module || !(sticky.tw > 0 && sticky.th > 0)) return null;
    return moduleSize(sticky, module, model.grid, model.moduleGridActive);
  }

  // Local coordinates: the renderer translates these with the parent sticky.
  // Count rows may have one fewer column so prime counts still fill the whole
  // footprint with exactly N cells of equal area, without a leftover sliver.
  function moduleLayout(model, sticky) {
    const roles = model.columnRoles;
    if (!roles || !sticky || !(sticky.w > 0 && sticky.h > 0) || !active(model, sticky)) return null;
    const fields = sFields(model, sticky);
    const rawCount = roles.countKey ? num(fields[roles.countKey]) : 0;
    const module = rowModule(model, sticky);
    const count = rawCount > 0 && Number.isInteger(rawCount) ? rawCount : 0;
    if (!count && !module) return null;
    // A malformed or enormous count must not allocate an unbounded render list.
    if (count > 10000) return null;
    const cells = [];
    const lines = [];
    const width = sticky.w;
    const height = sticky.h;
    let rows;
    let columns;
    if (count && !module) {
      let best = null;
      const targetAspect = module ? module.width / module.depth : 1;
      for (let r = 1; r <= Math.min(count, Math.ceil(Math.sqrt(count * height / width * targetAspect) * 2) + 2); r++) {
        const cols = count / r;
        const skew = Math.abs(Math.log((width / cols) / (height / r) / targetAspect));
        const ragged = count % r === 0 ? 0 : 0.12;
        const score = skew + ragged;
        if (!best || score < best.score) best = { rows: r, score: score };
      }
      rows = best.rows;
      columns = Math.ceil(count / rows);
      const base = Math.floor(count / rows);
      const extra = count % rows;
      let y = 0;
      for (let r = 0; r < rows; r++) {
        const n = base + (r < extra ? 1 : 0);
        const rowHeight = r === rows - 1 ? height - y : height * n / count;
        for (let c = 0; c < n; c++) cells.push({ x: c * width / n, y: y, w: width / n, h: rowHeight });
        for (let c = 1; c < n; c++) lines.push({ x1: c * width / n, y1: y, x2: c * width / n, y2: y + rowHeight });
        y += rowHeight;
        if (r < rows - 1) lines.push({ x1: 0, y1: y, x2: width, y2: y });
      }
    } else {
      const arrangement = moduleArrangement(sticky, module);
      columns = arrangement.columns;
      rows = arrangement.rows;
      if (rows * columns > 10000) return null;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < columns; c++) cells.push({ x: c * width / columns, y: r * height / rows, w: width / columns, h: height / rows });
      }
      for (let c = 1; c < columns; c++) lines.push({ x1: c * width / columns, y1: 0, x2: c * width / columns, y2: height });
      for (let r = 1; r < rows; r++) lines.push({ x1: 0, y1: r * height / rows, x2: width, y2: r * height / rows });
    }
    return { mode: count ? 'count' : 'module', lock: module ? module.lock : 'loose', count: cells.length, rows: rows, columns: columns,
      moduleWidth: module ? module.width : null, moduleDepth: module ? module.depth : null,
      cellWidth: cells[0].w, cellDepth: cells[0].h, cells: cells, lines: lines };
  }

  function active(model, sticky) {
    if (!sticky) return false;
    const row = model.rows[sticky.rowIndex];
    return !!(row && !row.dropped && trueArea(sticky) > 0);
  }

  function alive(model) {
    return model.stickies.filter((s) => active(model, s));
  }

  function boundsOf(list) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      x0 = Math.min(x0, s.x);
      y0 = Math.min(y0, s.y);
      x1 = Math.max(x1, s.x + s.w);
      y1 = Math.max(y1, s.y + s.h);
    }
    if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function offset(list, dx, dy) {
    for (let i = 0; i < list.length; i++) {
      list[i].x += dx;
      list[i].y += dy;
    }
  }

  function rectHits(x, y, w, h, placed) {
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i];
      if (x < p.x + p.w - 0.01 && x + w > p.x + 0.01 && y < p.y + p.h - 0.01 && y + h > p.y + 0.01) {
        return true;
      }
    }
    return false;
  }

  function spotScore(x, y, w, h, placed) {
    let x0 = x;
    let y0 = y;
    let x1 = x + w;
    let y1 = y + h;
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i];
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x + p.w);
      y1 = Math.max(y1, p.y + p.h);
    }
    const bw = x1 - x0;
    const bh = y1 - y0;
    const cx = (x0 + x1) * 0.5;
    const cy = (y0 + y1) * 0.5;
    // Prefer a squarer cloud. Minimum bbox area alone rewards a single row,
    // because a row wastes no cells and a block does.
    return Math.max(bw, bh) * 10000 + bw * bh + (cx * cx + cy * cy) * 0.02;
  }

  function findSpot(n, placed, gap) {
    let best = null;
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i];
      const cands = [
        { x: p.x + p.w + gap, y: p.y },
        { x: p.x, y: p.y + p.h + gap },
        { x: p.x + p.w + gap, y: p.y + p.h - n.h },
        { x: p.x + p.w - n.w, y: p.y + p.h + gap },
        { x: p.x - n.w - gap, y: p.y },
        { x: p.x, y: p.y - n.h - gap },
        { x: p.x - n.w - gap, y: p.y + p.h - n.h },
        { x: p.x + p.w - n.w, y: p.y - n.h - gap },
      ];
      for (let c = 0; c < cands.length; c++) {
        const spot = cands[c];
        if (rectHits(spot.x, spot.y, n.w, n.h, placed)) continue;
        const score = spotScore(spot.x, spot.y, n.w, n.h, placed);
        if (!best || score < best.score) best = { x: spot.x, y: spot.y, score: score };
      }
    }
    if (best) return best;
    const b = boundsOf(placed);
    const step = Math.max(gap, Math.min(n.w, n.h, 48));
    for (let y = b.y - n.h - gap; y <= b.y + b.h + gap; y += step) {
      for (let x = b.x - n.w - gap; x <= b.x + b.w + gap; x += step) {
        if (rectHits(x, y, n.w, n.h, placed)) continue;
        const score = spotScore(x, y, n.w, n.h, placed);
        if (!best || score < best.score) best = { x: x, y: y, score: score };
      }
    }
    if (best) return best;
    return { x: b.x + b.w + gap, y: b.y, score: 0 };
  }

  function packList(list, gap) {
    const sorted = list.slice().sort((a, b) => b.w * b.h - a.w * a.h);
    const placed = [];
    for (let i = 0; i < sorted.length; i++) {
      const n = sorted[i];
      if (!placed.length) {
        n.x = 0;
        n.y = 0;
      } else {
        const spot = findSpot(n, placed, gap);
        n.x = spot.x;
        n.y = spot.y;
      }
      placed.push(n);
    }
  }

  function groupBy(list, keyFn) {
    const map = new Map();
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const key = keyFn(item) || '';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return map;
  }

  // A group packs as one block so its members keep their offsets.
  function packUnits(model) {
    const units = [];
    const blocks = new Map();
    alive(model).forEach((s) => {
      if (!s.group) {
        units.push(s);
        return;
      }
      let unit = blocks.get(s.group);
      if (!unit) {
        unit = { x: 0, y: 0, w: 0, h: 0, rowIndex: s.rowIndex, members: [], offsets: [] };
        blocks.set(s.group, unit);
        units.push(unit);
      }
      unit.members.push(s);
    });
    blocks.forEach((unit) => {
      const b = boundsOf(unit.members);
      unit.x = b.x;
      unit.y = b.y;
      unit.w = b.w;
      unit.h = b.h;
      unit.offsets = unit.members.map((s) => ({ x: s.x - b.x, y: s.y - b.y }));
    });
    return units;
  }

  function placeUnits(units) {
    for (let i = 0; i < units.length; i++) {
      const unit = units[i];
      if (!unit.members) continue;
      for (let k = 0; k < unit.members.length; k++) {
        unit.members[k].x = unit.x + unit.offsets[k].x;
        unit.members[k].y = unit.y + unit.offsets[k].y;
      }
    }
  }

  function pack(model) {
    const items = packUnits(model);
    if (!items.length) return;
    if (model.columnRoles) {
      const keys = getColumnRoles(model).groupKeys;
      const level = (members, depth) => {
        if (depth >= keys.length) { packList(members, PACK_GAP); return; }
        const blocks = [];
        groupBy(members, (s) => sFields(model, s)[keys[depth]]).forEach((siblings) => {
          level(siblings, depth + 1);
          const box = boundsOf(siblings);
          offset(siblings, -box.x, -box.y);
          blocks.push({ x: 0, y: 0, w: box.w, h: box.h, members: siblings });
        });
        packList(blocks, PACK_GAP * (1.5 + 0.5 * (keys.length - depth - 1)));
        blocks.forEach((block) => offset(block.members, block.x, block.y));
      };
      level(items, 0);
      const box = boundsOf(items);
      offset(items, -(box.x + box.w * 0.5), -(box.y + box.h * 0.5));
      placeUnits(items);
      return;
    }
    const depts = groupBy(items, (s) => (model.deptKey ? sFields(model, s)[model.deptKey] : ''));
    const deptBlocks = [];
    depts.forEach((members) => {
      const groups = groupBy(members, (s) => (model.groupKey ? sFields(model, s)[model.groupKey] : ''));
      const groupBlocks = [];
      groups.forEach((gm) => {
        packList(gm, PACK_GAP);
        const gb = boundsOf(gm);
        offset(gm, -gb.x, -gb.y);
        groupBlocks.push({ x: 0, y: 0, w: gb.w, h: gb.h, members: gm });
      });
      packList(groupBlocks, PACK_GAP * 1.5);
      for (let i = 0; i < groupBlocks.length; i++) {
        const g = groupBlocks[i];
        offset(g.members, g.x, g.y);
      }
      const db = boundsOf(members);
      offset(members, -db.x, -db.y);
      deptBlocks.push({ x: 0, y: 0, w: db.w, h: db.h, members: members });
    });
    packList(deptBlocks, PACK_GAP * 2);
    for (let i = 0; i < deptBlocks.length; i++) {
      offset(deptBlocks[i].members, deptBlocks[i].x, deptBlocks[i].y);
    }
    const all = boundsOf(items);
    offset(items, -(all.x + all.w * 0.5), -(all.y + all.h * 0.5));
    placeUnits(items);
  }

  function sFields(model, sticky) {
    return model.rows[sticky.rowIndex].fields;
  }

  function writeArea(model, sticky) {
    const row = model.rows[sticky.rowIndex];
    if (!row) return;
    const area = areaValue(sticky);
    if (model.areaKey) row.fields[model.areaKey] = String(area);
    const qty = model.qtyKey ? num(row.fields[model.qtyKey]) : 1;
    if (model.sfKey && qty === 1) row.fields[model.sfKey] = String(area);
  }

  // The only way a sticky's area changes: an explicit edit of the Area
  // field. The true aspect is kept and the drawn box stays centred.
  function setAreaKeepingAspect(model, sticky, area) {
    const next = Math.max(0, Number(area) || 0);
    if (!next) { sticky.tw = 0; sticky.th = 0; writeArea(model, sticky); return; }
    const aspect = sticky.th > 0 && sticky.tw > 0 ? sticky.tw / sticky.th : sticky.w / sticky.h || 1;
    const th = Math.sqrt(next / aspect);
    sticky.tw = next / th;
    sticky.th = th;
    refit(model, sticky, true);
    writeArea(model, sticky);
  }

  function areaValue(sticky) {
    return Number(Math.max(0, trueArea(sticky)).toPrecision(12));
  }

  // ------------------------------------------------------------ grid fudge
  // With a fudge cell, a sticky draws as whole cells: of the cell counts
  // around its true sides, the pair whose product is nearest the true area
  // (ties keep the true aspect). The true size is never touched, so turning
  // the fudge off restores it exactly.

  function fudgeCells(tw, th, cell) {
    const area = tw * th;
    const fx = tw / cell;
    const fy = th / cell;
    const xs = [Math.max(1, Math.floor(fx)), Math.max(1, Math.ceil(fx))];
    let best = null;
    for (let i = 0; i < 2; i++) {
      const nx = xs[i];
      const ys = [Math.max(1, Math.floor(fy)), Math.max(1, Math.ceil(fy)), Math.max(1, Math.round(area / (nx * cell * cell)))];
      for (let k = 0; k < 3; k++) {
        const ny = ys[k];
        const err = Math.abs(nx * ny * cell * cell - area);
        const skew = Math.abs(Math.log((nx / ny) / (tw / th)));
        if (!best || err < best.err - 1e-9 || (err < best.err + 1e-9 && skew < best.skew)) best = { nx: nx, ny: ny, err: err, skew: skew };
      }
    }
    return [best.nx, best.ny];
  }

  function drawnSize(s, cell) {
    if (!(cell > 0)) return [s.tw, s.th];
    const c = fudgeCells(s.tw, s.th, cell);
    return [c[0] * cell, c[1] * cell];
  }

  // Re-derives the drawn box from the true size about its centre. With a
  // fudge cell, a box whose size changed lands with its corner on the grid.
  function refit(model, s, force) {
    const moduleSize = moduleDrawnSize(model, s);
    const cell = moduleSize ? 0 : model.cell || 0;
    const size = moduleSize || drawnSize(s, cell);
    if (!force && Math.abs(size[0] - s.w) < 1e-9 && Math.abs(size[1] - s.h) < 1e-9) return false;
    const cx = s.x + s.w * 0.5;
    const cy = s.y + s.h * 0.5;
    s.w = size[0];
    s.h = size[1];
    s.x = cx - s.w * 0.5;
    s.y = cy - s.h * 0.5;
    if (cell > 0) {
      s.x = Math.round(s.x / cell) * cell;
      s.y = Math.round(s.y / cell) * cell;
    }
    return true;
  }

  // Sets the buffer, the fudge cell (0 = true sizes), and the grid step
  // that decides how thick a line collides (omitted: unchanged). Returns
  // the stickies whose drawn size changed.
  function setParams(model, gap, cell, grid, gridActive) {
    model.gap = Math.max(0, Number(gap) || 0);
    if (grid !== undefined) model.grid = grid > 0 ? Number(grid) : 0;
    if (gridActive !== undefined) model.moduleGridActive = !!gridActive;
    else if (grid !== undefined) model.moduleGridActive = grid > 0;
    const next = cell > 0 ? cell : 0;
    const force = next > 0 && next !== model.cell;
    model.cell = next;
    const changed = [];
    for (let i = 0; i < model.stickies.length; i++) {
      if (refit(model, model.stickies[i], force)) changed.push(model.stickies[i]);
    }
    return changed;
  }

  // Rounds each body's corner to the cell where that stays legal: of the
  // four cell corners around it, the nearest that keeps it inside the
  // walls, a buffer from every other body, and clear of every line (swept,
  // so a snap never hops one). Rounding alone is not enough: two stickies
  // a hair under k cells apart can round to k - 1. A body with no legal
  // corner stays put; off the grid beats inside the buffer.
  function snapToCells(model, cell) {
    if (!(cell > 0)) return 0;
    const w = buildWorld(model);
    const cand = [];
    let moved = 0;
    // A body skipped because a neighbour was still off the grid gets
    // another pass once that neighbour lands; each pass only lands bodies.
    for (let pass = 0, before = -1; pass < 6 && moved !== before; pass++) {
      before = moved;
      snapPass(w, model, cell, cand, (n) => { moved += n; });
    }
    if (moved) commit(w);
    return moved;
  }

  function snapPass(w, model, cell, cand, count) {
    for (let b = 0; b < w.nb; b++) {
      const box = bodyBox(w, b);
      const x0 = box[0];
      const y0 = box[1];
      cand.length = 0;
      const anchors = [];
      w.members[b].forEach((i) => {
        const module = rowModule(model, w.list[i]);
        if (module && module.lock === 'hard') anchors.push({ x: w.x[i], y: w.y[i], sx: module.width, sy: module.depth });
      });
      // A rigid group can contain different module sizes and incompatible
      // offsets. Align its nearest legal member, translating the whole group;
      // an already aligned member keeps the authored arrangement unchanged.
      if (!anchors.length) anchors.push({ x: x0, y: y0, sx: cell, sy: cell });
      anchors.forEach((anchor) => {
        const fx = Math.floor(anchor.x / anchor.sx + 1e-9) * anchor.sx;
        const fy = Math.floor(anchor.y / anchor.sy + 1e-9) * anchor.sy;
        for (let c = 0; c < 4; c++) cand.push([(c & 1 ? fx + anchor.sx : fx) - anchor.x, (c & 2 ? fy + anchor.sy : fy) - anchor.y]);
      });
      cand.sort((p, q) => Math.hypot(p[0], p[1]) - Math.hypot(q[0], q[1]));
      if (Math.hypot(cand[0][0], cand[0][1]) < 1e-6) continue;
      if (!legalAt(w, b, 0, 0)) continue;
      for (let c = 0; c < 4; c++) {
        if (!legalAt(w, b, cand[c][0], cand[c][1])) continue;
        translate(w, b, cand[c][0], cand[c][1]);
        count(1);
        break;
      }
    }
  }

  // Whether body b, moved by (dx, dy), is inside the walls, a buffer from
  // every other body and every line, and got there without crossing one.
  function legalAt(w, b, dx, dy) {
    const g = w.gap - REST_SLACK;
    const m = w.members[b];
    if (w.wall) {
      const box = bodyBox(w, b);
      const f = w.wall;
      if (box[0] + dx < f.x0 - 1e-6 || box[2] + dx > f.x1 + 1e-6 || box[1] + dy < f.y0 - 1e-6 || box[3] + dy > f.y1 + 1e-6) return false;
    }
    const segs = w.segs;
    for (let k = 0; k < m.length; k++) {
      const i = m[k];
      const x0 = w.x[i] + dx;
      const y0 = w.y[i] + dy;
      const x1 = x0 + w.sw[i];
      const y1 = y0 + w.sh[i];
      for (let j = 0; j < w.n; j++) {
        if (w.body[j] === b) continue;
        const sx = Math.max(w.x[j] - x1, x0 - w.x[j] - w.sw[j]);
        const sy = Math.max(w.y[j] - y1, y0 - w.y[j] - w.sh[j]);
        if (Math.max(sx, sy) < g) return false;
      }
      for (let d = 0; d < segs.length; d += SEG) {
        const ax = segs[d];
        const ay = segs[d + 1];
        const bx = segs[d + 2];
        const by = segs[d + 3];
        if (cutsBox(x0, y0, x1, y1, ax, ay, bx, by)) return false;
        if (nearSeg(x0, y0, x1, y1, ax, ay, bx, by) < segs[d + 4] - REST_SLACK) return false;
        if ((dx || dy) && sweepSeg(w.x[i], w.y[i], w.x[i] + w.sw[i], w.y[i] + w.sh[i], dx, dy, ax, ay, bx, by) <= 1) return false;
      }
    }
    return true;
  }

  // --------------------------------------------------------------- stretch
  // An edge or corner drag reshapes a sticky at constant area. `o` is the
  // box at the press ({ x, y, w, h, tw, th }), `edge` one of n e s w ne nw
  // se sw, (px, py) the pointer in feet. The opposite edge (or corner)
  // stays put; an edge drag keeps the other axis centred. `opts.step` snaps
  // the dragged edge to the grid, `opts.cell` makes the dragged side whole
  // fudge cells, and `opts.wall` ({ x0, y0, x1, y1 }) bounds it.
  function fittingModuleCount(limit, side, step, gridActive) {
    if (!(limit > 0)) return 0;
    if (!gridActive || !(step > 0)) return Math.max(0, Math.floor(limit / side + 1e-9));
    const gridCells = Math.floor(limit / step + 1e-9);
    if (gridCells < 1) return 0;
    let count = Math.ceil((gridCells + 0.5) * step / side);
    while (count > 0 && Math.max(1, Math.round(count * side / step)) > gridCells) count--;
    return count;
  }

  function stretchBox(o, edge, px, py, opts) {
    const supplied = opts || {};
    const module = supplied.module && supplied.module.width > 0 && supplied.module.depth > 0 ? supplied.module : null;
    // A module controls dimensions before the board's size fudge. Loose lock
    // scales that complete envelope to the active primary grid afterwards.
    const op = module ? Object.assign({}, supplied, { cell: 0, step: 0 }) : supplied;
    const area = o.tw * o.th;
    const lo = Math.min(op.min || STRETCH_MIN, Math.sqrt(area));
    const wall = op.wall || null;
    let wMin = lo;
    let wMax = area / lo;
    if (wall) {
      wMax = Math.min(wMax, wall.x1 - wall.x0);
      wMin = Math.max(wMin, area / Math.max(1e-6, wall.y1 - wall.y0));
    }
    const hasE = edge.indexOf('e') >= 0;
    const hasW = edge.indexOf('w') >= 0;
    const hasN = edge.indexOf('n') >= 0;
    const hasS = edge.indexOf('s') >= 0;
    const corner = (hasE || hasW) && (hasN || hasS);
    const fx = hasW ? o.x + o.w : o.x;
    const fy = hasN ? o.y + o.h : o.y;
    const snap = (v) => {
      if (op.cell > 0) return Math.max(op.cell, Math.round(v / op.cell) * op.cell);
      return v;
    };
    const edgeAt = (p, fixed, sign) => {
      if (op.step > 0 && !(op.cell > 0)) p = Math.round(p / op.step) * op.step;
      return (p - fixed) * sign;
    };
    let tw;
    let th;
    if (hasE || hasW) {
      let ex = edgeAt(wall ? Math.min(Math.max(px, wall.x0), wall.x1) : px, fx, hasW ? -1 : 1);
      if (corner) {
        const ey = Math.max(1e-6, (hasN ? fy - py : py - fy));
        const aspect = Math.max(1e-6, ex) / ey;
        ex = Math.sqrt(area * aspect);
        if (op.step > 0 && !(op.cell > 0)) {
          const target = fx + (hasW ? -ex : ex);
          ex = Math.abs(Math.round(target / op.step) * op.step - fx);
        }
      }
      tw = snap(Math.min(wMax, Math.max(wMin, ex)));
      if (op.cell > 0 && tw > wMax + 1e-9) tw -= op.cell;
      th = area / tw;
    } else {
      let hMin = lo;
      let hMax = area / lo;
      if (wall) {
        hMax = Math.min(hMax, wall.y1 - wall.y0);
        hMin = Math.max(hMin, area / Math.max(1e-6, wall.x1 - wall.x0));
      }
      const ey = edgeAt(wall ? Math.min(Math.max(py, wall.y0), wall.y1) : py, fy, hasN ? -1 : 1);
      th = snap(Math.min(hMax, Math.max(hMin, ey)));
      if (op.cell > 0 && th > hMax + 1e-9) th -= op.cell;
      tw = area / th;
    }
    if (module && wall) {
      const cx = o.x + o.w * 0.5;
      const cy = o.y + o.h * 0.5;
      const roomW = hasW ? fx - wall.x0 : hasE ? wall.x1 - fx : 2 * Math.min(cx - wall.x0, wall.x1 - cx);
      const roomH = hasN ? fy - wall.y0 : hasS ? wall.y1 - fy : 2 * Math.min(cy - wall.y0, wall.y1 - cy);
      const fits = (width, height) => {
        const size = moduleSize({ tw: width, th: height }, module, supplied.step, supplied.gridActive);
        return size[0] <= roomW + 1e-8 && size[1] <= roomH + 1e-8;
      };
      if (!fits(tw, th)) {
        if (module.count) {
          let best = null;
          for (let columns = 1; columns <= module.count; columns++) {
            if (module.count % columns) continue;
            const rows = module.count / columns;
            const aspect = columns * module.width / (rows * module.depth);
            const width = Math.sqrt(area * aspect);
            const height = area / width;
            if (!fits(width, height)) continue;
            const score = Math.abs(Math.log(aspect / (tw / th)));
            if (!best || score < best.score) best = { tw: width, th: height, score: score };
          }
          if (!best) return { x: o.x, y: o.y, w: o.w, h: o.h, tw: o.tw, th: o.th };
          tw = best.tw; th = best.th;
        } else {
          const gridActive = module.lock === 'loose' && supplied.gridActive;
          const cols = fittingModuleCount(roomW, module.width, supplied.step, gridActive);
          const rows = fittingModuleCount(roomH, module.depth, supplied.step, gridActive);
          const minWidth = Math.max(lo, area / (rows * module.depth));
          const maxWidth = Math.min(area / lo, cols * module.width);
          if (!cols || !rows || minWidth > maxWidth + 1e-8) return { x: o.x, y: o.y, w: o.w, h: o.h, tw: o.tw, th: o.th };
          tw = Math.max(minWidth, Math.min(maxWidth, tw));
          th = area / tw;
          if (!fits(tw, th)) return { x: o.x, y: o.y, w: o.w, h: o.h, tw: o.tw, th: o.th };
        }
      }
    }
    const size = module ? moduleSize({ tw: tw, th: th }, module, supplied.step, supplied.gridActive) : op.cell > 0 ? drawnSize({ tw: tw, th: th }, op.cell) : [tw, th];
    const w = size[0];
    const h = size[1];
    let x = hasW ? fx - w : hasE ? fx : o.x + o.w * 0.5 - w * 0.5;
    let y = hasN ? fy - h : hasS ? fy : o.y + o.h * 0.5 - h * 0.5;
    if (op.cell > 0) {
      if (!hasE && !hasW) x += snapAxis(x, w, op.cell);
      if (!hasN && !hasS) y += snapAxis(y, h, op.cell);
    }
    return { x: x, y: y, w: w, h: h, tw: tw, th: th };
  }

  function ensureColumn(model, name) {
    const key = String(name || '').trim();
    if (!key) return null;
    if (model.columns.indexOf(key) < 0) model.columns.push(key);
    for (let i = 0; i < model.rows.length; i++) {
      if (model.rows[i].fields[key] == null) model.rows[i].fields[key] = '';
    }
    return key;
  }

  function leaveGroup(model, sticky) {
    const group = sticky.group;
    sticky.group = null;
    if (!group) return;
    const rest = alive(model).filter((s) => s.group === group);
    if (rest.length === 1) rest[0].group = null;
  }

  function dropSticky(model, id) {
    const sticky = model.stickies.find((s) => s.id === id);
    if (!sticky) return;
    const row = model.rows[sticky.rowIndex];
    if (row) row.dropped = true;
    leaveGroup(model, sticky);
  }

  // Every duplicate (Alt-drag, Ctrl+D, the menu): each sticky gets a copy
  // with every field of its row in a new row, inserted right after its
  // source row, so the copy exports as its own spreadsheet line beside the
  // original. Same box and style. Copies of a whole group form a new group.
  // Each copy passes through its original until passId is cleared. Null
  // past MAX_STICKIES.
  function duplicateStickies(model, ids) {
    const list = stickiesById(model, ids);
    if (!list.length || alive(model).length + list.length > MAX_STICKIES) return null;
    ensureRowIds(model);
    const groups = new Map();
    const out = [];
    const before = model.rows.length;
    const after = new Map();
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const rowIndex = model.rows.length;
      model.rows.push({ id: uid('r'), fields: Object.assign({}, sFields(model, s)), dropped: false });
      after.set(s.rowIndex, rowIndex);
      const c = newSticky(rowIndex, s.x, s.y, s.w, s.h, s.color);
      c.tw = s.tw;
      c.th = s.th;
      c.radius = s.radius || 0;
      c.stroke = s.stroke || 0;
      c.shadow = s.shadow || 0;
      c.gradientId = s.gradientId || null;
      c.height = finite(s.height) && s.height > 0 ? s.height : 8;
      c.z = nonNeg(s.z);
      c.material = appearance ? appearance.materialFor(s) : 'matte';
      c.locked = !!s.locked;
      Object.assign(c, readTextStyle(s));
      c.passId = s.id;
      if (s.group) {
        if (!groups.has(s.group)) groups.set(s.group, []);
        groups.get(s.group).push(c);
      }
      model.stickies.push(c);
      out.push(c);
    }
    groups.forEach((copies) => {
      if (copies.length < 2) return;
      const id = uid('g');
      for (let k = 0; k < copies.length; k++) copies[k].group = id;
    });
    const order = [];
    for (let i = 0; i < before; i++) {
      order.push(i);
      if (after.has(i)) order.push(after.get(i));
    }
    reorderRows(model, order);
    return out;
  }

  // Ctrl+D and the menu: the copies, a rigid block standing on their
  // originals, move to the nearest spot where every copy is one buffer
  // clear of every other sticky and every line, inside the frame walls.
  // The four spots one buffer beside the block come first, then offsets on
  // a grid of one buffer step, nearest first. A spread selection that fits
  // nowhere as one block places body by body (a locked group stays one
  // body). A body that fits nowhere shifts one width right and the result
  // is false, so the caller settles it.
  function placeCopies(model, copies, gap) {
    if (!copies.length) return false;
    const g = gap >= 0 ? gap : gapOf(model);
    const wall = model.frame ? frameInner(model.frame, g) : null;
    const segs = [];
    (model.lines || []).forEach((l) => {
      const r = lineCollisionRadius(l.width, model.grid) + g;
      for (let p = 0; p + 1 < l.points.length; p++) {
        const seg = new Float64Array(SEG);
        seg[0] = l.points[p][0];
        seg[1] = l.points[p][1];
        seg[2] = l.points[p + 1][0];
        seg[3] = l.points[p + 1][1];
        seg[4] = r;
        segs.push(seg);
      }
    });
    const mine = new Set(copies);
    if (placeBlock(copies, alive(model).filter((s) => !mine.has(s)), g, wall, segs, model)) return true;
    const bodies = new Map();
    copies.forEach((c) => {
      const k = c.group || c.id;
      if (!bodies.has(k)) bodies.set(k, []);
      bodies.get(k).push(c);
    });
    let ok = true;
    const waiting = new Set(copies);
    bodies.forEach((body) => {
      body.forEach((c) => waiting.delete(c));
      if (bodies.size > 1 && placeBlock(body, alive(model).filter((s) => !waiting.has(s) && body.indexOf(s) < 0), g, wall, segs, model)) return;
      const b = boundsOf(body);
      body.forEach((c) => { c.x += b.w + g; });
      ok = false;
    });
    return ok;
  }

  function placeBlock(copies, others, g, wall, segs, model) {
    const b = boundsOf(copies);
    const box = { x: 0, y: 0, w: 0, h: 0 };
    const fits = (dx, dy) => {
      if (wall && (b.x + dx < wall.x0 - 1e-6 || b.y + dy < wall.y0 - 1e-6 || b.x + b.w + dx > wall.x1 + 1e-6 || b.y + b.h + dy > wall.y1 + 1e-6)) return false;
      for (let i = 0; i < copies.length; i++) {
        const c = copies[i];
        box.x = c.x + dx;
        box.y = c.y + dy;
        box.w = c.w;
        box.h = c.h;
        for (let j = 0; j < others.length; j++) if (mtv(others[j], box, g - 1e-6)) return false;
        for (let k = 0; k < segs.length; k++) {
          if (capsulePush(box.x, box.y, box.x + box.w, box.y + box.h, segs[k], 0) && Math.hypot(PUSH[0], PUSH[1]) > 0.01) return false;
        }
      }
      return true;
    };
    const move = (dx, dy) => {
      copies.forEach((c) => {
        c.x += dx;
        c.y += dy;
      });
      return true;
    };
    const sides = [[b.w + g, 0], [0, b.h + g], [-(b.w + g), 0], [0, -(b.h + g)]].sort((p, q) => Math.hypot(p[0], p[1]) - Math.hypot(q[0], q[1]));
    for (let i = 0; i < sides.length; i++) if (fits(sides[i][0], sides[i][1])) return move(sides[i][0], sides[i][1]);
    const step = Math.max(1, g);
    const reach = model.frame ? Math.max(model.frame.w, model.frame.h) : 20 * Math.max(b.w, b.h);
    const n = Math.min(120, Math.ceil(reach / step));
    const cand = [];
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) if (i || j) cand.push(i * i + j * j, i, j);
    const idx = new Int32Array(cand.length / 3);
    for (let k = 0; k < idx.length; k++) idx[k] = k;
    idx.sort((p, q) => cand[p * 3] - cand[q * 3]);
    for (let k = 0; k < idx.length; k++) {
      const dx = cand[idx[k] * 3 + 1] * step;
      const dy = cand[idx[k] * 3 + 2] * step;
      if (fits(dx, dy)) return move(dx, dy);
    }
    return false;
  }

  // ------------------------------------------------------------ row order
  // The export order is model.rows' order. Rows move only through
  // reorderRows, which keeps every sticky on its own row.

  // `order`: every old row index, in the new order.
  function reorderRows(model, order) {
    ensureRowIds(model);
    const to = new Array(order.length);
    for (let i = 0; i < order.length; i++) to[order[i]] = i;
    model.rows = order.map((i) => model.rows[i]);
    model.stickies.forEach((s) => {
      s.rowIndex = to[s.rowIndex];
    });
  }

  function cellOf(fields, key) {
    return fields[key] == null ? '' : String(fields[key]).trim();
  }

  // The sheet's grouping levels: its categorical columns (the same test as
  // blobs, over its rows; never the name or area), in column order, kept
  // only when the rows really are clustered by them: within each parent
  // cluster, each value's rows run together (at most 10% extra runs, and
  // at least one, so a single stray row does not break the level), and the
  // clusters average two rows or more (a column that makes every row its
  // own cluster groups nothing). Rows in `skip` (the ones about to move)
  // are left out of the test.
  function rowHierarchy(model, skip) {
    if (model.columnRoles) return getColumnRoles(model).groupKeys.filter((key) => key !== model.nameKey);
    const rows = [];
    model.rows.forEach((r, i) => {
      if (!r.dropped && !(skip && skip.has(i))) rows.push(r.fields);
    });
    const levels = [];
    categoricalOf(model, rows).forEach((c) => {
      if (c.key === model.nameKey) return;
      const keys = levels.concat([c.key]);
      const distinct = new Set();
      let runs = 0;
      let prev = null;
      for (let i = 0; i < rows.length; i++) {
        const t = keys.map((k) => cellOf(rows[i], k)).join('\u001f');
        distinct.add(t);
        if (t !== prev) runs += 1;
        prev = t;
      }
      if (distinct.size * 2 <= rows.length && runs <= distinct.size + Math.max(1, Math.floor(distinct.size * 0.1))) levels.push(c.key);
    });
    return levels;
  }

  // After an edit to `key` on these rows: each moves to the end of the
  // deepest cluster its leading values match. With every level matching
  // that is its own cluster; with a value new at some level, it starts a
  // new cluster at the end of its parent's cluster (a new top-level value
  // goes after the last row). Moving rows go in their current order, so a
  // bulk edit keeps them in the same order; every other row keeps its
  // place relative to the rest. Nothing moves unless `key` is a level.
  // Returns whether any row moved.
  function resortRows(model, indices, key) {
    const moving = new Set(indices.filter((i) => model.rows[i] && !model.rows[i].dropped));
    if (!moving.size) return false;
    const levels = rowHierarchy(model, moving);
    if (!levels.length || (key != null && levels.indexOf(key) < 0)) return false;
    const order = [];
    for (let i = 0; i < model.rows.length; i++) if (!moving.has(i)) order.push(i);
    const movers = Array.from(moving).sort((p, q) => p - q);
    for (let m = 0; m < movers.length; m++) {
      const f = model.rows[movers[m]].fields;
      let at = -1;
      for (let d = levels.length; d >= 1 && at < 0; d--) {
        for (let p = order.length - 1; p >= 0; p--) {
          const r = model.rows[order[p]];
          if (r.dropped) continue;
          let same = true;
          for (let k = 0; k < d && same; k++) same = cellOf(r.fields, levels[k]) === cellOf(f, levels[k]);
          if (same) {
            at = p;
            break;
          }
        }
      }
      if (at < 0) {
        for (let p = order.length - 1; p >= 0 && at < 0; p--) if (!model.rows[order[p]].dropped) at = p;
      }
      order.splice(at + 1, 0, movers[m]);
    }
    if (order.every((v, i) => v === i)) return false;
    reorderRows(model, order);
    return true;
  }

  // ------------------------------------------------------------- line ends
  // A line may end in a cap at its start and at its end (`l.start`,
  // `l.end`; absent means none) and carry its own colour (`l.color`; absent
  // means the ink of what it sits on). Caps are drawing only: collision
  // still reads the centreline and width alone. Sized from the width, never
  // under LINE_END_MIN feet, so they scale with the board like the stroke.

  const LINE_ENDS = ['none', 'arrow', 'open', 'square', 'dot', 'tick', 'bar'];
  const LINE_END_MIN = 2; // ft

  function lineEndOr(value) {
    return LINE_ENDS.indexOf(value) > 0 ? value : null;
  }

  function lineEndSize(width) {
    return Math.max(LINE_END_MIN, width * 3);
  }

  // What every renderer draws for a line: `path`, the stroke's centreline
  // to draw with butt caps (an uncapped end runs on half the width, which is
  // the square cap it always had; an arrow end stops inside its head), and
  // `caps`, in feet: { k: 'fill', pts } closed polygons, { k: 'dot', x, y,
  // r } discs, and { k: 'stroke', pts, w } open polylines, each naming its
  // `kind` and which end (`at`: 'start' | 'end') it caps.
  function lineShape(l) {
    const pts = l.points.map((p) => [p[0], p[1]]);
    const caps = [];
    const w = l.width;
    const size = lineEndSize(w);
    const end = (atStart) => {
      const kind = lineEndOr(atStart ? l.start : l.end) || 'none';
      const i = atStart ? 0 : pts.length - 1;
      const step = atStart ? 1 : -1;
      let j = i + step;
      while (j >= 0 && j < pts.length && Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]) < 1e-9) j += step;
      if (j < 0 || j >= pts.length) return;
      const [x, y] = pts[i];
      const run = Math.hypot(x - pts[j][0], y - pts[j][1]);
      const ux = (x - pts[j][0]) / run; // outward, along the line past this end
      const uy = (y - pts[j][1]) / run;
      const nx = -uy;
      const ny = ux;
      const move = (d) => {
        const back = Math.min(-d, run * 0.5);
        pts[i] = d >= 0 ? [x + ux * d, y + uy * d] : [x - ux * back, y - uy * back];
      };
      const add = (cap) => caps.push(Object.assign(cap, { kind: kind, at: atStart ? 'start' : 'end' }));
      const L = size;
      const half = size * 0.4;
      if (kind === 'none' || kind === 'tick') move(w * 0.5);
      else if (kind === 'arrow') move(-L * 0.8);
      else if (kind === 'open') move(-w);
      if (kind === 'arrow') {
        add({ k: 'fill', pts: [[x, y], [x - ux * L + nx * half, y - uy * L + ny * half], [x - ux * L - nx * half, y - uy * L - ny * half]] });
      } else if (kind === 'open') {
        add({ k: 'stroke', w: w, pts: [[x - ux * L + nx * half, y - uy * L + ny * half], [x, y], [x - ux * L - nx * half, y - uy * L - ny * half]] });
      } else if (kind === 'square') {
        const s = size * 0.3;
        add({ k: 'fill', pts: [[x + (ux + nx) * s, y + (uy + ny) * s], [x + (-ux + nx) * s, y + (-uy + ny) * s], [x + (-ux - nx) * s, y + (-uy - ny) * s], [x + (ux - nx) * s, y + (uy - ny) * s]] });
      } else if (kind === 'dot') {
        add({ k: 'dot', x: x, y: y, r: size * 0.35 });
      } else if (kind === 'tick') {
        const t = size * 0.5 * Math.SQRT1_2;
        add({ k: 'stroke', w: w, pts: [[x + (ux + nx) * t, y + (uy + ny) * t], [x - (ux + nx) * t, y - (uy + ny) * t]] });
      } else if (kind === 'bar') {
        add({ k: 'stroke', w: w, pts: [[x + nx * half, y + ny * half], [x - nx * half, y - ny * half]] });
      }
    };
    end(true);
    end(false);
    return { path: pts, caps: caps };
  }

  // Line colour and ends for a set of lines; null clears to the default.
  // Returns how many lines changed.
  function setLineStyle(lines, prop, value) {
    const clean = prop === 'color' ? hexOr(value, null) : prop === 'start' || prop === 'end' ? lineEndOr(value) : undefined;
    if (clean === undefined) return 0;
    let changed = 0;
    for (let i = 0; i < lines.length; i++) {
      if ((lines[i][prop] || null) === clean) continue;
      if (clean == null) delete lines[i][prop];
      else lines[i][prop] = clean;
      changed += 1;
    }
    return changed;
  }

  // A saved line: its own colour and ends only when set, so older files and
  // plain lines read exactly as before.
  function captureLine(l) {
    const out = { id: l.id, points: l.points.map((p) => [p[0], p[1]]), width: l.width };
    const color = hexOr(l.color, null);
    if (color) out.color = color;
    if (lineEndOr(l.start)) out.start = l.start;
    if (lineEndOr(l.end)) out.end = l.end;
    return out;
  }

  // ------------------------------------------------------------------- CAD
  // The scene cad.js turns into a .3dm: y-down feet, the drawn (fudged)
  // boxes, and each sticky's true area. Text x, y is the block's top-left.

  function hexOr(value, fallback) {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
  }

  function capRadius(r, w, h) {
    return Math.max(0, Math.min(r || 0, Math.min(w, h) * 0.5));
  }

  function buildCadScene(model, view) {
    const v = view || {};
    const f = model.frame;
    const cols = model.columns;
    const fills = appearance ? appearance.prepare(model) : null;
    const text = (row, key) => (key && row[key] != null ? String(row[key]) : '');
    return {
      units: 'feet',
      title: f ? f.title : frameTitleFor(model.fileName),
      frame: f
        ? { x: f.x, y: f.y, w: f.w, h: f.h, radius: capRadius(FRAME_RADIUS, f.w, f.h), title: f.title, fill: hexOr(f.color, FRAME_FILL) }
        : null,
      stickies: alive(model).map((s) => {
        const row = sFields(model, s);
        const meta = {};
        for (let c = 0; c < cols.length; c++) meta[cols[c]] = fieldText(model, s, cols[c]);
        return {
          id: s.id,
          x: s.x,
          y: s.y,
          w: s.w,
          h: s.h,
          radius: capRadius(s.radius, s.w, s.h),
          fill: appearance ? appearance.fillFor(model, s, fills) : hexOr(s.color, STICKY_FILL),
          stroke: s.stroke || 0,
          name: text(row, model.nameKey),
          area: areaValue(s),
          department: text(row, model.deptKey),
          group: text(row, model.groupKey),
          meta: meta,
        };
      }),
      // Each line's centreline as drawn, its own colour or null (the layer's),
      // and its end caps as geometry (engine.lineShape).
      lines: (model.lines || []).map((l) => Object.assign(captureLine(l), { color: hexOr(l.color, null), caps: lineShape(l).caps })),
      texts: (model.texts || []).map((t) => ({ id: t.id, x: t.x, y: t.y, text: t.text, size: t.size, font: String(v.font || v.face || 'sans-serif'), color: hexOr(t.textColor, null) })),
      blobs: cadBlobs(model),
    };
  }

  // ------------------------------------------------------------------ blobs
  // A category blob is a soft shape drawn around every sticky that shares
  // one value of a categorical key, like a Grasshopper group. Blobs are
  // decoration: they never collide and never move anything. Their settings
  // are authored and live on the board (journaled, saved); contours are
  // derived and never stored.
  //
  // model.blobs = { on: [key...], keys: { [key]: { offset, color, alpha,
  // stroke?, label, singles, values: { [value]: { offset?, color?, alpha?,
  // stroke?, label? } } } } }. A value's own setting wins over its key's; a
  // null offset is half the buffer, a null colour the palette's pick, a
  // missing stroke BLOB_LINE (0 draws no outline).

  // Cool and muted, so every hue reads apart from the warm sticky fills.
  const BLOB_PALETTE = ['#2f7f9e', '#5b62c9', '#c0567a', '#3c9468', '#cf8a2e', '#8a55b8', '#2a9d9a', '#b8603c', '#76902c', '#56657a', '#c44b4b', '#4d86c7'];
  const BLOB_ALPHA = 0.18;
  const BLOB_LABEL = 7; // label height, ft
  const BLOB_LINE = 0.8; // default outline width, ft
  const BLOB_STROKE_MAX = 8; // ft
  const BLOB_OFFSET_MAX = 100;
  // Grid resolution of the fallback contour: the field spans at most this
  // many cells on its long side.
  const BLOB_RES = 220;
  // The exact contour builder (blob.js), loaded before this file in the
  // page and required beside it in Node. Without it, the raster stands in.
  const BLOB =
    typeof module !== 'undefined' && module.exports && typeof require === 'function'
      ? require('./blob.js')
      : (typeof globalThis !== 'undefined' && globalThis.ProgramBoardBlob) || null;
  // Categorical: text-like values (fewer than 60% numeric), filled on at
  // least half the stickies, some value shared by two or more, and at most
  // max(12, 40% of the stickies) distinct values.
  const CAT_MIN_DISTINCT = 12;
  const CAT_SHARE = 0.4;
  const CAT_NUMERIC = 0.6;
  const CAT_COVER = 0.5;

  function blobValue(model, s, key) {
    return fieldText(model, s, key).trim();
  }

  function looksNumeric(v) {
    return /^[-+]?\$?\s*(\d[\d,]*)?\.?\d+\s*(%|sf|ft)?$/i.test(v);
  }

  // [{ key, groups, shared }]: the keys that look like categories across
  // the stickies on the board, in column order. `groups` is the number of
  // distinct values.
  function categoricalKeys(model) {
    return categoricalOf(model, alive(model).map((s) => sFields(model, s)));
  }

  // The same test over any list of rows' fields.
  function categoricalOf(model, fieldsList) {
    const n = fieldsList.length;
    const out = [];
    if (model.columnRoles) {
      getColumnRoles(model).groupKeys.forEach((key) => {
        const counts = new Map();
        fieldsList.forEach((fields) => {
          const value = cellOf(fields, key);
          if (value) counts.set(value, (counts.get(value) || 0) + 1);
        });
        out.push({ key: key, groups: counts.size, shared: Array.from(counts.values()).filter((count) => count >= 2).length });
      });
      return out;
    }
    if (n < 2) return out;
    const cap = Math.max(CAT_MIN_DISTINCT, Math.floor(n * CAT_SHARE));
    for (let c = 0; c < model.columns.length; c++) {
      const key = model.columns[c];
      if (key === model.areaKey) continue;
      const counts = new Map();
      let filled = 0;
      let numeric = 0;
      for (let i = 0; i < n; i++) {
        const raw = fieldsList[i][key];
        const v = raw == null ? '' : String(raw).trim();
        if (!v) continue;
        filled += 1;
        if (looksNumeric(v)) numeric += 1;
        counts.set(v, (counts.get(v) || 0) + 1);
      }
      if (filled < Math.max(2, n * CAT_COVER) || numeric >= filled * CAT_NUMERIC || counts.size > cap) continue;
      let shared = 0;
      counts.forEach((k) => {
        if (k >= 2) shared += 1;
      });
      if (shared) out.push({ key: key, groups: counts.size, shared: shared });
    }
    return out;
  }

  function blobSettings(model) {
    if (!model.blobs || typeof model.blobs !== 'object') model.blobs = { on: [], keys: {} };
    return model.blobs;
  }

  function blobKey(model, key) {
    const b = blobSettings(model);
    if (!b.keys[key]) b.keys[key] = { offset: null, color: null, alpha: BLOB_ALPHA, label: true, singles: true, values: {} };
    return b.keys[key];
  }

  function blobOn(model, key) {
    return !!(model.blobs && model.blobs.on.indexOf(key) >= 0);
  }

  // Keys draw in column order, the later key on top.
  function setBlobOn(model, key, on) {
    const b = blobSettings(model);
    const list = b.on.filter((k) => k !== key);
    if (on) {
      list.push(key);
      blobKey(model, key);
    }
    const at = (k) => {
      const i = model.columns.indexOf(k);
      return i < 0 ? Infinity : i;
    };
    b.on = list.sort((p, q) => at(p) - at(q));
  }

  function hashString(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // Palette colours for one key's values: a hash of key + value, stable
  // across reloads; values that land on a taken colour step to the next
  // free one, in value order.
  function blobPalette(key, values) {
    const out = new Map();
    const used = new Set();
    values.slice().sort().forEach((v) => {
      let i = hashString(key + '\u001f' + v) % BLOB_PALETTE.length;
      for (let k = 0; k < BLOB_PALETTE.length && used.has(i); k++) i = (i + 1) % BLOB_PALETTE.length;
      used.add(i);
      if (used.size >= BLOB_PALETTE.length) used.clear();
      out.set(v, BLOB_PALETTE[i]);
    });
    return out;
  }

  // The default offset: half the buffer for the first key drawn, a quarter
  // buffer less for each key drawn over it (never under 15% of the buffer),
  // so a later key's blobs nest inside an earlier key's instead of tracing
  // the same outline.
  function blobDefaultOffset(model, key) {
    const gap = gapOf(model);
    const rank = Math.max(0, model.blobs ? model.blobs.on.indexOf(key) : 0);
    return Math.max(gap * 0.15, gap * (0.5 - 0.25 * rank));
  }

  // The settings that apply to one blob: { offset, color, alpha, label }.
  function blobStyle(model, key, value, paletteColor) {
    const k = (model.blobs && model.blobs.keys[key]) || {};
    const v = (k.values && k.values[value]) || {};
    return {
      offset: finite(v.offset) ? v.offset : finite(k.offset) ? k.offset : blobDefaultOffset(model, key),
      color: v.color || k.color || paletteColor || BLOB_PALETTE[hashString(key + '\u001f' + value) % BLOB_PALETTE.length],
      alpha: finite(v.alpha) ? v.alpha : finite(k.alpha) ? k.alpha : BLOB_ALPHA,
      stroke: finite(v.stroke) ? v.stroke : finite(k.stroke) ? k.stroke : BLOB_LINE,
      label: typeof v.label === 'boolean' ? v.label : k.label !== false,
      palette: paletteColor || null,
    };
  }

  // One property for one value, or (value null) for every blob of the key:
  // the key's setting changes and the values' own settings of it go.
  function setBlobStyle(model, key, value, prop, val) {
    const k = blobKey(model, key);
    const clean = (o) => {
      if (prop === 'offset') return finite(val) ? Math.min(BLOB_OFFSET_MAX, Math.max(0, val)) : null;
      if (prop === 'alpha') return finite(val) ? Math.min(1, Math.max(0.02, val)) : null;
      if (prop === 'stroke') return finite(val) ? Math.min(BLOB_STROKE_MAX, Math.max(0, val)) : null;
      if (prop === 'color') return typeof val === 'string' && /^#[0-9a-f]{6}$/i.test(val) ? val.toLowerCase() : null;
      if (prop === 'label') return !!val;
      return o;
    };
    if (value == null) {
      if (prop === 'singles') k.singles = !!val;
      else k[prop] = clean(k[prop]);
      Object.keys(k.values).forEach((v) => {
        delete k.values[v][prop];
        if (!Object.keys(k.values[v]).length) delete k.values[v];
      });
      return;
    }
    const v = k.values[value] || (k.values[value] = {});
    const next = clean(v[prop]);
    if (next == null) delete v[prop];
    else v[prop] = next;
    if (!Object.keys(v).length) delete k.values[value];
  }

  // The blobs to draw, in draw order: key order, later on top; values in
  // the order their first sticky appears. [{ key, value, members, style }].
  function blobGroups(model) {
    const b = model.blobs;
    if (!b || !b.on.length) return [];
    const list = alive(model);
    const out = [];
    for (let o = 0; o < b.on.length; o++) {
      const key = b.on[o];
      if (model.columns.indexOf(key) < 0) continue;
      const k = b.keys[key] || {};
      const byValue = new Map();
      for (let i = 0; i < list.length; i++) {
        const v = blobValue(model, list[i], key);
        if (!v) continue;
        let m = byValue.get(v);
        if (!m) byValue.set(v, (m = []));
        m.push(list[i]);
      }
      const colors = blobPalette(key, Array.from(byValue.keys()));
      byValue.forEach((members, value) => {
        const style = blobStyle(model, key, value, colors.get(value));
        if (members.length < 2 && k.singles === false) return;
        out.push({ key: key, value: value, members: members, style: style });
      });
    }
    return out;
  }

  // How far apart two members may be and still merge into one outline:
  // their offset shapes close over gaps narrower than twice this.
  function blobSmooth(model) {
    return Math.max(2, gapOf(model) * 0.6);
  }

  // Felzenszwalb's 1-D squared distance transform, in place along one row
  // or column of `f` (n samples, `stride` apart, starting at `at`).
  function edt1(f, at, stride, n, g, v, z) {
    for (let q = 0; q < n; q++) g[q] = f[at + q * stride];
    let k = 0;
    v[0] = 0;
    z[0] = -1e30;
    z[1] = 1e30;
    for (let q = 1; q < n; q++) {
      let s = (g[q] + q * q - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k -= 1;
        s = (g[q] + q * q - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k += 1;
      v[k] = q;
      z[k] = s;
      z[k + 1] = 1e30;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k += 1;
      const d = q - v[k];
      f[at + q * stride] = d * d + g[v[k]];
    }
  }

  // The shrink-wrap around member rects [{ x, y, w, h, radius }]: the union
  // of the rects grown by `offset`, closed by `smooth` (grown by offset +
  // smooth, then shrunk by smooth), so members closer than
  // 2 (offset + smooth) merge into one outline with round fillets in the
  // notches between them, and members further apart stay separate islands.
  // Built exactly from lines and arcs by blob.js; `segs` is that contour
  // and `points` a fine sampling of it for hit tests and labels.
  // Returns { loops: [{ segs, points, hole, area }], label: { x, y } | null }.
  function blobShape(rects, offset, smooth) {
    const exact = BLOB && BLOB.wrap(rects, offset, smooth);
    if (exact) return { loops: exact.loops, label: blobLabelAt(exact.loops) };
    return blobRaster(rects, offset, smooth);
  }

  // The same shrink-wrap sampled on a grid, for when the exact build is
  // unavailable or fails: the exact distance to the nearest member gives
  // the offset union; a Euclidean distance transform of the grown set gives
  // the closing; the outline is the zero crossing of the larger of the two
  // (marching squares), simplified and softened with one Chaikin pass.
  // Points only, no `segs`.
  function blobRaster(rects, offset, smooth) {
    const off = Math.max(0, offset || 0);
    const r = Math.max(0.5, smooth || 0);
    const grow = off + r;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < rects.length; i++) {
      const q = rects[i];
      x0 = Math.min(x0, q.x);
      y0 = Math.min(y0, q.y);
      x1 = Math.max(x1, q.x + q.w);
      y1 = Math.max(y1, q.y + q.h);
    }
    if (!rects.length) return { loops: [], label: null };
    const h = Math.max(0.25, (Math.max(x1 - x0, y1 - y0) + 2 * grow) / BLOB_RES);
    const pad = grow + 2 * h;
    const gx = x0 - pad;
    const gy = y0 - pad;
    const nx = Math.ceil((x1 - x0 + 2 * pad) / h) + 1;
    const ny = Math.ceil((y1 - y0 + 2 * pad) / h) + 1;
    const N = nx * ny;
    const d = new Float32Array(N).fill(1e9);
    const reach = grow + h;
    for (let m = 0; m < rects.length; m++) {
      const q = rects[m];
      const i0 = Math.max(0, Math.floor((q.x - reach - gx) / h));
      const i1 = Math.min(nx - 1, Math.ceil((q.x + q.w + reach - gx) / h));
      const j0 = Math.max(0, Math.floor((q.y - reach - gy) / h));
      const j1 = Math.min(ny - 1, Math.ceil((q.y + q.h + reach - gy) / h));
      for (let j = j0; j <= j1; j++) {
        const py = gy + j * h;
        const dy = Math.max(q.y - py, 0, py - q.y - q.h);
        const row = j * nx;
        for (let i = i0; i <= i1; i++) {
          const px = gx + i * h;
          const dx = Math.max(q.x - px, 0, px - q.x - q.w);
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < d[row + i]) d[row + i] = dist;
        }
      }
    }
    // Squared distance (in cells) from each node of the grown set to the
    // nearest node outside it.
    const e = new Float64Array(N);
    for (let p = 0; p < N; p++) e[p] = d[p] <= grow ? 1e20 : 0;
    const long = Math.max(nx, ny);
    const g = new Float64Array(long);
    const v = new Int32Array(long);
    const z = new Float64Array(long + 1);
    for (let i = 0; i < nx; i++) edt1(e, i, nx, ny, g, v, z);
    for (let j = 0; j < ny; j++) edt1(e, j * nx, 1, nx, g, v, z);
    // Inside where positive. The node-to-node distance overshoots the true
    // distance to the grown boundary by up to a cell; taking the full cell
    // off keeps the closing at or under the exact offset along straight
    // runs, so those stay ripple-free and the closing only shows in notches.
    const f = new Float32Array(N);
    for (let p = 0; p < N; p++) f[p] = Math.max(off - d[p], Math.sqrt(e[p]) * h - h - r);
    const loops = marchLoops(f, nx, ny, gx, gy, h).map((pts) => chaikin(simplify(pts, h * 0.3)));
    const out = loops.map((pts) => ({ points: pts, hole: false, area: polyArea(pts) }));
    for (let a = 0; a < out.length; a++) {
      let inside = 0;
      const p = out[a].points[0];
      for (let b = 0; b < out.length; b++) if (b !== a && pointInPoly(p[0], p[1], out[b].points)) inside += 1;
      out[a].hole = inside % 2 === 1;
    }
    return { loops: out, label: blobLabelAt(out) };
  }

  // Marching squares at level 0: closed loops of [x, y] in feet. The grid
  // border lies outside, so every crossing joins exactly two cells.
  function marchLoops(f, nx, ny, gx, gy, h) {
    const N = nx * ny;
    const nb0 = new Int32Array(2 * N).fill(-1);
    const nb1 = new Int32Array(2 * N).fill(-1);
    const link = (a, b) => {
      if (nb0[a] < 0) nb0[a] = b;
      else nb1[a] = b;
      if (nb0[b] < 0) nb0[b] = a;
      else nb1[b] = a;
    };
    for (let j = 0; j + 1 < ny; j++) {
      for (let i = 0; i + 1 < nx; i++) {
        const a = j * nx + i;
        const va = f[a];
        const vb = f[a + 1];
        const vc = f[a + nx + 1];
        const vd = f[a + nx];
        const c = (va > 0 ? 1 : 0) | (vb > 0 ? 2 : 0) | (vc > 0 ? 4 : 0) | (vd > 0 ? 8 : 0);
        if (c === 0 || c === 15) continue;
        const top = a;
        const bottom = a + nx;
        const left = N + a;
        const right = N + a + 1;
        switch (c) {
          case 1: case 14: link(left, top); break;
          case 2: case 13: link(top, right); break;
          case 3: case 12: link(left, right); break;
          case 4: case 11: link(right, bottom); break;
          case 6: case 9: link(top, bottom); break;
          case 7: case 8: link(left, bottom); break;
          case 5:
            if (va + vb + vc + vd > 0) {
              link(top, right);
              link(left, bottom);
            } else {
              link(left, top);
              link(right, bottom);
            }
            break;
          case 10:
            if (va + vb + vc + vd > 0) {
              link(left, top);
              link(right, bottom);
            } else {
              link(top, right);
              link(left, bottom);
            }
            break;
          default:
            break;
        }
      }
    }
    const point = (id) => {
      const vert = id >= N;
      const a = vert ? id - N : id;
      const b = vert ? a + nx : a + 1;
      const t = f[a] / (f[a] - f[b]);
      const i = a % nx;
      const j = (a - i) / nx;
      return vert ? [gx + i * h, gy + (j + t) * h] : [gx + (i + t) * h, gy + j * h];
    };
    const seen = new Uint8Array(2 * N);
    const loops = [];
    for (let id = 0; id < 2 * N; id++) {
      if (nb0[id] < 0 || seen[id]) continue;
      const pts = [];
      let prev = -1;
      let cur = id;
      while (cur >= 0 && !seen[cur]) {
        seen[cur] = 1;
        pts.push(point(cur));
        const next = nb0[cur] !== prev ? nb0[cur] : nb1[cur];
        prev = cur;
        cur = next;
      }
      if (pts.length >= 3) loops.push(pts);
    }
    return loops;
  }

  // Douglas-Peucker on a closed loop, split at its two furthest-apart points.
  function simplify(pts, tol) {
    if (pts.length < 8) return pts;
    let far = 0;
    let best = -1;
    for (let i = 1; i < pts.length; i++) {
      const dd = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
      if (dd > best) {
        best = dd;
        far = i;
      }
    }
    const keep = new Uint8Array(pts.length);
    const run = (a, b) => {
      const stack = [[a, b]];
      while (stack.length) {
        const [s, t] = stack.pop();
        const p = pts[s];
        const q = pts[t % pts.length];
        const lx = q[0] - p[0];
        const ly = q[1] - p[1];
        const len = Math.hypot(lx, ly) || 1;
        let worst = -1;
        let at = -1;
        for (let i = s + 1; i < t; i++) {
          const w = pts[i];
          const dist = Math.abs((w[0] - p[0]) * ly - (w[1] - p[1]) * lx) / len;
          if (dist > worst) {
            worst = dist;
            at = i;
          }
        }
        if (worst > tol) {
          keep[at] = 1;
          stack.push([s, at], [at, t]);
        }
      }
    };
    keep[0] = 1;
    keep[far] = 1;
    run(0, far);
    run(far, pts.length);
    const out = [];
    for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
    return out.length >= 3 ? out : pts;
  }

  // One corner-cutting pass: soft curves from a polygon.
  function chaikin(pts) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      out.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25], [p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
    }
    return out;
  }

  function polyArea(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return Math.abs(a) * 0.5;
  }

  function pointInPoly(x, y, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i];
      const b = pts[j];
      if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }

  // Where the title sits: on the top edge of the largest island, at its
  // left end, like a Grasshopper group's name.
  function blobLabelAt(loops) {
    let best = null;
    for (let i = 0; i < loops.length; i++) if (!loops[i].hole && (!best || loops[i].area > best.area)) best = loops[i];
    if (!best) return null;
    let top = Infinity;
    for (let i = 0; i < best.points.length; i++) top = Math.min(top, best.points[i][1]);
    let left = Infinity;
    for (let i = 0; i < best.points.length; i++) if (best.points[i][1] <= top + BLOB_LABEL * 0.5) left = Math.min(left, best.points[i][0]);
    return { x: left, y: top };
  }

  // A number that changes whenever the outline would: members' ids,
  // boxes, and corner radii, the offset, and the smoothing.
  function blobSig(group, smooth) {
    let h = 2166136261;
    const mix = (n) => {
      h ^= n | 0;
      h = Math.imul(h, 16777619);
    };
    const ms = group.members;
    mix(ms.length);
    // Micro-feet: any fractional offset a person can set rebuilds.
    mix(Math.round(group.style.offset * 1e6));
    mix(Math.round(smooth * 1e6));
    for (let i = 0; i < ms.length; i++) {
      const s = ms[i];
      mix(hashString(s.id));
      mix(Math.round(s.x * 1000));
      mix(Math.round(s.y * 1000));
      mix(Math.round(s.w * 1000));
      mix(Math.round(s.h * 1000));
      mix(Math.round((s.radius || 0) * 1000));
    }
    return h >>> 0;
  }

  // Contours are cached per blob (key + value) and rebuilt only when a
  // member moves or resizes, the membership changes, or the offset or the
  // smoothing (the buffer) changes; colour, opacity, and the label never
  // touch the outline. `update(model, limit, budgetMs)` returns the blobs
  // in draw order, each { id, key, value, members, style, shape, version }.
  // At most `limit` changed outlines are rebuilt per call, longest-waiting
  // first, and none after the first once `budgetMs` has passed; the rest
  // keep their last outline and count as `stale`. A new blob is always
  // built. `version` bumps on every rebuild.
  function blobCache() {
    const map = new Map();
    const clock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
    const cache = {
      computed: 0,
      stale: 0,
      ms: 0,
      clear() {
        map.clear();
      },
      update(model, limit, budgetMs) {
        const t0 = clock();
        const groups = blobGroups(model);
        const smooth = blobSmooth(model);
        const seen = new Set();
        const out = [];
        const dirty = [];
        cache.computed = 0;
        cache.stale = 0;
        const build = (e, gr, sig) => {
          e.shape = blobShape(gr.members, gr.style.offset, smooth);
          e.sig = sig;
          e.wait = 0;
          e.version += 1;
          cache.computed += 1;
        };
        for (let i = 0; i < groups.length; i++) {
          const gr = groups[i];
          const id = gr.key + '\u001f' + gr.value;
          seen.add(id);
          const sig = blobSig(gr, smooth);
          let e = map.get(id);
          if (!e) {
            e = { id: id, key: gr.key, value: gr.value, version: 0, wait: 0 };
            map.set(id, e);
            build(e, gr, sig);
          } else if (e.sig !== sig) {
            dirty.push({ e: e, gr: gr, sig: sig });
          }
          e.members = gr.members;
          e.style = gr.style;
          out.push(e);
        }
        if (dirty.length) {
          const budget = limit == null ? dirty.length : Math.max(0, limit);
          const timed = budgetMs != null;
          if (budget < dirty.length || timed) dirty.sort((p, q) => q.e.wait - p.e.wait);
          let built = 0;
          for (let i = 0; i < dirty.length; i++) {
            const d = dirty[i];
            if (built < budget && (!timed || built === 0 || clock() - t0 < budgetMs)) {
              build(d.e, d.gr, d.sig);
              built += 1;
            } else {
              d.e.wait += 1;
              cache.stale += 1;
            }
          }
        }
        map.forEach((e, id) => {
          if (!seen.has(id)) map.delete(id);
        });
        cache.ms = clock() - t0;
        return out;
      },
    };
    return cache;
  }

  // Every visible blob with its outline, uncached (exports and tests).
  function blobShapes(model) {
    const smooth = blobSmooth(model);
    return blobGroups(model).map((g) => ({ key: g.key, value: g.value, members: g.members, style: g.style, shape: blobShape(g.members, g.style.offset, smooth) }));
  }

  // For the 3DM: one closed loop per island or hole, in feet. `segs` (lines
  // and arcs, when the exact build ran) is the contour; `points` samples it.
  function cadBlobs(model) {
    const out = [];
    blobShapes(model).forEach((b) => {
      b.shape.loops.forEach((l) => {
        const segs = l.segs ? l.segs.map((p) => Object.assign({}, p)) : null;
        out.push({ key: b.key, value: b.value, segs: segs, points: l.points.map((p) => [p[0], p[1]]), closed: true, color: b.style.color, stroke: b.style.stroke, hole: l.hole });
      });
    });
    return out;
  }

  // The blob a board point grabs, from `list` (blobCache entries or
  // blobShapes): of every blob whose fill holds the point (even-odd over
  // its loops, so a hole misses) or whose outline lies within `tol`, the
  // one with the least area. A small blob inside or across a large one
  // stays reachable wherever the two overlap. Null when none.
  function blobPick(list, x, y, tol) {
    let best = null;
    let least = Infinity;
    const t2 = tol > 0 ? tol * tol : 0;
    for (let i = 0; i < list.length; i++) {
      const loops = list[i].shape && list[i].shape.loops;
      if (!loops || !loops.length) continue;
      let inside = false;
      let near = false;
      let area = 0;
      for (let j = 0; j < loops.length; j++) {
        const pts = loops[j].points;
        if (pointInPoly(x, y, pts)) inside = !inside;
        const a = finite(loops[j].area) ? loops[j].area : polyArea(pts);
        area += loops[j].hole ? -a : a;
        for (let p = 0, q = pts.length - 1; t2 && !near && p < pts.length; q = p++) near = segDist2(x, y, pts[q], pts[p]) <= t2;
      }
      if ((inside || near) && area < least) {
        best = list[i];
        least = area;
      }
    }
    return best;
  }

  function segDist2(x, y, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - a[0]) * dx + (y - a[1]) * dy) / len2)) : 0;
    const ex = x - (a[0] + dx * t);
    const ey = y - (a[1] + dy * t);
    return ex * ex + ey * ey;
  }

  function captureBlobs(b) {
    const src = b || { on: [], keys: {} };
    const keys = {};
    Object.keys(src.keys || {}).forEach((key) => {
      const k = src.keys[key];
      const values = {};
      Object.keys(k.values || {}).forEach((v) => {
        const p = k.values[v];
        const o = {};
        ['offset', 'color', 'alpha', 'stroke', 'label'].forEach((prop) => {
          if (p[prop] !== undefined) o[prop] = p[prop];
        });
        values[v] = o;
      });
      keys[key] = { offset: k.offset == null ? null : k.offset, color: k.color || null, alpha: k.alpha, label: k.label !== false, singles: k.singles !== false, values: values };
      if (finite(k.stroke)) keys[key].stroke = k.stroke;
    });
    return { on: (src.on || []).slice(), keys: keys };
  }

  function readBlobs(src) {
    const out = { on: [], keys: {} };
    if (!src || typeof src !== 'object') return out;
    const hex = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const keys = src.keys && typeof src.keys === 'object' ? src.keys : {};
    Object.keys(keys).forEach((key) => {
      const k = keys[key];
      if (!k || typeof k !== 'object') return;
      const values = {};
      const vs = k.values && typeof k.values === 'object' ? k.values : {};
      Object.keys(vs).forEach((v) => {
        const p = vs[v];
        if (!p || typeof p !== 'object') return;
        const o = {};
        if (finite(p.offset)) o.offset = clamp(p.offset, 0, BLOB_OFFSET_MAX);
        if (hex(p.color)) o.color = hex(p.color);
        if (finite(p.alpha)) o.alpha = clamp(p.alpha, 0.02, 1);
        if (finite(p.stroke)) o.stroke = clamp(p.stroke, 0, BLOB_STROKE_MAX);
        if (typeof p.label === 'boolean') o.label = p.label;
        // Boards saved while "Hide this group" existed carry `hidden`, and
        // nothing could unhide it; dropping it here brings those blobs back.
        if (Object.keys(o).length) values[v] = o;
      });
      out.keys[key] = {
        offset: finite(k.offset) ? clamp(k.offset, 0, BLOB_OFFSET_MAX) : null,
        color: hex(k.color),
        alpha: finite(k.alpha) ? clamp(k.alpha, 0.02, 1) : BLOB_ALPHA,
        label: k.label !== false,
        singles: k.singles !== false,
        values: values,
      };
      if (finite(k.stroke)) out.keys[key].stroke = clamp(k.stroke, 0, BLOB_STROKE_MAX);
    });
    out.on = (Array.isArray(src.on) ? src.on : []).filter((key, i, a) => typeof key === 'string' && out.keys[key] && a.indexOf(key) === i);
    return out;
  }

  // Vector that moves `b` out of `a`. Null when the gap is already clear.
  function mtv(a, b, gap) {
    const overlapX = (a.w + b.w) * 0.5 + gap - Math.abs(a.x + a.w * 0.5 - (b.x + b.w * 0.5));
    const overlapY = (a.h + b.h) * 0.5 + gap - Math.abs(a.y + a.h * 0.5 - (b.y + b.h * 0.5));
    if (overlapX <= 0 || overlapY <= 0) return null;
    if (overlapX < overlapY) {
      const sign = a.x + a.w * 0.5 <= b.x + b.w * 0.5 ? 1 : -1;
      return { x: sign * overlapX, y: 0 };
    }
    const sign = a.y + a.h * 0.5 <= b.y + b.h * 0.5 ? 1 : -1;
    return { x: 0, y: sign * overlapY };
  }

  // Transient per-sticky and per-board state for contacts, kept off the
  // saved fields (not enumerable, so capture, JSON, and copies skip it).
  let SERIAL = 0;
  function stash(obj, name, value) {
    Object.defineProperty(obj, name, { value: value, writable: true, configurable: true, enumerable: false });
    return value;
  }
  function serialOf(s) {
    return s._k || stash(s, '_k', ++SERIAL);
  }
  function contactMemory(model) {
    return model._axes || stash(model, '_axes', new Map());
  }

  // Flat arrays for one step or bundle frame, bodies found once. Offsets
  // queued in bdx/bdy apply to a whole body at the end of a pass, so a large
  // group moves once per pass.
  function buildWorld(model) {
    const list = alive(model);
    const n = list.length;
    const w = {
      list: list,
      n: n,
      x: new Float64Array(n),
      y: new Float64Array(n),
      sw: new Float64Array(n),
      sh: new Float64Array(n),
      ox: new Float64Array(n),
      oy: new Float64Array(n),
      px: new Float64Array(n),
      py: new Float64Array(n),
      body: new Int32Array(n),
      key: new Float64Array(n),
      order: new Int32Array(n),
      members: [],
      locked: [],
      area: [],
      bdx: [],
      bdy: [],
      nb: 0,
      sx: 0,
      sy: 0,
      gap: gapOf(model),
      wall: frameInner(model.frame, gapOf(model)),
      segs: lineSegments(model),
      kinematic: false,
      kin: null,
      mover: null,
      passes: false,
      axes: contactMemory(model),
      gen: model._axisGen || 0,
      liq: 0,
      gapN: gapOf(model),
      load: 0,
      ovx: 0,
      ovy: 0,
    };
    const byGroup = new Map();
    for (let i = 0; i < n; i++) {
      const s = list[i];
      w.key[i] = serialOf(s);
      w.x[i] = w.ox[i] = w.px[i] = s.x;
      w.y[i] = w.oy[i] = w.py[i] = s.y;
      w.sw[i] = s.w;
      w.sh[i] = s.h;
      w.order[i] = i;
      let b = s.group ? byGroup.get(s.group) : undefined;
      if (b === undefined) {
        b = w.members.length;
        w.members.push([]);
        w.locked.push(false);
        w.area.push(0);
        w.bdx.push(0);
        w.bdy.push(0);
        if (s.group) byGroup.set(s.group, b);
      }
      w.body[i] = b;
      w.members[b].push(i);
      if (s.dragging) w.locked[b] = true;
      if (s.passId) w.passes = true;
      w.area[b] += s.w * s.h;
    }
    w.nb = w.members.length;
    w.mover = new Uint8Array(w.nb);
    w.kin = new Uint8Array(w.nb);
    w.pin = new Uint8Array(w.nb);
    w.pvx = new Float64Array(w.nb);
    w.pvy = new Float64Array(w.nb);
    w.slid = new Int8Array(w.nb).fill(-1);
    return w;
  }

  // ------------------------------------------------------------------ lines
  // Nothing ever pushes a line; only the user's drag moves one. Each
  // segment collides as a capsule of lineCollisionRadius plus the buffer.
  // Resting segments and their bounds are built once per change of the
  // lines, the buffer, or the grid (model.lineGen bumps on every line
  // edit); a dragged line is rebuilt per step (driveLines).
  //
  // A line is a hard constraint: no sticky ever changes sides except by
  // the user's own ghost (Ctrl+Shift) drag. Every movement is swept
  // against the segments themselves (guardMove), so no push, however
  // large, can hop one; the buffer is then restored away from the line on
  // the side the sticky is on, never toward its middle.

  const SEG = 9; // ax ay bx by r x0 y0 x1 y1

  // How far from its centreline a stroke collides. A stroke thinner than
  // half a grid step reads as a centreline; a wider one as its edges.
  function lineCollisionRadius(width, grid) {
    return width >= 0.5 * (grid > 0 ? grid : 0) ? width * 0.5 : 0;
  }

  function lineReach(model, line) {
    return lineCollisionRadius(line.width, model.grid) + gapOf(model);
  }

  function segCount(line) {
    return Math.max(0, line.points.length - 1);
  }

  function writeSegs(line, r, data, k) {
    for (let p = 0; p + 1 < line.points.length; p++) {
      const a = line.points[p];
      const b = line.points[p + 1];
      data[k] = a[0];
      data[k + 1] = a[1];
      data[k + 2] = b[0];
      data[k + 3] = b[1];
      data[k + 4] = r;
      data[k + 5] = Math.min(a[0], b[0]) - r;
      data[k + 6] = Math.min(a[1], b[1]) - r;
      data[k + 7] = Math.max(a[0], b[0]) + r;
      data[k + 8] = Math.max(a[1], b[1]) + r;
      k += SEG;
    }
    return k;
  }

  function lineSegments(model) {
    const lines = model.lines || [];
    const key = model.lineGen + ':' + gapOf(model) + ':' + model.grid + ':' + lines.length;
    const cache = model._segs;
    if (cache && cache.key === key && cache.lines === lines) return cache.data;
    let count = 0;
    for (let i = 0; i < lines.length; i++) if (!lines[i].dragging) count += segCount(lines[i]);
    const data = new Float64Array(count * SEG);
    let k = 0;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].dragging) k = writeSegs(lines[i], lineReach(model, lines[i]), data, k);
    }
    Object.defineProperty(model, '_segs', { value: { key: key, lines: lines, data: data }, writable: true, configurable: true, enumerable: false });
    return data;
  }

  // A dragged line is a kinematic body of infinite mass: it travels to its
  // target (the new position of its first point), `f` of the way, in short
  // sub-steps. Whatever its segments would sweep in a sub-step is carried
  // ahead of them, then projected out of the buffer: a hard contact that
  // never rebounds. Those stickies chain into their neighbours through the
  // ordinary contact passes. A sticky that cannot go (pinned by the wall or
  // a resting line) stops the line where it touches, and the line backs
  // off to the buffer; it never passes over. Isolated (Ctrl), the line
  // stops against every sticky and slides along. Ghosted, it goes straight
  // to its target and touches nothing. Dragged stickies are never pushed;
  // they move with the line. Returns the segments of the lines that still
  // collide this step, appended to the resting ones.
  function driveLines(w, model, o, fx, fy) {
    const lines = model.lines || [];
    let moving = 0;
    for (let i = 0; i < lines.length; i++) if (lines[i].dragging && lines[i].dragTarget) moving += segCount(lines[i]);
    if (!moving) return;
    const scratch = model._driveSegs && model._driveSegs.length >= (w.segs.length + moving * SEG) ? model._driveSegs : new Float64Array(w.segs.length + moving * SEG + 8 * SEG);
    Object.defineProperty(model, '_driveSegs', { value: scratch, writable: true, configurable: true, enumerable: false });
    scratch.set(w.segs, 0);
    let k = w.segs.length;
    const own = OWN_SEGS;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.dragging || !line.dragTarget) continue;
      const dx = (line.dragTarget.x - line.points[0][0]) * fx;
      const dy = (line.dragTarget.y - line.points[0][1]) * fy;
      if (o.ghost) {
        shiftLine(line, null, 0, dx, dy);
        continue;
      }
      const n = segCount(line);
      const ls = n * SEG <= own.length ? own : new Float64Array(n * SEG);
      const r = lineReach(model, line);
      writeSegs(line, r, ls, 0);
      moveLine(w, line, ls, n * SEG, r, dx, dy, !!o.isolate);
      k = writeSegs(line, r, scratch, k);
    }
    w.segs = scratch.subarray(0, k);
    w.kinematic = !o.ghost;
  }

  function shiftLine(line, ls, len, dx, dy) {
    if (!dx && !dy) return;
    const pts = line.points;
    for (let p = 0; p < pts.length; p++) {
      pts[p][0] += dx;
      pts[p][1] += dy;
    }
    for (let d = 0; d < len; d += SEG) {
      ls[d] += dx;
      ls[d + 1] += dy;
      ls[d + 2] += dx;
      ls[d + 3] += dy;
      ls[d + 5] += dx;
      ls[d + 6] += dy;
      ls[d + 7] += dx;
      ls[d + 8] += dy;
    }
  }

  // Earliest fraction of the line's move (dx, dy) at which its segments
  // touch member i (the box swept backwards); Infinity if they never do.
  // A segment already cutting the box (drawn over it) is ignored.
  function lineSweep(w, i, ls, len, dx, dy) {
    const x0 = w.x[i];
    const y0 = w.y[i];
    const x1 = x0 + w.sw[i];
    const y1 = y0 + w.sh[i];
    let t = Infinity;
    for (let d = 0; d < len; d += SEG) {
      const ax = ls[d];
      const ay = ls[d + 1];
      const bx = ls[d + 2];
      const by = ls[d + 3];
      if (cutsBox(x0, y0, x1, y1, ax, ay, bx, by)) continue;
      const tt = sweepSeg(x0, y0, x1, y1, -dx, -dy, ax, ay, bx, by);
      if (tt < t) t = tt;
    }
    return t;
  }

  // The deepest the line reaches into member i's buffer, written into PUSH
  // as the move that takes the box out on its own side. False when clear.
  function lineHit(w, i, ls, len) {
    const x0 = w.x[i];
    const y0 = w.y[i];
    const x1 = x0 + w.sw[i];
    const y1 = y0 + w.sh[i];
    let need = 0;
    let ux = 0;
    let uy = 0;
    for (let d = 0; d < len; d += SEG) {
      if (x1 <= ls[d + 5] || x0 >= ls[d + 7] || y1 <= ls[d + 6] || y0 >= ls[d + 8]) continue;
      if (!reachPush(x0, y0, x1, y1, ls, d)) continue;
      const v = Math.hypot(PUSH[0], PUSH[1]);
      if (v > need) {
        need = v;
        ux = PUSH[0] / v;
        uy = PUSH[1] / v;
      }
    }
    if (need <= 1e-9) return false;
    PUSH[0] = ux * need;
    PUSH[1] = uy * need;
    return true;
  }

  const LINE_CANDS = [];
  const OWN_SEGS = new Float64Array(SEG * 16);
  const CARRY_DEPTH = 12;
  const CARRY_BUDGET = 64;
  let carryLeft = 0;

  // A line carries body b by (dx, dy) like a blade: the body travels until
  // it reaches a neighbour's buffer, pushes that neighbour the rest of the
  // way (and so on down the chain), then follows as far as the chain went.
  // The wall, the lines, and dragged stickies stop it. Teleporting it the
  // whole way instead would bury it in its neighbour, and contacts would
  // squeeze it out sideways past a line that should have stopped. A chain
  // may branch, so one carry spends a fixed budget of pushes; past it, a
  // neighbour is an obstacle and the contact passes take over.
  function carry(w, b, dx, dy) {
    carryLeft = CARRY_BUDGET;
    carryOn(w, b, dx, dy, 0);
  }

  function carryOn(w, b, dx, dy, depth) {
    for (let k = 0; k < 4 && depth < CARRY_DEPTH && carryLeft > 0; k++) {
      const t = sweep(w, b, dx, dy, null);
      const hit = SWEPT;
      if (t >= 1 || hit < 0 || w.locked[hit]) break;
      carryLeft -= 1;
      const q = w.members[hit][0];
      const qx = w.x[q];
      const qy = w.y[q];
      carryOn(w, hit, dx * (1 - t), dy * (1 - t), depth + 1);
      if (w.x[q] === qx && w.y[q] === qy) break;
    }
    const t = sweep(w, b, dx, dy, null);
    if (t > 0) guardMove(w, b, dx * t, dy * t);
    w.kin[b] = 1;
  }

  function moveLine(w, line, ls, len, r, dx, dy, isolate) {
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-12) return;
    // Broadphase: the segments' swept bounds, widened by the reach.
    let bx0 = Infinity;
    let by0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    for (let d = 0; d < len; d += SEG) {
      bx0 = Math.min(bx0, ls[d + 5], ls[d + 5] + dx);
      by0 = Math.min(by0, ls[d + 6], ls[d + 6] + dy);
      bx1 = Math.max(bx1, ls[d + 7], ls[d + 7] + dx);
      by1 = Math.max(by1, ls[d + 8], ls[d + 8] + dy);
    }
    LINE_CANDS.length = 0;
    for (let j = 0; j < w.n; j++) {
      if (w.locked[w.body[j]]) continue;
      if (w.x[j] >= bx1 || w.x[j] + w.sw[j] <= bx0 || w.y[j] >= by1 || w.y[j] + w.sh[j] <= by0) continue;
      LINE_CANDS.push(j);
    }
    if (!LINE_CANDS.length) {
      shiftLine(line, ls, len, dx, dy);
      return;
    }
    const steps = Math.min(200, Math.max(1, Math.ceil(dist / Math.max(1, r))));
    const sx = dx / steps;
    const sy = dy / steps;
    const ahead = GUARD_BACKOFF / Math.hypot(sx, sy);
    for (let s = 0; s < steps; s++) {
      let stop = Infinity;
      for (let c = 0; c < LINE_CANDS.length; c++) {
        const j = LINE_CANDS[c];
        let t = lineSweep(w, j, ls, len, sx, sy);
        if (t > 1) continue;
        if (!isolate) {
          const k = 1 - t + ahead;
          carry(w, w.body[j], sx * k, sy * k);
          t = lineSweep(w, j, ls, len, sx, sy);
        }
        if (t < stop) stop = t;
      }
      const f = stop <= 1 ? Math.max(0, stop - ahead) : 1;
      shiftLine(line, ls, len, sx * f, sy * f);
      for (let pass = 0; pass < 3; pass++) {
        let touched = false;
        for (let c = 0; c < LINE_CANDS.length; c++) {
          const j = LINE_CANDS[c];
          if (!lineHit(w, j, ls, len)) continue;
          touched = true;
          if (!isolate) {
            carry(w, w.body[j], PUSH[0], PUSH[1]);
            if (!lineHit(w, j, ls, len)) continue;
          }
          shiftLine(line, ls, len, -PUSH[0], -PUSH[1]);
        }
        if (!touched) break;
      }
      if (stop <= 1) break;
    }
  }

  // An endpoint drag swings one end of a line to (x, y); the other points
  // stay. The end travels in sub-steps short enough (half the reach) that
  // no sticky fits between two of them. After each, whatever the line
  // reaches is carried out of its buffer on its own side, as a dragged
  // line carries it. A sticky that cannot go (the wall, a resting line)
  // stops the end where the line meets its buffer, found by bisection.
  // Returns the fraction of the way the end got.
  function gripLine(model, line, index, x, y) {
    const p = line.points[index];
    const sx = p[0];
    const sy = p[1];
    const dist = Math.hypot(x - sx, y - sy);
    if (dist < 1e-12) return 1;
    const w = buildWorld(model);
    const r = lineReach(model, line);
    let base = 0;
    const lines = model.lines || [];
    for (let i = 0; i < lines.length; i++) if (lines[i] !== line && !lines[i].dragging) base += segCount(lines[i]) * SEG;
    const len = segCount(line) * SEG;
    const all = new Float64Array(base + len);
    let k = 0;
    for (let i = 0; i < lines.length; i++) if (lines[i] !== line && !lines[i].dragging) k = writeSegs(lines[i], lineReach(model, lines[i]), all, k);
    const ls = all.subarray(base);
    w.segs = all;
    const cands = [];
    let bx0 = Math.min(sx, x) - r;
    let bx1 = Math.max(sx, x) + r;
    let by0 = Math.min(sy, y) - r;
    let by1 = Math.max(sy, y) + r;
    for (let q = 0; q < line.points.length; q++) {
      bx0 = Math.min(bx0, line.points[q][0] - r);
      by0 = Math.min(by0, line.points[q][1] - r);
      bx1 = Math.max(bx1, line.points[q][0] + r);
      by1 = Math.max(by1, line.points[q][1] + r);
    }
    for (let j = 0; j < w.n; j++) {
      if (w.locked[w.body[j]]) continue;
      if (w.x[j] >= bx1 || w.x[j] + w.sw[j] <= bx0 || w.y[j] >= by1 || w.y[j] + w.sh[j] <= by0) continue;
      cands.push(j);
    }
    const saveX = Float64Array.from(w.x);
    const saveY = Float64Array.from(w.y);
    // Places the end at fraction t from the saved state; false if a
    // sticky could not be carried clear.
    const tryAt = (t) => {
      w.x.set(saveX);
      w.y.set(saveY);
      p[0] = sx + (x - sx) * t;
      p[1] = sy + (y - sy) * t;
      writeSegs(line, r, ls, 0);
      for (let pass = 0; pass < 3; pass++) {
        let touched = false;
        for (let c = 0; c < cands.length; c++) {
          const j = cands[c];
          if (!lineHit(w, j, ls, len)) continue;
          touched = true;
          carry(w, w.body[j], PUSH[0], PUSH[1]);
          if (lineHit(w, j, ls, len)) return false;
        }
        if (!touched) break;
      }
      return true;
    };
    const steps = Math.min(400, Math.max(1, Math.ceil(dist / Math.max(0.5, r * 0.5))));
    let got = 0;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      if (tryAt(t)) {
        got = t;
        saveX.set(w.x);
        saveY.set(w.y);
        continue;
      }
      // Every try starts again from the state at `got`.
      let lo = got;
      let hi = t;
      const keepX = Float64Array.from(saveX);
      const keepY = Float64Array.from(saveY);
      for (let it = 0; it < 6; it++) {
        const mid = (lo + hi) * 0.5;
        const ok = tryAt(mid);
        if (ok) {
          lo = mid;
          keepX.set(w.x);
          keepY.set(w.y);
        } else hi = mid;
        w.x.set(saveX);
        w.y.set(saveY);
      }
      got = lo;
      w.x.set(keepX);
      w.y.set(keepY);
      p[0] = sx + (x - sx) * got;
      p[1] = sy + (y - sy) * got;
      commit(w);
      return got;
    }
    commit(w);
    return got;
  }

  const PUSH = new Float64Array(2);

  function projOverlap(ux, uy, cx, cy, hx, hy, ax, ay, bx, by, r) {
    const c = cx * ux + cy * uy;
    const e = hx * Math.abs(ux) + hy * Math.abs(uy);
    const pa = ax * ux + ay * uy;
    const pb = bx * ux + by * uy;
    const lo = Math.min(pa, pb) - r;
    const hi = Math.max(pa, pb) + r;
    const o = Math.min(hi - (c - e), (c + e) - lo);
    // Positive: the rect's centre is past the capsule's middle along u.
    return o <= 0 ? 0 : (c >= (lo + hi) * 0.5 ? o : -o);
  }

  // Separating axes of a box and a capsule: the box's two, the segment's
  // normal, and for each round end the axis to the box's nearest point.
  // Writes into PUSH the least move that takes the box out; false if clear.
  function capsulePush(x0, y0, x1, y1, s, d) {
    const ax = s[d];
    const ay = s[d + 1];
    const bx = s[d + 2];
    const by = s[d + 3];
    const r = s[d + 4];
    const cx = (x0 + x1) * 0.5;
    const cy = (y0 + y1) * 0.5;
    const hx = (x1 - x0) * 0.5;
    const hy = (y1 - y0) * 0.5;
    let best = Infinity;
    let px = 0;
    let py = 0;
    const test = (ux, uy) => {
      const o = projOverlap(ux, uy, cx, cy, hx, hy, ax, ay, bx, by, r);
      if (o === 0) return false;
      if (Math.abs(o) < best) {
        best = Math.abs(o);
        px = ux * o;
        py = uy * o;
      }
      return true;
    };
    if (!test(1, 0) || !test(0, 1)) return false;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len > 1e-9 && !test(-dy / len, dx / len)) return false;
    for (let e = 0; e < 2; e++) {
      const ex = e ? bx : ax;
      const ey = e ? by : ay;
      const qx = Math.min(Math.max(ex, x0), x1);
      const qy = Math.min(Math.max(ey, y0), y1);
      const ql = Math.hypot(qx - ex, qy - ey);
      if (ql > 1e-9 && (Math.abs(ex - qx) > 1e-9 && Math.abs(ey - qy) > 1e-9) && !test((qx - ex) / ql, (qy - ey) / ql)) return false;
    }
    PUSH[0] = px;
    PUSH[1] = py;
    return true;
  }

  const CLIP = new Float64Array(2);
  const NEAR = new Float64Array(3); // distance, unit way out (segment to box)
  // How far short of a segment a swept body stops, in feet.
  const GUARD_BACKOFF = 1e-3;

  // One Liang-Barsky slab: narrows CLIP to where p * t <= q.
  function clip(p, q) {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > CLIP[1]) return false;
      if (r > CLIP[0]) CLIP[0] = r;
    } else {
      if (r < CLIP[0]) return false;
      if (r < CLIP[1]) CLIP[1] = r;
    }
    return true;
  }

  // Whether segment a-b touches the box (touching counts).
  function cutsBox(x0, y0, x1, y1, ax, ay, bx, by) {
    CLIP[0] = 0;
    CLIP[1] = 1;
    const dx = bx - ax;
    const dy = by - ay;
    return clip(-dx, ax - x0) && clip(dx, x1 - ax) && clip(-dy, ay - y0) && clip(dy, y1 - ay);
  }

  // Fraction of (vx, vy) at which the point q first enters the box.
  function rayBox(qx, qy, vx, vy, x0, y0, x1, y1) {
    CLIP[0] = 0;
    CLIP[1] = 1;
    return clip(-vx, qx - x0) && clip(vx, x1 - qx) && clip(-vy, qy - y0) && clip(vy, y1 - qy) ? CLIP[0] : Infinity;
  }

  // Earliest fraction of (dx, dy) at which a box, starting clear, first
  // touches segment a-b; Infinity if it never does. First contact of two
  // convex shapes is a corner of one on an edge of the other: the box's
  // corners against the segment, the segment's ends against the box.
  function sweepSeg(x0, y0, x1, y1, dx, dy, ax, ay, bx, by) {
    let t = Math.min(rayBox(ax, ay, -dx, -dy, x0, y0, x1, y1), rayBox(bx, by, -dx, -dy, x0, y0, x1, y1));
    const ex = bx - ax;
    const ey = by - ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) > 1e-12) {
      for (let c = 0; c < 4; c++) {
        const qx = ax - (c & 1 ? x1 : x0);
        const qy = ay - (c & 2 ? y1 : y0);
        const tt = (qx * ey - qy * ex) / den;
        if (tt < 0 || tt >= t) continue;
        const u = (qx * dy - qy * dx) / den;
        if (u >= 0 && u <= 1) t = tt;
      }
    }
    return t <= 1 ? t : Infinity;
  }

  // Distance from a box to a segment that does not cut it, and the unit way
  // out, into NEAR. Between disjoint convex shapes the closest pair has a
  // corner of one: the segment's ends against the box, the box's corners
  // against the segment.
  function nearSeg(x0, y0, x1, y1, ax, ay, bx, by) {
    let best = Infinity;
    let vx = 0;
    let vy = 0;
    for (let e = 0; e < 2; e++) {
      const ex = e ? bx : ax;
      const ey = e ? by : ay;
      const qx = ex < x0 ? x0 : ex > x1 ? x1 : ex;
      const qy = ey < y0 ? y0 : ey > y1 ? y1 : ey;
      const d = Math.hypot(qx - ex, qy - ey);
      if (d < best) {
        best = d;
        vx = qx - ex;
        vy = qy - ey;
      }
    }
    const sx = bx - ax;
    const sy = by - ay;
    const ll = sx * sx + sy * sy;
    for (let c = 0; c < 4; c++) {
      const px = c & 1 ? x1 : x0;
      const py = c & 2 ? y1 : y0;
      let u = ll > 1e-18 ? ((px - ax) * sx + (py - ay) * sy) / ll : 0;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const d = Math.hypot(px - ax - sx * u, py - ay - sy * u);
      if (d < best) {
        best = d;
        vx = px - ax - sx * u;
        vy = py - ay - sy * u;
      }
    }
    NEAR[0] = best;
    NEAR[1] = best > 1e-12 ? vx / best : 0;
    NEAR[2] = best > 1e-12 ? vy / best : 0;
    return best;
  }

  // Which side of segment d's line the point is on: +1 or -1.
  function sideOf(s, d, px, py) {
    return (s[d + 2] - s[d]) * (py - s[d + 1]) - (s[d + 3] - s[d + 1]) * (px - s[d]) >= 0 ? 1 : -1;
  }

  // The move that takes a box out of segment d's reach, into PUSH: straight
  // away from the line on the side the box is on. A box the segment cuts (a
  // line drawn over it, a ghost dropped on it) steps off along the line's
  // normal toward `side`, or toward its own centre's side when that is 0.
  // False when clear.
  function reachPush(x0, y0, x1, y1, s, d, side) {
    const ax = s[d];
    const ay = s[d + 1];
    const bx = s[d + 2];
    const by = s[d + 3];
    if (cutsBox(x0, y0, x1, y1, ax, ay, bx, by)) {
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1e-9) return capsulePush(x0, y0, x1, y1, s, d) && (Math.abs(PUSH[0]) > 1e-9 || Math.abs(PUSH[1]) > 1e-9);
      const sg = side || sideOf(s, d, (x0 + x1) * 0.5, (y0 + y1) * 0.5);
      const nx = -(by - ay) / len * sg;
      const ny = (bx - ax) / len * sg;
      let low = Infinity;
      for (let c = 0; c < 4; c++) low = Math.min(low, ((c & 1 ? x1 : x0) - ax) * nx + ((c & 2 ? y1 : y0) - ay) * ny);
      const need = s[d + 4] - low + GUARD_BACKOFF;
      PUSH[0] = nx * need;
      PUSH[1] = ny * need;
      return true;
    }
    const r = s[d + 4];
    const dist = nearSeg(x0, y0, x1, y1, ax, ay, bx, by);
    if (dist >= r - 1e-9 || dist < 1e-12) return false;
    PUSH[0] = NEAR[1] * (r - dist);
    PUSH[1] = NEAR[2] * (r - dist);
    return true;
  }

  // Moves body b by (dx, dy), stopping a hair short of the first segment it
  // would touch, so nothing crosses a line. Segments it already straddles
  // do not stop it. Returns the fraction travelled.
  function guardMove(w, b, dx, dy) {
    if (dx === 0 && dy === 0) return 1;
    const segs = w.segs;
    let t = Infinity;
    if (segs.length) {
      const m = w.members[b];
      const box = bodyBox(w, b);
      const lx = Math.min(box[0], box[0] + dx);
      const hx = Math.max(box[2], box[2] + dx);
      const ly = Math.min(box[1], box[1] + dy);
      const hy = Math.max(box[3], box[3] + dy);
      for (let d = 0; d < segs.length; d += SEG) {
        const r = segs[d + 4];
        if (segs[d + 5] + r > hx || segs[d + 7] - r < lx || segs[d + 6] + r > hy || segs[d + 8] - r < ly) continue;
        const ax = segs[d];
        const ay = segs[d + 1];
        const bx = segs[d + 2];
        const by = segs[d + 3];
        for (let k = 0; k < m.length; k++) {
          const i = m[k];
          const x0 = w.x[i];
          const y0 = w.y[i];
          const x1 = x0 + w.sw[i];
          const y1 = y0 + w.sh[i];
          if (cutsBox(x0, y0, x1, y1, ax, ay, bx, by)) continue;
          const tt = sweepSeg(x0, y0, x1, y1, dx, dy, ax, ay, bx, by);
          if (tt < t) t = tt;
        }
      }
    }
    if (t <= 1) {
      w.pin[b] = 1;
      aim(w, b, -dx, -dy);
      t = Math.max(0, t - GUARD_BACKOFF / Math.hypot(dx, dy));
    } else t = 1;
    if (t > 0) translate(w, b, dx * t, dy * t);
    return t;
  }

  // The side a group straddling segment d steps off to: where its members
  // clear of the line are (by area), else where its centre is.
  function straddleSide(w, b, s, d) {
    const m = w.members[b];
    let vote = 0;
    for (let k = 0; k < m.length; k++) {
      const i = m[k];
      if (cutsBox(w.x[i], w.y[i], w.x[i] + w.sw[i], w.y[i] + w.sh[i], s[d], s[d + 1], s[d + 2], s[d + 3])) continue;
      vote += sideOf(s, d, w.x[i] + w.sw[i] * 0.5, w.y[i] + w.sh[i] * 0.5) * w.sw[i] * w.sh[i];
    }
    if (vote) return vote > 0 ? 1 : -1;
    const c = bodyCenter(w, b);
    return sideOf(s, d, c.x, c.y);
  }

  // The way the immovable that pinned body b pushes back (its last one).
  function aim(w, b, nx, ny) {
    const l = Math.hypot(nx, ny);
    if (!(l > 1e-12)) return;
    if (!w.pnx) {
      w.pnx = new Float64Array(w.nb);
      w.pny = new Float64Array(w.nb);
    }
    w.pnx[b] = nx / l;
    w.pny[b] = ny / l;
  }

  // Pushes body b out of every line's reach, each push swept so it cannot
  // cross another line. Returns whether it moved.
  function clearLines(w, b) {
    const segs = w.segs;
    if (!segs.length) return false;
    let movedAny = false;
    const m = w.members[b];
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (let k = 0; k < m.length; k++) {
        const i = m[k];
        for (let d = 0; d < segs.length; d += SEG) {
          const x0 = w.x[i];
          const y0 = w.y[i];
          const x1 = x0 + w.sw[i];
          const y1 = y0 + w.sh[i];
          if (x1 <= segs[d + 5] || x0 >= segs[d + 7] || y1 <= segs[d + 6] || y0 >= segs[d + 8]) continue;
          const side = m.length > 1 && cutsBox(x0, y0, x1, y1, segs[d], segs[d + 1], segs[d + 2], segs[d + 3]) ? straddleSide(w, b, segs, d) : 0;
          if (!reachPush(x0, y0, x1, y1, segs, d, side)) continue;
          aim(w, b, PUSH[0], PUSH[1]);
          guardMove(w, b, PUSH[0], PUSH[1]);
          w.pin[b] = 1;
          moved = true;
        }
      }
      if (!moved) break;
      movedAny = true;
    }
    return movedAny;
  }

  // Lines go last, with absolute priority. Each body's motion since it was
  // last clear of the lines (contacts, walls, a bundle, a clamp) is
  // replayed swept against the segments, then the body steps out of their
  // reach. `skip` bodies (a ghost drag) pass through.
  function linePass(w, skip) {
    const segs = w.segs;
    if (!segs.length) return;
    for (let b = 0; b < w.nb; b++) {
      const m = w.members[b];
      if (!(skip && skip[b])) {
        const k = m[0];
        const dx = w.x[k] - w.px[k];
        const dy = w.y[k] - w.py[k];
        if (dx !== 0 || dy !== 0) {
          translate(w, b, -dx, -dy);
          guardMove(w, b, dx, dy);
        }
        clearLines(w, b);
      }
      for (let q = 0; q < m.length; q++) {
        w.px[m[q]] = w.x[m[q]];
        w.py[m[q]] = w.y[m[q]];
      }
    }
  }

  function markClear(w) {
    w.px.set(w.x);
    w.py.set(w.y);
  }

  // Whether any sticky's box crosses a line's collision envelope
  // (lineCollisionRadius), widened by `pad` on each side (0: buffer excluded).
  function lineOverlap(model, pad) {
    const lines = model.lines || [];
    if (!lines.length) return false;
    const list = alive(model);
    const seg = new Float64Array(SEG);
    for (let l = 0; l < lines.length; l++) {
      const pts = lines[l].points;
      const r = lineCollisionRadius(lines[l].width, model.grid) + (pad || 0);
      for (let p = 0; p + 1 < pts.length; p++) {
        seg[0] = pts[p][0];
        seg[1] = pts[p][1];
        seg[2] = pts[p + 1][0];
        seg[3] = pts[p + 1][1];
        seg[4] = r;
        for (let i = 0; i < list.length; i++) {
          const s = list[i];
          if (capsulePush(s.x, s.y, s.x + s.w, s.y + s.h, seg, 0) && Math.hypot(PUSH[0], PUSH[1]) > 0.01) return true;
        }
      }
    }
    return false;
  }

  function translate(w, b, dx, dy) {
    const m = w.members[b];
    for (let k = 0; k < m.length; k++) {
      w.x[m[k]] += dx;
      w.y[m[k]] += dy;
    }
  }

  function fold(w) {
    for (let b = 0; b < w.nb; b++) {
      if (w.bdx[b] === 0 && w.bdy[b] === 0) continue;
      translate(w, b, w.bdx[b], w.bdy[b]);
      w.bdx[b] = 0;
      w.bdy[b] = 0;
    }
  }

  function commit(w) {
    let moved = 0;
    for (let b = 0; b < w.nb; b++) {
      if (w.locked[b]) continue;
      const k = w.members[b][0];
      moved = Math.max(moved, Math.hypot(w.x[k] - w.ox[k], w.y[k] - w.oy[k]));
    }
    for (let i = 0; i < w.n; i++) {
      w.list[i].x = w.x[i];
      w.list[i].y = w.y[i];
    }
    return moved;
  }

  // Insertion sort: the order is nearly sorted from the previous pass.
  function sortByX(w) {
    const order = w.order;
    const x = w.x;
    for (let k = 1; k < w.n; k++) {
      const v = order[k];
      const xv = x[v];
      let m = k - 1;
      while (m >= 0 && x[order[m]] > xv) {
        order[m + 1] = order[m];
        m -= 1;
      }
      order[m + 1] = v;
    }
  }

  // Contacts are frictionless: only motion into a neighbour is resisted.
  // A pair within TOUCH of the buffer is touching, not overlapping, so
  // neighbours resting at the buffer never snag a sideways move.
  const TOUCH = 0.02;
  // A pair keeps last frame's axis until the other is clearly shallower
  // (under this share of it), so corners and near-ties do not flicker.
  const AXIS_KEEP = 0.5;
  // A dragged body glancing a neighbour (their bodies overlapping, across
  // its motion, by less than this share of the smaller side) pushes it
  // aside across the motion instead of ahead along it.
  const DEFLECT = 0.35;
  // Motion counts as along an axis when it is within about 30° of it.
  const ALONG = 1.7;
  // ...and as moving away across it beyond about 11° (a hand's wobble is
  // not a direction).
  const AWAY = 0.2;

  // Same rule as mtv, on queued positions. Writes the vector that moves j
  // out of i into w.sx / w.sy (the shallower axis), and both signed
  // overlaps into w.ovx / w.ovy for callers that choose the axis.
  function overlap(w, i, j, gap) {
    const bi = w.body[i];
    const bj = w.body[j];
    const acx = w.x[i] + w.bdx[bi] + w.sw[i] * 0.5;
    const bcx = w.x[j] + w.bdx[bj] + w.sw[j] * 0.5;
    const ox = (w.sw[i] + w.sw[j]) * 0.5 + gap - Math.abs(acx - bcx);
    if (ox <= TOUCH) return false;
    const acy = w.y[i] + w.bdy[bi] + w.sh[i] * 0.5;
    const bcy = w.y[j] + w.bdy[bj] + w.sh[j] * 0.5;
    const oy = (w.sh[i] + w.sh[j]) * 0.5 + gap - Math.abs(acy - bcy);
    if (oy <= TOUCH) return false;
    w.ovx = acx <= bcx ? ox : -ox;
    w.ovy = acy <= bcy ? oy : -oy;
    if (ox < oy) {
      w.sx = w.ovx;
      w.sy = 0;
    } else {
      w.sx = 0;
      w.sy = w.ovy;
    }
    return true;
  }

  function useAxis(w, axis) {
    w.sx = axis === 0 ? w.ovx : 0;
    w.sy = axis === 0 ? 0 : w.ovy;
  }

  // The axis a contact between i and j resolves on, after overlap(). A
  // dragged body moving along an axis pushes a neighbour it glances across
  // its motion, never ahead. Otherwise the pair keeps last frame's axis
  // unless the other became clearly shallower; a new pair takes the
  // shallower one.
  function steerAxis(w, i, j, bi, bj, gap) {
    const ax = Math.abs(w.ovx);
    const ay = Math.abs(w.ovy);
    const swept = w.shock ? sweptAxis(w, i, j, gap) : -1;
    let axis = -1;
    const mb = w.mover[bi] ? bi : w.mover[bj] ? bj : -1;
    if (mb >= 0) {
      const vx = Math.abs(w.pvx[mb]);
      const vy = Math.abs(w.pvy[mb]);
      const deflect = DEFLECT + LIQ_DEFLECT * w.liq;
      // A body moving away from the neighbour across its motion cannot
      // deflect it that way; it pushes on the face they meet on.
      const self = w.body[i] === mb ? i : j;
      const other = self === i ? j : i;
      const awayY = vy > AWAY * vx && w.pvy[mb] * (w.y[other] + w.sh[other] * 0.5 - w.y[self] - w.sh[self] * 0.5) < 0;
      const awayX = vx > AWAY * vy && w.pvx[mb] * (w.x[other] + w.sw[other] * 0.5 - w.x[self] - w.sw[self] * 0.5) < 0;
      if (vx > 1e-6 && vx >= vy * ALONG) axis = swept === 1 || (!awayY && ay - gap < deflect * Math.min(w.sh[i], w.sh[j])) ? 1 : 0;
      else if (vy > 1e-6 && vy >= vx * ALONG) axis = swept === 0 || (!awayX && ax - gap < deflect * Math.min(w.sw[i], w.sw[j])) ? 0 : 1;
    }
    if (axis < 0) axis = swept;
    const ka = w.key[i];
    const kb = w.key[j];
    const key = ka < kb ? ka * 67108864 + kb : kb * 67108864 + ka;
    if (axis < 0) {
      const was = w.axes.get(key);
      const last = was !== undefined && Math.floor(was / 2) >= w.gen - AXIS_MEMORY ? was % 2 : -1;
      if (last === 0) axis = ay < ax * AXIS_KEEP ? 1 : 0;
      else if (last === 1) axis = ax < ay * AXIS_KEEP ? 0 : 1;
      else axis = ax < ay ? 0 : 1;
    }
    w.axes.set(key, w.gen * 2 + axis);
    useAxis(w, axis);
  }

  // The face a drag brought i and j together through: the axis on which
  // they were still apart (buffer included) where this step began. Apart
  // on both, the buffer they crossed last; already inside, none (-1). A
  // deep press never turns into a sideways shove because the other axis
  // happens to be shallower once the step has run.
  function sweptAxis(w, i, j, gap) {
    const sx = Math.abs(w.ox[i] + w.sw[i] * 0.5 - w.ox[j] - w.sw[j] * 0.5) - (w.sw[i] + w.sw[j]) * 0.5 - gap;
    const sy = Math.abs(w.oy[i] + w.sh[i] * 0.5 - w.oy[j] - w.sh[j] * 0.5) - (w.sh[i] + w.sh[j]) * 0.5 - gap;
    const clearX = sx >= -TOUCH;
    const clearY = sy >= -TOUCH;
    if (clearX !== clearY) return clearX ? 0 : 1;
    if (!clearX) return -1;
    const bi = w.body[i];
    const bj = w.body[j];
    const vx = Math.abs(w.x[i] + w.bdx[bi] - w.ox[i] - (w.x[j] + w.bdx[bj] - w.ox[j]));
    const vy = Math.abs(w.y[i] + w.bdy[bi] - w.oy[i] - (w.y[j] + w.bdy[bj] - w.oy[j]));
    return sx * vy >= sy * vx ? 0 : 1;
  }

  // An obstacle stops only motion into it. A projection that would carry
  // body b further along its own motion (dx, dy) resists nothing, so the
  // other axis is used. A body moving along an axis (the pointer's motion)
  // that is inside an obstacle's buffer, but not its body, across it steps
  // out across it and slides on. At a corner of two buffers the body keeps
  // the axis it last slid on.
  function slideAxis(w, b, dx, dy, gap) {
    const okX = !(w.ovx * dx > 1e-9);
    const okY = !(w.ovy * dy > 1e-9);
    const bufX = Math.abs(w.ovx) <= gap;
    const bufY = Math.abs(w.ovy) <= gap;
    const px = Math.abs(w.pvx[b]) > 1e-9 || Math.abs(w.pvy[b]) > 1e-9 ? Math.abs(w.pvx[b]) : Math.abs(dx);
    const py = Math.abs(w.pvx[b]) > 1e-9 || Math.abs(w.pvy[b]) > 1e-9 ? Math.abs(w.pvy[b]) : Math.abs(dy);
    let axis = -1;
    if (okX !== okY) axis = okX ? 0 : 1;
    else if (px > 1e-9 && px >= py * ALONG && bufY) axis = 1;
    else if (py > 1e-9 && py >= px * ALONG && bufX) axis = 0;
    else if (bufX && bufY && w.slid[b] >= 0) axis = w.slid[b];
    if (axis >= 0) useAxis(w, axis);
    w.slid[b] = w.sx !== 0 ? 0 : 1;
  }

  // Sort-and-sweep on x: visits member pairs from different bodies, not both
  // locked, whose x spans come within `reach`. A pair missed because a body
  // moved earlier in the same pass is caught by the next pass.
  function eachNear(w, reach, visit) {
    sortByX(w);
    const order = w.order;
    for (let oi = 0; oi < w.n; oi++) {
      const i = order[oi];
      const right = w.x[i] + w.sw[i] + reach;
      const bi = w.body[i];
      for (let oj = oi + 1; oj < w.n; oj++) {
        const j = order[oj];
        if (w.x[j] >= right) break;
        const bj = w.body[j];
        if (bi === bj || (w.locked[bi] && w.locked[bj])) continue;
        visit(i, j, bi, bj);
      }
    }
  }

  // An Alt-drag copy passes through its own original until it is dropped.
  function passes(w, i, j) {
    const a = w.list[i];
    const b = w.list[j];
    return (a.passId && a.passId === b.id) || (b.passId && b.passId === a.id);
  }

  // `isolated`: dragged bodies neither push nor are pushed (Ctrl and
  // Ctrl+Shift drags); they resolve against obstacles in applyDrag instead.
  function contactPass(w, gain, isolated) {
    if (w.shock) {
      pushPass(w, gain);
      return;
    }
    const g = w.gap;
    eachNear(w, g, (i, j, bi, bj) => {
      if (isolated && (w.mover[bi] || w.mover[bj])) return;
      if (w.passes && passes(w, i, j)) return;
      const pusher = w.mover[bi] || w.mover[bj];
      const gg = pusher ? g : w.gapN;
      if (!overlap(w, i, j, gg)) return;
      steerAxis(w, i, j, bi, bj, gg);
      const mx = w.sx * gain;
      const my = w.sy * gain;
      if (pusher) w.load += Math.abs(mx) + Math.abs(my);
      if (w.locked[bi]) {
        w.bdx[bj] += mx;
        w.bdy[bj] += my;
      } else if (w.locked[bj]) {
        w.bdx[bi] -= mx;
        w.bdy[bi] -= my;
      } else {
        w.bdx[bi] -= mx * 0.5;
        w.bdy[bi] -= my * 0.5;
        w.bdx[bj] += mx * 0.5;
        w.bdy[bj] += my * 0.5;
      }
    });
    fold(w);
  }

  // Liquid, a sticky pushed ahead along the drag of the dragged body r the
  // push started from, off-centre of it (by more than FLOW_OFF of its own
  // size), also drifts across the drag toward its side, up to LIQ_FLOW ft
  // a pass: the crowd slips around the finger, at every depth, instead of
  // piling up ahead of it. A push through the centre stays rigid, so a
  // chain still packs and stops.
  const FLOW_OFF = 0.25;
  const LIQ_FLOW = 0.6;

  function flowAside(w, r, other, ob, mx, my) {
    const vx = Math.abs(w.pvx[r]);
    const vy = Math.abs(w.pvy[r]);
    const rate = LIQ_FLOW * w.liq;
    const box = bodyBox(w, r);
    if (mx !== 0 && my === 0 && vx >= vy * ALONG) {
      const off = w.y[other] + w.sh[other] * 0.5 - (box[1] + box[3]) * 0.5;
      if (Math.abs(off) > FLOW_OFF * w.sh[other]) translate(w, ob, 0, Math.min(Math.abs(w.ovy), rate) * (off >= 0 ? 1 : -1));
    } else if (my !== 0 && mx === 0 && vy >= vx * ALONG) {
      const off = w.x[other] + w.sw[other] * 0.5 - (box[0] + box[2]) * 0.5;
      if (Math.abs(off) > FLOW_OFF * w.sw[other]) translate(w, ob, Math.min(Math.abs(w.ovx), rate) * (off >= 0 ? 1 : -1), 0);
    }
  }

  let PAIR_I = new Int32Array(512);
  let PAIR_J = new Int32Array(512);
  let ADJ = new Int32Array(1024);
  const FAR = 1 << 30;

  // A drag's push travels outward from the dragged bodies like a shove
  // across a slick table. Breadth-first from them, each body resolves its
  // contacts as it is reached: a neighbour it overlaps yields the whole
  // overlap at once, along the contact normal only, and is reached in turn
  // (only a real push reaches a body; resting against one at the buffer
  // does not). One pass carries a push down a chain of any length, each
  // link keeps its motion along whatever it rests on, and no link halves
  // the push. What is left is then resolved, the nearer body of a pair
  // standing and the farther yielding; pairs equally
  // far, or never reached, split it. A body pinned by a line or
  // the wall and pushed into it stands, and the pusher gives back instead,
  // so the chain packs and the jam reaches the dragged bodies (see step).
  function pushPass(w, gain) {
    if (!w.pairs) pushPairs(w);
    const np = w.np;
    if (!np) return;
    const nb = w.nb;
    const lv = w.level;
    const deg = w.deg;
    lv.fill(FAR);
    w.root.fill(-1);
    const q = w.queue;
    let head = 0;
    w.qtail = 0;
    for (let b = 0; b < nb; b++) {
      if (!w.mover[b]) continue;
      lv[b] = 0;
      w.root[b] = b;
      q[w.qtail++] = b;
    }
    while (head < w.qtail) {
      const b = q[head++];
      for (let e = deg[b]; e < deg[b + 1]; e++) resolvePush(w, ADJ[e], gain);
    }
    for (let p = 0; p < np; p++) if (lv[w.body[PAIR_I[p]]] === FAR && lv[w.body[PAIR_J[p]]] === FAR) resolvePush(w, p, gain);
  }

  // The pairs a push can bring together in this slice of a solve (both
  // bodies may move its reach), and each body's pairs. Built once a slice.
  function pushPairs(w) {
    const reach = w.gap + 2 * w.reach;
    let np = 0;
    eachNear(w, reach, (i, j) => {
      const dy = Math.abs(w.y[i] + w.sh[i] * 0.5 - w.y[j] - w.sh[j] * 0.5) - (w.sh[i] + w.sh[j]) * 0.5;
      if (dy >= reach) return;
      if (np === PAIR_I.length) {
        const grow = (a) => {
          const b = new a.constructor(a.length * 2);
          b.set(a);
          return b;
        };
        PAIR_I = grow(PAIR_I);
        PAIR_J = grow(PAIR_J);
      }
      PAIR_I[np] = i;
      PAIR_J[np] = j;
      np += 1;
    });
    w.np = np;
    w.pairs = true;
    const nb = w.nb;
    if (!w.level) {
      w.level = new Int32Array(nb);
      w.root = new Int32Array(nb);
      w.deg = new Int32Array(nb + 1);
      w.queue = new Int32Array(nb);
    }
    const deg = w.deg;
    deg.fill(0);
    for (let p = 0; p < np; p++) {
      deg[w.body[PAIR_I[p]] + 1] += 1;
      deg[w.body[PAIR_J[p]] + 1] += 1;
    }
    for (let b = 0; b < nb; b++) deg[b + 1] += deg[b];
    if (ADJ.length < np * 2) ADJ = new Int32Array(np * 4);
    const fill = w.queue;
    for (let b = 0; b < nb; b++) fill[b] = deg[b];
    for (let p = 0; p < np; p++) {
      ADJ[fill[w.body[PAIR_I[p]]]++] = p;
      ADJ[fill[w.body[PAIR_J[p]]]++] = p;
    }
  }

  // One pair of pushPass. A body the push reaches for the first time takes
  // its distance and its dragged body from the one that pushed it.
  function resolvePush(w, p, gain) {
    const i = PAIR_I[p];
    const j = PAIR_J[p];
    const bi = w.body[i];
    const bj = w.body[j];
    if (w.passes && passes(w, i, j)) return;
    const pusher = w.mover[bi] || w.mover[bj];
    const gg = pusher ? w.gap : w.gapN;
    if (!overlap(w, i, j, gg)) return;
    steerAxis(w, i, j, bi, bj, gg);
    const mx = w.sx * gain;
    const my = w.sy * gain;
    if (pusher) w.load += Math.abs(mx) + Math.abs(my);
    w.corr += Math.abs(mx) + Math.abs(my);
    const lv = w.level;
    const near = w.locked[bi] || (!w.locked[bj] && lv[bi] < lv[bj]) ? bi : w.locked[bj] || lv[bj] < lv[bi] ? bj : -1;
    if (near < 0) {
      translate(w, bi, -mx * 0.5, -my * 0.5);
      translate(w, bj, mx * 0.5, my * 0.5);
      return;
    }
    const far = near === bi ? bj : bi;
    const px = near === bi ? mx : -mx;
    const py = near === bi ? my : -my;
    if (w.liq > 0 && !w.mover[far] && !w.pin[far] && w.root[near] >= 0) flowAside(w, w.root[near], near === bi ? j : i, far, mx, my);
    if (w.pin[far] && w.pnx && px * w.pnx[far] + py * w.pny[far] < -1e-9) {
      // Pushed into what pins it, the far body stands; the near one gives
      // back, jammed in turn, so the jam reaches the pusher.
      w.jam = true;
      if (!w.locked[near]) {
        translate(w, near, -px, -py);
        if (!w.pin[near] || w.pin[far] < w.pin[near]) w.pin[near] = w.pin[far];
        w.pnx[near] = w.pnx[far];
        w.pny[near] = w.pny[far];
      }
    } else translate(w, far, px, py);
    if (lv[far] === FAR && lv[near] !== FAR) {
      lv[far] = lv[near] + 1;
      w.root[far] = w.root[near];
      w.queue[w.qtail++] = far;
    }
  }

  // ------------------------------------------------------------------- drag
  // The first dragged member with a target carries its whole body.
  // Immovable obstacles are the frame wall and the lines, plus, in an
  // isolated (Ctrl) drag, every sticky not being dragged. While nothing
  // blocks, the selection moves rigidly to its targets. Once something
  // does, it crowds: bodies move leaders-first along the drag, each one
  // stopping at the obstacles and at the members already placed, so the
  // blocked ones halt and the rest pack up behind them. A ghost drag
  // (Ctrl+Shift) only keeps to the wall.
  const CATCH = 0.2;
  const CATCH_MIN = 1;

  // `part` (of 1): how much of this solve's way the dragged bodies have
  // come by the end of this call, when solve sub-steps a long move.
  function applyDrag(w, o, fx, fy, walls, part) {
    const movers = [];
    const mdx = [];
    const mdy = [];
    const share = part > 0 ? part : 1;
    for (let b = 0; b < w.nb; b++) {
      if (!w.locked[b]) continue;
      const m = w.members[b];
      for (let k = 0; k < m.length; k++) {
        const s = w.list[m[k]];
        if (!s.dragging || !s.dragTarget) continue;
        w.mover[b] = 1;
        movers.push(b);
        const i0 = m[k];
        let tx = s.dragTarget.x - w.ox[i0];
        let ty = s.dragTarget.y - w.oy[i0];
        // The pointer's own motion since the last step, which a press held
        // back by an obstacle does not bend.
        const lt = s._lt;
        w.pvx[b] = lt && lt.on ? s.dragTarget.x - lt.x : tx;
        w.pvy[b] = lt && lt.on ? s.dragTarget.y - lt.y : ty;
        // Way the pointer got ahead while something held the body back is
        // made up a share per step, so a give never lands as one jump.
        if (!o.ghost) {
          const bx = tx - w.pvx[b];
          const by = ty - w.pvy[b];
          const bl = Math.hypot(bx, by);
          const room = Math.max(CATCH_MIN, CATCH * bl);
          if (bl > room) {
            tx = w.pvx[b] + (bx * room) / bl;
            ty = w.pvy[b] + (by * room) / bl;
          }
        }
        mdx.push(tx * fx * share - (w.x[i0] - w.ox[i0]));
        mdy.push(ty * fy * share - (w.y[i0] - w.oy[i0]));
        if (w.slid[b] < 0) w.slid[b] = s._sa == null ? -1 : s._sa;
        break;
      }
    }
    if (!movers.length) return;
    if (o.ghost) {
      for (let r = 0; r < movers.length; r++) {
        translate(w, movers[r], mdx[r], mdy[r]);
        containBody(w, movers[r]);
      }
      return;
    }
    const obst = new Uint8Array(w.nb);
    if (o.isolate) for (let b = 0; b < w.nb; b++) obst[b] = w.mover[b] ? 0 : 1;
    else if (walls) for (let b = 0; b < w.nb; b++) obst[b] = walls[b] && !w.mover[b] ? 1 : 0;
    // Rigid first: every body free to reach its own target.
    const save = new Float64Array(w.n * 2);
    for (let i = 0; i < w.n; i++) {
      save[i * 2] = w.x[i];
      save[i * 2 + 1] = w.y[i];
    }
    let free = true;
    for (let r = 0; r < movers.length && free; r++) {
      const b = movers[r];
      const k = w.members[b][0];
      const tx = w.x[k] + mdx[r];
      const ty = w.y[k] + mdy[r];
      moveBody(w, b, mdx[r], mdy[r], obst);
      if (Math.abs(w.x[k] - tx) > 1e-6 || Math.abs(w.y[k] - ty) > 1e-6) free = false;
    }
    if (free) return;
    for (let i = 0; i < w.n; i++) {
      w.x[i] = save[i * 2];
      w.y[i] = save[i * 2 + 1];
    }
    // Crowd: leaders first along the mean motion.
    let ux = 0;
    let uy = 0;
    for (let r = 0; r < movers.length; r++) {
      ux += mdx[r];
      uy += mdy[r];
    }
    const order = movers.map((b, r) => {
      const c = bodyCenter(w, b);
      return { b: b, r: r, key: c.x * ux + c.y * uy };
    });
    order.sort((p, q) => q.key - p.key);
    for (let n = 0; n < order.length; n++) {
      const it = order[n];
      moveBody(w, it.b, mdx[it.r], mdy[it.r], obst);
      obst[it.b] = 1;
    }
  }

  const CANDS = [];

  // Moves body b by (dx, dy) in sub-steps short enough that no `obst` body
  // can be tunnelled through, projecting it out of those bodies, the walls,
  // and last the lines after each. Every move is swept against the lines,
  // so however long the step it stops at one. Projection only removes
  // penetration, so it slides along what stops it and never rebounds.
  function moveBody(w, b, dx, dy, obst) {
    const g = w.gap;
    const box = bodyBox(w, b);
    const bx0 = Math.min(box[0], box[0] + dx) - g;
    const by0 = Math.min(box[1], box[1] + dy) - g;
    const bx1 = Math.max(box[2], box[2] + dx) + g;
    const by1 = Math.max(box[3], box[3] + dy) + g;
    let thick = Infinity;
    const m = w.members[b];
    for (let k = 0; k < m.length; k++) thick = Math.min(thick, w.sw[m[k]], w.sh[m[k]]);
    CANDS.length = 0;
    for (let j = 0; j < w.n; j++) {
      const bj = w.body[j];
      if (bj === b || !obst[bj]) continue;
      if (w.x[j] >= bx1 || w.x[j] + w.sw[j] <= bx0 || w.y[j] >= by1 || w.y[j] + w.sh[j] <= by0) continue;
      CANDS.push(j);
      thick = Math.min(thick, w.sw[j], w.sh[j]);
    }
    const segs = w.segs;
    let anySeg = false;
    for (let d = 0; d < segs.length; d += SEG) {
      if (segs[d + 5] >= bx1 || segs[d + 7] <= bx0 || segs[d + 6] >= by1 || segs[d + 8] <= by0) continue;
      anySeg = true;
      thick = Math.min(thick, segs[d + 4] * 2);
    }
    const len = Math.hypot(dx, dy);
    const steps = CANDS.length || anySeg ? Math.min(96, Math.max(1, Math.ceil(len / Math.max(0.25, thick * 0.45)))) : 1;
    for (let s = 0; s < steps; s++) {
      guardMove(w, b, dx / steps, dy / steps);
      for (let pass = 0; pass < 3; pass++) {
        let moved = false;
        for (let c = 0; c < CANDS.length; c++) {
          const j = CANDS[c];
          for (let k = 0; k < m.length; k++) {
            if (!overlap(w, j, m[k], g)) continue;
            slideAxis(w, b, dx, dy, g);
            guardMove(w, b, w.sx, w.sy);
            moved = true;
          }
        }
        const before = w.x[m[0]] + w.y[m[0]];
        containBody(w, b, true);
        if (w.x[m[0]] + w.y[m[0]] !== before) moved = true;
        if (anySeg && clearLines(w, b)) moved = true;
        if (!moved) break;
      }
    }
  }

  const BOX = new Float64Array(4);

  function bodyBox(w, b) {
    const m = w.members[b];
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let k = 0; k < m.length; k++) {
      const i = m[k];
      if (w.x[i] < x0) x0 = w.x[i];
      if (w.y[i] < y0) y0 = w.y[i];
      if (w.x[i] + w.sw[i] > x1) x1 = w.x[i] + w.sw[i];
      if (w.y[i] + w.sh[i] > y1) y1 = w.y[i] + w.sh[i];
    }
    BOX[0] = x0;
    BOX[1] = y0;
    BOX[2] = x1;
    BOX[3] = y1;
    return BOX;
  }

  // Offset along one axis that brings [a0, a1] inside [lo, hi]; a span wider
  // than the room is centred.
  function inside(a0, a1, lo, hi) {
    if (a1 - a0 > hi - lo) return (lo + hi - a0 - a1) * 0.5;
    if (a0 < lo) return lo - a0;
    if (a1 > hi) return hi - a1;
    return 0;
  }

  // `guard`: swept against the lines, which outrank the wall.
  function containBody(w, b, guard) {
    const f = w.wall;
    if (!f) return;
    const box = bodyBox(w, b);
    const dx = inside(box[0], box[2], f.x0, f.x1);
    const dy = inside(box[1], box[3], f.y0, f.y1);
    if (!dx && !dy) return false;
    if (guard) guardMove(w, b, dx, dy);
    else translate(w, b, dx, dy);
    return true;
  }

  // The frame is a wall: a projection, never a rebound. A body it holds
  // back is pinned (2; a line's pin, 1, outranks it; see strain).
  function wallPass(w) {
    if (!w.wall) return;
    for (let b = 0; b < w.nb; b++) {
      const k = w.members[b][0];
      const x0 = w.x[k];
      const y0 = w.y[k];
      if (!containBody(w, b)) continue;
      if (!w.pin[b]) w.pin[b] = 2;
      aim(w, b, w.x[k] - x0, w.y[k] - y0);
      w.corr += Math.abs(w.x[k] - x0) + Math.abs(w.y[k] - y0);
    }
  }

  function clampMotion(w, maxPush) {
    if (!(maxPush > 0)) return;
    for (let b = 0; b < w.nb; b++) {
      if (w.locked[b] || w.kin[b]) continue;
      const k = w.members[b][0];
      const dx = w.x[k] - w.ox[k];
      const dy = w.y[k] - w.oy[k];
      const d = Math.hypot(dx, dy);
      if (d > maxPush) {
        const f = maxPush / d - 1;
        translate(w, b, dx * f, dy * f);
      }
    }
  }

  const SUB_LEN = 8;
  const SUB_MAX = 8;
  const JAM_PASSES = 4;

  // One solve, the drag carried `fx` and `fy` of the way to its targets
  // along each axis. Nothing is written back to the stickies (dragged
  // lines do move).
  function solve(model, o, fx, fy, walls) {
    const w = buildWorld(model);
    let cap = o.maxPush;
    const iters = o.iters || 1;
    const gain = o.contactEase == null ? 0.45 : o.contactEase;
    const isolated = !!(o.drag && (o.isolate || o.ghost));
    w.shock = !!o.drag && !isolated;
    const skipLines = o.drag && o.ghost ? w.mover : null;
    let subs = 1;
    if (o.drag) {
      liquid(w, model);
      driveLines(w, model, o, fx, fy);
      applyDrag(w, o, fx, fy, walls);
      markClear(w);
      // Pushed neighbours keep up with the dragged body, however the
      // pointer events fell within the frame, and flow faster when liquid.
      let lead = 0;
      for (let b = 0; b < w.nb; b++) {
        if (!w.mover[b]) continue;
        const k = w.members[b][0];
        lead = Math.max(lead, Math.hypot(w.x[k] - w.ox[k], w.y[k] - w.oy[k]));
      }
      if (cap > 0) cap = Math.max(cap, lead * 1.25) * (1 + LIQ_PUSH * w.liq);
      // A long move is pushed in slices, each no longer than SUB_LEN, so a
      // push never carries a body over the one ahead of it.
      if (w.shock && lead > SUB_LEN) {
        subs = Math.min(SUB_MAX, Math.ceil(lead / SUB_LEN));
        for (let i = 0; i < w.n; i++) {
          if (!w.mover[w.body[i]]) continue;
          w.x[i] = w.ox[i];
          w.y[i] = w.oy[i];
        }
      }
      w.reach = (lead / subs) * 1.25 + TOUCH;
    }
    for (let sub = 1; sub <= subs; sub++) {
      if (subs > 1) {
        applyDrag(w, o, fx, fy, walls, sub / subs);
        markClear(w);
      }
      w.pairs = false;
      // A push stops early once a pass corrects nothing. A jam handed back
      // through a long chain can take more passes than `iters`; it keeps
      // going, up to JAM_PASSES times, while it still corrects anything;
      // earlier slices only have to keep bodies from passing each other.
      const passes = sub < subs ? 1 : w.shock && w.jam ? iters * JAM_PASSES : iters;
      for (let i = 0; i < passes; i++) {
        w.corr = 0;
        contactPass(w, gain, isolated);
        wallPass(w);
        linePass(w, skipLines);
        if (w.shock && i > 0 && w.corr < 1e-3) break;
      }
    }
    // After a frame shrink a sticky far outside glides in at this cap.
    clampMotion(w, cap);
    linePass(w, skipLines);
    return w;
  }

  // ------------------------------------------------------------ liquefaction
  // Pressing into a crowd that resists (a push the solve cannot clear, or
  // a squeeze) for more than a moment liquefies it: over LIQ_RAMP ms the
  // neighbours' buffer between each other shrinks toward LIQ_GAP of the
  // full buffer (never below zero), their push allowance grows, the
  // dragged body deflects more of them aside, and a squeeze held only by
  // the wall gives, so they flow around it like grains around a finger.
  // Links the dragged body pushes head-on stay rigid: a chain still carries
  // the push. Easing off ramps it back down; a settle, which
  // always uses the full buffer, re-spreads them on release. The dragged
  // body's own buffer never shrinks.
  const LIQ_DELAY = 90;
  const LIQ_RAMP = 180;
  const LIQ_GAP = 0.25;
  const LIQ_PUSH = 2;
  const LIQ_DEFLECT = 0.25;
  const LIQ_RESIST = 0.25;
  const LIQ_WALL = 1.5;
  const AXIS_MEMORY = 3;

  function liquidState(model) {
    return model._liquid || stash(model, '_liquid', { level: 0, held: 0 });
  }

  function liquid(w, model) {
    const st = model._liquid;
    w.liq = st ? st.level : 0;
    w.gapN = w.gap * (1 - (1 - LIQ_GAP) * w.liq);
  }

  // Whether the dragged bodies still overlap a neighbour after the solve,
  // by more than LIQ_RESIST: the crowd is pushing back.
  function resisted(w) {
    let worst = 0;
    eachNear(w, w.gap, (i, j, bi, bj) => {
      if (!(w.mover[bi] || w.mover[bj]) || (w.mover[bi] && w.mover[bj])) return;
      if (w.passes && passes(w, i, j)) return;
      if (!overlap(w, i, j, w.gap)) return;
      worst = Math.max(worst, Math.min(Math.abs(w.ovx), Math.abs(w.ovy)));
    });
    return worst > LIQ_RESIST;
  }

  // Pressing: the pointer held more than a buffer ahead of where a squeeze
  // stopped the dragged body, or a crowd still overlapping it.
  function flow(model, o, w, strained) {
    const st = liquidState(model);
    const dt = o.dt > 0 ? Math.min(o.dt, 50) : 1000 / 60;
    let ahead = 0;
    if (strained) {
      for (let b = 0; b < w.nb; b++) {
        if (!w.mover[b]) continue;
        const m = w.members[b];
        for (let k = 0; k < m.length; k++) {
          const s = w.list[m[k]];
          if (s.dragging && s.dragTarget) ahead = Math.max(ahead, Math.hypot(s.dragTarget.x - w.x[m[k]], s.dragTarget.y - w.y[m[k]]));
        }
      }
    }
    if (ahead > Math.max(2, w.gap) || resisted(w)) {
      st.held += dt;
      if (st.held > LIQ_DELAY) st.level = Math.min(1, st.level + dt / LIQ_RAMP);
    } else {
      st.held = 0;
      st.level = Math.max(0, st.level - dt / LIQ_RAMP);
    }
  }

  function liquidLevel(model) {
    return model._liquid ? model._liquid.level : 0;
  }

  function resetLiquid(model) {
    if (model._liquid) {
      model._liquid.level = 0;
      model._liquid.held = 0;
    }
  }

  // Each step is a generation of the contact memory; pairs not touched for
  // AXIS_MEMORY steps forget their axis.
  function tickContacts(model) {
    const gen = (model._axisGen || 0) + 1;
    stash(model, '_axisGen', gen);
    const axes = contactMemory(model);
    if (axes.size > 8 * model.stickies.length + 64) {
      axes.forEach((v, k) => {
        if (Math.floor(v / 2) < gen - AXIS_MEMORY) axes.delete(k);
      });
    }
  }

  const STRAIN_OK = 0.05;

  // What a solve leaves undone at the immovables: the deepest buffer
  // violation between a body a line or the wall held back (w.pin) and its
  // neighbour, or between any body and a line. Neighbours of a liquid crowd
  // are measured at their shrunken buffer.
  // With `walls`, every body (not a dragged one) in a violation deeper than
  // `limit` is marked in it: jammed, it becomes an obstacle the dragged
  // bodies slide along (see step). Returns the deepest violation.
  function strain(w, limit, walls) {
    const g = w.gap;
    let worst = 0;
    // A crowd held only by the wall stops being a wall once mostly liquid.
    const mark = (b, v, byLine) => {
      if (walls && v > limit && !w.mover[b] && (byLine || w.liq < 0.5)) walls[b] = 1;
    };
    eachNear(w, g, (i, j, bi, bj) => {
      if (!(w.pin[bi] || w.pin[bj])) return;
      if (w.passes && passes(w, i, j)) return;
      const sx = Math.abs(w.x[i] + w.sw[i] * 0.5 - w.x[j] - w.sw[j] * 0.5) - (w.sw[i] + w.sw[j]) * 0.5;
      const sy = Math.abs(w.y[i] + w.sh[i] * 0.5 - w.y[j] - w.sh[j] * 0.5) - (w.sh[i] + w.sh[j]) * 0.5;
      let v = (w.mover[bi] || w.mover[bj] ? g : w.gapN) - Math.max(sx, sy);
      // Held only by the wall, a liquid crowd flows along it: its buffer
      // gives, down to bodies touching, never overlapping.
      const byLine = w.pin[bi] === 1 || w.pin[bj] === 1;
      if (!byLine && w.liq > 0) v -= Math.min((LIQ_WALL * g * w.liq) / (1.001 - w.liq), w.mover[bi] || w.mover[bj] ? g : w.gapN);
      if (v > worst) worst = v;
      mark(bi, v, byLine);
      mark(bj, v, byLine);
    });
    const segs = w.segs;
    for (let i = 0; i < w.n && segs.length; i++) {
      const x0 = w.x[i];
      const y0 = w.y[i];
      const x1 = x0 + w.sw[i];
      const y1 = y0 + w.sh[i];
      for (let d = 0; d < segs.length; d += SEG) {
        if (x1 <= segs[d + 5] || x0 >= segs[d + 7] || y1 <= segs[d + 6] || y0 >= segs[d + 8]) continue;
        if (!reachPush(x0, y0, x1, y1, segs, d)) continue;
        const v = Math.hypot(PUSH[0], PUSH[1]);
        if (v > worst) worst = v;
        mark(w.body[i], v, true);
      }
    }
    return worst;
  }

  function draggedLines(model) {
    const out = [];
    const lines = model.lines || [];
    for (let i = 0; i < lines.length; i++) if (lines[i].dragging && lines[i].dragTarget) out.push({ line: lines[i], at: lines[i].points.map((p) => [p[0], p[1]]) });
    return out;
  }

  function linePoints(held) {
    return held.map((h) => h.line.points.map((p) => [p[0], p[1]]));
  }

  function setLinePoints(held, pts) {
    for (let i = 0; i < held.length; i++) {
      const src = pts ? pts[i] : held[i].at;
      const dst = held[i].line.points;
      for (let p = 0; p < dst.length; p++) {
        dst[p][0] = src[p][0];
        dst[p][1] = src[p][1];
      }
    }
  }

  function dragsAnything(model) {
    for (let i = 0; i < model.stickies.length; i++) if (model.stickies[i].dragging && model.stickies[i].dragTarget) return true;
    const lines = model.lines || [];
    for (let i = 0; i < lines.length; i++) if (lines[i].dragging && lines[i].dragTarget) return true;
    return false;
  }

  // opts.drag moves dragged stickies and lines to their targets;
  // opts.isolate (Ctrl) makes every other sticky a fixed obstacle;
  // opts.ghost (Ctrl+Shift) lets the dragged ones pass through everything
  // but the wall.
  //
  // The pusher stops, but only into the squeeze: a drag that would squeeze
  // a sticky against a line or the wall (strain the solve cannot clear)
  // goes as far along its targets as the squeeze allows, found by
  // bisection, and then slides: the rest of each axis on its own, the
  // longer first, as far as it does not deepen the squeeze. So a sticky
  // pressed into a row jammed at a line glides along the row with the
  // cursor. The next frame tries again from there. A ghost drag squeezes
  // nothing. opts.dt (ms since the last step) paces liquefaction.
  function step(model, opts) {
    const o = opts || {};
    tickContacts(model);
    if (!o.drag || o.ghost || !dragsAnything(model)) return commit(solve(model, o, 1, 1));
    const held = draggedLines(model);
    const full = solve(model, o, 1, 1);
    const s1 = strain(full);
    if (s1 <= STRAIN_OK) return finishDrag(model, o, full, false);
    const atFull = linePoints(held);
    setLinePoints(held, null);
    let best = solve(model, o, 0, 0);
    let bestAt = linePoints(held);
    const limit = Math.max(strain(best), STRAIN_OK) + 1e-3;
    if (s1 <= limit) {
      setLinePoints(held, atFull);
      return finishDrag(model, o, full, false);
    }
    // What is jammed against an immovable is immovable too: the dragged
    // bodies slide along it at the buffer, like a Ctrl drag, and push
    // everything else as before. Jams found behind jams join in turn.
    const walls = new Uint8Array(full.nb);
    let w = full;
    let count = 0;
    for (let r = 0; r < 3; r++) {
      strain(w, limit, walls);
      let now = 0;
      for (let b = 0; b < walls.length; b++) now += walls[b];
      if (now === count) break;
      count = now;
      setLinePoints(held, null);
      w = solve(model, o, 1, 1, walls);
      if (strain(w) <= limit) return finishDrag(model, o, w, true);
    }
    const trial = (fx, fy) => {
      setLinePoints(held, null);
      const w = solve(model, o, fx, fy, walls);
      if (strain(w) > limit) return false;
      best = w;
      bestAt = linePoints(held);
      return true;
    };
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 5; k++) {
      const mid = (lo + hi) * 0.5;
      if (trial(mid, mid)) lo = mid;
      else hi = mid;
    }
    const f = [lo, lo];
    const d = leadMotion(model);
    const axes = Math.abs(d.x) >= Math.abs(d.y) ? [0, 1] : [1, 0];
    for (let n = 0; n < 2; n++) {
      const a = axes[n];
      const at = (v) => (a === 0 ? trial(v, f[1]) : trial(f[0], v));
      if (f[a] >= 1 || (a === 0 ? !d.x : !d.y)) continue;
      if (at(1)) {
        f[a] = 1;
        continue;
      }
      let l = f[a];
      let h = 1;
      for (let k = 0; k < 4; k++) {
        const mid = (l + h) * 0.5;
        if (at(mid)) l = mid;
        else h = mid;
      }
      f[a] = l;
    }
    setLinePoints(held, bestAt);
    return finishDrag(model, o, best, true);
  }

  function finishDrag(model, o, w, strained) {
    flow(model, o, w, strained);
    for (let b = 0; b < w.nb; b++) {
      if (!w.mover[b]) continue;
      const m = w.members[b];
      for (let k = 0; k < m.length; k++) {
        const s = w.list[m[k]];
        if (!s.dragging || !s.dragTarget) continue;
        const lt = s._lt || stash(s, '_lt', { x: 0, y: 0, on: false });
        lt.x = s.dragTarget.x;
        lt.y = s.dragTarget.y;
        lt.on = true;
        stash(s, '_sa', w.slid[b]);
        break;
      }
    }
    return commit(w);
  }

  // The first dragged sticky's way to its target.
  function leadMotion(model) {
    for (let i = 0; i < model.stickies.length; i++) {
      const s = model.stickies[i];
      if (s.dragging && s.dragTarget && active(model, s)) return { x: s.dragTarget.x - s.x, y: s.dragTarget.y - s.y };
    }
    const lines = model.lines || [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.dragging && l.dragTarget) return { x: l.dragTarget.x - l.points[0][0], y: l.dragTarget.y - l.points[0][1] };
    }
    return { x: 0, y: 0 };
  }

  function markTargets(w, ids) {
    const all = !ids || !ids.length;
    const target = new Array(w.nb).fill(all);
    if (all) return target;
    const want = new Set(ids);
    for (let i = 0; i < w.n; i++) if (want.has(w.list[i].id)) target[w.body[i]] = true;
    return target;
  }

  function targetCentroid(w, target) {
    let sx = 0;
    let sy = 0;
    let sa = 0;
    for (let i = 0; i < w.n; i++) {
      if (!target[w.body[i]]) continue;
      const a = w.sw[i] * w.sh[i];
      sx += (w.x[i] + w.sw[i] * 0.5) * a;
      sy += (w.y[i] + w.sh[i] * 0.5) * a;
      sa += a;
    }
    return sa > 0 ? { x: sx / sa, y: sy / sa } : null;
  }

  // Area-weighted, like targetCentroid. A bbox center would let a sparse
  // group's pull disagree with the centroid, and the cluster would drift.
  function bodyCenter(w, b) {
    const m = w.members[b];
    let sx = 0;
    let sy = 0;
    let sa = 0;
    for (let k = 0; k < m.length; k++) {
      const i = m[k];
      const a = w.sw[i] * w.sh[i];
      sx += (w.x[i] + w.sw[i] * 0.5) * a;
      sy += (w.y[i] + w.sh[i] * 0.5) * a;
      sa += a;
    }
    return { x: sx / sa, y: sy / sa };
  }

  // Time a point moving by (vx, vy) meets the box [x0,x1]x[y0,y1], counting
  // only faces it approaches. A point resting on a face (within tol) is
  // outside, so a body parked at exactly the gap stays blocked next frame.
  function faceTime(px, py, vx, vy, x0, x1, y0, y1, tol) {
    let t = Infinity;
    if ((vx > 0 && px <= x0 + tol) || (vx < 0 && px >= x1 - tol)) {
      const tx = Math.max(0, ((vx > 0 ? x0 : x1) - px) / vx);
      const yy = py + vy * tx;
      if (yy > y0 + tol && yy < y1 - tol) t = tx;
    }
    if ((vy > 0 && py <= y0 + tol) || (vy < 0 && py >= y1 - tol)) {
      const ty = Math.max(0, ((vy > 0 ? y0 : y1) - py) / vy);
      const xx = px + vx * ty;
      if (ty < t && xx > x0 + tol && xx < x1 - tol) t = ty;
    }
    return t;
  }

  // A point already inside the box may not go deeper through the face it is
  // nearest; left free, it slides in and is later ejected outward (a bounce).
  function deepens(px, py, vx, vy, x0, x1, y0, y1) {
    if (px <= x0 || px >= x1 || py <= y0 || py >= y1) return false;
    const l = px - x0;
    const r = x1 - px;
    const t = py - y0;
    const d = y1 - py;
    const m = Math.min(l, r, t, d);
    if (m === l) return vx > 0;
    if (m === r) return vx < 0;
    if (m === t) return vy > 0;
    return vy < 0;
  }

  // Fraction of (vx, vy) body b can travel before it reaches the wall or
  // the buffer of a target or locked body (rank above zero; no rank: any
  // body). The body reached goes into SWEPT (-1: the wall or nothing).
  // Targets never push each other aside: that churn drags the centroid and
  // the cluster never settles.
  let SWEPT = -1;

  function sweep(w, b, vx, vy, rank) {
    const g = w.gap;
    let best = 1;
    SWEPT = -1;
    if (w.wall) {
      const box = bodyBox(w, b);
      const f = w.wall;
      if (vx > 0) best = Math.min(best, Math.max(0, (f.x1 - box[2]) / vx));
      if (vx < 0) best = Math.min(best, Math.max(0, (f.x0 - box[0]) / vx));
      if (vy > 0) best = Math.min(best, Math.max(0, (f.y1 - box[3]) / vy));
      if (vy < 0) best = Math.min(best, Math.max(0, (f.y0 - box[1]) / vy));
      if (best === 0) return 0;
    }
    const m = w.members[b];
    for (let k = 0; k < m.length; k++) {
      const i = m[k];
      const px = w.x[i];
      const py = w.y[i];
      const pw = w.sw[i];
      const ph = w.sh[i];
      const lx = Math.min(px, px + vx) - g;
      const hx = Math.max(px, px + vx) + pw + g;
      const ly = Math.min(py, py + vy) - g;
      const hy = Math.max(py, py + vy) + ph + g;
      for (let j = 0; j < w.n; j++) {
        const bj = w.body[j];
        if (bj === b || (rank && !(rank[bj] > 0))) continue;
        const qx = w.x[j];
        const qy = w.y[j];
        if (qx >= hx || qx + w.sw[j] <= lx || qy >= hy || qy + w.sh[j] <= ly) continue;
        const x0 = qx - g - pw;
        const x1 = qx + w.sw[j] + g;
        const y0 = qy - g - ph;
        const y1 = qy + w.sh[j] + g;
        const t = deepens(px, py, vx, vy, x0, x1, y0, y1) ? 0 : faceTime(px, py, vx, vy, x0, x1, y0, y1, 1e-6);
        if (t >= best) continue;
        best = t;
        SWEPT = bj;
        if (best === 0) return 0;
      }
    }
    return best;
  }

  function slide(w, b, vx, vy, rank) {
    const t = sweep(w, b, vx, vy, rank);
    if (t > 0) translate(w, b, vx * t, vy * t);
    const rx = vx * (1 - t);
    const ry = vy * (1 - t);
    if (Math.abs(rx) > 1e-9) {
      const tx = sweep(w, b, rx, 0, rank);
      if (tx > 0) translate(w, b, rx * tx, 0);
    }
    if (Math.abs(ry) > 1e-9) {
      const ty = sweep(w, b, 0, ry, rank);
      if (ty > 0) translate(w, b, 0, ry * ty);
    }
  }

  // Bundle precedence, a strict order so pushes never cycle: locked bodies,
  // then targets by area, then bystanders nearer the centroid.
  function bundleRanks(w, target, c, rank) {
    for (let b = 0; b < w.nb; b++) {
      if (w.locked[b]) rank[b] = Infinity;
      else if (target[b]) rank[b] = 1 + w.area[b];
      else {
        const bc = bodyCenter(w, b);
        rank[b] = -((bc.x - c.x) * (bc.x - c.x) + (bc.y - c.y) * (bc.y - c.y));
      }
    }
  }

  function outranks(rank, a, b) {
    return rank[a] > rank[b] || (rank[a] === rank[b] && a < b);
  }

  // Records what yielder member y needs to clear d, and bans every direction
  // that would carry y across d. A pair resting at the gap still bans the
  // way back, so a yielder between two pushers leaves sideways. `eject` is
  // how deep into the buffer a pair must be before the yielder is ejected:
  // the whole buffer (true overlap) in a bundle, none when unjamming.
  function noteYield(w, y, d, need, banned, eject) {
    const g = w.gap;
    const k = w.body[y] * 4;
    let ex = w.x[d] + w.sw[d] * 0.5 - (w.x[y] + w.sw[y] * 0.5);
    let ey = w.y[d] + w.sh[d] * 0.5 - (w.y[y] + w.sh[y] * 0.5);
    const ox = (w.sw[y] + w.sw[d]) * 0.5 + g - Math.abs(ex);
    const oy = (w.sh[y] + w.sh[d]) * 0.5 + g - Math.abs(ey);
    if (ox <= -TOUCH_SLACK || oy <= -TOUCH_SLACK) return;
    const trueX = ox > eject + 1e-6;
    const trueY = oy > eject + 1e-6;
    if (trueX && trueY) {
      need[k + RIGHT] = Math.max(need[k + RIGHT], w.x[d] + w.sw[d] + g - w.x[y]);
      need[k + LEFT] = Math.max(need[k + LEFT], w.x[y] + w.sw[y] + g - w.x[d]);
      need[k + DOWN] = Math.max(need[k + DOWN], w.y[d] + w.sh[d] + g - w.y[y]);
      need[k + UP] = Math.max(need[k + UP], w.y[y] + w.sh[y] + g - w.y[d]);
    } else if (ox > 1e-6 && oy > 1e-6) {
      // Inside the gap but not overlapping (as the user left it): block the
      // approach without ejecting, or the yielder bounces out and back.
      if (trueX) ex = 0;
      else if (trueY) ey = 0;
    } else if (ox > 1e-6) ex = 0;
    else if (oy > 1e-6) ey = 0;
    else return;
    if (ex > 1e-6) banned[k + RIGHT] = 1;
    if (ex < -1e-6) banned[k + LEFT] = 1;
    if (ey > 1e-6) banned[k + DOWN] = 1;
    if (ey < -1e-6) banned[k + UP] = 1;
  }

  // One Jacobi pass: only yielders move, each by the shortest clear that
  // leads away from the centroid. Every yield grows the yielder's distance,
  // so a body boxed in by larger ones cannot circle back to where it began.
  // Unjamming (`unjam`), the buffer counts as overlap.
  function bundlePass(w, rank, c, need, banned, unjam) {
    need.fill(0);
    banned.fill(0);
    const eject = unjam ? 0 : w.gap;
    eachNear(w, w.gap + TOUCH_SLACK, (i, j, bi, bj) => {
      if (outranks(rank, bi, bj)) noteYield(w, j, i, need, banned, eject);
      else noteYield(w, i, j, need, banned, eject);
    });
    const open = OPEN;
    const room = ROOM;
    for (let b = 0; b < w.nb; b++) {
      const k = b * 4;
      if (!(need[k] > 0)) continue;
      const bc = bodyCenter(w, b);
      open[RIGHT] = bc.x >= c.x - 1e-6;
      open[LEFT] = bc.x <= c.x + 1e-6;
      open[DOWN] = bc.y >= c.y - 1e-6;
      open[UP] = bc.y <= c.y + 1e-6;
      wallRoom(w, b, room);
      let dir = shortestClear(need, banned, k, open, true, room);
      if (dir < 0) dir = shortestClear(need, banned, k, open, false, room);
      // Against the wall, any clear way will do, even toward the middle.
      if (dir < 0) dir = shortestClear(need, banned, k, ANY, false, room);
      let len = dir < 0 ? 0 : need[k + dir];
      if (dir < 0) {
        // Boxed in: take what room there is; contacts settle the rest.
        for (let d = 0; d < 4; d++) if (room[d] > 1e-6 && (dir < 0 || room[d] > room[dir])) dir = d;
        if (dir < 0) continue;
        len = Math.min(need[k + dir], room[dir]);
      }
      if (dir === RIGHT) w.bdx[b] += len;
      else if (dir === LEFT) w.bdx[b] -= len;
      else if (dir === DOWN) w.bdy[b] += len;
      else w.bdy[b] -= len;
    }
    fold(w);
  }

  const OPEN = [true, true, true, true];
  const ANY = [true, true, true, true];
  const ROOM = new Float64Array(4);

  function wallRoom(w, b, room) {
    if (!w.wall) {
      room.fill(Infinity);
      return;
    }
    const box = bodyBox(w, b);
    room[RIGHT] = w.wall.x1 - box[2];
    room[LEFT] = box[0] - w.wall.x0;
    room[DOWN] = w.wall.y1 - box[3];
    room[UP] = box[1] - w.wall.y0;
  }

  function shortestClear(need, banned, k, open, obeyBans, room) {
    let dir = -1;
    for (let d = 0; d < 4; d++) {
      if (!open[d] || (obeyBans && banned[k + d]) || need[k + d] > room[d] + 1e-6) continue;
      if (dir < 0 || need[k + d] < need[k + dir]) dir = d;
    }
    return dir;
  }

  function bundleStep(model, ids, opts) {
    const o = opts || {};
    const pull = o.pull == null ? 0.18 : o.pull;
    const maxPush = o.maxPush == null ? BUNDLE_PUSH : o.maxPush;
    const iters = o.iters == null ? 6 : o.iters;
    const w = buildWorld(model);
    if (!w.n) return 0;
    const target = markTargets(w, ids);
    const c = o.center && Number.isFinite(o.center.x) && Number.isFinite(o.center.y)
      ? { x: o.center.x, y: o.center.y } : targetCentroid(w, target);
    if (!c) return 0;
    const rank = new Float64Array(w.nb);
    bundleRanks(w, target, c, rank);
    const movers = [];
    for (let b = 0; b < w.nb; b++) if (target[b] && !w.locked[b]) movers.push(b);
    movers.sort((a, b) => (outranks(rank, a, b) ? -1 : 1));
    // Larger bodies travel faster, so they reach the middle first.
    for (let r = 0; r < movers.length; r++) {
      const b = movers[r];
      const scale = movers.length > 1 ? 1 - SIZE_LAG * r / (movers.length - 1) : 1;
      const bc = bodyCenter(w, b);
      const ddx = c.x - bc.x;
      const ddy = c.y - bc.y;
      const d = Math.hypot(ddx, ddy);
      if (d < 1e-6) continue;
      const len = Math.min(d * pull, maxPush * scale);
      slide(w, b, ddx / d * len, ddy / d * len, rank);
    }
    const need = new Float64Array(w.nb * 4);
    const banned = new Uint8Array(w.nb * 4);
    for (let i = 0; i < iters; i++) {
      bundleRanks(w, target, c, rank);
      bundlePass(w, rank, c, need, banned, !!o.unjam);
    }
    wallPass(w);
    linePass(w, null);
    // A bystander boxed in by arriving targets glides out instead of jumping.
    clampMotion(w, maxPush * 2);
    linePass(w, null);
    return commit(w);
  }

  // Instant mode is not bound by the animation's per-frame cap: unless the
  // caller sets maxPush, the step grows with the spread so 600 frames suffice.
  function bundle(model, ids, opts) {
    const o = Object.assign({}, opts);
    if (o.maxPush == null) {
      const want = ids && ids.length ? new Set(ids) : null;
      const b = boundsOf(alive(model).filter((s) => !want || want.has(s.id)));
      o.maxPush = Math.max(BUNDLE_PUSH, Math.max(b.w, b.h) / 150);
    }
    let frames = 0;
    while (frames < 600) {
      frames += 1;
      if (bundleStep(model, ids, o) < 0.05) break;
    }
    return frames;
  }

  function overlapsAny(model) {
    const list = alive(model);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[i].group && list[i].group === list[j].group) continue;
        if (mtv(list[i], list[j], 0)) return true;
      }
    }
    return lineOverlap(model, 0);
  }

  // Whether any two bodies, or a body and a stroke, sit closer than the
  // buffer (less `slack`): what a larger buffer leaves behind.
  function crowdedAny(model, slack) {
    const g = Math.max(0, gapOf(model) - (slack == null ? 0.05 : slack));
    const list = alive(model);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[i].group && list[i].group === list[j].group) continue;
        if (mtv(list[i], list[j], g)) return true;
      }
    }
    return lineOverlap(model, g);
  }

  // ----------------------------------------------------------------- settle
  // The one rest loop, a frame at a time for the app (beginSettle, then
  // settleStep until it returns false) or all at once (settleNow). What the
  // user just placed (`held`) stays exactly where it landed while its
  // neighbours make room. Rest is never "motion stopped": it is the buffer
  // holding everywhere, no two bodies and no body and line closer than the
  // buffer (less REST_SLACK), and nothing outside the frame.
  //
  // An eased relax (the calm glide) comes first. If it stops short, a firm
  // relax closes the gap at a walking pace; each time that stalls the next
  // remedy gets a turn: what was held lets go and may yield too; stickies
  // caught in pockets yield their shortest way out; after a frame shrink
  // (`contain`) everything bundles inside the new walls. Whatever still
  // cannot rest is a jam (a frame too full, a pocket between lines too
  // small) and is reported, never left silently. Fudged stickies finish on
  // whole cells.

  const REST_SLACK = 0.05;
  const SETTLE_EASE = 120;
  const SETTLE_FIRM = 45;
  const SETTLE_BUNDLE = 420;
  const EASE_STEP = { iters: 3, contactEase: 0.55, maxPush: 18 };
  const FIRM_STEP = { iters: 12, contactEase: 1, maxPush: 4 };

  function clearHolds(model) {
    for (let i = 0; i < model.stickies.length; i++) {
      const s = model.stickies[i];
      s.dragging = false;
      s.dragTarget = null;
      if (s._lt) s._lt.on = false;
      if (s._sa != null) s._sa = null;
    }
  }

  function atRest(model) {
    return !crowdedAny(model, REST_SLACK) && !outsideFrame(model).length;
  }

  function beginSettle(model, held, opts) {
    const o = opts || {};
    clearHolds(model);
    resetLiquid(model);
    const list = held || [];
    for (let i = 0; i < list.length; i++) list[i].dragging = true;
    return { phase: 'ease', frames: 0, total: 0, held: list.length > 0, contain: !!o.contain, unjammed: false, jamIds: null, bundled: false, bundlePush: o.bundlePush || 9, jam: null, done: false };
  }

  function nextPhase(st, phase) {
    st.phase = phase;
    st.frames = 0;
  }

  // Returns whether motion continues. At the end st.jam is null (at rest)
  // or the jam report.
  function settleStep(model, st) {
    if (st.done) return false;
    st.total += 1;
    st.frames += 1;
    if (st.phase === 'bundle') {
      const ease = Math.min(1, st.frames / 18);
      const moved = bundleStep(model, [], { pull: 0.1 * ease, maxPush: st.bundlePush * ease });
      if (st.frames > 18 && (moved < 0.05 || st.frames >= SETTLE_BUNDLE)) nextPhase(st, 'ease');
      return true;
    }
    if (st.phase === 'unjam') {
      const moved = bundleStep(model, st.jamIds, { pull: 0, maxPush: st.bundlePush, iters: 3, unjam: true });
      if (moved < 0.05 || st.frames >= SETTLE_FIRM) nextPhase(st, 'ease');
      return true;
    }
    const firm = st.phase === 'firm';
    const moved = step(model, firm ? FIRM_STEP : EASE_STEP);
    if (atRest(model)) return finishSettle(model, st, false);
    if (!firm) {
      if (moved < 0.05 || st.frames >= SETTLE_EASE) nextPhase(st, 'firm');
      return true;
    }
    // Stalled: nothing moves, or a pocket that pushes back as hard as it is
    // pushed has had its chance.
    if (moved >= 1e-3 && st.frames < SETTLE_FIRM) return true;
    if (st.held) {
      clearHolds(model);
      st.held = false;
      nextPhase(st, 'ease');
      return true;
    }
    // Contacts push along one axis at a time, so a sticky caught in a
    // pocket (between a rigid group's members, or in a packed cluster) can
    // be pushed equally from both sides and never move. Unjamming yields as
    // a bundle does, around the stuck stickies: the smaller of each pair
    // takes its shortest way out, and the neighbourhood steps outward from
    // them to make the room.
    if (!st.unjammed) {
      st.unjammed = true;
      st.jamIds = jamReport(model).ids;
      nextPhase(st, 'unjam');
      return true;
    }
    if (st.contain && !st.bundled) {
      st.bundled = true;
      nextPhase(st, 'bundle');
      return true;
    }
    return finishSettle(model, st, true);
  }

  function finishSettle(model, st, jammed) {
    clearHolds(model);
    if (!jammed && model.cell > 0) snapToCells(model, model.cell);
    st.jam = jammed ? jamReport(model) : null;
    st.done = true;
    return false;
  }

  function settleNow(model, held, opts) {
    const st = beginSettle(model, held, opts);
    while (settleStep(model, st) && st.total < 5000);
    return { frames: st.total, jam: st.jam };
  }

  // What keeps a board from resting: pairs inside the buffer, stickies in a
  // line's reach, stickies outside the frame, the closest pair, and the ids.
  function jamReport(model) {
    const g = gapOf(model) - REST_SLACK;
    const list = alive(model);
    const ids = new Set();
    let pairs = 0;
    let minGap = Infinity;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (a.group && a.group === b.group) continue;
        const sep = Math.max(Math.max(b.x - a.x - a.w, a.x - b.x - b.w), Math.max(b.y - a.y - a.h, a.y - b.y - b.h));
        if (sep < minGap) minGap = sep;
        if (sep < g) {
          pairs += 1;
          ids.add(a.id);
          ids.add(b.id);
        }
      }
    }
    let lines = 0;
    const segs = lineSegments(model);
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      for (let d = 0; d < segs.length; d += SEG) {
        const cut = cutsBox(s.x, s.y, s.x + s.w, s.y + s.h, segs[d], segs[d + 1], segs[d + 2], segs[d + 3]);
        if (cut || nearSeg(s.x, s.y, s.x + s.w, s.y + s.h, segs[d], segs[d + 1], segs[d + 2], segs[d + 3]) < segs[d + 4] - REST_SLACK) {
          lines += 1;
          ids.add(s.id);
        }
      }
    }
    const outside = outsideFrame(model);
    outside.forEach((s) => ids.add(s.id));
    return { pairs: pairs, lines: lines, outside: outside.length, minGap: minGap, ids: Array.from(ids) };
  }

  // ------------------------------------------------------------------ frame
  // One frame, the environment the stickies live on. Membership is derived:
  // a sticky belongs when its center is inside. Its edges are walls.

  // The walls keep stickies one buffer inside the frame.
  function frameInner(frame, gap) {
    if (!frame) return null;
    const g = gap == null ? CONTACT_GAP : gap;
    return { x0: frame.x + g, y0: frame.y + g, x1: frame.x + frame.w - g, y1: frame.y + frame.h - g };
  }

  function frameTitleFor(fileName) {
    return String(fileName || 'Program').replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim() || 'Program';
  }

  // Sized around what is on the board with comfortable air on every side.
  function frameAround(model, title) {
    const b = boundsOf(alive(model));
    const m = Math.max(40, Math.max(b.w, b.h) * 0.08);
    const prev = model.frame;
    model.frame = {
      x: b.x - m,
      y: b.y - m,
      w: b.w + m * 2,
      h: b.h + m * 2,
      title: title != null ? String(title) : prev ? prev.title : frameTitleFor(model.fileName),
      color: prev ? prev.color : null,
    };
    return model.frame;
  }

  function frameMembers(model) {
    const f = model.frame;
    if (!f) return [];
    return alive(model).filter((s) => {
      const cx = s.x + s.w * 0.5;
      const cy = s.y + s.h * 0.5;
      return cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h;
    });
  }

  function moveFrame(model, dx, dy, members) {
    const f = model.frame;
    if (!f) return;
    const list = members || frameMembers(model);
    f.x += dx;
    f.y += dy;
    offset(list, dx, dy);
  }

  // Bodies are what must fit: a group is as wide as its bounds.
  function bodyBoxes(list) {
    const out = [];
    const groups = new Map();
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!s.group) {
        out.push({ members: [s], x: s.x, y: s.y, w: s.w, h: s.h });
        continue;
      }
      let body = groups.get(s.group);
      if (!body) {
        body = { members: [], x: 0, y: 0, w: 0, h: 0 };
        groups.set(s.group, body);
        out.push(body);
      }
      body.members.push(s);
    }
    groups.forEach((body) => {
      const b = boundsOf(body.members);
      body.x = b.x;
      body.y = b.y;
      body.w = b.w;
      body.h = b.h;
    });
    return out;
  }

  // The least the frame may be along `axis` ('w' or 'h') when the other side
  // is `other`: every body must fit across, and the inner area must hold the
  // program at FRAME_PACK.
  function frameFloor(model, axis, other) {
    const bodies = bodyBoxes(alive(model));
    let side = 0;
    let area = 0;
    for (let i = 0; i < bodies.length; i++) {
      side = Math.max(side, axis === 'w' ? bodies[i].w : bodies[i].h);
      for (let k = 0; k < bodies[i].members.length; k++) area += bodies[i].members[k].w * bodies[i].members[k].h;
    }
    const g = gapOf(model);
    const across = Math.max(1e-6, other - g * 2);
    return Math.max(FRAME_MIN, side + g * 2, area / FRAME_PACK / across + g * 2);
  }

  // Resizes one axis about the frame's center, never below the floor.
  // Returns the size applied.
  function resizeFrame(model, axis, value) {
    const f = model.frame;
    if (!f || !(value > 0)) return null;
    const floor = frameFloor(model, axis, axis === 'w' ? f.h : f.w);
    const next = Math.max(value, floor);
    if (axis === 'w') {
      f.x += (f.w - next) * 0.5;
      f.w = next;
    } else {
      f.y += (f.h - next) * 0.5;
      f.h = next;
    }
    return next;
  }

  // Stickies whose box reaches past the inner wall by more than `tol`.
  function outsideFrame(model, tol) {
    const inner = frameInner(model.frame, gapOf(model));
    if (!inner) return [];
    const t = tol == null ? 0.01 : tol;
    return alive(model).filter((s) => s.x < inner.x0 - t || s.y < inner.y0 - t || s.x + s.w > inner.x1 + t || s.y + s.h > inner.y1 + t);
  }

  // ------------------------------------------------------------------ align
  // Slate's align widget: everything goes to the union box of the selection.
  // A group moves as its rigid bounds.

  const ALIGN_MODES = ['left', 'hcenter', 'right', 'top', 'vmiddle', 'bottom', 'hdist', 'vdist', 'areaasc', 'areadesc'];

  // Area is the source footprint, not its grid/module-adjusted display size.
  // Groups sort as one body by summed member area. Keep ties in spatial order.
  function areaSortPlan(model, bodies, union, descending) {
    const horizontal = union.w >= union.h;
    const pos = horizontal ? 'x' : 'y', cross = horizontal ? 'y' : 'x';
    const size = horizontal ? 'w' : 'h', crossSize = horizontal ? 'h' : 'w';
    const gap = gapOf(model), wall = frameInner(model.frame, gap);
    const length = bodies.reduce((sum, body) => sum + body[size], 0);
    const breadth = Math.max(...bodies.map(body => body[crossSize]));
    const minimum = length + gap * (bodies.length - 1);
    const low = wall ? (horizontal ? wall.x0 : wall.y0) : -Infinity;
    const high = wall ? (horizontal ? wall.x1 : wall.y1) : Infinity;
    const crossLow = wall ? (horizontal ? wall.y0 : wall.x0) : -Infinity;
    const crossHigh = wall ? (horizontal ? wall.y1 : wall.x1) : Infinity;
    // Refuse a row/column that cannot fit instead of clamping it out of order.
    if (minimum > high - low + 1e-8 || breadth > crossHigh - crossLow + 1e-8) return [];
    const span = Math.min(high - low, Math.max(minimum, union[size]));
    const spacing = Math.max(gap, (span - length) / (bodies.length - 1));
    let at = Math.max(low, Math.min(high - span, union[pos] + (union[size] - span) * 0.5));
    const middle = Math.max(crossLow + breadth * 0.5,
      Math.min(crossHigh - breadth * 0.5, union[cross] + union[crossSize] * 0.5));
    const ranked = bodies.map((body, index) => ({body, index, area: body.members.reduce((sum, s) => sum + trueArea(s), 0)}));
    ranked.sort((a, b) => {
      const delta = a.area - b.area;
      const areaOrder = Math.abs(delta) > Math.max(1, a.area, b.area) * 1e-10 ? (descending ? -delta : delta) : 0;
      return areaOrder || a.body[pos] - b.body[pos] || a.body[cross] - b.body[cross] || a.index - b.index;
    });
    ranked.forEach(({body}) => {
      body.dx = horizontal ? at - body.x : middle - body.w * 0.5 - body.x;
      body.dy = horizontal ? middle - body.h * 0.5 - body.y : at - body.y;
      at += body[size] + spacing;
    });
    return bodies.filter(body => Math.abs(body.dx) > 1e-9 || Math.abs(body.dy) > 1e-9);
  }

  function alignPlan(model, ids, mode) {
    const bodies = bodyBoxes(stickiesById(model, expandToGroups(model, ids)));
    const distribute = mode === 'hdist' || mode === 'vdist';
    if (ALIGN_MODES.indexOf(mode) < 0 || bodies.length < (distribute ? 3 : 2)) return [];
    const u = boundsOf(bodies);
    bodies.forEach((b) => {
      b.dx = 0;
      b.dy = 0;
    });
    if (mode === 'areaasc' || mode === 'areadesc') return areaSortPlan(model, bodies, u, mode === 'areadesc');
    if (mode === 'left') bodies.forEach((b) => { b.dx = u.x - b.x; });
    else if (mode === 'hcenter') bodies.forEach((b) => { b.dx = u.x + u.w * 0.5 - (b.x + b.w * 0.5); });
    else if (mode === 'right') bodies.forEach((b) => { b.dx = u.x + u.w - (b.x + b.w); });
    else if (mode === 'top') bodies.forEach((b) => { b.dy = u.y - b.y; });
    else if (mode === 'vmiddle') bodies.forEach((b) => { b.dy = u.y + u.h * 0.5 - (b.y + b.h * 0.5); });
    else if (mode === 'bottom') bodies.forEach((b) => { b.dy = u.y + u.h - (b.y + b.h); });
    else {
      const horizontal = mode === 'hdist';
      const pos = horizontal ? 'x' : 'y';
      const size = horizontal ? 'w' : 'h';
      const order = bodies.slice().sort((a, b) => a[pos] - b[pos]);
      const first = order[0];
      const last = order[order.length - 1];
      const span = last[pos] + last[size] - first[pos];
      let total = 0;
      for (let i = 0; i < order.length; i++) total += order[i][size];
      const gap = (span - total) / (order.length - 1);
      let at = first[pos] + first[size] + gap;
      for (let i = 1; i < order.length - 1; i++) {
        const b = order[i];
        if (horizontal) b.dx = at - b.x;
        else b.dy = at - b.y;
        at += b[size] + gap;
      }
    }
    fanOut(bodies, mode === 'left' || mode === 'hcenter' || mode === 'right' || mode === 'hdist', gapOf(model));
    return bodies.filter((b) => Math.abs(b.dx) > 1e-9 || Math.abs(b.dy) > 1e-9);
  }

  // Stickies never overlap, so bodies that an align would stack fan out
  // along the free axis (y after a horizontal align, x after a vertical one)
  // in their existing order, one buffer apart. The aligned edge stays exact.
  function fanOut(bodies, freeY, gap) {
    const g = gap;
    const a0 = (b) => (freeY ? b.x + b.dx : b.y + b.dy);
    const aSize = (b) => (freeY ? b.w : b.h);
    const f0 = (b) => (freeY ? b.y + b.dy : b.x + b.dx);
    const fSize = (b) => (freeY ? b.h : b.w);
    const order = bodies.slice().sort((p, q) => f0(p) + fSize(p) * 0.5 - (f0(q) + fSize(q) * 0.5));
    for (let i = 1; i < order.length; i++) {
      const b = order[i];
      let at = f0(b);
      for (let moved = true; moved;) {
        moved = false;
        for (let j = 0; j < i; j++) {
          const o = order[j];
          const crosses = a0(b) < a0(o) + aSize(o) + g && a0(o) < a0(b) + aSize(b) + g;
          if (crosses && at < f0(o) + fSize(o) + g && f0(o) < at + fSize(b) + g) {
            at = f0(o) + fSize(o) + g;
            moved = true;
          }
        }
      }
      if (freeY) b.dy += at - f0(b);
      else b.dx += at - f0(b);
    }
  }

  function applyPlan(plan) {
    for (let i = 0; i < plan.length; i++) offset(plan[i].members, plan[i].dx, plan[i].dy);
  }

  // Returns the stickies that moved. A body the align would carry across a
  // line stops at it instead.
  function alignSelection(model, ids, mode) {
    const plan = alignPlan(model, ids, mode);
    if (!(model.lines && model.lines.length)) applyPlan(plan);
    else {
      const w = buildWorld(model);
      const index = new Map();
      for (let i = 0; i < w.n; i++) index.set(w.list[i], i);
      for (let p = 0; p < plan.length; p++) {
        const i = index.get(plan[p].members[0]);
        if (i === undefined) continue;
        const b = w.body[i];
        guardMove(w, b, plan[p].dx, plan[p].dy);
        clearLines(w, b);
      }
      commit(w);
    }
    const moved = [];
    for (let i = 0; i < plan.length; i++) moved.push.apply(moved, plan[i].members);
    return moved;
  }

  function stickiesById(model, ids) {
    const want = new Set(ids || []);
    return model.stickies.filter((s) => want.has(s.id) && active(model, s));
  }

  function groupsOf(list) {
    const groups = new Set();
    for (let i = 0; i < list.length; i++) if (list[i].group) groups.add(list[i].group);
    return groups;
  }

  function groupStickies(model, ids) {
    const picked = new Set(stickiesById(model, ids));
    if (picked.size < 2) return null;
    const groups = groupsOf(Array.from(picked));
    const members = alive(model).filter((s) => picked.has(s) || (s.group && groups.has(s.group)));
    const id = uid('g');
    for (let i = 0; i < members.length; i++) members[i].group = id;
    return id;
  }

  function ungroupStickies(model, ids) {
    const groups = groupsOf(stickiesById(model, ids));
    let changed = 0;
    for (let i = 0; i < model.stickies.length; i++) {
      const s = model.stickies[i];
      if (!s.group || !groups.has(s.group)) continue;
      s.group = null;
      changed += 1;
    }
    return changed;
  }

  function groupMembers(model, id) {
    const sticky = model.stickies.find((s) => s.id === id);
    if (!active(model, sticky)) return [];
    if (!sticky.group) return [sticky];
    return alive(model).filter((s) => s.group === sticky.group);
  }

  function expandToGroups(model, ids) {
    const list = alive(model);
    const byId = new Map();
    const byGroup = new Map();
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      byId.set(s.id, s);
      if (!s.group) continue;
      if (!byGroup.has(s.group)) byGroup.set(s.group, []);
      byGroup.get(s.group).push(s);
    }
    const out = [];
    const seen = new Set();
    (ids || []).forEach((id) => {
      const s = byId.get(id);
      if (!s) return;
      const members = s.group ? byGroup.get(s.group) : [s];
      for (let k = 0; k < members.length; k++) {
        if (seen.has(members[k].id)) continue;
        seen.add(members[k].id);
        out.push(members[k].id);
      }
    });
    return out;
  }

  function snapAxis(start, size, gridStep) {
    const lead = Math.round(start / gridStep) * gridStep - start;
    const end = start + size;
    const trail = Math.round(end / gridStep) * gridStep - end;
    return Math.abs(trail) < Math.abs(lead) - 1e-9 ? trail : lead;
  }

  function snapDelta(x, y, w, h, gridStep) {
    if (!(gridStep > 0)) return { dx: 0, dy: 0 };
    return { dx: snapAxis(x, w, gridStep), dy: snapAxis(y, h, gridStep) };
  }

  function snapEdge(value, gridStep) {
    if (!(gridStep > 0)) return value;
    return Math.round(value / gridStep) * gridStep;
  }

  // The area column reads the true size, which is what writeArea will store;
  // a fudged drawing never changes it.
  function fieldText(model, sticky, key) {
    if (key === model.areaKey) return String(areaValue(sticky));
    const value = sFields(model, sticky)[key];
    return value == null ? '' : String(value);
  }

  function commonField(model, ids, key) {
    const list = stickiesById(model, ids);
    if (!list.length) return { value: '', mixed: false };
    const first = fieldText(model, list[0], key);
    for (let i = 1; i < list.length; i++) {
      if (fieldText(model, list[i], key) !== first) return { value: '', mixed: true };
    }
    return { value: first, mixed: false };
  }

  function applyRowArea(model, rowIndex, area) {
    const row = model.rows[rowIndex];
    let sticky = model.stickies.find((s) => s.rowIndex === rowIndex);
    if (model.areaKey) row.fields[model.areaKey] = String(area);
    if (!sticky && area > 0) {
      const box = boundsOf(alive(model));
      const side = Math.sqrt(area);
      sticky = newSticky(rowIndex, box.w ? box.x + box.w + gapOf(model) : 0, box.y, side, side, null);
      refit(model, sticky, false);
      if (model.frame) placeFresh(model, [sticky], gapOf(model));
      model.stickies.push(sticky);
    } else if (sticky) setAreaKeepingAspect(model, sticky, area);
    return sticky;
  }

  // Table edits preserve the visible row order. Explicit zero hides a sticky
  // while keeping its id and its source row available for later activation.
  function editRowField(model, rowIndex, key, value) {
    const row = model.rows[rowIndex];
    if (!row || row.dropped || model.columns.indexOf(key) < 0) return 0;
    const text = value == null ? '' : String(value);
    const roles = getColumnRoles(model);
    let number;
    if (key === model.areaKey || key === roles.countKey || key === roles.moduleWidthKey || key === roles.moduleDepthKey) {
      const raw = text.replace(/,/g, '').trim();
      number = Number(raw);
      if ((!raw && key === model.areaKey) || !Number.isFinite(number) || number < 0) throw new Error('Use a non-negative number' + (key === model.areaKey ? '; use 0 to hide a row.' : '.'));
      if (key === roles.countKey && (!Number.isInteger(number) || number > 10000)) throw new Error('Use a whole module count from 0 to 10,000.');
    }
    if (row.fields[key] === text) return 0;
    const sticky = model.stickies.find((s) => s.rowIndex === rowIndex);
    if (key === model.areaKey && number > 0 && (!sticky || !active(model, sticky)) && alive(model).length >= MAX_STICKIES) {
      throw new Error('Stay under ' + MAX_STICKIES + ' stickies.');
    }
    ensureRowIds(model);
    const clearances = groupClearances(model, sticky ? [sticky] : []);
    if (key === model.areaKey) applyRowArea(model, rowIndex, number);
    else {
      row.fields[key] = text;
      if (sticky && (key === roles.countKey || key === roles.moduleWidthKey || key === roles.moduleDepthKey)) refit(model, sticky, false);
    }
    respaceGroups(clearances);
    return 1;
  }

  function setField(model, ids, key, value) {
    const name = ensureColumn(model, key);
    if (!name) return 0;
    const wanted = new Set(ids || []);
    const list = name === model.areaKey ? model.stickies.filter(s => wanted.has(s.id) && model.rows[s.rowIndex] && !model.rows[s.rowIndex].dropped) : stickiesById(model, ids);
    if (name === model.areaKey) {
      const area = Number(String(value == null ? '' : value).replace(/,/g, '').trim());
      if (!Number.isFinite(area) || area < 0 || String(value == null ? '' : value).trim() === '') return 0;
      const groups = groupClearances(model, list);
      for (let i = 0; i < list.length; i++) setAreaKeepingAspect(model, list[i], area);
      respaceGroups(groups);
      return list.length;
    }
    const text = value == null ? '' : String(value);
    const changed = list.filter((s) => cellOf(sFields(model, s), name) !== text.trim());
    const clearances = groupClearances(model, list);
    for (let i = 0; i < list.length; i++) sFields(model, list[i])[name] = text;
    if (model.columnRoles && [model.columnRoles.countKey, model.columnRoles.moduleWidthKey, model.columnRoles.moduleDepthKey].indexOf(name) >= 0) {
      list.forEach((s) => refit(model, s, false));
      respaceGroups(clearances);
    }
    // A grouping value changed: those rows re-sort into their cluster.
    if (changed.length && name !== model.nameKey) resortRows(model, changed.map((s) => s.rowIndex), name);
    return list.length;
  }

  // A sticky's name is its row's cell in the name column. A sheet with no
  // name-like column gains a 'Name' column on the first rename, as any new
  // field would. Blank is allowed, as in the metadata capsule; a name never
  // moves its row.
  function nameOf(model, sticky) {
    return model.nameKey ? cellOf(sFields(model, sticky), model.nameKey) : '';
  }

  function setName(model, ids, value) {
    if (!model.nameKey) model.nameKey = ensureColumn(model, 'Name');
    return setField(model, ids, model.nameKey, value);
  }

  // A group is rigid, so the solver never separates its own members. Before
  // an area edit, note each member pair's clearance (capped at the buffer);
  // afterwards, members that grew into each other step apart, half each, until
  // every pair has that clearance back. Centres otherwise stay put, so a
  // shrink keeps the layout and just opens the gaps.
  function groupClearances(model, list) {
    const gap = gapOf(model);
    const ids = groupsOf(list);
    const out = [];
    ids.forEach((g) => {
      const members = alive(model).filter((s) => s.group === g);
      const need = [];
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const a = members[i];
          const b = members[j];
          const gx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
          const gy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
          need.push(Math.min(gap, Math.max(0, gx, gy)));
        }
      }
      out.push({ members: members, need: need });
    });
    return out;
  }

  function respaceGroups(groups) {
    for (let g = 0; g < groups.length; g++) {
      const members = groups[g].members;
      const need = groups[g].need;
      for (let pass = 0; pass < 64; pass++) {
        let moved = false;
        let k = 0;
        for (let i = 0; i < members.length; i++) {
          for (let j = i + 1; j < members.length; j++, k++) {
            const push = mtv(members[i], members[j], need[k] - 1e-6);
            if (!push) continue;
            members[i].x -= push.x * 0.5;
            members[i].y -= push.y * 0.5;
            members[j].x += push.x * 0.5;
            members[j].y += push.y * 0.5;
            moved = true;
          }
        }
        if (!moved) break;
      }
    }
  }

  function syncAreas(model) {
    const list = model.stickies.filter(s => model.rows[s.rowIndex] && !model.rows[s.rowIndex].dropped);
    for (let i = 0; i < list.length; i++) writeArea(model, list[i]);
  }

  function exportCsv(model) {
    syncAreas(model);
    const lines = [model.columns.map(csvEscape).join(',')];
    for (let i = 0; i < model.rows.length; i++) {
      const row = model.rows[i];
      if (row.dropped) continue;
      lines.push(model.columns.map((col) => csvEscape(row.fields[col] == null ? '' : row.fields[col])).join(','));
    }
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  function readBookmarks(value) {
    if (!Array.isArray(value)) return [];
    const out = [];
    const ids = new Set();
    // Creation is capped in the UI. Imported snapshots are retained even
    // above that cap, so reopening or renaming never discards saved work.
    for (let i = 0; i < value.length; i++) {
      const entry = value[i];
      try {
        if (!entry || typeof entry.id !== 'string' || typeof entry.name !== 'string' || !entry.state || !entry.state.board) continue;
        const board = entry.state.board;
        if (!Array.isArray(board.columns) || !board.columns.every(key => typeof key === 'string') ||
          !Array.isArray(board.rows) || !Array.isArray(board.stickies) ||
          board.rows.some(row => !row || !row.fields || typeof row.fields !== 'object' || Array.isArray(row.fields))) continue;
        const state = { ...entry.state, board: { ...board } };
        // Strip catalogues before cloning, including legacy root catalogues.
        // A cyclic catalogue cannot recursively grow or invalidate a snapshot.
        delete state.bookmarks;
        delete state.board.bookmarks;
        const base = entry.id.trim().slice(0, 128) || 'bookmark-' + (i + 1);
        let id = base, duplicate = 1;
        while (ids.has(id)) id = base + '-' + (++duplicate);
        const copy = JSON.parse(JSON.stringify({
          id: id,
          name: entry.name.trim().slice(0, 96) || 'Bookmark ' + (i + 1),
          createdAt: typeof entry.createdAt === 'string' && Number.isFinite(Date.parse(entry.createdAt)) ? new Date(entry.createdAt).toISOString() : '',
          state: state,
        }));
        ids.add(id);
        out.push(copy);
      } catch (err) { /* A malformed optional bookmark does not prevent opening a board. */ }
    }
    return out;
  }

  function capture(model) {
    ensureRowIds(model);
    const f = model.frame;
    return {
      version: 5,
      frame: f ? { x: f.x, y: f.y, w: f.w, h: f.h, title: f.title, color: f.color || null } : null,
      fudge: !!model.fudge,
      bufferMul: model.bufferMul,
      blobs: captureBlobs(model.blobs),
      gradients: appearance ? appearance.readGradients(model.gradients) : {},
      lines: (model.lines || []).map(captureLine),
      texts: (model.texts || []).map((t) => writeTextStyle({ id: t.id, x: t.x, y: t.y, text: t.text, size: t.size, w: t.w || 0 }, t)),
      fileName: model.fileName,
      columns: model.columns.slice(),
      nameKey: model.nameKey,
      areaKey: model.areaKey,
      deptKey: model.deptKey,
      groupKey: model.groupKey,
      sfKey: model.sfKey,
      qtyKey: model.qtyKey,
      columnRoles: model.columnRoles ? cleanColumnRoles(model, model.columnRoles) : null,
      bookmarks: readBookmarks(model.bookmarks),
      rows: model.rows.map((row) => ({ id: row.id, fields: Object.assign({}, row.fields), dropped: !!row.dropped })),
      stickies: model.stickies.map((s) => writeTextStyle({
        id: s.id,
        rowIndex: s.rowIndex,
        x: s.x,
        y: s.y,
        w: s.w,
        h: s.h,
        tw: s.tw,
        th: s.th,
        color: s.color || null,
        gradientId: s.gradientId || null,
        height: finite(s.height) && s.height > 0 ? s.height : 8,
        z: nonNeg(s.z),
        material: appearance ? appearance.materialFor(s) : 'matte',
        locked: !!s.locked,
        group: s.group || null,
        radius: s.radius || 0,
        stroke: s.stroke || 0,
        shadow: s.shadow || 0,
      }, s)),
    };
  }

  function nonNeg(value) {
    return finite(value) && value > 0 ? value : 0;
  }

  function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function restore(data) {
    const model = emptyModel(data.fileName);
    model.columns = data.columns.slice();
    model.nameKey = data.nameKey;
    model.areaKey = data.areaKey;
    model.deptKey = data.deptKey;
    model.groupKey = data.groupKey;
    model.sfKey = data.sfKey;
    model.qtyKey = data.qtyKey;
    model.columnRoles = data.columnRoles ? cleanColumnRoles(model, data.columnRoles) : null;
    model.bookmarks = readBookmarks(data.bookmarks);
    if (model.columnRoles) {
      model.areaKey = model.columnRoles.areaKey;
      model.deptKey = model.columnRoles.groupKeys[0] || null;
      model.groupKey = model.columnRoles.groupKeys[1] || null;
    }
    model.rows = data.rows.map((row) => ({ id: row.id, fields: Object.assign({}, row.fields), dropped: !!row.dropped }));
    model.gradients = appearance ? appearance.readGradients(data.gradients) : {};
    // Older layouts may carry fields this board no longer reads (cords, pins,
    // corner notes); only geometry, style, and group survive. Before version
    // 4 the drawn box was the true size.
    const valid = (s) => s && model.rows[s.rowIndex] && finite(s.x) && finite(s.y) &&
      ((s.w > 0 && s.h > 0) || (s.tw === 0 && s.th === 0 && s.w >= 0 && s.h >= 0));
    model.stickies = data.stickies.filter(valid).map((s) => Object.assign({
      id: String(s.id),
      rowIndex: s.rowIndex,
      x: s.x,
      y: s.y,
      w: s.w,
      h: s.h,
      tw: s.tw === 0 && s.th === 0 ? 0 : s.tw > 0 ? s.tw : s.w,
      th: s.tw === 0 && s.th === 0 ? 0 : s.th > 0 ? s.th : s.h,
      color: typeof s.color === 'string' && s.color ? s.color : null,
      gradientId: typeof s.gradientId === 'string' && Object.prototype.hasOwnProperty.call(model.gradients, s.gradientId) ? s.gradientId : null,
      height: finite(s.height) && s.height > 0 ? s.height : 8,
      z: nonNeg(s.z),
      material: appearance ? appearance.materialFor(s) : 'matte',
      locked: !!s.locked,
      dragging: false,
      dragTarget: null,
      group: typeof s.group === 'string' && s.group ? s.group : null,
      radius: nonNeg(s.radius),
      stroke: nonNeg(s.stroke),
      shadow: nonNeg(s.shadow),
      passId: null,
    }, readTextStyle(s)));
    model.fudge = !!data.fudge;
    model.bufferMul = finite(data.bufferMul) && data.bufferMul >= 0 ? Math.round(data.bufferMul) : 1;
    model.blobs = readBlobs(data.blobs);
    const point = (p) => Array.isArray(p) && finite(p[0]) && finite(p[1]);
    model.lines = (Array.isArray(data.lines) ? data.lines : [])
      .filter((l) => l && Array.isArray(l.points) && l.points.length >= 2 && l.points.every(point))
      .map((l) => {
        const line = {
          id: String(l.id),
          points: l.points.map((p) => [p[0], p[1]]),
          width: Math.min(LINE_MAX, Math.max(LINE_MIN, finite(l.width) ? l.width : 2)),
        };
        setLineStyle([line], 'color', l.color);
        setLineStyle([line], 'start', l.start);
        setLineStyle([line], 'end', l.end);
        return line;
      });
    model.texts = (Array.isArray(data.texts) ? data.texts : [])
      .filter((t) => t && finite(t.x) && finite(t.y) && typeof t.text === 'string' && t.text)
      .map((t) => {
        const style = readTextStyle(t);
        return { id: String(t.id), x: t.x, y: t.y, text: t.text, size: t.size > 0 ? t.size : TEXT_SIZE, w: nonNeg(t.w), textFace: style.textFace, textColor: style.textColor };
      });
    model.lineGen += 1;
    const f = data.frame;
    model.frame = f && finite(f.x) && finite(f.y) && f.w > 0 && f.h > 0
      ? {
        x: f.x,
        y: f.y,
        w: f.w,
        h: f.h,
        title: typeof f.title === 'string' ? f.title : frameTitleFor(model.fileName),
        color: typeof f.color === 'string' && /^#[0-9a-f]{6}$/i.test(f.color) ? f.color.toLowerCase() : null,
      }
      : null;
    // Ids are one prefix letter plus base-36 digits, and digits can be letters.
    let maxSeq = seq;
    const bump = (id) => {
      const n = parseInt(String(id || '').slice(1), 36);
      if (Number.isFinite(n)) maxSeq = Math.max(maxSeq, n);
    };
    model.stickies.forEach((s) => {
      bump(s.id);
      if (s.group) bump(s.group);
    });
    model.lines.forEach((l) => bump(l.id));
    model.texts.forEach((t) => bump(t.id));
    ensureRowIds(model);
    model.rows.forEach((row) => { if (/^r[0-9a-z]+$/i.test(row.id)) bump(row.id); });
    seq = maxSeq;
    return model;
  }

  const LAYOUT_KIND = 'program-board-layout';

  // A saved layout: the board (frame, stickies, groups, rows) plus the view
  // settings that make it look the same when opened again.
  function packLayout(model, view, camera) {
    const v = view || {};
    const out = {
      kind: LAYOUT_KIND,
      version: 2,
      savedAt: new Date().toISOString(),
      board: capture(model),
      view: {
        face: v.face,
        background: v.background,
        grid: !!v.grid,
        gridStep: v.gridStep,
        lineWidth: v.lineWidth,
        textScale: v.textScale,
        textColor: v.textColor,
        custom: v.custom,
        mode: v.mode,
        isoDirection: v.isoDirection,
        isoCamera: v.isoCamera,
        leaderThreshold: v.leaderThreshold,
        pack: v.pack == null ? undefined : JSON.parse(JSON.stringify(v.pack)),
      },
    };
    if (camera) out.camera = { x: camera.x, y: camera.y, z: camera.z };
    return out;
  }

  function unpackLayout(data) {
    const obj = typeof data === 'string' ? JSON.parse(data) : data;
    if (!obj || obj.kind !== LAYOUT_KIND || !obj.board || !Array.isArray(obj.board.stickies) || !Array.isArray(obj.board.rows)) {
      throw new Error('That file is not a program board layout.');
    }
    const model = restore(obj.board);
    if (!model.rows.length) throw new Error('That layout has no program rows.');
    if (!model.frame && alive(model).length) frameAround(model);
    const cam = obj.camera;
    return {
      model: model,
      view: obj.view && typeof obj.view === 'object' ? obj.view : {},
      camera: cam && finite(cam.x) && finite(cam.y) && cam.z > 0 ? { x: cam.x, y: cam.y, z: cam.z } : null,
    };
  }

  // ------------------------------------------------------------ save files
  // Save writes one zip: <base>.csv (the same bytes as Export CSV, the data
  // authority), <base>.layout.json (geometry, style, view, camera), and
  // manifest.json (app, time, file names, SHA-256 of the CSV bytes).

  const SAVE_KIND = 'program-board-save';

  function baseName(fileName) {
    return String(fileName || 'program').replace(/(\.layout)?\.(csv|xlsx|xlsm|json|zip)$/i, '') || 'program';
  }

  // Resolves to { name, bytes, layoutText }. Areas are synced into the rows
  // by exportCsv before the layout is captured, so the two agree.
  async function buildSave(model, view, camera, meta) {
    const m = meta || {};
    const base = baseName(model.fileName);
    const csvBytes = new TextEncoder().encode(exportCsv(model));
    const layout = packLayout(model, view, camera);
    const layoutText = JSON.stringify(layout, null, 1);
    const manifest = {
      kind: SAVE_KIND,
      version: 1,
      app: m.app || '',
      savedAt: layout.savedAt,
      csv: base + '.csv',
      layout: base + '.layout.json',
      csvSha256: sha256Hex(csvBytes),
    };
    const bytes = await zip([
      { name: manifest.csv, data: csvBytes },
      { name: manifest.layout, data: layoutText },
      { name: 'manifest.json', data: JSON.stringify(manifest, null, 1) },
    ], { date: m.date, store: m.store });
    return { name: base + '.zip', bytes: bytes, layoutText: layoutText };
  }

  // The parts openSave takes, from a saved zip. A zip without a manifest
  // still opens if it holds a sheet and/or a layout.
  async function readSaveZip(buffer) {
    const files = await unzip(buffer, 'a zip archive');
    const names = Object.keys(files).filter((n) => !/\/$/.test(n) && !/(^|\/)__MACOSX\//.test(n));
    const tail = (n) => n.split('/').pop();
    let manifest = null;
    const mName = names.find((n) => tail(n).toLowerCase() === 'manifest.json');
    if (mName) {
      try {
        manifest = JSON.parse(new TextDecoder().decode(files[mName]));
      } catch (err) {
        manifest = null;
      }
    }
    const pick = (want, re) => (want && files[want] ? want : names.find((n) => re.test(n) && n !== mName));
    const csvName = pick(manifest && manifest.csv, /\.csv$/i);
    const xlsxName = csvName ? null : names.find((n) => /\.xlsx?m?$/i.test(n));
    const layoutName = pick(manifest && manifest.layout, /\.json$/i);
    const parts = { manifest: manifest };
    if (csvName) {
      parts.csvBytes = files[csvName];
      parts.csvText = new TextDecoder().decode(files[csvName]);
      parts.csvName = tail(csvName);
    } else if (xlsxName) {
      const bytes = files[xlsxName];
      parts.matrix = await xlsxToMatrix(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
      parts.csvName = tail(xlsxName);
    }
    if (layoutName) parts.layout = new TextDecoder().decode(files[layoutName]);
    if (!csvName && !xlsxName && !layoutName) throw new Error('That zip holds no spreadsheet and no layout.');
    return parts;
  }

  // parts: { csvText | matrix, csvName, csvBytes?, layout (text or object)?,
  // manifest? }. Returns { model, view, camera, summary }, summary being
  // { restored, added, removed, resized, exact }. The sheet alone packs a
  // fresh board; the layout alone carries its own rows. Together, the
  // sheet is the data and the layout the geometry and style: when the
  // manifest's hash matches the CSV bytes, or the rows are unchanged, the
  // layout restores exactly; otherwise the rows are matched (mergeSheet).
  function openSave(parts) {
    let layout = parts.layout;
    if (typeof layout === 'string') {
      try {
        layout = JSON.parse(layout);
      } catch (err) {
        throw new Error('That layout is not valid JSON.');
      }
    }
    const hasSheet = parts.csvText != null || !!parts.matrix;
    if (!layout && !hasSheet) throw new Error('Nothing to open.');
    const summary = (restored, added, removed, resized, exact) => ({ restored: restored, added: added, removed: removed, resized: resized, exact: exact });
    if (!hasSheet) {
      const u = unpackLayout(layout);
      return { model: u.model, view: u.view, camera: u.camera, summary: summary(alive(u.model).length, 0, 0, 0, true) };
    }
    const sheet = parts.matrix ? modelFromMatrix(parts.matrix, parts.csvName) : modelFromCsv(parts.csvText, parts.csvName);
    if (!layout) {
      pack(sheet);
      return { model: sheet, view: null, camera: null, summary: summary(0, alive(sheet).length, 0, 0, false) };
    }
    const u = unpackLayout(layout);
    if (u.model.columnRoles) {
      const roles = cleanColumnRoles(sheet, u.model.columnRoles);
      if (!roles.areaKey) roles.areaKey = sheet.areaKey;
      setColumnRoles(sheet, roles);
    }
    const hashed = !!(parts.manifest && parts.csvBytes && parts.manifest.csvSha256 === sha256Hex(parts.csvBytes));
    if (hashed || sameRows(sheet, u.model)) {
      return { model: u.model, view: u.view, camera: u.camera, summary: summary(alive(u.model).length, 0, 0, 0, true) };
    }
    const step = Number(u.view.gridStep) > 0 ? Number(u.view.gridStep) : 10;
    const merged = mergeSheet(sheet, u.model, u.model.bufferMul * step);
    merged.model.fileName = parts.csvName || sheet.fileName;
    return { model: merged.model, view: u.view, camera: u.camera, summary: merged.summary };
  }

  // The sheet's rows are exactly the layout's live rows, in order.
  function sameRows(sheet, board) {
    if (sheet.columns.join('\u001f') !== board.columns.join('\u001f')) return false;
    const rows = board.rows.filter((r) => !r.dropped);
    if (rows.length !== sheet.rows.length) return false;
    for (let i = 0; i < rows.length; i++) {
      for (let c = 0; c < sheet.columns.length; c++) {
        const col = sheet.columns[c];
        if (String(sheet.rows[i].fields[col] == null ? '' : sheet.rows[i].fields[col]) !== String(rows[i].fields[col] == null ? '' : rows[i].fields[col])) return false;
      }
    }
    return true;
  }

  // Matches each sheet row to a live layout row: first by an exact
  // fingerprint of every cell, then by (name, department, group), then by
  // the same position among live rows; each pass takes unmatched rows in
  // order, so ties resolve first-come. A matched sticky keeps its id,
  // place, and style and takes the sheet's values; a changed area resizes
  // it about its centre at its aspect. Sheet rows with no match become new
  // stickies placed in free room inside the frame; layout stickies whose
  // rows are gone (or now have no area) are dropped. Lines, text, the
  // frame, groups, and settings come from the layout.
  function mergeSheet(sheet, lay, gap) {
    ensureRowIds(lay);
    ensureRowIds(sheet);
    const cols = sheet.columns;
    const cell = (fields, k) => (k && fields[k] != null ? String(fields[k]) : '');
    const exactKey = (fields) => cols.map((c) => cell(fields, c)).join('\u001f');
    const idKey = (m, fields) => [m.nameKey, m.deptKey, m.groupKey].map((k) => cell(fields, k).trim().toLowerCase()).join('\u001f');
    const live = [];
    lay.rows.forEach((r, j) => {
      if (!r.dropped) live.push(j);
    });
    const n = sheet.rows.length;
    const match = new Array(n).fill(-1);
    const used = new Set();
    const pass = (sheetKey, layKey) => {
      const queues = new Map();
      live.forEach((j) => {
        if (used.has(j)) return;
        const k = layKey(lay.rows[j].fields);
        if (!queues.has(k)) queues.set(k, []);
        queues.get(k).push(j);
      });
      for (let i = 0; i < n; i++) {
        if (match[i] >= 0) continue;
        const q = queues.get(sheetKey(sheet.rows[i].fields));
        while (q && q.length) {
          const j = q.shift();
          if (used.has(j)) continue;
          match[i] = j;
          used.add(j);
          break;
        }
      }
    };
    pass(exactKey, exactKey);
    pass((f) => idKey(sheet, f), (f) => idKey(lay, f));
    for (let i = 0; i < n && i < live.length; i++) {
      if (match[i] < 0 && !used.has(live[i])) {
        match[i] = live[i];
        used.add(live[i]);
      }
    }
    const rowIds = new Set(lay.rows.map((row) => row.id));
    match.forEach((oldIndex, index) => {
      if (oldIndex >= 0) sheet.rows[index].id = lay.rows[oldIndex].id;
      else {
        // The CSV was parsed before the layout raised the id counter. Keep
        // its fresh identity unless it collides with a saved row identity.
        while (rowIds.has(sheet.rows[index].id)) sheet.rows[index].id = uid('r');
        rowIds.add(sheet.rows[index].id);
      }
    });
    const sheetSticky = new Map();
    sheet.stickies.forEach((s) => sheetSticky.set(s.rowIndex, s));
    const toSheet = new Map();
    match.forEach((j, i) => {
      if (j >= 0) toSheet.set(j, i);
    });
    const kept = [];
    const claimed = new Set();
    let removed = 0;
    let resized = 0;
    lay.stickies.forEach((s) => {
      if (!active(lay, s)) return;
      const i = toSheet.get(s.rowIndex);
      const src = i === undefined ? null : sheetSticky.get(i);
      if (!src) {
        removed += 1;
        return;
      }
      claimed.add(i);
      s.rowIndex = i;
      const area = src.tw * src.th;
      if (Math.abs(area - s.tw * s.th) > 0.5) {
        const aspect = s.tw / s.th;
        s.th = Math.sqrt(area / aspect);
        s.tw = area / s.th;
        refit({ cell: 0 }, s, true);
        resized += 1;
      }
      kept.push(s);
    });
    const fresh = sheet.stickies.filter((s) => !claimed.has(s.rowIndex));
    // The sheet's ids were minted before the layout raised the counter.
    fresh.forEach((s) => { s.id = uid('s'); });
    lay.columns = cols.slice();
    lay.nameKey = sheet.nameKey;
    lay.areaKey = sheet.areaKey;
    lay.deptKey = sheet.deptKey;
    lay.groupKey = sheet.groupKey;
    lay.sfKey = sheet.sfKey;
    lay.qtyKey = sheet.qtyKey;
    lay.columnRoles = sheet.columnRoles ? cleanColumnRoles(sheet, sheet.columnRoles) : null;
    lay.rows = sheet.rows;
    lay.stickies = kept;
    kept.forEach((s) => refit(lay, s, false));
    fresh.forEach((s) => refit(lay, s, false));
    placeFresh(lay, fresh, gap);
    lay.stickies = kept.concat(fresh);
    return { model: lay, summary: { restored: kept.length, added: fresh.length, removed: removed, resized: resized, exact: false } };
  }

  // New stickies go into free room inside the frame walls, one buffer from
  // everything, nearest their department's other stickies (else the frame
  // centre), largest first. With no room left, the frame grows to the right.
  function placeFresh(model, fresh, gap) {
    if (!fresh.length) return;
    const g = gap >= 0 ? gap : CONTACT_GAP;
    const blocked = model.stickies.map((s) => ({ x: s.x - g, y: s.y - g, w: s.w + 2 * g, h: s.h + 2 * g }));
    const dept = (s) => (model.deptKey ? String(model.rows[s.rowIndex].fields[model.deptKey] || '') : '');
    const f = model.frame;
    const order = fresh.slice().sort((a, b) => b.w * b.h - a.w * a.h);
    for (let k = 0; k < order.length; k++) {
      const n = order[k];
      const wall = frameInner(f, g);
      const mates = model.stickies.filter((s) => dept(s) === dept(n));
      const aim = mates.length ? boundsOf(mates) : { x: f.x, y: f.y, w: f.w, h: f.h };
      const ax = aim.x + aim.w * 0.5;
      const ay = aim.y + aim.h * 0.5;
      const fits = (x, y) => x >= wall.x0 - 1e-9 && y >= wall.y0 - 1e-9 && x + n.w <= wall.x1 + 1e-9 && y + n.h <= wall.y1 + 1e-9 && !rectHits(x, y, n.w, n.h, blocked);
      let best = null;
      const consider = (x, y) => {
        if (!fits(x, y)) return;
        const d = (x + n.w * 0.5 - ax) * (x + n.w * 0.5 - ax) + (y + n.h * 0.5 - ay) * (y + n.h * 0.5 - ay);
        if (!best || d < best.d) best = { x: x, y: y, d: d };
      };
      for (let i = 0; i < blocked.length; i++) {
        const p = blocked[i];
        consider(p.x + p.w, p.y + g);
        consider(p.x + g, p.y + p.h);
        consider(p.x - n.w, p.y + g);
        consider(p.x + g, p.y - n.h);
        consider(p.x + p.w, p.y + p.h - g - n.h);
        consider(p.x + p.w - g - n.w, p.y + p.h);
      }
      consider(wall.x0, wall.y0);
      consider(wall.x1 - n.w, wall.y0);
      consider(wall.x0, wall.y1 - n.h);
      consider(wall.x1 - n.w, wall.y1 - n.h);
      if (!best) {
        const stepX = Math.max(1, g, Math.min(n.w, n.h) * 0.5);
        for (let y = wall.y0; y + n.h <= wall.y1; y += stepX) {
          for (let x = wall.x0; x + n.w <= wall.x1; x += stepX) consider(x, y);
        }
      }
      if (!best) {
        const x = f.x + f.w;
        best = { x: x, y: wall.y0 };
        f.w += n.w + g;
        if (n.h > wall.y1 - wall.y0) f.h = n.h + 2 * g;
      }
      n.x = best.x;
      n.y = best.y;
      blocked.push({ x: n.x - g, y: n.y - g, w: n.w + 2 * g, h: n.h + 2 * g });
      model.stickies.push(n);
    }
    model.stickies.length -= order.length;
  }

  // ----------------------------------------------------------------- labels
  // A sticky's label is fitted once, in world feet, to that sticky alone.
  // Type follows the width: the name is sized at NAME of the sticky's width
  // and wraps into as many lines as the inset box holds at that size, so a
  // wide sticky gets big type and a tall, narrow one wraps into more lines.
  // Height limits the size only when the block cannot fit (a short, wide
  // sticky). The whole block stays inside the inset box at every zoom.
  // Screen size is then world size times zoom, with no floor and no ceiling.
  //
  // `measure(text)` returns the width of `text` at LABEL.REF px. PAD is a
  // fraction of the shorter side; NAME is the name size as a fraction of
  // the width; AREA, LEAD and GAP are fractions of the name size. A name may
  // take MAX_LINES lines, or more when the height holds them at full size.
  // The area line shows only when adding it keeps the name at KEEP_AREA of
  // its size without it.

  const LABEL = { REF: 100, PAD: 0.08, NAME: 0.13, AREA: 0.7, LEAD: 1.2, GAP: 0.28, MAX_LINES: 4, KEEP_AREA: 0.75 };
  const WRAP_STEPS = [1, 1.25, 1.6, 2, 2.5, 3.2, 4, 5, 6.5, 8];

  function wrapWords(words, widths, space, limit) {
    const lines = [];
    let line = '';
    let lineW = 0;
    let widest = 0;
    for (let i = 0; i < words.length; i++) {
      if (line && lineW + space + widths[i] > limit) {
        lines.push(line);
        widest = Math.max(widest, lineW);
        line = words[i];
        lineW = widths[i];
      } else if (line) {
        line += ' ' + words[i];
        lineW += space + widths[i];
      } else {
        line = words[i];
        lineW = widths[i];
      }
    }
    if (line) {
      lines.push(line);
      widest = Math.max(widest, lineW);
    }
    return { lines: lines, widest: widest };
  }

  // Returns { lines, f, area, lineH, y0, areaY } with f the name size and
  // y0 / areaY the first line's and the area line's centres, all in feet and
  // measured from the sticky's centre. An empty name yields no lines.
  // `scale` (default 1) multiplies the width-first size, the cap the name
  // wraps and grows toward; the block still never leaves the inset box.
  function fitLabel(name, areaText, w, h, measure, scale) {
    const out = { lines: [], f: 0, area: false, lineH: 0, y0: 0, areaY: 0 };
    const m = Math.min(w, h);
    const pad = LABEL.PAD * m;
    const innerW = w - 2 * pad;
    const innerH = h - 2 * pad;
    const words = String(name || '').split(/\s+/).filter(Boolean);
    if (!words.length || !(innerW > 0) || !(innerH > 0)) return out;
    const widths = words.map(measure);
    const space = measure(' ');
    const k = scale > 0 ? scale : 1;
    const cap = LABEL.NAME * w * k;
    const maxLines = labelLines(w, h, k);
    // Try wrap widths from the capped size outward and keep the one that
    // lets the name be largest; ties keep fewer lines.
    const base = (innerW / cap) * LABEL.REF;
    let best = null;
    for (let i = 0; i < WRAP_STEPS.length; i++) {
      const lay = wrapWords(words, widths, space, base * WRAP_STEPS[i]);
      const n = lay.lines.length;
      if (n > maxLines && i < WRAP_STEPS.length - 1) continue;
      const f = Math.min(cap, (innerW * LABEL.REF) / lay.widest, innerH / (n * LABEL.LEAD));
      if (!best || f > best.f * 1.0001 || (f > best.f * 0.9999 && n < best.lines.length)) best = { lines: lay.lines, f: f };
      if (n === 1) break;
    }
    // Kerning makes a joined line differ slightly from its summed words.
    let widest = 0;
    for (let i = 0; i < best.lines.length; i++) widest = Math.max(widest, measure(best.lines[i]));
    const n = best.lines.length;
    let f = Math.min(best.f, (innerW * LABEL.REF) / widest);
    let withArea = Math.min(f, innerH / (n * LABEL.LEAD + LABEL.GAP + LABEL.AREA * LABEL.LEAD));
    const areaW = areaText ? measure(areaText) : 0;
    if (areaW > 0) withArea = Math.min(withArea, (innerW * LABEL.REF) / (areaW * LABEL.AREA));
    out.area = areaW > 0 && withArea >= f * LABEL.KEEP_AREA;
    if (out.area) f = withArea;
    const block = (n * LABEL.LEAD + (out.area ? LABEL.GAP + LABEL.AREA * LABEL.LEAD : 0)) * f;
    out.lines = best.lines;
    out.f = f;
    out.lineH = LABEL.LEAD * f;
    out.y0 = -block * 0.5 + out.lineH * 0.5;
    out.areaY = -block * 0.5 + (n * LABEL.LEAD + LABEL.GAP) * f + LABEL.AREA * LABEL.LEAD * f * 0.5;
    return out;
  }

  // Lines a name may wrap into on a w x h sticky.
  function labelLines(w, h, scale) {
    const innerH = h - 2 * LABEL.PAD * Math.min(w, h);
    return Math.max(LABEL.MAX_LINES, Math.floor(innerH / (LABEL.NAME * w * (scale > 0 ? scale : 1) * LABEL.LEAD)));
  }

  // ------------------------------------------------------------ text style
  // A sticky's label, or a text block, may carry its own type: textFace
  // (a face key), textScale (stickies: a multiplier on the width-first
  // fit), and textColor (a hex ink). Each one set overrides the board's
  // setting for that item alone (the board's typeface, size, and ink, which
  // default to Standard, 100%, and ink that follows the fill); null means
  // the board's. Saved only when
  // set, so older files load unchanged.

  const TEXT_FACES = ['std', 'mono', 'sans'];
  const TEXT_SCALE = { MIN: 0.5, MAX: 2 };

  function textFaceOr(value) {
    return TEXT_FACES.indexOf(value) >= 0 ? value : null;
  }

  // A sticky's own 1 is a real override once the board's size is not 1.
  function textScaleOr(value) {
    if (!finite(value) || !(value > 0)) return null;
    return Math.min(TEXT_SCALE.MAX, Math.max(TEXT_SCALE.MIN, value));
  }

  function readTextStyle(src) {
    const s = src || {};
    return { textFace: textFaceOr(s.textFace), textScale: textScaleOr(s.textScale), textColor: hexOr(s.textColor, null) };
  }

  function writeTextStyle(out, item) {
    const style = readTextStyle(item);
    if (style.textFace) out.textFace = style.textFace;
    if (style.textScale) out.textScale = style.textScale;
    if (style.textColor) out.textColor = style.textColor;
    return out;
  }

  // What an item draws with: its own setting where it has one, else the
  // board's defaults (`board.face`, `board.textScale`, `board.textColor`).
  // color null means ink that follows the fill.
  function textStyleOf(item, board) {
    const own = readTextStyle(item);
    const b = board || {};
    return {
      face: own.textFace || textFaceOr(b.face) || TEXT_FACES[0],
      scale: own.textScale || textScaleOr(b.textScale) || 1,
      color: own.textColor || hexOr(b.textColor, null),
    };
  }

  // prop 'face' | 'scale' | 'color'; null returns each item to the board's
  // setting. Returns how many items changed.
  function setTextStyle(items, prop, value) {
    const field = { face: 'textFace', scale: 'textScale', color: 'textColor' }[prop];
    if (!field) return 0;
    const clean = readTextStyle({ [field]: value })[field];
    let changed = 0;
    for (let i = 0; i < items.length; i++) {
      if ((items[i][field] || null) === clean) continue;
      items[i][field] = clean;
      changed += 1;
    }
    return changed;
  }

  function summarize(model) {
    const list = alive(model);
    const drawn = new Set(list.map((s) => s.rowIndex));
    let omitted = 0;
    for (let i = 0; i < model.rows.length; i++) {
      if (!model.rows[i].dropped && !drawn.has(i)) omitted += 1;
    }
    const area = list.reduce((sum, s) => sum + trueArea(s), 0);
    return {
      stickies: list.length,
      rows: model.rows.filter((r) => !r.dropped).length,
      omitted: omitted,
      area: area,
      bounds: boundsOf(list),
    };
  }

  function decodeXml(value) {
    return String(value)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&amp;/g, '&');
  }

  async function inflate(method, comp) {
    if (method === 0) return comp;
    if (method !== 8) throw new Error('That file uses a zip method this page cannot read. Save the sheet as CSV.');
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('This browser cannot unzip that file. Save the sheet as CSV.');
    }
    const stream = new Blob([comp]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(buffer, what) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('That file is not ' + (what || 'an Excel workbook') + '.');
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const files = {};
    for (let n = 0; n < count; n++) {
      if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Could not read that workbook.');
      const method = view.getUint16(p + 10, true);
      const compSize = view.getUint32(p + 20, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const localOff = view.getUint32(p + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
      const localNameLen = view.getUint16(localOff + 26, true);
      const localExtraLen = view.getUint16(localOff + 28, true);
      const dataOff = localOff + 30 + localNameLen + localExtraLen;
      files[name] = await inflate(method, bytes.subarray(dataOff, dataOff + compSize));
      p += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }

  // -------------------------------------------------------------- zip write
  // A plain PKZIP archive: one local header and one central record per
  // entry, no data descriptors, no zip64, UTF-8 names. Each entry is
  // DEFLATEd through CompressionStream when the browser has it and that is
  // smaller; otherwise it is STOREd.

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  async function deflateRaw(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (err) {
      return null;
    }
  }

  // entries: [{ name, data: string | Uint8Array }]; opts.store skips DEFLATE,
  // opts.date stamps the entries (default now). Resolves to the archive.
  async function zip(entries, opts) {
    const o = opts || {};
    const when = o.date || new Date();
    const time = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
    const date = ((Math.max(1980, when.getFullYear()) - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
    const enc = new TextEncoder();
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (let i = 0; i < entries.length; i++) {
      const data = typeof entries[i].data === 'string' ? enc.encode(entries[i].data) : entries[i].data;
      const name = enc.encode(entries[i].name);
      const crc = crc32(data);
      let method = 0;
      let body = data;
      if (!o.store) {
        const packed = await deflateRaw(data);
        if (packed && packed.length < data.length) {
          method = 8;
          body = packed;
        }
      }
      const local = new Uint8Array(30 + name.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, method, true);
      lv.setUint16(10, time, true);
      lv.setUint16(12, date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, body.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      local.set(name, 30);
      const central = new Uint8Array(46 + name.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, method, true);
      cv.setUint16(12, time, true);
      cv.setUint16(14, date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, body.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      central.set(name, 46);
      locals.push(local, body);
      centrals.push(central);
      offset += local.length + body.length;
    }
    const cdSize = centrals.reduce((n, c) => n + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    const out = new Uint8Array(offset + cdSize + 22);
    let p = 0;
    locals.concat(centrals, [end]).forEach((part) => {
      out.set(part, p);
      p += part.length;
    });
    return out;
  }

  // SHA-256, hex. Pure so it also works where crypto.subtle is withheld
  // (plain http, some file:// hosts) and in node.
  const SHA_K = (() => {
    const k = new Uint32Array(64);
    let n = 0;
    for (let c = 2; n < 64; c++) {
      let prime = true;
      for (let d = 2; d * d <= c; d++) if (c % d === 0) prime = false;
      if (prime) k[n++] = Math.floor((Math.cbrt(c) % 1) * 4294967296) >>> 0;
    }
    return k;
  })();

  function sha256Hex(bytes) {
    const len = bytes.length;
    const total = ((len + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(total);
    buf.set(bytes);
    buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, Math.floor(len / 0x20000000));
    dv.setUint32(total - 4, (len * 8) >>> 0);
    const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const w = new Uint32Array(64);
    const rotr = (x, r) => (x >>> r) | (x << (32 - r));
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const a = w[i - 15];
        const b = w[i - 2];
        w[i] = (w[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) | 0;
      }
      let a = h[0];
      let b = h[1];
      let c = h[2];
      let d = h[3];
      let e = h[4];
      let f = h[5];
      let g = h[6];
      let k = h[7];
      for (let i = 0; i < 64; i++) {
        const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA_K[i] + w[i]) | 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        k = g;
        g = f;
        f = e;
        e = (d + t1) | 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0;
      h[1] = (h[1] + b) | 0;
      h[2] = (h[2] + c) | 0;
      h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0;
      h[5] = (h[5] + f) | 0;
      h[6] = (h[6] + g) | 0;
      h[7] = (h[7] + k) | 0;
    }
    return h.map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
  }

  function parseSharedStrings(xml) {
    const out = [];
    const parts = xml.split(/<si\b[^>]*>/i).slice(1);
    for (let i = 0; i < parts.length; i++) {
      const body = parts[i].split(/<\/si>/i)[0];
      const texts = [];
      const re = /<t\b[^>]*>([\s\S]*?)<\/t>/gi;
      let m;
      while ((m = re.exec(body))) texts.push(decodeXml(m[1]));
      out.push(texts.join(''));
    }
    return out;
  }

  function colIndex(letters) {
    let n = 0;
    const src = letters.toUpperCase();
    for (let i = 0; i < src.length; i++) n = n * 26 + (src.charCodeAt(i) - 64);
    return n - 1;
  }

  function parseSheet(xml, strings) {
    const rows = [];
    const parts = xml.split(/<row\b[^>]*>/i).slice(1);
    for (let r = 0; r < parts.length; r++) {
      const body = parts[r].split(/<\/row>/i)[0];
      const row = [];
      const re = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi;
      let m;
      while ((m = re.exec(body))) {
        const attrs = m[1];
        const inner = m[2] || '';
        const ref = /r="([A-Z]+)\d+"/i.exec(attrs);
        const col = ref ? colIndex(ref[1]) : row.length;
        const typeMatch = /t="([^"]+)"/.exec(attrs);
        const type = typeMatch ? typeMatch[1] : '';
        let value = '';
        if (type === 's') {
          const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
          value = v ? strings[Number(v[1])] || '' : '';
        } else if (type === 'inlineStr') {
          const texts = [];
          const tre = /<t\b[^>]*>([\s\S]*?)<\/t>/gi;
          let tm;
          while ((tm = tre.exec(inner))) texts.push(decodeXml(tm[1]));
          value = texts.join('');
        } else {
          const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
          value = v ? decodeXml(v[1]) : '';
        }
        row[col] = value;
      }
      for (let c = 0; c < row.length; c++) if (row[c] == null) row[c] = '';
      rows.push(row);
    }
    return rows;
  }

  async function xlsxToMatrix(buffer) {
    const files = await unzip(buffer);
    const decoder = new TextDecoder();
    const sharedFile = files['xl/sharedStrings.xml'];
    const strings = sharedFile ? parseSharedStrings(decoder.decode(sharedFile)) : [];
    let sheetName = 'xl/worksheets/sheet1.xml';
    if (!files[sheetName]) {
      sheetName = Object.keys(files).find((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name));
    }
    if (!sheetName || !files[sheetName]) throw new Error('No worksheet in that workbook.');
    return parseSheet(decoder.decode(files[sheetName]), strings);
  }

  async function modelFromXlsx(buffer, fileName) {
    return modelFromMatrix(await xlsxToMatrix(buffer), fileName);
  }

  function selfTest(csvText) {
    const errors = [];
    const model = modelFromCsv(csvText, 'sample.csv');
    const expect = model.rows.reduce((sum, row, index) => {
      const drawn = model.stickies.some((s) => s.rowIndex === index);
      return drawn ? sum + num(row.fields[model.areaKey]) : sum;
    }, 0);
    const got = alive(model).reduce((sum, s) => sum + trueArea(s), 0);
    if (Math.abs(got - expect) > 0.01) errors.push('area sum ' + got + ' != ' + expect);
    const quoted = model.rows.some((row) => String(row.fields.Notes || '').indexOf('1,500') >= 0);
    if (!quoted) errors.push('quoted comma did not survive parsing');
    pack(model);
    const list = alive(model);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (mtv(list[i], list[j], 0)) errors.push('pack overlap ' + i + ' ' + j);
      }
    }
    if (errors.length > 2) return errors;
    const out = exportCsv(model);
    const again = modelFromCsv(out, 'clone.csv');
    if (again.stickies.length !== model.stickies.length) {
      errors.push('export roundtrip ' + again.stickies.length + ' != ' + model.stickies.length);
    }
    testSeparation(errors);
    testGroupApi(errors);
    testGroupPush(errors);
    testGroupCollision(errors);
    testBundle(csvText, errors);
    testBundleCalm(errors);
    testSnap(errors);
    testLabels(errors);
    testTextStyle(errors);
    testLineEnds(errors);
    testBlobPick(errors);
    testAlign(errors);
    testFrame(csvText, errors);
    testLayout(csvText, errors);
    testRoundtrip(errors);
    testFields(errors);
    testFudge(csvText, errors);
    testStretch(errors);
    testBuffer(errors);
    testLines(errors);
    testLineRadius(errors);
    testLineHerd(errors);
    testDragModes(errors);
    testDuplicate(errors);
    testAreaEach(errors);
    testCad(errors);
    return errors;
  }

  function testFudge(csvText, errors) {
    // The chosen cells are the nearest product of any floor/ceil pair.
    const cases = [[33, 47], [12, 12], [5, 90], [71.3, 18.2], [4, 4], [100, 3]];
    for (let i = 0; i < cases.length; i++) {
      const tw = cases[i][0];
      const th = cases[i][1];
      const c = fudgeCells(tw, th, 10);
      const err = Math.abs(c[0] * c[1] * 100 - tw * th);
      for (let nx = 1; nx <= 12; nx++) {
        if (nx !== Math.max(1, Math.floor(tw / 10)) && nx !== Math.max(1, Math.ceil(tw / 10))) continue;
        for (let ny = 1; ny <= 40; ny++) {
          if (Math.abs(nx * ny * 100 - tw * th) < err - 1e-9) errors.push('fudge ' + tw + 'x' + th + ' missed ' + nx + 'x' + ny);
        }
      }
    }
    const m = framedSample(csvText);
    const truth = alive(m).map((s) => [s.tw, s.th, fieldText(m, s, m.areaKey)]);
    setParams(m, 10, 10);
    if (alive(m).some((s) => Math.abs(s.w / 10 - Math.round(s.w / 10)) > 1e-9 || Math.abs(s.x / 10 - Math.round(s.x / 10)) > 1e-9)) errors.push('fudge left a side or corner off the cells');
    if (alive(m).some((s, i) => fieldText(m, s, m.areaKey) !== truth[i][2])) errors.push('fudge changed an area field');
    const rest = settleNow(m, [], {});
    if (rest.jam || !atRest(m)) errors.push('the fudged board did not come to rest: ' + JSON.stringify(rest.jam));
    if (alive(m).some((s) => Math.abs(s.x / 10 - Math.round(s.x / 10)) > 1e-9 || Math.abs(s.y / 10 - Math.round(s.y / 10)) > 1e-9)) errors.push('snap left a corner off the grid');
    // A pair a hair under the buffer apart (legal at rest) that plain
    // rounding would collapse: 5.01 -> 10 and 34.97 -> 30 leaves no gap.
    const pair = tinyModel([[5.01, 0, 20, 20], [34.97, 0, 20, 20]]);
    setParams(pair, 10, 0, 10);
    pair.cell = 10;
    snapToCells(pair, 10);
    const ps = pair.stickies;
    if (ps[0].x !== 0 || ps[1].x !== 30) errors.push('safe snap chose ' + ps[0].x + ', ' + ps[1].x + ' (want 0, 30)');
    if (crowdedAny(pair)) errors.push('snapping to cells crowded a legal pair');
    setParams(m, 10, 0);
    if (alive(m).some((s, i) => s.w !== truth[i][0] || s.h !== truth[i][1])) errors.push('unfudging did not restore the true size exactly');
  }

  function testStretch(errors) {
    const o = { x: 0, y: 0, w: 20, h: 20, tw: 20, th: 20 };
    const e = stretchBox(o, 'e', 40, 999);
    if (!near(e.w, 40) || !near(e.h, 10) || !near(e.x, 0) || !near(e.y, 5)) errors.push('edge stretch ' + JSON.stringify(e));
    const nw = stretchBox(o, 'nw', -10, 5);
    if (!near(nw.w * nw.h, 400) || !near(nw.x + nw.w, 20) || !near(nw.y + nw.h, 20)) errors.push('corner stretch moved its anchor or area');
    if (!near(nw.w / nw.h, 30 / 15)) errors.push('corner stretch did not follow the pointer aspect');
    const tiny = stretchBox(o, 'e', 1e6, 0);
    if (!near(tiny.h, STRETCH_MIN) || !near(tiny.w * tiny.h, 400)) errors.push('stretch passed the minimum side');
    const g = stretchBox(o, 'e', 33, 0, { step: 5 });
    if (!near(g.w, 35) || !near(g.w * g.h, 400)) errors.push('grid stretch did not snap the edge');
    const c = stretchBox(o, 's', 0, 47, { cell: 10 });
    if (!near(c.th, 50) || !near(c.tw * c.th, 400) || Math.abs(c.w / 10 - Math.round(c.w / 10)) > 1e-9) errors.push('fudged stretch left the cells');
    const walled = stretchBox(o, 'e', 500, 0, { wall: { x0: -100, y0: -100, x1: 60, y1: 100 } });
    if (!near(walled.w, 60)) errors.push('stretch crossed the wall');
  }

  function testBuffer(errors) {
    const m = tinyModel([[0, 0, 20, 20], [22, 0, 20, 20]]);
    if (overlapsAny(m)) errors.push('a 2 ft gap reads as an overlap');
    setParams(m, 10, 0);
    if (!crowdedAny(m)) errors.push('a 2 ft gap inside a 10 ft buffer is not crowded');
    settle(m);
    if (crowdedAny(m)) errors.push('still crowded after settling to the buffer');
    const gapNow = m.stickies[1].x - (m.stickies[0].x + m.stickies[0].w);
    if (gapNow < 10 - 0.05) errors.push('buffer 10 settled at ' + gapNow.toFixed(3));
    const a = tinyModel([[0, 0, 40, 20], [5, 30, 20, 20]]);
    setParams(a, 10, 0);
    alignSelection(a, a.stickies.map((s) => s.id), 'left');
    if (!near(a.stickies[1].y, 30)) errors.push('align fan-out ignored the buffer');
  }

  function testLines(errors) {
    // One sticky pushed at a wall of line stops one buffer short of it.
    const m = tinyModel([[0, 0, 20, 20]]);
    m.lines.push({ id: 'l1', points: [[60, -100], [60, 100]], width: 2 });
    m.lineGen += 1;
    const s = m.stickies[0];
    s.dragging = true;
    for (let f = 0; f < 30; f++) {
      s.dragTarget = { x: Math.min(120, f * 6), y: 0 };
      step(m, { iters: 6, drag: true, maxPush: 14 });
    }
    if (!(Math.abs(s.x + s.w - (60 - 1 - CONTACT_GAP)) < 0.01)) errors.push('line did not stop the sticky: ' + (s.x + s.w));
    if (m.lines[0].points[0][0] !== 60) errors.push('a sticky moved a line');
    // A row of five dragged at a diagonal line: nobody crosses and the row
    // piles up behind the blocked lead.
    const row = tinyModel([[0, 0, 20, 20], [40, 0, 20, 20], [80, 0, 20, 20], [120, 0, 20, 20], [160, 0, 20, 20]]);
    row.lines.push({ id: 'l2', points: [[240, -200], [260, 200]], width: 2 });
    row.lineGen += 1;
    const five = row.stickies;
    five.forEach((t) => { t.dragging = true; });
    const start = five.map((t) => t.x);
    for (let f = 0; f < 60; f++) {
      five.forEach((t, i) => { t.dragTarget = { x: start[i] + Math.min(200, f * 5), y: 0 }; });
      step(row, { iters: 6, drag: true, maxPush: 14 });
    }
    if (overlapsAny(row)) errors.push('a crowd drag crossed the line or overlapped');
    const span = boundsOf(five).w;
    if (!(span < 180 - 20)) errors.push('the crowd did not pile up: span ' + span.toFixed(1));
    // Lines round-trip.
    const back = restore(JSON.parse(JSON.stringify(capture(row))));
    if (back.lines.length !== 1 || back.lines[0].points[1][0] !== 260) errors.push('lines did not round-trip');
  }

  function testLineRadius(errors) {
    const g = 10;
    if (lineCollisionRadius(0.49 * g, g) !== 0) errors.push('a 0.49g stroke did not collide at its centreline');
    if (!near(lineCollisionRadius(0.5 * g, g), 0.25 * g)) errors.push('a 0.5g stroke did not collide at its edge');
    if (!near(lineCollisionRadius(0.51 * g, g), 0.255 * g)) errors.push('a 0.51g stroke did not collide at its edge');
    // Resting distance: settled out of the envelope, a sticky's face sits
    // one buffer from the centreline (thin) or from the stroke edge (thick).
    const rest = (width) => {
      const m = tinyModel([[48, 0, 20, 20]]);
      setParams(m, 4, 0, g);
      m.lines.push({ id: 'l', points: [[70, -100], [70, 100]], width: width });
      m.lineGen += 1;
      settle(m);
      return 70 - (m.stickies[0].x + m.stickies[0].w);
    };
    const thin = rest(4);
    const thick = rest(6);
    if (!(Math.abs(thin - 4) < 0.01)) errors.push('thin line rest ' + thin.toFixed(3) + ' != buffer 4 from the centreline');
    if (!(Math.abs(thick - 7) < 0.01)) errors.push('thick line rest ' + thick.toFixed(3) + ' != buffer 4 from the 3 ft edge');
    // A grid change re-reads the rule: the same 4 ft stroke on a 5 ft grid
    // collides at its edge, and the settled sticky steps out a further 2 ft.
    const m = tinyModel([[48, 0, 20, 20]]);
    setParams(m, 4, 0, g);
    m.lines.push({ id: 'l', points: [[70, -100], [70, 100]], width: 4 });
    m.lineGen += 1;
    settle(m);
    setParams(m, 4, 0, 5);
    if (!crowdedAny(m)) errors.push('a finer grid did not widen the envelope');
    settle(m);
    if (!(Math.abs(70 - (m.stickies[0].x + 20) - 6) < 0.01) || m.lines[0].points[0][0] !== 70) errors.push('grid change did not settle the sticky clear of the edge');
  }

  function testLineHerd(errors) {
    // A dragged line herds a row: the lead is pushed, it chain-pushes the
    // rest, and nobody ends inside the envelope or overlapping.
    const herd = (opts) => {
      const m = tinyModel([[40, 0, 20, 20], [64, 0, 20, 20], [88, 0, 20, 20]]);
      m.frame = { x: -100, y: -100, w: 500, h: 250, title: 'T', color: null };
      m.lines.push({ id: 'l', points: [[20, -40], [20, 60]], width: 2 });
      m.lineGen += 1;
      const line = m.lines[0];
      line.dragging = true;
      for (let f = 1; f <= 30; f++) {
        line.dragTarget = { x: 20 + Math.min(120, f * 6), y: -40 };
        step(m, Object.assign({ iters: 6, contactEase: 1, drag: true, maxPush: 6 }, opts));
      }
      line.dragging = false;
      line.dragTarget = null;
      m.lineGen += 1;
      return m;
    };
    const m = herd({});
    const xs = m.stickies.map((s) => s.x);
    if (m.lines[0].points[0][0] !== 140) errors.push('the herding line did not reach its target: ' + m.lines[0].points[0][0]);
    if (!(xs[0] >= 140 + 1 + CONTACT_GAP - 0.01)) errors.push('the line did not push the lead: ' + xs[0].toFixed(2));
    if (overlapsAny(m) || crowdedAny(m, 0.05)) errors.push('herding left an overlap or a crowded pair ' + JSON.stringify(xs));
    if (m.stickies.some((s) => s.y !== 0)) errors.push('herding pushed a sticky off the drag axis');
    // At the wall the herd stops the line; nothing leaves the frame.
    const walled = tinyModel([[300, 0, 20, 20]]);
    walled.frame = { x: -100, y: -100, w: 430, h: 250, title: 'T', color: null };
    walled.lines.push({ id: 'l', points: [[280, -40], [280, 60]], width: 2 });
    walled.lineGen += 1;
    const wl = walled.lines[0];
    wl.dragging = true;
    for (let f = 1; f <= 20; f++) {
      wl.dragTarget = { x: 280 + f * 4, y: -40 };
      step(walled, { iters: 6, contactEase: 1, drag: true, maxPush: 6 });
    }
    const ws = walled.stickies[0];
    if (ws.x + ws.w > 330 - CONTACT_GAP + 1e-6) errors.push('the line pushed a sticky through the wall');
    if (!(wl.points[0][0] <= ws.x - 1 - CONTACT_GAP + 1e-6)) errors.push('a pinned sticky did not stop the line: ' + wl.points[0][0]);
    // Isolated: the line stops one buffer short and nobody moves.
    const iso = herd({ isolate: true });
    if (iso.stickies[0].x !== 40 || !near(iso.lines[0].points[0][0], 40 - 1 - CONTACT_GAP)) errors.push('an isolated line did not stop at the row: ' + iso.lines[0].points[0][0]);
    // Ghosted: straight through, then the row settles off the resting line.
    const gh = herd({ ghost: true });
    if (gh.lines[0].points[0][0] !== 140 || gh.stickies[0].x !== 40) errors.push('a ghosted line interacted');
    // A locked group rides as one body.
    const grp = tinyModel([[40, 0, 20, 20], [40, 24, 20, 20]]);
    grp.stickies.forEach((s) => { s.group = 'g'; });
    grp.lines.push({ id: 'l', points: [[20, 10], [20, 20]], width: 2 });
    grp.lineGen += 1;
    grp.lines[0].dragging = true;
    for (let f = 1; f <= 10; f++) {
      grp.lines[0].dragTarget = { x: 20 + f * 5, y: 10 };
      step(grp, { iters: 6, contactEase: 1, drag: true, maxPush: 6 });
    }
    if (grp.stickies[0].x !== grp.stickies[1].x || !(grp.stickies[0].x > 40)) errors.push('a herded group did not move rigidly');
  }

  function testDragModes(errors) {
    // Isolated: the dragged sticky stops at a neighbour that never moves.
    const iso = tinyModel([[0, 0, 20, 20], [40, 0, 20, 20]]);
    const a = iso.stickies[0];
    const b = iso.stickies[1];
    a.dragging = true;
    for (let f = 0; f < 20; f++) {
      a.dragTarget = { x: Math.min(100, f * 8), y: 0 };
      step(iso, { iters: 6, drag: true, isolate: true, maxPush: 14 });
    }
    if (b.x !== 40 || b.y !== 0) errors.push('isolated drag moved a neighbour');
    if (!near(a.x, 40 - CONTACT_GAP - 20)) errors.push('isolated drag did not stop at the neighbour: ' + a.x);
    // Ghost: passes through, then the release settles it apart.
    const gh = tinyModel([[0, 0, 20, 20], [40, 0, 20, 20]]);
    const g = gh.stickies[0];
    g.dragging = true;
    for (let f = 0; f < 10; f++) {
      g.dragTarget = { x: Math.min(35, f * 5), y: 0 };
      step(gh, { iters: 6, drag: true, ghost: true, maxPush: 14 });
    }
    if (!near(g.x, 35) || gh.stickies[1].x !== 40) errors.push('ghost drag interacted');
    g.dragging = false;
    g.dragTarget = null;
    settle(gh);
    if (overlapsAny(gh)) errors.push('ghost release did not settle');
  }

  function testDuplicate(errors) {
    const m = tinyModel([[0, 0, 20, 20], [100, 0, 20, 20]]);
    m.columns.push('Dept');
    m.rows.forEach((r) => { r.fields.Dept = 'Labs'; });
    m.stickies[0].radius = 3;
    m.stickies[0].shadow = 2;
    const copies = duplicateStickies(m, [m.stickies[0].id]);
    const c = copies && copies[0];
    if (!c || c.passId !== m.stickies[0].id || c.radius !== 3 || c.shadow !== 2) errors.push('duplicate lost style or pass');
    if (m.rows.length !== 3 || m.rows[1].fields.Dept !== 'Labs' || m.rows[1].fields.Space !== 'S0' || c.rowIndex !== 1) errors.push('duplicate did not copy the row right after its source');
    const csv = exportCsv(m);
    if ((csv.match(/S0,/g) || []).length !== 2) errors.push('duplicate row missing from the CSV');
    c.dragging = true;
    for (let f = 0; f < 10; f++) {
      c.dragTarget = { x: f * 4, y: 0 };
      step(m, { iters: 6, drag: true, maxPush: 14 });
    }
    if (m.stickies[0].x !== 0) errors.push('the copy pushed its original');
  }

  function testAreaEach(errors) {
    // Three loose stickies of different sizes unify to one exact area, each
    // keeping its aspect and centre, and each row gets the value.
    const m = tinyModel([[0, 0, 40, 40], [100, 0, 20, 50], [200, 0, 30, 30]]);
    const centres = m.stickies.map((s) => [s.x + s.w / 2, s.y + s.h / 2, s.tw / s.th]);
    setField(m, m.stickies.map((s) => s.id), 'SubTotal', '1200');
    m.stickies.forEach((s, i) => {
      if (!near(trueArea(s), 1200) || !near(s.x + s.w / 2, centres[i][0]) || !near(s.tw / s.th, centres[i][2])) errors.push('area each: sticky ' + i);
      if (m.rows[i].fields.SubTotal !== '1200') errors.push('area each: row ' + i);
    });
    // A locked group grows: members keep their pair clearance (the buffer)
    // instead of overlapping inside the rigid body, and stay one group.
    const g = tinyModel([[0, 0, 20, 20], [30, 0, 20, 20], [0, 30, 20, 20]]);
    setParams(g, 10, 0);
    groupStickies(g, g.stickies.map((s) => s.id));
    const before = boundsOf(g.stickies);
    setField(g, g.stickies.map((s) => s.id), 'SubTotal', '900');
    const s = g.stickies;
    for (let i = 0; i < s.length; i++) {
      for (let j = i + 1; j < s.length; j++) {
        if (mtv(s[i], s[j], 10 - 1e-3)) errors.push('area each: group members ' + i + ',' + j + ' closer than the buffer');
      }
    }
    const after = boundsOf(s);
    if (!s.every((t) => t.group === s[0].group && t.group)) errors.push('area each: group broke');
    if (Math.abs(after.x + after.w / 2 - (before.x + before.w / 2)) > 5.01) errors.push('area each: group drifted');
  }

  function testCad(errors) {
    const m = tinyModel([[0, 0, 33, 47], [100, 0, 20, 20]]);
    m.frame = { x: -50, y: -50, w: 300, h: 200, title: 'Level 1', color: null };
    m.lines.push({ id: 'l1', points: [[0, 80], [100, 80]], width: 2 });
    m.texts.push({ id: 't1', x: 5, y: 120, text: 'Note', size: 12, w: 0 });
    m.stickies[0].radius = 999;
    m.stickies[0].stroke = 1.5;
    setParams(m, 10, 10);
    const scene = JSON.parse(JSON.stringify(buildCadScene(m, { font: 'Inter' })));
    const s = scene.stickies[0];
    if (scene.units !== 'feet' || scene.title !== 'Level 1' || scene.frame.fill !== FRAME_FILL) errors.push('cad scene header');
    if (s.w % 10 !== 0 || s.area !== 1551 || !near(s.radius, Math.min(s.w, s.h) / 2)) errors.push('cad sticky ' + JSON.stringify(s));
    if (s.fill !== STICKY_FILL || s.stroke !== 1.5 || s.name !== 'S0' || s.meta.SubTotal !== '1551') errors.push('cad sticky fields');
    if (scene.lines[0].points.length !== 2 || scene.texts[0].font !== 'Inter') errors.push('cad lines or texts');
    const t = scene.texts[0];
    if (t.x !== 5 || t.y !== 120 || t.size !== 12) errors.push('cad text is not top-left feet with size in feet');
    m.stickies[1].radius = 4;
    if (buildCadScene(m, {}).stickies[1].radius !== 4) errors.push('cad radius is not the fillet in feet');
  }

  function tinyModel(rects) {
    const model = emptyModel('tiny.csv');
    model.columns = ['Space', 'SubTotal'];
    model.nameKey = 'Space';
    model.areaKey = 'SubTotal';
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      model.rows.push({ fields: { Space: 'S' + i, SubTotal: String(r[2] * r[3]) }, dropped: false });
      model.stickies.push(newSticky(i, r[0], r[1], r[2], r[3], null));
    }
    return model;
  }

  function packedSample(csvText, spreadBy) {
    const model = modelFromCsv(csvText, 'sample.csv');
    pack(model);
    alive(model).forEach((s) => {
      s.x *= spreadBy;
      s.y *= spreadBy;
    });
    return model;
  }

  function boxArea(list) {
    const b = boundsOf(list);
    return b.w * b.h;
  }

  function offsetsOf(list) {
    return list.map((s) => ({ x: s.x - list[0].x, y: s.y - list[0].y }));
  }

  function offsetsKept(list, before) {
    const now = offsetsOf(list);
    return now.every((o, i) => Math.abs(o.x - before[i].x) < 1e-6 && Math.abs(o.y - before[i].y) < 1e-6);
  }

  function testSeparation(errors) {
    const pair = tinyModel([[0, 0, 100, 100], [80, 0, 100, 100]]);
    step(pair, { iters: 8, contactEase: 1, maxPush: 500, drag: false });
    if (mtv(pair.stickies[0], pair.stickies[1], 0)) errors.push('overlap was not cleared');
    if (pair.stickies[1].x < pair.stickies[0].x) errors.push('centers crossed during separation');
  }

  function testGroupApi(errors) {
    const m = tinyModel([[0, 0, 50, 50], [60, 0, 50, 50], [200, 0, 50, 50], [300, 0, 50, 50]]);
    const s = m.stickies;
    groupStickies(m, [s[0].id, s[1].id]);
    const merged = groupStickies(m, [s[1].id, s[2].id]);
    if (!merged || s[0].group !== merged || s[2].group !== merged) errors.push('touched groups did not merge');
    if (groupMembers(m, s[0].id).length !== 3) errors.push('groupMembers missed a member');
    if (groupMembers(m, s[3].id)[0] !== s[3]) errors.push('ungrouped sticky is not its own body');
    if (expandToGroups(m, [s[2].id, s[3].id, s[3].id]).length !== 4) errors.push('expandToGroups miscounted');
    if (groupStickies(m, [s[3].id]) !== null) errors.push('one sticky formed a group');
    if (ungroupStickies(m, [s[0].id]) !== 3) errors.push('ungroup did not clear the whole group');
    groupStickies(m, [s[0].id, s[1].id]);
    dropSticky(m, s[0].id);
    if (s[1].group !== null) errors.push('drop left a group of one');
  }

  // A dragged sticky shoves a group; the group moves as one body.
  function testGroupPush(errors) {
    const m = tinyModel([[0, 0, 100, 100], [104, 0, 100, 100], [-200, 10, 80, 80]]);
    const a = m.stickies[0];
    const b = m.stickies[1];
    const c = m.stickies[2];
    groupStickies(m, [a.id, b.id]);
    const ax = a.x;
    const before = offsetsOf([a, b]);
    c.dragging = true;
    for (let f = 0; f < 40; f++) {
      c.dragTarget = { x: Math.min(-40, -200 + f * 8), y: 10 };
      step(m, { iters: 6, drag: true, maxPush: 14 });
    }
    if (!offsetsKept([a, b], before)) errors.push('group offset drifted under a drag');
    if (overlapsAny(m)) errors.push('group push left an overlap');
    if (!(a.x > ax + 20)) errors.push('group was not pushed aside');
  }

  // A sticky dropped across one member: relaxing clears it without the
  // members separating.
  function testGroupCollision(errors) {
    const m = tinyModel([[0, 0, 60, 60], [64, 0, 60, 60], [0, 64, 60, 60], [40, 20, 70, 70]]);
    const trio = m.stickies.slice(0, 3);
    groupStickies(m, trio.map((s) => s.id));
    const before = offsetsOf(trio);
    for (let f = 0; f < 200; f++) {
      if (step(m, { iters: 3, contactEase: 0.55, maxPush: 18 }) < 0.05) break;
    }
    if (!offsetsKept(trio, before)) errors.push('group offset drifted in a collision');
    if (overlapsAny(m)) errors.push('group collision left an overlap');
  }

  // Stickies the user left inside the contact gap must not be ejected and
  // pulled back: every sticky's path through a bundle never reverses.
  function testBundleCalm(errors) {
    const m = tinyModel([[-300, 0, 120, 120], [200, 0, 30, 30], [230.5, 0, 30, 30], [200, 30.5, 30, 30], [260.8, 30.5, 30, 30]]);
    const list = m.stickies;
    const last = list.map(() => null);
    let reversals = 0;
    for (let f = 0; f < 400; f++) {
      const ease = Math.min(1, (f + 1) / 18);
      const before = list.map((s) => [s.x, s.y]);
      const moved = bundleStep(m, [], { pull: 0.1 * ease, maxPush: 12 * ease });
      for (let i = 0; i < list.length; i++) {
        const dx = list[i].x - before[i][0];
        const dy = list[i].y - before[i][1];
        if (Math.hypot(dx, dy) < 0.02) continue;
        const p = last[i];
        if (p && dx * p[0] + dy * p[1] < 0) reversals += 1;
        last[i] = [dx, dy];
      }
      if (f > 18 && moved < 0.05) break;
    }
    if (reversals) errors.push('bundle reversed direction ' + reversals + ' times');
    if (overlapsAny(m)) errors.push('calm bundle left an overlap');
  }

  function testBundle(csvText, errors) {
    const all = packedSample(csvText, 3);
    const list = alive(all);
    const before = boxArea(list);
    const frames = bundle(all);
    const after = boxArea(list);
    const fill = list.reduce((sum, s) => sum + s.w * s.h, 0) / after;
    if (overlapsAny(all)) errors.push('bundle left an overlap');
    if (!(after < before * 0.6)) errors.push('bundle bbox ' + Math.round(after) + ' vs ' + Math.round(before));
    if (!(fill >= 0.45)) errors.push('bundle fill ' + fill.toFixed(3));
    if (frames >= 600) errors.push('bundle did not settle');

    const part = packedSample(csvText, 1);
    const picks = alive(part).filter((_, i) => i % 7 === 3).slice(0, 10);
    const partBefore = boxArea(picks);
    bundle(part, picks.map((s) => s.id));
    if (overlapsAny(part)) errors.push('subset bundle left an overlap');
    if (!(boxArea(picks) < partBefore)) errors.push('subset bundle did not tighten');

    const grouped = packedSample(csvText, 3);
    const trio = alive(grouped).slice(0, 3);
    groupStickies(grouped, trio.map((s) => s.id));
    const offs = offsetsOf(trio);
    bundle(grouped);
    if (!offsetsKept(trio, offs)) errors.push('bundle moved group members apart');
    if (overlapsAny(grouped)) errors.push('group bundle left an overlap');
  }

  function near(a, b) {
    return Math.abs(a - b) < 1e-6;
  }

  function testAlign(errors) {
    const rects = [[0, 0, 40, 20], [100, 50, 20, 60], [300, 20, 60, 30]];
    const run = (mode) => {
      const m = tinyModel(rects);
      alignSelection(m, m.stickies.map((s) => s.id), mode);
      return m.stickies;
    };
    const left = run('left');
    if (!left.every((s) => near(s.x, 0))) errors.push('align left missed the union edge');
    // All three now share x = 0, so they fan out down y in their old order.
    const ys = left.map((s) => s.y);
    if (!near(ys[0], 0) || !near(ys[2], 24) || !near(ys[1], 58)) errors.push('align left stacked instead of fanning out ' + ys.join(','));
    const right = run('right');
    if (!right.every((s) => near(s.x + s.w, 360))) errors.push('align right missed the union edge');
    const hc = run('hcenter');
    if (!hc.every((s) => near(s.x + s.w * 0.5, 180))) errors.push('align center-h missed the union center');
    const top = run('top');
    if (!top.every((s) => near(s.y, 0))) errors.push('align top missed the union edge');
    const vm = run('vmiddle');
    if (!vm.every((s) => near(s.y + s.h * 0.5, 55))) errors.push('align middle-v missed the union middle');
    const bottom = run('bottom');
    if (!bottom.every((s) => near(s.y + s.h, 110))) errors.push('align bottom missed the union edge');
    // Span 0..360, sizes 40 + 20 + 60 = 120, gap (360 - 120) / 2 = 120.
    const hd = run('hdist');
    if (!near(hd[0].x, 0) || !near(hd[2].x, 300) || !near(hd[1].x, 160)) errors.push('distribute-h ' + hd.map((s) => s.x).join(','));
    // By y: 0 (h20), 20 (h30), 50 (h60): span 110, sizes 110, gap 0.
    const vd = run('vdist');
    if (!near(vd[0].y, 0) || !near(vd[2].y, 20) || !near(vd[1].y, 50)) errors.push('distribute-v ' + vd.map((s) => s.y).join(','));
    const two = tinyModel(rects.slice(0, 2));
    if (alignPlan(two, two.stickies.map((s) => s.id), 'hdist').length) errors.push('distribute ran on two bodies');
    if (!alignPlan(two, two.stickies.map((s) => s.id), 'left').length) errors.push('align refused two bodies');

    // A group aligns by its bounds and keeps its shape.
    const g = tinyModel([[10, 0, 30, 30], [50, 40, 30, 30], [200, 100, 40, 40]]);
    const pair = g.stickies.slice(0, 2);
    groupStickies(g, pair.map((s) => s.id));
    const offs = offsetsOf(pair);
    alignSelection(g, [pair[0].id, g.stickies[2].id], 'right');
    if (!offsetsKept(pair, offs)) errors.push('align pulled a group apart');
    if (!near(pair[1].x + pair[1].w, 240) || !near(g.stickies[2].x + g.stickies[2].w, 240)) errors.push('group did not align by its bounds');
    const solo = tinyModel([[0, 0, 30, 30], [50, 0, 30, 30]]);
    groupStickies(solo, solo.stickies.map((s) => s.id));
    if (alignPlan(solo, [solo.stickies[0].id], 'left').length) errors.push('one group aligned against itself');
  }

  function framedSample(csvText) {
    const m = modelFromCsv(csvText, 'sample.csv');
    pack(m);
    frameAround(m);
    return m;
  }

  function settle(m) {
    for (let f = 0; f < 400; f++) if (step(m, { iters: 3, contactEase: 0.55, maxPush: 18 }) < 0.05) break;
  }

  function testFrame(csvText, errors) {
    const m = framedSample(csvText);
    if (outsideFrame(m).length) errors.push('the load frame does not hold the program');
    // Drag a sticky far past the right wall. Shoved deep into the crowd
    // ahead of it, it stops where the crowd jams against the wall, never
    // through it; the one nearest the wall stops at the wall.
    const deep = () => {
      const l = alive(m);
      for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) if (!(l[i].group && l[i].group === l[j].group) && mtv(l[i], l[j], -STRAIN_OK)) return true;
      return false;
    };
    const wallDrag = (s) => {
      s.dragging = true;
      for (let f = 0; f < 60; f++) {
        s.dragTarget = { x: s.x + 40, y: s.y };
        step(m, { iters: 6, contactEase: 1, maxPush: 14, drag: true });
        if (deep()) {
          errors.push('a drag toward the wall pushed stickies into each other');
          break;
        }
      }
      s.dragging = false;
      s.dragTarget = null;
      settle(m);
    };
    wallDrag(alive(m)[3]);
    const s = alive(m).reduce((a, b) => (b.x + b.w > a.x + a.w ? b : a));
    wallDrag(s);
    if (outsideFrame(m).length) errors.push('a drag left ' + outsideFrame(m).length + ' outside the frame');
    if (!near(s.x + s.w, m.frame.x + m.frame.w - gapOf(m))) errors.push('the dragged sticky did not stop at the wall');
    bundle(m);
    if (outsideFrame(m).length) errors.push('a bundle left a sticky outside the frame');
    if (overlapsAny(m)) errors.push('a framed bundle left an overlap');

    // Shrink hard: the floor holds, stickies glide in, and nothing overlaps.
    const k = framedSample(csvText);
    const got = resizeFrame(k, 'w', 10);
    if (!(got > 10) || !near(got, frameFloor(k, 'w', k.frame.h))) errors.push('frame went below its floor');
    settle(k);
    if (overlapsAny(k)) bundle(k);
    if (outsideFrame(k).length) errors.push('a shrink left ' + outsideFrame(k).length + ' outside the frame');
    if (overlapsAny(k)) errors.push('a shrink left an overlap');

    // Moving the frame carries its members.
    const before = alive(k).map((t) => [t.x, t.y]);
    moveFrame(k, 30, -20);
    if (!alive(k).every((t, i) => near(t.x - before[i][0], 30) && near(t.y - before[i][1], -20))) errors.push('frame move left members behind');
  }

  function testLayout(csvText, errors) {
    const m = framedSample(csvText);
    const ids = alive(m).slice(0, 2).map((s) => s.id);
    const g = groupStickies(m, ids);
    m.frame.title = 'Level 2';
    m.frame.color = '#f4f2ee';
    const view = { face: 'mono', background: '#ebe9e4', grid: true, gridStep: 5 };
    const text = JSON.stringify(packLayout(m, view));
    const back = unpackLayout(text);
    const f = back.model.frame;
    if (!f || f.title !== 'Level 2' || f.color !== '#f4f2ee' || !near(f.w, m.frame.w) || !near(f.x, m.frame.x)) errors.push('layout lost the frame');
    if (back.model.stickies.filter((s) => s.group === g).length !== 2) errors.push('layout lost a group');
    if (back.model.stickies.some((s, i) => !near(s.x, m.stickies[i].x) || !near(s.h, m.stickies[i].h))) errors.push('layout moved a sticky');
    if (back.view.face !== 'mono' || back.view.background !== '#ebe9e4' || back.view.grid !== true || back.view.gridStep !== 5) errors.push('layout lost the view');
    try {
      unpackLayout('{"kind":"something-else"}');
      errors.push('a foreign json loaded as a layout');
    } catch (e) {
      /* expected */
    }
  }

  // A stand-in for canvas measuring: 0.55 em per character.
  function fakeMeasure(text) {
    return String(text).length * 0.55 * LABEL.REF;
  }

  // Every line's box, in feet, relative to the sticky's top-left corner.
  function labelBoxes(fit, w, h) {
    const boxes = [];
    const k = fit.f / LABEL.REF;
    for (let i = 0; i < fit.lines.length; i++) {
      const lw = fakeMeasure(fit.lines[i]) * k;
      const cy = h * 0.5 + fit.y0 + i * fit.lineH;
      boxes.push([w * 0.5 - lw * 0.5, cy - fit.lineH * 0.5, w * 0.5 + lw * 0.5, cy + fit.lineH * 0.5]);
    }
    return boxes;
  }

  // A sticky's own type beats the board's; clearing it (null, or scale 1)
  // returns it to the board's. It rides capture/restore, the layout, and
  // duplication, never touches the CSV clone, and a bad value is dropped.
  // Line colour and ends: kept only when set, cleaned on restore, drawn as
  // caps sized from the width (never under the minimum), never changing
  // collision, and handed to the 3DM scene as geometry.
  function testLineEnds(errors) {
    const m = tinyModel([[0, 0, 20, 20]]);
    const plain = { id: 'p', points: [[0, 50], [40, 50]], width: 2 };
    const capped = { id: 'c', points: [[0, 80], [40, 80]], width: 2 };
    m.lines.push(plain, capped);
    if (setLineStyle([capped], 'color', '#B0453A') !== 1 || setLineStyle([capped], 'start', 'dot') !== 1 || setLineStyle([capped], 'end', 'arrow') !== 1) errors.push('line ends: a set did not change the line');
    if (setLineStyle([capped], 'end', 'comet') !== 1 || capped.end !== undefined) errors.push('line ends: an unknown end was not cleared');
    setLineStyle([capped], 'end', 'arrow');
    const data = JSON.parse(JSON.stringify(capture(m)));
    const [dp, dc] = data.lines;
    if ('color' in dp || 'start' in dp || 'end' in dp) errors.push('line ends: a plain line saved a style');
    if (dc.color !== '#b0453a' || dc.start !== 'dot' || dc.end !== 'arrow') errors.push('line ends: capture lost the style ' + JSON.stringify(dc));
    const back = restore(Object.assign({}, data, { lines: data.lines.concat([{ id: 'j', points: [[0, 0], [1, 0]], width: 1, color: 'red', start: 'x' }]) }));
    const bc = back.lines.find((l) => l.id === 'c');
    const bj = back.lines.find((l) => l.id === 'j');
    if (bc.color !== '#b0453a' || bc.start !== 'dot' || bc.end !== 'arrow' || 'color' in bj || 'start' in bj) errors.push('line ends: restore did not keep or clean the style');
    const p = lineShape(plain);
    if (p.caps.length || p.path[0][0] !== -1 || p.path[1][0] !== 41) errors.push('line ends: a plain line is not its old square-capped stroke ' + JSON.stringify(p.path));
    const s = lineShape(capped);
    const tip = s.caps.find((c) => c.k === 'fill');
    const dot = s.caps.find((c) => c.k === 'dot');
    if (!tip || tip.pts[0][0] !== 40 || !(s.path[1][0] < 40 - 2) || !dot || dot.x !== 0 || !(dot.r >= LINE_END_MIN * 0.35 - 1e-9)) errors.push('line ends: the arrow and dot are not drawn at the ends ' + JSON.stringify(s));
    const thin = lineShape({ points: [[0, 0], [30, 0]], width: 0.5, end: 'bar' });
    const bar = thin.caps[0];
    if (!bar || Math.abs(Math.hypot(bar.pts[0][0] - bar.pts[1][0], bar.pts[0][1] - bar.pts[1][1]) - LINE_END_MIN * 0.8) > 1e-9) errors.push('line ends: a thin line\'s bar is not held to the minimum size');
    LINE_ENDS.slice(1).forEach((kind) => {
      if (!lineShape({ points: [[0, 0], [30, 0]], width: 2, start: kind, end: kind }).caps.length) errors.push('line ends: ' + kind + ' drew nothing');
    });
    const scene = buildCadScene(m, {}).lines.find((l) => l.id === 'c');
    if (!scene || scene.color !== '#b0453a' || scene.caps.length !== 2 || scene.points[1][0] !== 40) errors.push('line ends: the 3DM scene lost the colour, the caps, or the centreline');
  }

  function testTextStyle(errors) {
    const m = tinyModel([[0, 0, 60, 40], [80, 0, 60, 40]]);
    const [a, b] = m.stickies;
    const board = { face: 'mono' };
    const csv0 = exportCsv(m);
    const plain = textStyleOf(a, board);
    if (plain.face !== 'mono' || plain.scale !== 1 || plain.color !== null) errors.push('text style: no override did not read the board: ' + JSON.stringify(plain));
    if (setTextStyle([a], 'face', 'sans') !== 1 || setTextStyle([a], 'scale', 1.5) !== 1 || setTextStyle([a], 'color', '#1F6FB2') !== 1) errors.push('text style: a set did not change the sticky');
    const own = textStyleOf(a, board);
    if (own.face !== 'sans' || own.scale !== 1.5 || own.color !== '#1f6fb2') errors.push('text style: the override lost to the board: ' + JSON.stringify(own));
    if (textStyleOf(a, { face: 'std' }).face !== 'sans') errors.push('text style: a board face change reached an overridden sticky');
    if (textStyleOf(b, { face: 'std' }).face !== 'std') errors.push('text style: a board face change missed a plain sticky');
    const f1 = fitLabel('Reading Room', '2,400 sf', 60, 40, fakeMeasure);
    const big = fitLabel('Reading Room', '2,400 sf', 60, 40, fakeMeasure, 1.5);
    const small = fitLabel('Reading Room', '2,400 sf', 60, 40, fakeMeasure, 0.5);
    if (!(big.f > f1.f * 1.05) || !(small.f < f1.f * 0.6)) errors.push('text style: the scale did not size the fit (' + [small.f, f1.f, big.f].join(', ') + ')');
    labelBoxes(big, 60, 40).forEach((box) => {
      const pad = LABEL.PAD * 40;
      if (box[0] < pad - 1e-6 || box[2] > 60 - pad + 1e-6 || box[1] < pad - 1e-6 || box[3] > 40 - pad + 1e-6) errors.push('text style: a scaled label left its inset');
    });
    const data = JSON.parse(JSON.stringify(capture(m)));
    if (data.stickies[0].textFace !== 'sans' || data.stickies[0].textScale !== 1.5 || data.stickies[0].textColor !== '#1f6fb2') errors.push('text style: capture dropped the override');
    if ('textFace' in data.stickies[1] || 'textScale' in data.stickies[1] || 'textColor' in data.stickies[1]) errors.push('text style: capture wrote an unset override');
    const back = unpackLayout(JSON.parse(JSON.stringify(packLayout(restore(data), board)))).model;
    const ra = textStyleOf(back.stickies[0], board);
    if (ra.face !== 'sans' || ra.scale !== 1.5 || ra.color !== '#1f6fb2' || back.stickies[1].textFace !== null) errors.push('text style: the layout round trip lost the override');
    if (exportCsv(m) !== csv0) errors.push('text style: an override reached the CSV clone');
    const dm = restore(JSON.parse(JSON.stringify(capture(m))));
    const dup = duplicateStickies(dm, [dm.stickies[0].id]);
    if (!dup || dup[0].textFace !== 'sans' || dup[0].textScale !== 1.5 || dup[0].textColor !== '#1f6fb2') errors.push('text style: a duplicate lost the override');
    setTextStyle([a], 'face', null);
    setTextStyle([a], 'scale', null);
    setTextStyle([a], 'color', null);
    const reset = textStyleOf(a, board);
    if (reset.face !== 'mono' || reset.scale !== 1 || reset.color !== null || a.textScale !== null) errors.push('text style: reset did not return to the board: ' + JSON.stringify(reset));
    // Board defaults reach only the stickies without their own setting.
    setTextStyle([a], 'scale', 1);
    setTextStyle([a], 'color', '#1f6fb2');
    const globals = { face: 'sans', textScale: 1.4, textColor: '#b0453a' };
    const ga = textStyleOf(a, globals);
    const gb = textStyleOf(b, globals);
    if (ga.face !== 'sans' || ga.scale !== 1 || ga.color !== '#1f6fb2') errors.push('text style: a board default beat an override: ' + JSON.stringify(ga));
    if (gb.face !== 'sans' || gb.scale !== 1.4 || gb.color !== '#b0453a') errors.push('text style: a board default missed a plain sticky: ' + JSON.stringify(gb));
    const gl = unpackLayout(JSON.parse(JSON.stringify(packLayout(restore(capture(m)), globals)))).view;
    if (gl.textScale !== 1.4 || gl.textColor !== '#b0453a' || gl.face !== 'sans') errors.push('text style: the layout lost the board defaults');
    setTextStyle([a], 'scale', null);
    setTextStyle([a], 'color', null);
    const junk = restore(Object.assign(data, { stickies: data.stickies.map((s) => Object.assign({}, s, { textFace: 'comic', textScale: 99, textColor: 'blue' })) }));
    const js = junk.stickies[0];
    if (js.textFace !== null || js.textScale !== TEXT_SCALE.MAX || js.textColor !== null) errors.push('text style: bad values were not cleaned: ' + JSON.stringify([js.textFace, js.textScale, js.textColor]));
    const withText = tinyModel([[0, 0, 20, 20]]);
    withText.texts.push({ id: 't1', x: 0, y: 30, text: 'North', size: 12, w: 0, textFace: 'mono', textColor: '#b0453a' });
    const tb = restore(JSON.parse(JSON.stringify(capture(withText)))).texts[0];
    if (tb.textFace !== 'mono' || tb.textColor !== '#b0453a' || buildCadScene(withText, {}).texts[0].color !== '#b0453a') errors.push('text style: a text block lost its type');
  }

  // A press grabs the least-area blob that holds it; a hole or open board
  // grabs nothing, and an outline within the tolerance still counts.
  function testBlobPick(errors) {
    const sq = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    const loop = (pts, hole) => ({ points: pts, hole: !!hole, area: polyArea(pts) });
    const big = { key: 'K', value: 'big', shape: { loops: [loop(sq(0, 0, 100, 100)), loop(sq(70, 70, 20, 20), true)] } };
    const small = { key: 'K', value: 'small', shape: { loops: [loop(sq(10, 10, 30, 30))] } };
    const list = [small, big];
    const pick = (x, y, tol) => {
      const e = blobPick(list, x, y, tol);
      return e ? e.value : null;
    };
    if (pick(20, 20, 0) !== 'small') errors.push('blob pick: the nested blob was not the one grabbed');
    if (pick(60, 20, 0) !== 'big') errors.push('blob pick: the large blob missed its own fill');
    if (pick(80, 80, 0) !== null) errors.push('blob pick: a hole grabbed its blob');
    if (pick(150, 50, 0) !== null) errors.push('blob pick: open board grabbed a blob');
    if (pick(101, 50, 2) !== 'big' || pick(101, 50, 0.5) !== null) errors.push('blob pick: the outline tolerance is wrong');
  }

  function testLabels(errors) {
    const names = ['Team Workrooms', 'Meeting: Medium Conference (12)', 'Lower Level (Quiet Zone or heavy equipment)', 'Supercalifragilisticexpialidocious', 'Lobby'];
    const sizes = [[160, 150], [40, 30], [12, 60], [70, 9], [5, 5], [0.4, 0.3], [160, 40], [20, 140], [300, 12], [3, 90]];
    for (let i = 0; i < names.length; i++) {
      for (let j = 0; j < sizes.length; j++) {
        const w = sizes[j][0];
        const h = sizes[j][1];
        const fit = fitLabel(names[i], '1,234 sf', w, h, fakeMeasure);
        if (!fit.lines.length || !(fit.f > 0)) {
          errors.push('label vanished: ' + names[i] + ' in ' + w + 'x' + h);
          continue;
        }
        const pad = LABEL.PAD * Math.min(w, h) - 1e-9;
        const boxes = labelBoxes(fit, w, h);
        if (fit.area) {
          const aw = fakeMeasure('1,234 sf') * (fit.f * LABEL.AREA) / LABEL.REF;
          const ah = fit.lineH * LABEL.AREA;
          boxes.push([w * 0.5 - aw * 0.5, h * 0.5 + fit.areaY - ah * 0.5, w * 0.5 + aw * 0.5, h * 0.5 + fit.areaY + ah * 0.5]);
        }
        if (boxes.some((b) => b[0] < pad || b[1] < pad || b[2] > w - pad || b[3] > h - pad)) {
          errors.push('label left its sticky: ' + names[i] + ' in ' + w + 'x' + h);
        }
        if (fit.lines.length > labelLines(w, h)) errors.push('label wrapped past ' + labelLines(w, h) + ' lines: ' + names[i] + ' in ' + w + 'x' + h);
      }
    }
    // Width sets the size: a wide sticky gets type sized to its width (the
    // shorter side used to cap it), a tall, narrow one keeps its
    // width-based size and wraps into more lines, and only an extreme
    // flat one is held to its height.
    const wide = fitLabel('Lobby', '', 160, 50, fakeMeasure);
    if (!near(wide.f, LABEL.NAME * 160)) errors.push('a wide sticky did not get width-sized type: ' + wide.f);
    const tall = fitLabel('Alpha Beta Gamma Delta Epsilon Zeta Eta Theta', '', 24, 160, fakeMeasure);
    if (!near(tall.f, LABEL.NAME * 24) || !(tall.lines.length > LABEL.MAX_LINES)) errors.push('a tall sticky shrank its name instead of wrapping: ' + tall.f + ' in ' + tall.lines.length + ' lines');
    const flat = fitLabel('Lobby', '', 300, 12, fakeMeasure);
    if (!near(flat.f, (12 - 2 * LABEL.PAD * 12) / LABEL.LEAD) || !(flat.f < LABEL.NAME * 300)) errors.push('an extreme flat sticky was not held to its height: ' + flat.f);
    // The same name is larger on a larger sticky, in proportion.
    const small = fitLabel('Team Workrooms', '12,000 sf', 40, 40, fakeMeasure);
    const big = fitLabel('Team Workrooms', '12,000 sf', 160, 160, fakeMeasure);
    if (!near(big.f / small.f, 4)) errors.push('label size did not follow sticky size: ' + small.f + ' vs ' + big.f);
    if (!big.area) errors.push('a roomy sticky dropped its area line');
    if (fitLabel('   ', '10 sf', 50, 50, fakeMeasure).lines.length) errors.push('a blank name drew lines');
  }

  function testSnap(errors) {
    // Left 13 -> 10 and right 53 -> 50 tie at -3, so the left edge wins.
    // Top 27 -> 30 is +3, bottom 58 -> 60 is +2, so the bottom edge wins.
    const d = snapDelta(13, 27, 40, 31, 10);
    if (Math.abs(d.dx + 3) > 1e-9 || Math.abs(d.dy - 2) > 1e-9) {
      errors.push('snapDelta ' + d.dx + ',' + d.dy + ' != -3,2');
    }
    // Left 12 -> 10 is -2, right 48 -> 50 is +2: a tie keeps the left edge.
    if (Math.abs(snapDelta(12, 0, 36, 10, 10).dx + 2) > 1e-9) errors.push('snapDelta tie did not keep the left edge');
    const off = snapDelta(13, 27, 40, 31, 0);
    if (off.dx !== 0 || off.dy !== 0) errors.push('snapDelta moved with no grid');
    if (snapEdge(27, 10) !== 30) errors.push('snapEdge 27 -> ' + snapEdge(27, 10));
  }

  function testRoundtrip(errors) {
    const m = tinyModel([[0, 0, 50, 50], [60, 0, 50, 50], [200, 0, 50, 50]]);
    const g = groupStickies(m, [m.stickies[0].id, m.stickies[1].id]);
    const data = JSON.parse(JSON.stringify(capture(m)));
    const back = restore(data);
    const groups = back.stickies.map((s) => s.group);
    if (groups[0] !== g || groups[1] !== g || groups[2] !== null) errors.push('restore lost group ids');
    const legacy = JSON.parse(JSON.stringify(data));
    legacy.cords = [{ id: 'c9', a: data.stickies[0].id, b: data.stickies[2].id, mode: 'shrink' }];
    legacy.stickies[0].pinned = true;
    legacy.stickies.push({ id: 's-bad', rowIndex: 99, x: 0, y: 0, w: 10, h: 10 });
    try {
      const old = restore(legacy);
      if (old.stickies.length !== 3) errors.push('restore kept a sticky with no row');
    } catch (e) {
      errors.push('restore threw on a legacy layout: ' + e.message);
    }
    data.stickies[2].group = 'gzzz';
    restore(data);
    const next = groupStickies(back, [back.stickies[0].id, back.stickies[2].id]);
    if (!next || parseInt(next.slice(1), 36) <= parseInt('zzz', 36)) errors.push('restore did not bump past group ids');
  }

  function testFields(errors) {
    const m = tinyModel([[0, 0, 50, 50], [60, 0, 40, 40]]);
    const ids = m.stickies.map((s) => s.id);
    setField(m, ids, 'Dept', 'Labs');
    const dept = commonField(m, ids, 'Dept');
    if (dept.mixed || dept.value !== 'Labs') errors.push('setField/commonField lost a shared value');
    if (!commonField(m, ids, 'SubTotal').mixed) errors.push('different areas did not read as mixed');
    setField(m, ids, 'SubTotal', '900');
    if (m.stickies.some((s) => Math.abs(s.w * s.h - 900) > 1e-6)) errors.push('setField area did not resize');
    if (commonField(m, ids, 'SubTotal').value !== '900') errors.push('area did not read back as 900');
    setField(m, ids, 'SubTotal', 'none');
    if (Math.abs(m.stickies[0].w * m.stickies[0].h - 900) > 1e-6) errors.push('a bad area resized a sticky');
    testNames(errors);
  }

  // The inline editor and the capsule's Name row share setName: the CSV
  // clone shows the new name in the name column, no row moves, blank is
  // allowed, a nameless sheet gains a Name column, and capture/restore
  // (the undo snapshot) brings the old name back.
  function testNames(errors) {
    const m = tinyModel([[0, 0, 50, 50], [60, 0, 40, 40], [120, 0, 30, 30]]);
    const [a, b] = m.stickies;
    const undo = JSON.stringify(capture(m));
    const order0 = m.rows.map((r) => r.fields.SubTotal).join();
    setName(m, [b.id], '  Reading Room ');
    if (nameOf(m, b) !== 'Reading Room' || nameOf(m, a) !== 'S0') errors.push('setName did not rename exactly its sticky');
    if (m.rows.map((r) => r.fields.SubTotal).join() !== order0) errors.push('a rename moved a row');
    const csvRows = exportCsv(m).replace(/^\uFEFF/, '').split('\r\n');
    if (csvRows[0] !== 'Space,SubTotal' || csvRows[2].split(',')[0].trim() !== 'Reading Room') errors.push('the CSV clone did not carry the rename: ' + csvRows[2]);
    if (!commonField(m, [a.id, b.id], 'Space').mixed || commonField(m, [b.id], 'Space').value.trim() !== 'Reading Room') errors.push('commonField missed the rename');
    setName(m, [a.id], '');
    if (nameOf(m, a) !== '' || exportCsv(m).split('\r\n')[1].split(',')[0] !== '') errors.push('a blank name was refused');
    const back = restore(JSON.parse(undo));
    if (nameOf(back, back.stickies[1]) !== 'S1' || nameOf(back, back.stickies[0]) !== 'S0') errors.push('restoring the snapshot did not undo the rename');
    const bare = tinyModel([[0, 0, 20, 20]]);
    bare.nameKey = null;
    bare.columns = ['SubTotal'];
    delete bare.rows[0].fields.Space;
    setName(bare, [bare.stickies[0].id], 'Lobby');
    if (bare.nameKey !== 'Name' || bare.columns.join() !== 'SubTotal,Name' || nameOf(bare, bare.stickies[0]) !== 'Lobby') errors.push('a nameless sheet did not gain a Name column');
    testAreaEdit(errors);
  }

  // The readout editor on a sticky and the capsule's Area row share one
  // setter (setField on the area column): the area lands within half a
  // square foot at the same aspect and centre, the CSV clone carries it as
  // a whole number, no row moves, a fudged board keeps the true area, and
  // the capture/restore undo snapshot brings the old size back.
  function testAreaEdit(errors) {
    const m = tinyModel([[0, 0, 50, 20], [80, 0, 40, 40]]);
    const s = m.stickies[0];
    const undo = JSON.stringify(capture(m));
    const aspect = s.tw / s.th;
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    setField(m, [s.id], m.areaKey, '3,200');
    if (Math.abs(s.w * s.h - 3200) > 0.5 || Math.abs(trueArea(s) - 3200) > 0.5) errors.push('an area edit did not land at 3200 sf: ' + s.w * s.h);
    if (Math.abs(s.tw / s.th - aspect) > 1e-9 || Math.abs(s.x + s.w / 2 - cx) > 1e-9 || Math.abs(s.y + s.h / 2 - cy) > 1e-9) errors.push('an area edit lost the aspect or the centre');
    const rows = exportCsv(m).replace(/^\uFEFF/, '').split('\r\n');
    if (rows[1] !== 'S0,3200' || rows[2] !== 'S1,1600') errors.push('the CSV clone did not carry the new area: ' + rows.slice(1, 3).join(' / '));
    const back = restore(JSON.parse(undo));
    if (Math.abs(trueArea(back.stickies[0]) - 1000) > 1e-6 || exportCsv(back).split('\r\n')[1] !== 'S0,1000') errors.push('restoring the snapshot did not undo the area edit');
    const f = tinyModel([[0, 0, 50, 20]]);
    setParams(f, 10, 10, 10);
    setField(f, [f.stickies[0].id], f.areaKey, '2500');
    const t = f.stickies[0];
    if (Math.abs(trueArea(t) - 2500) > 0.5 || exportCsv(f).split('\r\n')[1] !== 'S0,2500' || Math.abs(t.w / 10 - Math.round(t.w / 10)) > 1e-9) errors.push('a fudged area edit lost the true area or the cells');
  }

  return {
    CONTACT_GAP: CONTACT_GAP,
    PACK_GAP: PACK_GAP,
    MAX_STICKIES: MAX_STICKIES,
    parseCsv: parseCsv,
    modelFromCsv: modelFromCsv,
    modelFromMatrix: modelFromMatrix,
    modelFromXlsx: modelFromXlsx,
    xlsxToMatrix: xlsxToMatrix,
    pack: pack,
    step: step,
    mtv: mtv,
    alive: alive,
    boundsOf: boundsOf,
    writeArea: writeArea,
    setAreaKeepingAspect: setAreaKeepingAspect,
    ensureColumn: ensureColumn,
    dropSticky: dropSticky,
    groupStickies: groupStickies,
    ungroupStickies: ungroupStickies,
    groupMembers: groupMembers,
    expandToGroups: expandToGroups,
    bundleStep: bundleStep,
    bundle: bundle,
    snapDelta: snapDelta,
    snapEdge: snapEdge,
    commonField: commonField,
    setField: setField,
    editRowField: editRowField,
    getColumnRoles: getColumnRoles,
    setColumnRoles: setColumnRoles,
    getColumnTags: getColumnTags,
    columnTags: getColumnTags,
    moduleLayout: moduleLayout,
    moduleForSticky: rowModule,
    refitSticky: refit,
    nameOf: nameOf,
    setName: setName,
    exportCsv: exportCsv,
    capture: capture,
    restore: restore,
    summarize: summarize,
    overlapsAny: overlapsAny,
    frameInner: frameInner,
    STICKY_FILL: STICKY_FILL,
    FRAME_FILL: FRAME_FILL,
    FRAME_RADIUS: FRAME_RADIUS,
    LINE_MIN: LINE_MIN,
    LINE_MAX: LINE_MAX,
    LINE_WIDTH: LINE_WIDTH,
    LINE_ENDS: LINE_ENDS,
    LINE_END_MIN: LINE_END_MIN,
    lineShape: lineShape,
    setLineStyle: setLineStyle,
    TEXT_SIZE: TEXT_SIZE,
    STRETCH_MIN: STRETCH_MIN,
    trueArea: trueArea,
    gapOf: gapOf,
    setParams: setParams,
    snapToCells: snapToCells,
    fudgeCells: fudgeCells,
    stretchBox: stretchBox,
    capRadius: capRadius,
    duplicateStickies: duplicateStickies,
    buildCadScene: buildCadScene,
    lineOverlap: lineOverlap,
    lineCollisionRadius: lineCollisionRadius,
    crowdedAny: crowdedAny,
    atRest: atRest,
    beginSettle: beginSettle,
    settleStep: settleStep,
    settleNow: settleNow,
    liquidLevel: liquidLevel,
    resetLiquid: resetLiquid,
    jamReport: jamReport,
    REST_SLACK: REST_SLACK,
    fieldText: fieldText,
    uid: uid,
    ensureRowIds: ensureRowIds,
    frameTitleFor: frameTitleFor,
    frameAround: frameAround,
    frameMembers: frameMembers,
    moveFrame: moveFrame,
    frameFloor: frameFloor,
    resizeFrame: resizeFrame,
    outsideFrame: outsideFrame,
    alignPlan: alignPlan,
    alignSelection: alignSelection,
    packLayout: packLayout,
    unpackLayout: unpackLayout,
    baseName: baseName,
    buildSave: buildSave,
    readSaveZip: readSaveZip,
    openSave: openSave,
    zip: zip,
    unzip: unzip,
    crc32: crc32,
    sha256Hex: sha256Hex,
    matrixToCsv: matrixToCsv,
    LABEL: LABEL,
    fitLabel: fitLabel,
    selfTest: selfTest,
    gripLine: gripLine,
    cutsBox: cutsBox,
    num: num,
    BLOB_PALETTE: BLOB_PALETTE,
    BLOB_ALPHA: BLOB_ALPHA,
    BLOB_LABEL: BLOB_LABEL,
    BLOB_LINE: BLOB_LINE,
    BLOB_STROKE_MAX: BLOB_STROKE_MAX,
    BLOB_OFFSET_MAX: BLOB_OFFSET_MAX,
    categoricalKeys: categoricalKeys,
    placeCopies: placeCopies,
    reorderRows: reorderRows,
    rowHierarchy: rowHierarchy,
    resortRows: resortRows,
    blobOn: blobOn,
    setBlobOn: setBlobOn,
    blobStyle: blobStyle,
    setBlobStyle: setBlobStyle,
    blobGroups: blobGroups,
    blobSmooth: blobSmooth,
    blobShape: blobShape,
    blobRaster: blobRaster,
    blobShapes: blobShapes,
    blobCache: blobCache,
    blobPick: blobPick,
    pointInPoly: pointInPoly,
    TEXT_FACES: TEXT_FACES,
    TEXT_SCALE: TEXT_SCALE,
    textStyleOf: textStyleOf,
    setTextStyle: setTextStyle,
  };
});
