'use strict';

const fs = require('fs');
const path = require('path');
const engine = require('./engine.js');

const csv = fs.readFileSync(path.join(__dirname, 'fixtures', 'program.csv'), 'utf8');

function ms(start) {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

// Repeats drawable rows until the sheet makes exactly `count` stickies.
function inflated(count) {
  const matrix = engine.parseCsv(csv);
  const header = matrix[0];
  const areaCol = header.indexOf('SubTotal');
  const drawn = matrix.slice(1).filter((row) => engine.num(row[areaCol]) > 0);
  const rows = [header];
  for (let i = 0; i < count; i++) rows.push(drawn[i % drawn.length]);
  return engine.modelFromMatrix(rows, 'inflated.csv');
}

function sampleModel(count) {
  return count ? inflated(count) : engine.modelFromCsv(csv, 'sample.csv');
}

// Drags one sticky back and forth through the packed cluster.
function timeStep(count) {
  const model = sampleModel(count);
  engine.pack(model);
  const list = engine.alive(model);
  const bounds = engine.boundsOf(list);
  const mover = list[list.length - 1];
  mover.dragging = true;
  const times = [];
  for (let f = 0; f < 80; f++) {
    const t = (f % 40) / 39;
    const u = f < 40 ? t : 1 - t;
    mover.dragTarget = { x: bounds.x + u * (bounds.w - mover.w), y: bounds.y + bounds.h * 0.5 };
    const start = process.hrtime.bigint();
    engine.step(model, { iters: 6, drag: true, maxPush: 14 });
    if (f >= 20) times.push(ms(start));
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  return {
    stickies: list.length,
    frames: times.length,
    avgMs: +avg.toFixed(4),
    worstMs: +Math.max.apply(null, times).toFixed(4),
  };
}

function timeBundle(count) {
  const model = sampleModel(count);
  engine.pack(model);
  const list = engine.alive(model);
  list.forEach((s) => {
    s.x *= 3;
    s.y *= 3;
  });
  const before = engine.boundsOf(list);
  const start = process.hrtime.bigint();
  const frames = engine.bundle(model);
  const total = ms(start);
  const after = engine.boundsOf(list);
  const area = list.reduce((sum, s) => sum + s.w * s.h, 0);
  return {
    stickies: list.length,
    frames: frames,
    totalMs: +total.toFixed(2),
    msPerFrame: +(total / frames).toFixed(4),
    bboxRatio: +((after.w * after.h) / (before.w * before.h)).toFixed(3),
    fill: +(area / (after.w * after.h)).toFixed(3),
    aspect: +(after.w / after.h).toFixed(3),
    overlaps: engine.overlapsAny(model),
  };
}

// 200 stickies, six lines, and a 30-sticky selection dragged into one of
// them: the crowd path, the most expensive drag there is.
function timeCrowd(count) {
  const model = sampleModel(count);
  engine.pack(model);
  engine.setParams(model, 10, 0);
  const list = engine.alive(model);
  const b = engine.boundsOf(list);
  for (let i = 0; i < 6; i++) {
    const x = b.x + b.w * (i + 1) / 7;
    model.lines.push({ id: 'l' + i, points: [[x, b.y - 50], [x + 40, b.y + b.h + 50]], width: 2 });
  }
  model.lineGen += 1;
  for (let f = 0; f < 200; f++) if (engine.step(model, { iters: 3, contactEase: 0.55, maxPush: 18 }) < 0.05) break;
  const picks = list.slice().sort((p, q) => p.x - q.x).slice(0, 30);
  picks.forEach((s) => { s.dragging = true; });
  const start0 = picks.map((s) => [s.x, s.y]);
  const times = [];
  for (let f = 0; f < 80; f++) {
    const dx = Math.min(b.w * 0.6, f * 8);
    picks.forEach((s, i) => { s.dragTarget = { x: start0[i][0] + dx, y: start0[i][1] }; });
    const start = process.hrtime.bigint();
    engine.step(model, { iters: 6, drag: true, maxPush: 14 });
    if (f >= 10) times.push(ms(start));
  }
  const avg = times.reduce((a, c) => a + c, 0) / times.length;
  return {
    stickies: list.length,
    lines: model.lines.length,
    dragged: picks.length,
    avgMs: +avg.toFixed(4),
    worstMs: +Math.max.apply(null, times).toFixed(4),
    crossesLine: engine.lineOverlap(model),
  };
}

// 200 stickies inside their frame, and a wall-high line dragged through
// them: the herding path, every sticky it meets pushed and chained.
function timeHerd(count) {
  const model = sampleModel(count);
  engine.pack(model);
  engine.frameAround(model);
  engine.setParams(model, 10, 0, 10);
  const list = engine.alive(model);
  for (let f = 0; f < 200; f++) if (engine.step(model, { iters: 3, contactEase: 0.55, maxPush: 18 }) < 0.05) break;
  const b = engine.boundsOf(list);
  const x0 = b.x - 20;
  model.lines.push({ id: 'herd', points: [[x0, b.y + b.h * 0.2], [x0, b.y + b.h * 0.8]], width: 4 });
  model.lineGen += 1;
  const line = model.lines[model.lines.length - 1];
  line.dragging = true;
  const times = [];
  let worstCross = false;
  for (let f = 1; f <= 90; f++) {
    line.dragTarget = { x: x0 + Math.min(b.w * 0.5, f * 8), y: line.points[0][1] };
    const start = process.hrtime.bigint();
    engine.step(model, { iters: 6, contactEase: 1, drag: true, maxPush: 8 });
    times.push(ms(start));
    if (engine.lineOverlap(model)) worstCross = true;
  }
  const avg = times.reduce((a, c) => a + c, 0) / times.length;
  return {
    stickies: list.length,
    frames: times.length,
    travelled: +(line.points[0][0] - x0).toFixed(2),
    avgMs: +avg.toFixed(4),
    worstMs: +Math.max.apply(null, times).toFixed(4),
    crossesLine: worstCross,
    outside: engine.outsideFrame(model).length,
  };
}

// The zip writer, read back by the xlsx reader and checked against zlib.
async function testZip(errors) {
  const zlib = require('zlib');
  const crypto = require('crypto');
  const random = new Uint8Array(20000);
  for (let i = 0; i < random.length; i++) random[i] = (i * 2654435761) >>> 24;
  const entries = [
    { name: 'a.txt', data: 'hello, zip\n'.repeat(200) },
    { name: 'dir/b.bin', data: random },
    { name: 'empty.txt', data: '' },
    { name: 'naïve café.csv', data: csv },
  ];
  const out = { deflated: 0, stored: 0 };
  for (const store of [false, true]) {
    const bytes = await engine.zip(entries, { store: store });
    const files = await engine.unzip(bytes.buffer.slice(0));
    const view = new DataView(bytes.buffer);
    const eocd = bytes.length - 22;
    let p = view.getUint32(eocd + 16, true);
    for (const e of entries) {
      const want = typeof e.data === 'string' ? new TextEncoder().encode(e.data) : e.data;
      const got = files[e.name];
      if (!got || Buffer.compare(Buffer.from(got), Buffer.from(want)) !== 0) errors.push('zip round trip lost ' + e.name + (store ? ' (store)' : ''));
      const method = view.getUint16(p + 10, true);
      const crc = view.getUint32(p + 16, true);
      if (crc !== zlib.crc32(want) || crc !== engine.crc32(want)) errors.push('zip crc wrong for ' + e.name);
      if (method === 8) out.deflated += 1;
      else out.stored += 1;
      p += 46 + view.getUint16(p + 28, true);
    }
  }
  if (!out.deflated) errors.push('the zip writer never deflated');
  for (const s of ['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), csv]) {
    if (engine.sha256Hex(new TextEncoder().encode(s)) !== crypto.createHash('sha256').update(s).digest('hex')) errors.push('sha256 wrong for a ' + s.length + '-char input');
  }
  return out;
}

// A styled board saved to a zip, then opened three ways.
async function testSaveRestore(errors) {
  const model = engine.modelFromCsv(csv, 'sample.csv');
  engine.pack(model);
  engine.frameAround(model);
  engine.setParams(model, 10, 0, 10);
  const list = engine.alive(model);
  list[0].color = '#d9a0a0';
  list[1].radius = 4;
  list[2].stroke = 1.5;
  list[3].shadow = 6;
  list[4].group = list[5].group = 'g1';
  const plainCsv = engine.exportCsv(model);
  // Per-sticky and per-text type settings ride in the layout, never the CSV.
  list[6].textFace = 'mono';
  list[6].textScale = 1.4;
  list[6].textColor = '#1f6fb2';
  list[7].textColor = '#ffffff';
  model.lines.push({ id: 'l1', points: [[0, 0], [50, 80]], width: 3, color: '#1f6fb2', start: 'dot', end: 'arrow' });
  model.lines.push({ id: 'l2', points: [[60, 0], [90, 0]], width: 1 });
  model.texts.push({ id: 't1', x: 10, y: -40, text: 'North', size: 12, w: 0, textFace: 'sans', textColor: '#b0453a' });
  if (engine.exportCsv(model) !== plainCsv) errors.push('a text override changed the CSV');
  model.lineGen += 1;
  engine.setBlobOn(model, 'Group', true);
  engine.setBlobOn(model, 'Department', true);
  engine.setBlobStyle(model, 'Department', null, 'offset', 10);
  engine.setBlobStyle(model, 'Department', 'Department B', 'color', '#8a55b8');
  engine.setBlobStyle(model, 'Department', 'Department B', 'offset', 1.37);
  engine.setBlobStyle(model, 'Group', null, 'label', false);
  engine.setBlobStyle(model, 'Group', null, 'stroke', 2.5);
  engine.setBlobStyle(model, 'Department', 'Department B', 'stroke', 0);
  engine.setBlobStyle(model, 'Group', null, 'singles', false);
  const view = { face: 'mono', background: '#f4efe6', grid: true, gridStep: 10, lineWidth: 3, textScale: 1.2, textColor: '#2b2b2b', custom: { sticky: ['#123456'], background: [], frame: [] } };
  const camera = { x: 12.5, y: -8, z: 0.75 };
  const saved = await engine.buildSave(model, view, camera, { app: 'test' });
  const truth = JSON.stringify(engine.capture(model));
  const parts = await engine.readSaveZip(saved.bytes.buffer.slice(0));
  const names = Object.keys(await engine.unzip(saved.bytes.buffer.slice(0))).sort();
  if (names.join() !== ['manifest.json', 'sample.csv', 'sample.layout.json'].join()) errors.push('save zip holds ' + names.join());
  if (parts.csvText !== engine.exportCsv(engine.restore(JSON.parse(truth))).replace(/^\uFEFF/, '')) errors.push('the zipped csv is not the export clone');
  const same = (res, label) => {
    if (JSON.stringify(engine.capture(res.model)) !== truth) errors.push(label + ': board differs');
    if (JSON.stringify(res.view) !== JSON.stringify(view)) errors.push(label + ': view differs');
    if (JSON.stringify(res.camera) !== JSON.stringify(camera)) errors.push(label + ': camera differs');
    if (!res.summary.exact) errors.push(label + ': not exact');
  };
  const fromZip = engine.openSave(parts);
  same(fromZip, 'zip restore');
  if (engine.blobStyle(fromZip.model, 'Department', 'Department B').offset !== 1.37 || !/"offset": 1\.37\b/.test(String(parts.layout))) errors.push('a fractional blob offset did not survive the zip as 1.37');
  if (engine.blobStyle(fromZip.model, 'Department', 'Department B').stroke !== 0 || engine.blobStyle(fromZip.model, 'Group', 'x').stroke !== 2.5 || engine.blobStyle(fromZip.model, 'Department', 'Admin').stroke !== engine.BLOB_LINE) errors.push('a blob stroke (0, a key-wide 2.5, or the default) did not survive the zip');
  if ((engine.buildCadScene(fromZip.model, {}).blobs.find((b) => b.value === 'Department B') || {}).stroke !== 0) errors.push('the 3DM scene lost a blob\'s zero stroke');
  const zl = fromZip.model.lines;
  if (zl[0].color !== '#1f6fb2' || zl[0].start !== 'dot' || zl[0].end !== 'arrow' || 'color' in zl[1] || 'start' in zl[1] || 'end' in zl[1]) errors.push('line colour and end caps did not survive the zip (or a plain line gained them)');
  if (fromZip.view.textScale !== 1.2 || fromZip.view.textColor !== '#2b2b2b') errors.push('the board text defaults did not survive the zip');
  const fromFiles = engine.openSave({ csvText: parts.csvText, csvName: 'sample.csv', layout: parts.layout });
  same(fromFiles, 'separate-file restore');
  const own = fromZip.model.stickies.find((t) => t.id === list[6].id);
  const ownText = fromZip.model.texts[0];
  if (!own || own.textFace !== 'mono' || own.textScale !== 1.4 || own.textColor !== '#1f6fb2') errors.push('a sticky text override did not survive the zip');
  if (!ownText || ownText.textFace !== 'sans' || ownText.textColor !== '#b0453a') errors.push('a text-block override did not survive the zip');
  if (parts.csvText !== plainCsv.replace(/^\uFEFF/, '')) errors.push('the zipped CSV carries text overrides');
  // A layout from before per-item type opens with none set.
  const legacy = JSON.parse(parts.layout);
  const strip = (o) => { delete o.textFace; delete o.textScale; delete o.textColor; };
  (legacy.board.stickies || []).forEach(strip);
  (legacy.board.texts || []).forEach(strip);
  const old = engine.openSave({ csvText: parts.csvText, csvName: 'sample.csv', layout: JSON.stringify(legacy) });
  if (old.model.stickies.some((t) => t.textFace || t.textScale || t.textColor) || old.model.texts.some((t) => t.textFace || t.textColor)) errors.push('an old layout grew text overrides');

  // Edited in Excel: one area changed, two rows swapped, one removed, one added.
  const matrix = engine.parseCsv(parts.csvText);
  const head = matrix[0];
  const col = (name) => head.indexOf(name);
  const rowsOf = (name) => matrix.filter((r, i) => i > 0 && r[col('Space')] === name);
  const unique = matrix.slice(1).filter((r) => engine.num(r[col('SubTotal')]) > 0 && rowsOf(r[col('Space')]).length === 1).map((r) => r[col('Space')]);
  const grow = unique[2];
  const groupedNames = list.slice(4, 6).map((s) => model.rows[s.rowIndex].fields.Space);
  const gone = unique.find((name, i) => i >= 5 && !groupedNames.includes(name));
  const swapA = unique[8];
  const swapB = unique[12];
  const byName = (m, name) => engine.alive(m).find((s) => m.rows[s.rowIndex].fields.Space === name);
  const before = { grow: Object.assign({}, byName(model, grow)), gone: byName(model, gone).id, a: Object.assign({}, byName(model, swapA)), b: Object.assign({}, byName(model, swapB)) };
  const ia = matrix.indexOf(rowsOf(swapA)[0]);
  const ib = matrix.indexOf(rowsOf(swapB)[0]);
  [matrix[ia], matrix[ib]] = [matrix[ib], matrix[ia]];
  const growRow = rowsOf(grow)[0];
  const newArea = Math.round(engine.num(growRow[col('SubTotal')]) * 1.5);
  growRow[col('SubTotal')] = String(newArea);
  // As the sheet's own formula would: SubTotal = Qty x SF.
  if (engine.num(growRow[col('Qty')]) === 1) growRow[col('SF')] = String(newArea);
  matrix.splice(matrix.indexOf(rowsOf(gone)[0]), 1);
  const added = head.map(() => '');
  added[col('Department')] = matrix[1][col('Department')];
  added[col('Space')] = 'Test Bay';
  added[col('SubTotal')] = '900';
  matrix.push(added);
  const edited = engine.openSave({ csvText: engine.matrixToCsv(matrix), csvName: 'sample.csv', layout: parts.layout });
  const s = edited.summary;
  const m = edited.model;
  const n0 = list.length;
  if (s.exact || s.restored !== n0 - 1 || s.added !== 1 || s.removed !== 1 || s.resized !== 1) errors.push('edited restore summary ' + JSON.stringify(s));
  const g = byName(m, grow);
  const cx = (t) => t.x + t.w / 2;
  const cy = (t) => t.y + t.h / 2;
  if (!g || g.id !== before.grow.id || Math.abs(g.tw * g.th - newArea) > 0.01 || Math.abs(cx(g) - cx(before.grow)) > 1e-9 || Math.abs(cy(g) - cy(before.grow)) > 1e-9 || Math.abs(g.tw / g.th - before.grow.tw / before.grow.th) > 1e-9) errors.push('the changed area did not resize about the centre at its aspect');
  if (engine.alive(m).some((t) => t.id === before.gone)) errors.push('the removed row kept its sticky');
  const a = byName(m, swapA);
  const b = byName(m, swapB);
  if (!a || !b || a.id !== before.a.id || b.id !== before.b.id || a.x !== before.a.x || b.y !== before.b.y) errors.push('reordered rows lost their stickies');
  const moved = engine.alive(m).filter((t) => {
    const o = engine.alive(model).find((q) => q.id === t.id);
    return o && t.id !== before.grow.id && (o.x !== t.x || o.y !== t.y || o.w !== t.w || o.h !== t.h || o.color !== t.color || o.radius !== t.radius);
  });
  if (moved.length) errors.push(moved.length + ' unchanged stickies moved or lost style');
  const nb = byName(m, 'Test Bay');
  const wall = engine.frameInner(m.frame, 10);
  if (!nb || nb.x < wall.x0 - 1e-6 || nb.y < wall.y0 - 1e-6 || nb.x + nb.w > wall.x1 + 1e-6 || nb.y + nb.h > wall.y1 + 1e-6) errors.push('the new row was not placed inside the frame');
  if (nb && engine.alive(m).some((t) => t !== nb && t.id !== before.grow.id && engine.mtv(t, nb, 10 - 1e-6))) errors.push('the new row landed within a buffer of a sticky');
  if (m.lines.length !== 2 || m.lines[0].end !== 'arrow' || m.texts.length !== 1 || m.stickies.filter((t) => t.group === 'g1').length !== 2) errors.push('lines, text, or groups did not survive the merge');
  if (JSON.stringify(m.blobs) !== JSON.stringify(JSON.parse(truth).blobs)) errors.push('blob settings did not survive the merge');
  const outLines = engine.exportCsv(m).replace(/^\uFEFF/, '').split('\r\n');
  const inLines = engine.matrixToCsv(matrix).replace(/^\uFEFF/, '').split(/\r?\n/);
  const diff = outLines.findIndex((line, i) => line !== inLines[i]);
  if (diff >= 0 || outLines.length !== inLines.length) errors.push('the merged board does not export the edited CSV: ' + JSON.stringify([outLines[diff], inLines[diff]]));
  return { zipBytes: saved.bytes.length, entries: names, edited: s };
}

// The collision repro (test-stress.js) through the engine's own settle:
// the six line cases, then random edits on a 200-sticky board with lines.
// At every rest no two bodies may sit inside the buffer unless a jam is
// reported, and no sticky may ever change sides of a line.
function testCollisions(errors) {
  const stress = require('./test-stress.js');
  const settle = stress.engineSettle(engine);
  const t0 = Date.now();
  const cases = stress.lineCases(engine, settle);
  const lineMs = Date.now() - t0;
  for (const k in cases) {
    const c = cases[k];
    if (c.crossings) errors.push(k + ': ' + c.crossings + ' line crossings');
    if (c.coreHits) errors.push(k + ': a sticky entered a line ' + c.coreHits + ' times');
    if (k === 'frameTooSmall') {
      if (!c.jam) errors.push('frameTooSmall: the impossible shrink did not report a jam');
    } else if (c.jam || c.inside) errors.push(k + ': did not rest (jam ' + c.jam + ', inside ' + c.inside + ')');
  }
  if (!cases.lineChain.stoppedShort) errors.push('lineChain: the line did not stop a reach short of the pinned row');
  if (!(cases.linePinned.lineX < 590)) errors.push('linePinned: the line passed the pinned sticky (x ' + cases.linePinned.lineX + ')');
  if (cases.gripHerd.endX !== 320) errors.push('gripHerd: the swung end stopped at x ' + cases.gripHerd.endX + ' with room to herd');
  if (!(cases.gripPinned.endX < 100)) errors.push('gripPinned: the swung end did not stop at the pinned sticky (x ' + cases.gripPinned.endX + ')');
  // Contact feel: glide along a row, a push into a cluster, a pushed body
  // sliding along the one it rests on, and five-link chains pushed along
  // a surface, into a wall and into a line.
  const contacts = stress.contactCases(engine, settle);
  for (const e of stress.contactFailures(contacts)) errors.push('contact ' + e);
  const runs = [];
  for (const seed of [7, 31]) {
    for (const fudge of [false, true]) {
      const t = Date.now();
      const r = stress.run(engine, inflated(200), settle, { seed: seed, ops: 60, fudge: fudge });
      const tag = 'stress seed ' + seed + (fudge ? ' fudged' : '');
      if (r.silent) errors.push(tag + ': ' + r.silent + ' rests inside the buffer with no jam: ' + r.worst.join('; '));
      if (r.minGap < r.gap - stress.TOL) errors.push(tag + ': min gap at rest ' + r.minGap + ' < ' + (r.gap - stress.TOL));
      if (r.groupMinGap < r.gap - stress.TOL) errors.push(tag + ': min group gap at rest ' + r.groupMinGap);
      if (r.crossings) errors.push(tag + ': ' + r.crossings + ' line crossings ' + JSON.stringify(r.crossingsByOp));
      if (r.coreHits) errors.push(tag + ': a sticky entered a line ' + r.coreHits + ' times');
      runs.push({ seed: seed, fudge: fudge, ms: Date.now() - t, settles: r.settles, jams: r.jams, silent: r.silent, minGap: r.minGap, groupMinGap: r.groupMinGap, crossings: r.crossings, coreHits: r.coreHits, slowest: r.slowest });
    }
  }
  return { lineMs: lineMs, cases: cases, contacts: contacts, runs: runs };
}

// Category blobs: which keys qualify on the sample, outline correctness on
// a board laid out by hand, the contour cache, and the settings round trip.
function testBlobs(errors) {
  const out = {};
  const sample = engine.modelFromCsv(csv, 'sample.csv');
  const cats = engine.categoricalKeys(sample);
  out.categorical = cats;
  const catKeys = cats.map((c) => c.key);
  for (const key of ['Department', 'Group']) if (catKeys.indexOf(key) < 0) errors.push('blobs: ' + key + ' is not categorical');
  for (const key of ['Qty', 'SF', 'SubTotal', 'Allocation A', 'Allocation B', 'Allocation C', 'Space']) if (catKeys.indexOf(key) >= 0) errors.push('blobs: ' + key + ' was offered as a category');

  // Kind a: a close pair plus one far away (two islands). Kind b: a pair
  // well clear of both. Kind c: one sticky alone.
  const rows = [['Name', 'Kind', 'Area'], ['a1', 'a', '400'], ['a2', 'a', '400'], ['a3', 'a', '400'], ['b1', 'b', '400'], ['b2', 'b', '400'], ['c1', 'c', '400']];
  const m = engine.modelFromMatrix(rows, 'blobs.csv');
  engine.setParams(m, 4, 0, 10);
  const at = { a1: [0, 0], a2: [24, 0], a3: [400, 0], b1: [0, 120], b2: [24, 120], c1: [200, 300] };
  const byName = {};
  engine.alive(m).forEach((s) => {
    const name = m.rows[s.rowIndex].fields.Name;
    byName[name] = s;
    s.x = at[name][0];
    s.y = at[name][1];
    s.w = s.h = 20;
  });
  if (engine.categoricalKeys(m).map((c) => c.key).join() !== 'Kind') errors.push('blobs: the hand board offered ' + JSON.stringify(engine.categoricalKeys(m)));
  engine.setBlobOn(m, 'Kind', true);
  const inside = (loops, x, y) => loops.filter((l) => engine.pointInPoly(x, y, l.points)).length % 2 === 1;
  const shapes = engine.blobShapes(m);
  const shape = (v) => shapes.find((b) => b.value === v).shape;
  if (shapes.length !== 3) errors.push('blobs: expected 3 blobs, got ' + shapes.length);
  shapes.forEach((b) => {
    b.members.forEach((s) => {
      for (const [x, y] of [[s.x, s.y], [s.x + s.w, s.y], [s.x, s.y + s.h], [s.x + s.w, s.y + s.h], [s.x + s.w / 2, s.y + s.h / 2]]) {
        if (!inside(b.shape.loops, x, y)) errors.push('blobs: a corner of ' + m.rows[s.rowIndex].fields.Name + ' is outside its ' + b.value + ' blob');
      }
    });
    engine.alive(m).forEach((s) => {
      if (b.members.indexOf(s) >= 0) return;
      const corners = [[s.x, s.y], [s.x + s.w, s.y], [s.x, s.y + s.h], [s.x + s.w, s.y + s.h]];
      if (corners.some(([x, y]) => inside(b.shape.loops, x, y))) errors.push('blobs: ' + m.rows[s.rowIndex].fields.Name + ' reaches into the ' + b.value + ' blob');
    });
  });
  const aLoops = shape('a').loops.filter((l) => !l.hole).length;
  if (aLoops !== 2) errors.push('blobs: the far member did not split into its own island (' + aLoops + ' islands)');
  if (shape('b').loops.length !== 1) errors.push('blobs: the close pair did not merge (' + shape('b').loops.length + ' loops)');
  // The gap between a close pair is filled; the offset reaches past the rect.
  if (!inside(shape('b').loops, 22, 130)) errors.push('blobs: the notch between a close pair is open');
  const off = engine.blobStyle(m, 'Kind', 'b').offset;
  if (!inside(shape('b').loops, -off * 0.6, 130) || inside(shape('b').loops, -off - 1.5, 130)) errors.push('blobs: the outline is not the offset away from its members');
  out.islands = { a: aLoops, b: shape('b').loops.length, c: shape('c').loops.length };

  // Grabbing a blob: a press on its fill between stickies picks that blob,
  // whose members (with their groups) are what a drag moves.
  const drawn = engine.blobCache().update(m);
  const grab = engine.blobPick(drawn, 22, 130, 0.5);
  const grabbed = grab ? grab.members.map((s) => m.rows[s.rowIndex].fields.Name).sort().join() : '';
  if (grabbed !== 'b1,b2') errors.push('blobs: a press between b1 and b2 grabbed ' + (grabbed || 'nothing'));
  if (engine.blobPick(drawn, 120, 60, 0.5)) errors.push('blobs: a press on the open board grabbed a blob');
  byName.b1.group = byName.c1.group = 'gx';
  const moves = engine.expandToGroups(m, grab ? grab.members.map((s) => s.id) : []);
  if (moves.indexOf(byName.c1.id) < 0 || moves.length !== 3) errors.push('blobs: a grabbed blob did not bring its members\u2019 groups');
  byName.b1.group = byName.c1.group = null;
  out.grab = grabbed;

  // The cache rebuilds only what changed.
  const cache = engine.blobCache();
  const version = (list, v) => list.find((e) => e.value === v).version;
  let list = cache.update(m);
  if (cache.computed !== 3) errors.push('blobs: first update built ' + cache.computed);
  list = cache.update(m);
  if (cache.computed !== 0) errors.push('blobs: an idle update rebuilt ' + cache.computed);
  const vb = version(list, 'b');
  const va = version(list, 'a');
  byName.b1.x -= 3;
  list = cache.update(m, 0);
  if (cache.computed !== 0 || cache.stale !== 1) errors.push('blobs: a throttled update did not defer (computed ' + cache.computed + ', stale ' + cache.stale + ')');
  list = cache.update(m);
  if (cache.computed !== 1 || version(list, 'b') !== vb + 1 || version(list, 'a') !== va) errors.push('blobs: moving b1 did not rebuild exactly its blob');
  // A budget of one per call still reaches every changed blob in turn:
  // the one that waited goes first, even while another keeps changing.
  byName.a1.x -= 1;
  byName.b1.x -= 1;
  list = cache.update(m, 0);
  const v0 = { a: version(list, 'a'), b: version(list, 'b') };
  list = cache.update(m, 1);
  const built = version(list, 'a') > v0.a ? 'a' : 'b';
  const other = built === 'a' ? 'b' : 'a';
  byName[built + '1'].x -= 1;
  list = cache.update(m, 1);
  if (version(list, other) === v0[other]) errors.push('blobs: a limited update starved a changed blob');
  cache.update(m);
  engine.setBlobStyle(m, 'Kind', 'a', 'color', '#123456');
  engine.setBlobStyle(m, 'Kind', 'a', 'alpha', 0.4);
  list = cache.update(m);
  if (cache.computed !== 0 || list.find((e) => e.value === 'a').style.color !== '#123456') errors.push('blobs: a colour change rebuilt an outline or was not seen');
  engine.setBlobStyle(m, 'Kind', 'a', 'offset', 12);
  list = cache.update(m);
  if (cache.computed !== 1) errors.push('blobs: an offset change rebuilt ' + cache.computed);
  engine.setParams(m, 20, 0, 10);
  list = cache.update(m);
  if (cache.computed !== 3) errors.push('blobs: a buffer change rebuilt ' + cache.computed + ' of 3');
  // "Hide this group" is gone and nothing could unhide a group, so a board
  // saved with a hidden flag loads with that blob back and the flag dropped.
  const legacy = JSON.parse(JSON.stringify(engine.capture(m)));
  legacy.blobs.keys.Kind.values.c = { hidden: true };
  legacy.blobs.keys.Kind.values.a = Object.assign({}, legacy.blobs.keys.Kind.values.a, { hidden: true });
  const unhidden = engine.restore(legacy);
  const uk = unhidden.blobs.keys.Kind.values;
  if (uk.c || (uk.a && 'hidden' in uk.a) || (uk.a && uk.a.color !== '#123456')) errors.push('blobs: a legacy hidden flag survived restore: ' + JSON.stringify(unhidden.blobs.keys.Kind.values));
  if (!engine.blobGroups(unhidden).some((g) => g.value === 'c') || JSON.stringify(engine.capture(unhidden)).indexOf('hidden') >= 0) errors.push('blobs: a legacy hidden group does not draw again');
  engine.setBlobStyle(m, 'Kind', null, 'singles', false);
  if (cache.update(m).some((e) => e.value === 'c')) errors.push('blobs: a single sticky still draws with singles off');

  // Settings survive capture and restore (undo, the zip, localStorage),
  // and the scope "all" clears each value's own setting.
  engine.setBlobStyle(m, 'Kind', null, 'color', '#2a9d9a');
  if (engine.blobStyle(m, 'Kind', 'a').color !== '#2a9d9a') errors.push('blobs: "All" did not override a value\'s colour');
  const back = engine.restore(JSON.parse(JSON.stringify(engine.capture(m))));
  if (JSON.stringify(engine.capture(back).blobs) !== JSON.stringify(engine.capture(m).blobs)) errors.push('blobs: settings changed across capture/restore');
  const junk = engine.restore(Object.assign(JSON.parse(JSON.stringify(engine.capture(m))), { blobs: { on: ['Kind', 'Nope', 3], keys: { Kind: { offset: -5, color: 'red', alpha: 9, values: { a: { color: '#ABCDEF', hidden: 'yes' } } } } } }));
  const jk = junk.blobs.keys.Kind;
  if (junk.blobs.on.join() !== 'Kind' || jk.offset !== 0 || jk.color !== null || jk.alpha !== 1 || jk.values.a.color !== '#abcdef' || jk.values.a.hidden) errors.push('blobs: bad settings were not cleaned: ' + JSON.stringify(junk.blobs));

  // The 3DM scene carries one closed polyline per island.
  const scene = engine.buildCadScene(m, {});
  const cadA = scene.blobs.filter((b) => b.value === 'a');
  if (cadA.length !== 2 || !cadA.every((b) => b.closed && b.key === 'Kind' && b.color === '#2a9d9a' && b.points.length >= 8)) errors.push('blobs: the cad scene blobs are wrong: ' + JSON.stringify(scene.blobs.map((b) => [b.value, b.points.length, b.closed, b.color])));
  out.cad = scene.blobs.length;
  if (!scene.blobs.every((b) => Array.isArray(b.segs) && b.segs.length >= 4)) errors.push('blobs: the cad scene blobs carry no line/arc contour');

  out.geometry = testBlobGeometry(errors);

  // Timing: 200 stickies, Department and Group on.
  const big = inflated(200);
  engine.pack(big);
  engine.setBlobOn(big, 'Department', true);
  engine.setBlobOn(big, 'Group', true);
  const timed = engine.blobCache();
  let t = process.hrtime.bigint();
  const all = timed.update(big);
  out.build200 = { blobs: all.length, ms: Math.round(ms(t) * 10) / 10 };
  const one = engine.alive(big)[5];
  const times = [];
  for (let i = 0; i < 40; i++) {
    one.x += 0.7;
    t = process.hrtime.bigint();
    timed.update(big);
    times.push(ms(t));
  }
  times.sort((p, q) => p - q);
  out.moveOne200 = { rebuilt: timed.computed, avg: Math.round((times.reduce((p, q) => p + q, 0) / times.length) * 100) / 100, p95: Math.round(times[Math.floor(times.length * 0.95)] * 100) / 100 };
  out.perBlob = Math.round((out.build200.ms / Math.max(1, all.length)) * 100) / 100;
  return out;
}

// The exact contour: straight runs at exactly the offset, convex corners
// of radius offset (plus the sticky's own fillet), concave junctions
// filleted tangent to both sides, no self-crossings, and nothing on the
// outline nearer a member than the offset.
function testBlobGeometry(errors) {
  const B = require('./blob.js');
  const I = B.internals;
  const out = {};
  const TOL = 0.01;
  const off = 5;
  const sm = 6;
  const piece = (p) => (p.k === 0 ? I.line(p.x0, p.y0, p.x1, p.y1) : I.arc(p.cx, p.cy, p.r, p.a0, p.da));
  const segsOf = (shape) => shape.loops.reduce((a, l) => a.concat(l.segs || []), []);
  const distRect = (q, x, y) => {
    const rs = Math.max(0, Math.min(q.radius || 0, q.w / 2, q.h / 2));
    const dx = Math.max(q.x + rs - x, 0, x - (q.x + q.w - rs));
    const dy = Math.max(q.y + rs - y, 0, y - (q.y + q.h - rs));
    return Math.hypot(dx, dy) - rs;
  };
  const minDist = (rects, shape) => {
    let d = Infinity;
    shape.loops.forEach((l) => l.points.forEach(([x, y]) => rects.forEach((q) => (d = Math.min(d, distRect(q, x, y))))));
    return d;
  };
  // Largest direction change where one piece meets the next, in degrees.
  const worstJoint = (shape) => {
    let worst = 0;
    shape.loops.forEach((l) => {
      for (let i = 0; i < l.segs.length; i++) {
        const a = I.tangentAt(piece(l.segs[i]), 1);
        const b = I.tangentAt(piece(l.segs[(i + 1) % l.segs.length]), 0);
        worst = Math.max(worst, Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1])) * 180 / Math.PI);
      }
    });
    return worst;
  };
  // Largest direction change between consecutive samples of the outline.
  const worstSample = (shape) => {
    let worst = 0;
    shape.loops.forEach((l) => {
      const p = l.points;
      for (let i = 0; i < p.length; i++) {
        const a = p[i];
        const b = p[(i + 1) % p.length];
        const c = p[(i + 2) % p.length];
        const t1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const t2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
        let dt = Math.abs(t2 - t1);
        if (dt > Math.PI) dt = 2 * Math.PI - dt;
        worst = Math.max(worst, dt * 180 / Math.PI);
      }
    });
    return worst;
  };
  const crossings = (shape) => {
    const all = segsOf(shape).map(piece);
    let n = 0;
    const hits = [];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        hits.length = 0;
        I.intersect(all[i], all[j], 1e-7, hits);
        for (const [t, u] of hits) if (!((t < 1e-6 || t > 1 - 1e-6) && (u < 1e-6 || u > 1 - 1e-6))) n += 1;
      }
    }
    return n;
  };
  const check = (name, rects, o, s) => {
    const shape = engine.blobShape(rects, o, s);
    const segs = segsOf(shape);
    if (!segs.length) {
      errors.push('blobs: ' + name + ' fell back to the raster outline');
      return { shape: shape, segs: segs };
    }
    const d = minDist(rects, shape);
    if (Math.abs(d - o) > TOL) errors.push('blobs: ' + name + ' comes ' + d.toFixed(4) + ' from its members, not the offset ' + o);
    const x = crossings(shape);
    if (x) errors.push('blobs: ' + name + ' crosses itself ' + x + ' times');
    const j = worstJoint(shape);
    if (j > 0.01) errors.push('blobs: ' + name + ' kinks ' + j.toFixed(3) + '\u00b0 where two pieces meet');
    out[name] = { segs: segs.length, arcs: segs.filter((p) => p.k === 1).length, minDist: Math.round(d * 1e4) / 1e4, worstSampleTurn: Math.round(worstSample(shape) * 100) / 100 };
    return { shape: shape, segs: segs };
  };
  const lines = (segs) => segs.filter((p) => p.k === 0);
  const near = (a, b) => Math.abs(a - b) <= TOL;

  // Touching, then aligned across a gap: one straight run on each side,
  // exactly the offset out.
  for (const [name, rects] of [
    ['touching', [{ x: 0, y: 0, w: 20, h: 20 }, { x: 20, y: 0, w: 30, h: 20 }]],
    ['aligned', [{ x: 0, y: 0, w: 20, h: 20 }, { x: 30, y: 0, w: 20, h: 20 }]],
  ]) {
    const { segs } = check(name, rects, off, sm);
    const ls = lines(segs);
    const top = ls.filter((p) => near(p.y0, -off) && near(p.y1, -off));
    const bottom = ls.filter((p) => near(p.y0, 20 + off) && near(p.y1, 20 + off));
    const left = ls.filter((p) => near(p.x0, -off) && near(p.x1, -off));
    const right = ls.filter((p) => near(p.x0, 50 + off) && near(p.x1, 50 + off));
    if (segs.length !== 8 || top.length !== 1 || bottom.length !== 1 || left.length !== 1 || right.length !== 1) errors.push('blobs: ' + name + ' rects did not give four straight offset sides (' + JSON.stringify(segs.map((p) => p.k)) + ')');
    if (top.length && !(near(Math.min(top[0].x0, top[0].x1), 0) && near(Math.max(top[0].x0, top[0].x1), 50))) errors.push('blobs: ' + name + ' top run does not span both members');
    segs.filter((p) => p.k === 1).forEach((p) => {
      if (!near(p.r, off)) errors.push('blobs: ' + name + ' convex corner radius ' + p.r + ' is not the offset ' + off);
    });
  }

  // A rounded sticky: its corners are its own fillet plus the offset.
  {
    const { segs } = check('rounded', [{ x: 0, y: 0, w: 30, h: 20, radius: 4 }], off, sm);
    if (!segs.filter((p) => p.k === 1).every((p) => near(p.r, 4 + off))) errors.push('blobs: a rounded sticky\'s corner is not its radius plus the offset');
  }

  // The stepped pair (a wide sticky over a narrower, inset one): straight
  // offset runs, one concave fillet of the smoothing radius where the
  // narrow one's side meets the wide one's underside, no kink anywhere.
  {
    const rects = [{ x: 0, y: 0, w: 70, h: 47 }, { x: 21, y: 57, w: 49, h: 58 }];
    const { shape, segs } = check('stepped', rects, off, sm);
    const concave = segs.filter((p) => p.k === 1 && p.da < 0);
    if (concave.length !== 1 || !near(concave[0].r, sm)) errors.push('blobs: the stepped pair has no single concave fillet of radius ' + sm + ': ' + JSON.stringify(concave));
    if (!lines(segs).some((p) => near(p.x0, 21 - off) && near(p.x1, 21 - off))) errors.push('blobs: the narrow member\'s side is not a straight run at the offset');
    if (!lines(segs).some((p) => near(p.y0, 47 + off) && near(p.y1, 47 + off))) errors.push('blobs: the wide member\'s underside is not a straight run at the offset');
    if (shape.loops.length === 1 && worstSample(shape) > 6) errors.push('blobs: the stepped outline turns ' + worstSample(shape).toFixed(2) + '\u00b0 between samples');
  }

  // Corner to corner: a neck at least twice the offset wide, not a spike.
  {
    const rects = [{ x: 0, y: 0, w: 20, h: 20 }, { x: 28, y: 28, w: 20, h: 20 }];
    const { shape } = check('diagonal', rects, off, sm);
    if (shape.loops.length !== 1) errors.push('blobs: corner-to-corner members did not join');
  }

  // Six members with gaps of every kind, on the board's own buffer.
  {
    const rects = [
      { x: 0, y: 0, w: 30, h: 20 },
      { x: 40, y: 0, w: 20, h: 35 },
      { x: 0, y: 30, w: 25, h: 25, radius: 3 },
      { x: 35, y: 45, w: 40, h: 15 },
      { x: 70, y: 5, w: 15, h: 30 },
      { x: 10, y: 65, w: 55, h: 12 },
    ];
    const { shape } = check('cluster', rects, off, sm);
    if (shape.loops.filter((l) => !l.hole).length !== 1) errors.push('blobs: the cluster did not wrap as one island');
  }

  // Far apart: separate islands, each exactly offset.
  {
    const { shape } = check('apart', [{ x: 0, y: 0, w: 20, h: 20 }, { x: 60, y: 0, w: 20, h: 20 }], off, sm);
    if (shape.loops.length !== 2) errors.push('blobs: members far apart merged');
  }

  // A fractional offset is exact: 1.37 ft out, corners of radius 1.37, and
  // the same float in the 3DM scene and the SVG.
  {
    const frac = 1.37;
    const rects = [{ x: 0, y: 0, w: 20, h: 20 }, { x: 30, y: 4, w: 20, h: 12 }];
    const { segs } = check('fractional', rects, frac, sm);
    if (!lines(segs).some((p) => near(p.y0, -frac) && near(p.y1, -frac))) errors.push('blobs: the 1.37 ft offset has no straight run at y = -1.37');
    if (!segs.filter((p) => p.k === 1 && p.da > 0).every((p) => Math.abs(p.r - frac) < 1e-9)) errors.push('blobs: a convex corner is not exactly 1.37 ft');
    const rows = [['Name', 'Kind', 'Area'], ['f1', 'f', '400'], ['f2', 'f', '240']];
    const fm = engine.modelFromMatrix(rows, 'frac.csv');
    engine.setParams(fm, 10, 0, 10);
    engine.alive(fm).forEach((s, i) => Object.assign(s, rects[i]));
    engine.setBlobOn(fm, 'Kind', true);
    engine.setBlobStyle(fm, 'Kind', 'f', 'offset', frac);
    const back = engine.restore(JSON.parse(JSON.stringify(engine.capture(fm))));
    if (engine.blobStyle(back, 'Kind', 'f').offset !== frac) errors.push('blobs: a 1.37 ft offset did not survive capture and restore');
    const board = engine.blobShapes(back)[0];
    const d = minDist(rects, board.shape);
    if (Math.abs(d - frac) > TOL) errors.push('blobs: the board draws a 1.37 ft offset at ' + d.toFixed(4));
    const cadSegs = engine.buildCadScene(back, {}).blobs[0].segs;
    if (!cadSegs || !cadSegs.some((p) => p.k === 1 && Math.abs(p.r - frac) < 1e-9)) errors.push('blobs: the 3DM scene lost the 1.37 ft corner radius');
    if (B.svgPath(board.shape.loops).indexOf('A1.37 1.37') < 0) errors.push('blobs: the SVG lost the 1.37 ft corner radius');
    out.fractional.boardMinDist = Math.round(d * 1e4) / 1e4;
  }

  // The last-resort outline (no smoothing, no bridges) is still exact
  // lines and arcs at the offset.
  {
    const rects = [{ x: 0, y: 0, w: 20, h: 20 }, { x: 10, y: 15, w: 20, h: 20 }];
    const plain = I.finish(I.build(rects, 2.5, 0, false), 0, 1);
    const d = minDist(rects, plain);
    if (!plain.loops.length || !plain.loops[0].segs || Math.abs(d - 2.5) > TOL || crossings(plain)) errors.push('blobs: the unsmoothed fallback is not an exact offset (' + d + ')');
  }

  // The fallback still draws when the exact build is unavailable.
  const raster = engine.blobRaster([{ x: 0, y: 0, w: 20, h: 20 }], off, sm);
  if (!raster.loops.length || raster.loops[0].segs) errors.push('blobs: the raster fallback is broken');

  // SVG keeps real arcs.
  const svg = B.svgPath(engine.blobShape([{ x: 0, y: 0, w: 20, h: 20 }], off, sm).loops);
  if ((svg.match(/A/g) || []).length !== 4) errors.push('blobs: the SVG outline lost its arcs: ' + svg);

  // Timing for one busy blob: 60 stickies on the board's buffer.
  const many = [];
  for (let i = 0; i < 60; i++) many.push({ x: (i % 10) * 28 + (i % 3) * 2, y: Math.floor(i / 10) * 30 + (i % 4) * 1.5, w: 16 + (i % 5) * 1, h: 18 + (i % 3) * 1 });
  let big = engine.blobShape(many, off, sm);
  const runs = [];
  for (let i = 0; i < 5; i++) {
    const t = process.hrtime.bigint();
    big = engine.blobShape(many, off, sm);
    runs.push(ms(t));
  }
  runs.sort((p, q) => p - q);
  out.sixtyMembersMs = Math.round(runs[2] * 100) / 100;
  if (!big.loops.length || !big.loops[0].segs) errors.push('blobs: the 60-member blob fell back to the raster outline');
  return out;
}

// Spreadsheet order: duplicates insert after their source row; metadata
// edits re-sort a row into its cluster; the order survives the save zip,
// including the fuzzy merge.
async function testRowOrder(errors) {
  const out = {};
  const tag = (f) => f.Department + '|' + f.Group + '|' + f.Space;
  const order = (m) => m.rows.filter((r) => !r.dropped).map((r) => tag(r.fields));
  const find = (m, dept, group, space) => engine.alive(m).find((s) => { const f = m.rows[s.rowIndex].fields; return f.Department === dept && f.Group === group && f.Space === space; });
  const csvLines = (m) => engine.exportCsv(m).replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);
  const without = (list, drop) => list.filter((t, i) => drop.indexOf(i) < 0);

  // Duplicates.
  let m = engine.modelFromCsv(csv, 'sample.csv');
  engine.pack(m);
  engine.frameAround(m);
  engine.setParams(m, 10, 0, 10);
  const before = csvLines(m);
  const hb = find(m, 'Department A', 'Group A2', 'Room A08');
  const k = hb.rowIndex;
  const [copy] = engine.duplicateStickies(m, [hb.id]);
  if (copy.rowIndex !== k + 1 || hb.rowIndex !== k) errors.push('rows: a duplicate row did not land right after its source (' + copy.rowIndex + ' vs ' + k + ')');
  let after = csvLines(m);
  if (after[k + 2] !== after[k + 1] || JSON.stringify(without(after, [k + 2])) !== JSON.stringify(before)) errors.push('rows: the CSV does not show the duplicate right after its source');
  // A locked group: a new group, each row after its own source.
  const g1 = find(m, 'Department B', '', 'Room B15');
  const g2 = find(m, 'Department G', '', 'Room G02');
  engine.groupStickies(m, [g1.id, g2.id]);
  const lines0 = csvLines(m);
  const copies = engine.duplicateStickies(m, [g1.id, g2.id]);
  after = csvLines(m);
  if (!copies[0].group || copies[0].group !== copies[1].group || copies[0].group === g1.group) errors.push('rows: duplicating a group did not make a new group');
  if (copies.some((c, i) => c.rowIndex !== [g1, g2][i].rowIndex + 1)) errors.push('rows: group duplicates are not right after their sources');
  if (JSON.stringify(without(after, [copies[0].rowIndex + 1, copies[1].rowIndex + 1])) !== JSON.stringify(lines0)) errors.push('rows: group duplication disturbed other rows');
  // Ctrl+D placement: one buffer clear of everything, inside the frame.
  // A group spread across a tightly framed, packed board fits nowhere as
  // one body: it shifts off its originals and the caller settles it.
  // Force an over-wide rigid group instead of relying on a particular CSV's
  // packed geometry to make the duplicate unplaceable.
  const copyPositions = copies.map((c) => ({ x: c.x, y: c.y }));
  copies[1].x = copies[0].x + m.frame.w + 10;
  const at0 = copies.map((c) => c.x);
  if (engine.placeCopies(m, copies, 10) || copies.some((c, i) => !(c.x > at0[i]))) errors.push('rows: an unplaceable group did not shift off its originals');
  copies.forEach((c, i) => Object.assign(c, copyPositions[i]));
  const wall = engine.frameInner(m.frame, 10);
  engine.settleNow(m, [], {});
  const dup = engine.duplicateStickies(m, [hb.id]);
  const hbAt = { x: hb.x, y: hb.y };
  const placed = engine.placeCopies(m, dup, 10);
  const crowd = dup.some((c) => engine.alive(m).some((o) => dup.indexOf(o) < 0 && engine.mtv(o, c, 10 - 1e-6)) || c.x < wall.x0 - 1e-6 || c.y < wall.y0 - 1e-6 || c.x + c.w > wall.x1 + 1e-6 || c.y + c.h > wall.y1 + 1e-6);
  if (!placed || crowd) errors.push('rows: placed copies are not one buffer clear inside the frame');
  out.duplicate = { sourceRow: k, copyRow: copy.rowIndex, groupCopies: copies.map((c) => c.rowIndex), placedOffset: [Math.round(dup[0].x - hbAt.x), Math.round(dup[0].y - hbAt.y)] };

  // Re-sort rules.
  m = engine.modelFromCsv(csv, 'sample.csv');
  if (engine.rowHierarchy(m).join() !== 'Department,Group') errors.push('rows: the sample hierarchy is ' + engine.rowHierarchy(m).join());
  const moved = (label, before0, after0, was, t, wantAfter) => {
    const rest = after0.filter((x) => x !== t);
    if (JSON.stringify(rest) !== JSON.stringify(before0.filter((x) => x !== was))) errors.push('rows: ' + label + ' changed the order of other rows');
    const at = after0.indexOf(t);
    if (after0[at - 1] !== wantAfter) errors.push('rows: ' + label + ' put the row after ' + after0[at - 1] + ', not ' + wantAfter);
    return at;
  };
  const edit = (dept, group, space, key, value, wantAfter, label) => {
    const s = find(m, dept, group, space);
    const o0 = order(m);
    const was = tag(m.rows[s.rowIndex].fields);
    engine.setField(m, [s.id], key, value);
    const f = m.rows[s.rowIndex].fields;
    return moved(label, o0, order(m), was, tag(f), wantAfter);
  };
  const rules = {};
  rules.department = edit('Department G', '', 'Room G02', 'Department', 'Department B', 'Department B||Room B17', 'a department change');
  rules.group = edit('Department A', 'Group A2', 'Room A06', 'Group', 'Group A3', 'Department A|Group A3|Room A09', 'a group change');
  rules.newGroup = edit('Department A', 'Group A2', 'Room A07', 'Group', 'Zeta Test Group', 'Department A|Group A7|Room A16', 'a new group');
  rules.newGroupInOtherDept = edit('Department A', 'Group A5', 'Room A13', 'Department', 'Department B', 'Department B||Room G02', 'a department change with a group new there');
  const lastRow = order(m)[order(m).length - 1];
  rules.newDepartment = edit('Department E', 'Group E3', 'Room E11', 'Department', 'Zeta Test Department', lastRow, 'a new department');
  // Bulk edits: the edited rows land together, in their old order.
  const bulk = (picks, key, value, wantAfter, label) => {
    const list = picks.map((p) => find(m, p[0], p[1], p[2]));
    const o0 = order(m);
    engine.setField(m, list.map((s) => s.id), key, value);
    const o1 = order(m);
    const tags = list.map((s) => tag(m.rows[s.rowIndex].fields));
    const at = tags.map((t) => o1.indexOf(t));
    if (at.some((p, i) => i && p !== at[i - 1] + 1) || o1[at[0] - 1] !== wantAfter) errors.push('rows: ' + label + ' did not land together after ' + wantAfter + ': ' + JSON.stringify(at));
    if (JSON.stringify(o1.filter((t) => tags.indexOf(t) < 0)) !== JSON.stringify(o0.filter((t) => o1.indexOf(t) >= 0 && tags.indexOf(t) < 0))) errors.push('rows: ' + label + ' disturbed other rows');
    return at;
  };
  rules.bulkGroup = bulk([['Department A', 'Group A1', 'Room A02'], ['Department A', 'Group A2', 'Room A08'], ['Department A', 'Group A4', 'Room A11']], 'Group', 'Group A7', 'Department A|Group A7|Room A16', 'a bulk group edit');
  rules.bulkDepartment = bulk([['Department B', '', 'Room B15'], ['Department B', '', 'Room B16'], ['Department F', '', 'Room F01']], 'Department', 'Department G', 'Department G||Room G05', 'a bulk department edit');
  // Name, area, and other columns never move a row.
  const still = order(m);
  const s0 = find(m, 'Department C', 'Group C2', 'Room C13');
  engine.setField(m, [s0.id], 'Space', 'Room C13 edited');
  engine.setField(m, [s0.id], 'SubTotal', '1200');
  engine.setField(m, [s0.id], 'Notes', 'moved?');
  engine.setField(m, [s0.id], 'Qty', '4');
  if (JSON.stringify(order(m).map((t) => t.replace('Room C13 edited', 'Room C13'))) !== JSON.stringify(still)) errors.push('rows: a name, area, or plain column edit moved a row');
  out.rules = rules;

  // The order survives the save zip, exactly and through the fuzzy merge.
  engine.pack(m);
  engine.frameAround(m);
  engine.setParams(m, 10, 0, 10);
  const byId = (mm) => new Map(engine.alive(mm).map((s) => [s.id, tag(mm.rows[s.rowIndex].fields) + '|' + Math.round(s.x) + ',' + Math.round(s.y)]));
  const truth = byId(m);
  const saved = await engine.buildSave(m, { grid: false, gridStep: 10 }, null, { app: 'test' });
  const parts = await engine.readSaveZip(saved.bytes.buffer.slice(0));
  const same = (mm, label) => {
    const got = byId(mm);
    let bad = 0;
    truth.forEach((v, id) => { if (got.get(id) !== v) bad += 1; });
    if (bad || JSON.stringify(order(mm)) !== JSON.stringify(order(m))) errors.push('rows: ' + label + ' lost the re-sorted order or a sticky (' + bad + ')');
  };
  const exact = engine.openSave(parts);
  if (!exact.summary.exact) errors.push('rows: the re-sorted save did not restore exactly');
  same(exact.model, 'zip restore');
  same(engine.openSave({ csvText: parts.csvText, csvName: 'sample.csv', layout: parts.layout }).model, 'separate-file restore');
  // Edited outside: the re-sorted row gets a note, another row a new area.
  const matrix = engine.parseCsv(parts.csvText);
  const head = matrix[0];
  const mail = matrix.find((r) => r[head.indexOf('Space')] === 'Room G02');
  mail[head.indexOf('Notes')] = 'edited outside';
  const tele = matrix.find((r) => r[head.indexOf('Space')] === 'Room A13');
  tele[head.indexOf('Comments')] = 'also edited';
  const merged = engine.openSave({ csvText: engine.matrixToCsv(matrix), csvName: 'sample.csv', layout: parts.layout, manifest: parts.manifest, csvBytes: new TextEncoder().encode(engine.matrixToCsv(matrix)) });
  if (merged.summary.exact || merged.summary.restored !== truth.size || merged.summary.added || merged.summary.removed) errors.push('rows: the fuzzy merge after a re-sort: ' + JSON.stringify(merged.summary));
  same(merged.model, 'fuzzy merge');
  const mailSticky = engine.alive(merged.model).find((s) => merged.model.rows[s.rowIndex].fields.Space === 'Room G02');
  if (!mailSticky || merged.model.rows[mailSticky.rowIndex].fields.Notes !== 'edited outside') errors.push('rows: the re-sorted row lost its outside edit');
  out.restore = { exact: exact.summary, merged: merged.summary };

  // Another sheet: clustered columns become levels; a scattered one does not.
  const rows = [['Floor', 'Zone', 'Tag', 'Name', 'Area']];
  const tags = ['x', 'y', 'z'];
  let n = 0;
  for (const floor of ['F1', 'F2', 'F3']) for (const zone of ['A', 'B', 'C']) for (let i = 0; i < 3; i++) rows.push([floor, zone, tags[n++ % 3], 'R' + n, '100']);
  const other = engine.modelFromMatrix(rows, 'other.csv');
  out.otherHierarchy = engine.rowHierarchy(other);
  if (out.otherHierarchy.join() !== 'Floor,Zone') errors.push('rows: another sheet gave levels ' + out.otherHierarchy.join());
  const r5 = engine.alive(other).find((s) => other.rows[s.rowIndex].fields.Name === 'R5');
  engine.setField(other, [r5.id], 'Floor', 'F3');
  const ord = other.rows.map((r) => r.fields.Name);
  if (ord[ord.indexOf('R5') - 1] !== 'R24') errors.push('rows: another sheet placed R5 after ' + ord[ord.indexOf('R5') - 1]);

  // Grey fields read from commonField: empty on all is empty; mixed is not.
  const gm = engine.modelFromCsv(csv, 'sample.csv');
  const ids = engine.alive(gm).slice(0, 3).map((s) => s.id);
  const empty = engine.commonField(gm, ids, 'Comments');
  engine.setField(gm, [ids[2]], 'Comments', 'Synthetic test note');
  const mixed = engine.commonField(gm, [ids[0], ids[2]], 'Comments');
  if (empty.mixed || empty.value !== '' || !mixed.mixed) errors.push('rows: empty/mixed detection for grey fields is wrong');
  return out;
}

(async () => {
// Exercise quoted CSV parsing with an authored test note; the public fixture
// contains no client comments or notes.
const selfTestMatrix = engine.parseCsv(csv);
selfTestMatrix[1][selfTestMatrix[0].indexOf('Notes')] = 'Synthetic quoted quantity: 1,500';
const errors = engine.selfTest(engine.matrixToCsv(selfTestMatrix));
const rowCheck = await testRowOrder(errors);
const blobCheck = testBlobs(errors);
const collisions = testCollisions(errors);
const zipCheck = await testZip(errors);
const saveCheck = await testSaveRestore(errors);
const crowd200 = timeCrowd(200);
if (crowd200.crossesLine) errors.push('the crowd drag at 200 crossed a line');
if (crowd200.worstMs > 16) errors.push('the crowd drag at 200 took ' + crowd200.worstMs + ' ms in one step');
const herd200 = timeHerd(200);
if (herd200.crossesLine) errors.push('a sticky crossed the herding line at 200');
if (herd200.outside) errors.push('herding at 200 pushed ' + herd200.outside + ' stickies out of the frame');
if (herd200.worstMs > 16) errors.push('herding at 200 took ' + herd200.worstMs + ' ms in one step');
const cadModel = engine.modelFromCsv(csv, 'sample.csv');
engine.pack(cadModel);
engine.frameAround(cadModel);
const cad = engine.buildCadScene(cadModel, { font: 'Inter' });
const cadArea = cad.stickies.reduce((sum, s) => sum + s.area, 0);
if (cad.stickies.length !== engine.alive(cadModel).length) errors.push('cad scene dropped a sticky');
if (Math.abs(cadArea - engine.summarize(cadModel).area) > cad.stickies.length) errors.push('cad scene areas drifted');
const model = engine.modelFromCsv(csv, 'sample.csv');
engine.pack(model);
const step69 = timeStep(0);
const step200 = timeStep(200);
const bundle69 = timeBundle(0);
const bundle200 = timeBundle(200);
if (bundle200.overlaps) errors.push('bundle at 200 left an overlap');
console.log(JSON.stringify({
  summary: engine.summarize(model),
  step: [step69, step200],
  bundle: [bundle69, bundle200],
  crowd: crowd200,
  herd: herd200,
  cad: { stickies: cad.stickies.length, area: cadArea, frame: !!cad.frame, bytes: JSON.stringify(cad).length },
  zip: zipCheck,
  save: saveCheck,
  blobs: blobCheck,
  rows: rowCheck,
  collisions: collisions,
  errors: errors,
}, null, 2));
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('selfTest ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
