'use strict';

// node test-cad.js
// Exports a sample board with cad.js, writes it to %TEMP%, and reads it back
// with the same vendored rhino3dm to check what Rhino will see.

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cad = require('./cad.js');
const blobKit = require('./blob.js');

const OUT = path.join(os.tmpdir(), 'program-board-sample.3dm');
const DEPTS = [
  { name: 'Research Space', fill: '#9fc5e8' },
  { name: 'Administration', fill: '#f4cccc' },
  { name: 'Shared Support', fill: '#d9ead3' },
  { name: 'Building Support', fill: '#3d4a5c' },
];
const UNICODE_NAME = 'Caf\u00e9 \u2013 \u201cLab\u201d \ud83d\ude00';

function sampleScene() {
  const stickies = [];
  for (let i = 0; i < 70; i++) {
    const d = i < 66 ? DEPTS[i % DEPTS.length] : null;
    const w = 10 + (i % 7) * 4;
    const h = 8 + (i % 5) * 3;
    stickies.push({
      id: 's' + i,
      x: 20 + (i % 10) * 40,
      y: 30 + Math.floor(i / 10) * 32,
      w,
      h,
      radius: [0, 0.5, 1.5, 3][i % 4],
      fill: d ? d.fill : '#fff2cc',
      stroke: 1,
      name: i === 5 ? UNICODE_NAME : 'Room ' + i + (i % 3 ? ' Open Office Workstations' : ''),
      area: w * h,
      department: d ? d.name : '',
      group: 'G' + (i % 3),
      meta: { 'Room Number': String(100 + i), Occupancy: String(i % 9), Area: 'meta must not override' },
    });
  }
  // A radius beyond half the short side becomes a circle: arcs only.
  stickies.push({
    id: 'round', x: 20, y: 300, w: 20, h: 20, radius: 15, fill: '#9fc5e8', stroke: 1,
    name: 'Round', area: 314, department: 'Research Space', group: 'G0', meta: {},
  });
  // A department named like a fixed layer gets its own layer.
  stickies.push({
    id: 'clash', x: 60, y: 300, w: 20, h: 12, radius: 1, fill: '#fff2cc', stroke: 1,
    name: 'Reading', area: 240, department: 'text', group: 'G1', meta: {},
  });
  return {
    units: 'feet',
    title: 'Sample Program',
    frame: { x: 0, y: 0, w: 440, h: 340, radius: 8, title: 'Level 1 Program', fill: '#f7f5f0' },
    stickies,
    lines: [
      { id: 'l1', points: [[0, 0], [100, 50], [200, 50]], width: 2 },
      { id: 'l2', points: [[10, 10], [10, 10], [60, 10]], width: 0.5 },
      { id: 'l3', points: [[5, 5], [5, 5]], width: 1 },
    ],
    texts: [
      { id: 't1', x: 12, y: -40, text: 'North Wing', size: 10, font: 'Replica' },
      { id: 't2', x: 300, y: 350, text: 'Two\nLines', size: 4, font: 'Replica' },
    ],
  };
}

function polygonArea(curve, samples) {
  const d = curve.domain;
  let area = 0;
  let prev = curve.pointAt(d[0]);
  for (let k = 1; k <= samples; k++) {
    const p = curve.pointAt(d[0] + ((d[1] - d[0]) * k) / samples);
    area += prev[0] * p[1] - p[0] * prev[1];
    prev = p;
  }
  return Math.abs(area) / 2;
}

// The boundary loops stored inside a hatch that has been through a file:
// ON_Hatch data starts after the class and class-id chunks (56 bytes), then
// version (1), plane (128), scale and rotation (16), pattern index (4),
// loop count (4); each loop is version (1), type (4: 0 outer, 1 inner), then
// a curve object. Returns [{ type, curve }].
function hatchLoops(rhino, hatch) {
  const json = hatch.toJSON();
  const b = Buffer.from(json.data, 'base64');
  let at = 56 + 1 + 128 + 16 + 4;
  const n = b.readInt32LE(at);
  at += 4;
  const loops = [];
  for (let i = 0; i < n; i++) {
    const type = b.readInt32LE(at + 1);
    at += 5;
    const size = 12 + Number(b.readBigUInt64LE(at + 4));
    loops.push({
      type,
      curve: rhino.CommonObject.decode({
        version: json.version, archive3dm: json.archive3dm, opennurbs: json.opennurbs,
        data: b.subarray(at, at + size).toString('base64'),
      }),
    });
    at += size;
  }
  return loops;
}

function circle(cx, cy, r, n) {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push([cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]);
  return pts;
}

// Two keys. Research Space has two islands, the first with a hole; the
// hole also lies inside the Group blob, which must not claim it. Those are
// points only (the NURBS path). Administration is the real contour of two
// 30 ft stickies 10 ft apart at a 5 ft offset: exact lines and arcs
// spanning 300..380 x 360..400, with corners of radius 5.
const BLOB = {
  RS: '#2f7f9e',
  ADMIN: '#c0567a',
  G0: '#3c9468',
};
const ADMIN_OFFSET = 5;
function adminBlob() {
  const shape = blobKit.wrap([{ x: 305, y: 365, w: 30, h: 30 }, { x: 345, y: 365, w: 30, h: 30 }], ADMIN_OFFSET, 6);
  const [loop] = shape.loops;
  const points = loop.points.concat([loop.points[0]]); // a repeated first point is dropped
  return { key: 'Department', value: 'Administration', segs: loop.segs, points, closed: true, color: BLOB.ADMIN, stroke: 2, hole: false };
}
function sampleBlobs() {
  return [
    { key: 'Group', value: 'G0', points: circle(100, 380, 60, 72), closed: true, color: BLOB.G0, stroke: 0, hole: false },
    { key: 'Department', value: 'Research Space', points: circle(100, 380, 30, 72), closed: true, color: BLOB.RS, hole: false },
    { key: 'Department', value: 'Research Space', points: circle(100, 380, 10, 72).reverse(), closed: true, color: BLOB.RS, hole: true },
    { key: 'Department', value: 'Research Space', points: circle(250, 380, 20, 72), closed: true, color: BLOB.RS, hole: false },
    adminBlob(),
    { key: 'Department', value: 'Nothing', points: [[0, 0], [1, 1]], closed: true, color: BLOB.ADMIN, hole: false },
  ];
}

function near(actual, expected, tol, what) {
  assert.ok(Math.abs(actual - expected) <= tol, what + ': ' + actual + ' vs ' + expected);
}

const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');

async function main() {
  const rhino = await cad.loadRhino();

  // The hand-serialized ON_Hatch matches openNURBS byte for byte when empty.
  const empty = new rhino.Hatch();
  assert.deepEqual(Buffer.from(cad.internals.hatchObject([])), Buffer.from(empty.toJSON().data, 'base64'),
    'empty hatch bytes differ from openNURBS');

  const scene = { ...sampleScene(), blobs: sampleBlobs() };
  const t0 = process.hrtime.bigint();
  const bytes = await cad.export3dm(scene);
  const exportMs = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(bytes instanceof Uint8Array && bytes.length > 1000);
  fs.writeFileSync(OUT, bytes);

  const doc = rhino.File3dm.fromByteArray(bytes);
  assert.ok(doc, 'rhino3dm could not read the export');
  assert.equal(doc.archiveVersion, 70, 'archive version');
  assert.equal(doc.settings().modelUnitSystem, rhino.UnitSystem.Feet, 'model units');

  // Layers.
  const layers = doc.layers();
  const layerPath = [];
  const layerByPath = new Map();
  for (let i = 0; i < layers.count; i++) {
    const layer = layers.get(i);
    layerPath[layer.index] = layer.fullPath;
    layerByPath.set(layer.fullPath, layer);
  }
  const deptLayer = (s) => (s.department === 'text' ? 'text (Program)' : s.department || 'Program');
  const baseLayers = ['Frame', 'Lines', 'Text', 'Program', 'text (Program)', ...DEPTS.map((d) => d.name)];
  const blobLayers = ['Blobs', 'Blobs::Department', 'Blobs::Group'];
  const expectedLayers = baseLayers.concat(blobLayers);
  assert.deepEqual([...layerByPath.keys()].sort(), expectedLayers.slice().sort(), 'layer paths');
  for (const old of ['Stickies', 'Sticky Hatch', 'Sticky Labels']) assert.ok(!layerByPath.has(old), 'no ' + old + ' layer');
  for (const [p, layer] of layerByPath) {
    assert.ok(!p.includes('::') || p.startsWith('Blobs::'), p + ' is top-level or a blob key');
    if (!['Frame', 'Lines', 'Text'].includes(p)) {
      assert.equal(hex(layer.color), hex(cad.internals.NEUTRAL), p + ' layer is neutral');
    }
  }

  // Objects by type and layer.
  const tally = new Map();
  const byId = new Map();
  const blobParts = [];
  const objects = doc.objects();
  for (let i = 0; i < objects.count; i++) {
    const o = objects.get(i);
    const g = o.geometry();
    const a = o.attributes();
    const key = g.constructor.name + ' @ ' + layerPath[a.layerIndex];
    tally.set(key, (tally.get(key) || 0) + 1);
    const part = { g, a, type: g.constructor.name, layer: layerPath[a.layerIndex] };
    const id = a.getUserString('Id');
    if (id) {
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(part);
    }
    if (part.layer.startsWith('Blobs')) blobParts.push(part);
  }
  const count = (type, layer) => tally.get(type + ' @ ' + layer) || 0;
  const stickies = scene.stickies;
  const onLayer = (layer) => stickies.filter((s) => deptLayer(s) === layer).length;
  const curvesOn = (layer) => count('PolyCurve', layer) + count('PolylineCurve', layer);

  let hatches = 0;
  for (const [key, n] of tally) if (key.startsWith('Hatch @') && !key.includes('@ Blobs')) hatches += n;
  assert.equal(hatches, stickies.length, 'sticky hatch count equals sticky count');
  for (const layer of baseLayers.filter((p) => !['Frame', 'Lines', 'Text'].includes(p))) {
    assert.ok(onLayer(layer) > 0, layer + ' has stickies');
    assert.equal(curvesOn(layer), onLayer(layer), layer + ' curves');
    assert.equal(count('Hatch', layer), onLayer(layer), layer + ' hatches');
    assert.equal(count('Text', layer), onLayer(layer), layer + ' labels');
  }
  assert.equal(count('PolyCurve', 'Frame'), 1, 'frame boundary');
  assert.equal(count('Text', 'Frame'), 1, 'frame title');
  assert.equal(count('PolylineCurve', 'Lines'), 2, 'lines (the degenerate one is dropped)');
  assert.equal(count('Text', 'Text'), scene.texts.length, 'texts');
  // Blobs: 5 outlines (one a hole), 4 island hatches, 3 value labels, 3 values.
  const BLOB_OBJECTS = 5 + 4 + 3;
  const BLOB_VALUES = 3;
  assert.equal(doc.groups().count, stickies.length + BLOB_VALUES, 'one group per sticky and per blob value');
  const baseTotal = stickies.length * 3 + 2 + 2 + scene.texts.length;
  assert.equal(objects.count, baseTotal + BLOB_OBJECTS, 'total object count');

  // Every sticky: boundary area and y-flip, hatch, user text, label.
  const probe = new rhino.DimensionStyle();
  for (const s of stickies) {
    const parts = byId.get(s.id);
    const curve = parts.find((p) => p.type === 'PolyCurve' || p.type === 'PolylineCurve');
    const hatch = parts.find((p) => p.type === 'Hatch');
    const label = parts.find((p) => p.type === 'Text');
    assert.ok(curve && hatch && label, s.id + ' parts');
    assert.ok(curve.g.isClosed, s.id + ' closed');
    assert.equal(curve.type, s.radius > 0 ? 'PolyCurve' : 'PolylineCurve', s.id + ' curve type');

    const r = Math.min(s.radius, s.w / 2, s.h / 2);
    const expected = s.w * s.h - (4 - Math.PI) * r * r;
    near(polygonArea(curve.g, 4000), expected, expected * 1e-4, s.id + ' area');

    for (const box of [curve.g.getBoundingBox(), hatch.g.getBoundingBox()]) {
      near(box.min[0], s.x, 1e-6, s.id + ' min x');
      near(box.max[0], s.x + s.w, 1e-6, s.id + ' max x');
      near(box.min[1], -(s.y + s.h), 1e-6, s.id + ' min y (flipped)');
      near(box.max[1], -s.y, 1e-6, s.id + ' max y (flipped)');
      near(box.min[2], 0, 0, s.id + ' z');
    }

    assert.equal(hatch.g.patternIndex, -1, s.id + ' solid pattern');
    assert.ok(hatch.g.isValid, s.id + ' hatch valid');
    const loops = hatchLoops(rhino, hatch.g);
    assert.equal(loops.length, 1, s.id + ' one hatch loop');
    assert.equal(loops[0].type, 0, s.id + ' outer loop');
    assert.equal(loops[0].curve.dimension, 2, s.id + ' hatch loop is 2d');
    assert.ok(loops[0].curve.isClosed, s.id + ' hatch loop closed');
    near(polygonArea(loops[0].curve, 4000), expected, expected * 1e-4, s.id + ' hatch loop area');
    assert.equal(hatch.a.displayOrder, cad.internals.ORDER.STICKY_HATCH, s.id + ' hatch draw order');
    // One layer, one group, colours from the object.
    const groupOf = (p) => p.a.getGroupList();
    for (const p of [curve, hatch, label]) {
      assert.equal(p.layer, deptLayer(s), s.id + ' ' + p.type + ' layer');
      assert.equal(groupOf(p).length, 1, s.id + ' ' + p.type + ' in one group');
      assert.equal(groupOf(p)[0], groupOf(curve)[0], s.id + ' ' + p.type + ' shares the group');
      assert.equal(p.a.colorSource, rhino.ObjectColorSource.ColorFromObject, s.id + ' ' + p.type + ' color source');
      assert.equal(p.a.plotColorSource, rhino.ObjectPlotColorSource.PlotColorFromObject, s.id + ' ' + p.type + ' plot source');
      assert.equal(hex(p.a.plotColor), hex(p.a.objectColor), s.id + ' ' + p.type + ' plot color');
    }
    const fill = { r: parseInt(s.fill.slice(1, 3), 16), g: parseInt(s.fill.slice(3, 5), 16), b: parseInt(s.fill.slice(5, 7), 16) };
    const dark = 0.2126 * fill.r + 0.7152 * fill.g + 0.0722 * fill.b < 128;
    assert.equal(hex(hatch.a.objectColor), s.fill, s.id + ' hatch color');
    assert.equal(hex(label.a.objectColor), dark ? '#ffffff' : hex(cad.internals.INK), s.id + ' label ink');
    const stroke = cad.internals.shade(fill, cad.internals.STROKE_SHADE);
    assert.equal(hex(curve.a.objectColor), hex(stroke), s.id + ' outline color');

    for (const p of [curve, hatch]) {
      if (s.id !== 's5') assert.equal(p.a.getUserString('Name'), s.name, s.id + ' Name');
      assert.equal(p.a.getUserString('Area'), String(s.area), s.id + ' Area');
      assert.equal(p.a.getUserString('Group'), s.group, s.id + ' Group');
      if (s.department) assert.equal(p.a.getUserString('Department'), s.department, s.id + ' Department');
      else assert.equal(p.a.getUserString('Department'), '', s.id + ' no Department');
      for (const [k, v] of Object.entries(s.meta)) {
        if (k !== 'Area') assert.equal(p.a.getUserString(k), v, s.id + ' meta ' + k);
      }
    }

    const areaLine = Math.round(s.area).toLocaleString('en-US') + ' sf';
    assert.ok(label.g.plainText.endsWith(areaLine), s.id + ' label ends with area: ' + JSON.stringify(label.g.plainText));
    const o = label.g.plane.origin;
    assert.ok(o[0] >= s.x && o[0] < s.x + s.w / 2, s.id + ' label x inside the left half');
    assert.ok(o[1] <= -s.y && o[1] > -(s.y + s.h / 2), s.id + ' label top inside the upper half');
    assert.ok(label.g.getTextHeight(probe) > 0, s.id + ' label height');
  }

  // Blobs.
  assert.equal(count('NurbsCurve', 'Blobs::Department'), 3, 'Department point outlines, hole included');
  assert.equal(count('PolyCurve', 'Blobs::Department'), 1, 'the exact Administration outline');
  assert.equal(count('NurbsCurve', 'Blobs::Group'), 1, 'Group outline');
  assert.equal(count('Hatch', 'Blobs::Department'), 3, 'one hatch per Department island, none for the hole');
  assert.equal(count('Hatch', 'Blobs::Group'), 1, 'Group hatch');
  assert.equal(count('Text', 'Blobs::Department'), 2, 'one label per Department value');
  assert.equal(count('Text', 'Blobs::Group'), 1, 'Group label');
  assert.equal(blobParts.filter((p) => p.layer === 'Blobs').length, 0, 'nothing on the Blobs parent layer');
  assert.equal(blobParts.length, BLOB_OBJECTS, 'blob object count');

  const colorOf = { 'Research Space': BLOB.RS, Administration: BLOB.ADMIN, G0: BLOB.G0 };
  const stickyGroups = new Set(stickies.map((s) => byId.get(s.id)[0].a.getGroupList()[0]));
  const groupOfValue = new Map();
  for (const p of blobParts) {
    const key = p.a.getUserString('Key');
    const value = p.a.getUserString('Value');
    const what = key + ': ' + value + ' ' + p.type;
    assert.equal(p.layer, 'Blobs::' + key, what + ' layer');
    assert.equal(p.a.colorSource, rhino.ObjectColorSource.ColorFromObject, what + ' color source');
    assert.equal(hex(p.a.objectColor), colorOf[value], what + ' color');
    assert.equal(p.a.plotColorSource, rhino.ObjectPlotColorSource.PlotColorFromObject, what + ' plot source');
    assert.equal(hex(p.a.plotColor), colorOf[value], what + ' plot color');
    const g = p.a.getGroupList();
    assert.equal(g.length, 1, what + ' in one group');
    assert.ok(!stickyGroups.has(g[0]), what + ' group is not a sticky group');
    if (!groupOfValue.has(key + value)) groupOfValue.set(key + value, g[0]);
    assert.equal(g[0], groupOfValue.get(key + value), what + ' shares its value group');
    if (p.type === 'NurbsCurve') {
      assert.ok(p.g.isClosed && p.g.isPeriodic && p.g.degree === 3, what + ' closed periodic cubic');
      assert.ok(['true', 'false'].includes(p.a.getUserString('Hole')), what + ' Hole');
    }
    if (p.type === 'PolyCurve') {
      assert.ok(p.g.isClosed && p.g.isValid, what + ' closed valid');
      assert.equal(p.a.getUserString('Hole'), 'false', what + ' Hole');
    }
    if (p.type === 'Hatch') {
      assert.equal(p.a.displayOrder, cad.internals.ORDER.BLOB_HATCH, what + ' draw order');
      assert.equal(p.g.patternIndex, -1, what + ' solid');
    }
  }
  assert.equal(new Set(groupOfValue.values()).size, BLOB_VALUES, 'one group per key and value');
  assert.ok(cad.internals.ORDER.BLOB_HATCH < cad.internals.ORDER.STICKY_HATCH, 'blob fills draw behind sticky fills');

  // A blob's stroke rides as a user string; a zero stroke keeps its outline
  // (the hatch boundary) but plots nothing.
  const outlines = blobParts.filter((q) => q.type !== 'Hatch' && q.type !== 'TextEntity' && q.a.getUserString('Hole'));
  assert.ok(outlines.some((p) => p.a.getUserString('Value') === 'G0') && outlines.some((p) => p.a.getUserString('Value') === 'Administration'), 'stroke outlines found');
  for (const p of outlines) {
    const value = p.a.getUserString('Value');
    const zero = value === 'G0';
    assert.equal(p.a.getUserString('Stroke'), zero ? '0' : value === 'Administration' ? '2' : '', value + ' Stroke');
    assert.equal(p.a.plotWeightSource === rhino.ObjectPlotWeightSource.PlotWeightFromObject, zero, value + ' plot weight source');
    if (zero) assert.equal(p.a.plotWeight, -1, value + ' does not plot');
  }
  const rsCurves = blobParts.filter((p) => p.type === 'NurbsCurve' && p.a.getUserString('Value') === 'Research Space');
  assert.deepEqual(rsCurves.map((p) => p.a.getUserString('Hole')).sort(), ['false', 'false', 'true'], 'one hole outline');
  const rsHatches = blobParts.filter((p) => p.type === 'Hatch' && p.a.getUserString('Value') === 'Research Space');
  const loopSets = rsHatches.map((p) => hatchLoops(rhino, p.g)).sort((a, b) => b.length - a.length);
  assert.deepEqual(loopSets.map((l) => l.map((x) => x.type)), [[0, 1], [0]], 'the hole is an inner loop of its island');

  // Hatch area: outer minus hole, matching the outline curves in the file.
  const [ringLoops] = loopSets;
  const ringArea = polygonArea(ringLoops[0].curve, 4000) - polygonArea(ringLoops[1].curve, 4000);
  const outline = (hole, cx) => rsCurves.find((p) => p.a.getUserString('Hole') === String(hole)
    && Math.abs((p.g.getBoundingBox().min[0] + p.g.getBoundingBox().max[0]) / 2 - cx) < 1e-6);
  const curveRing = polygonArea(outline(false, 100).g, 4000) - polygonArea(outline(true, 100).g, 4000);
  near(ringArea, curveRing, curveRing * 1e-6, 'hatch area equals outline minus hole');
  near(ringArea, Math.PI * (30 * 30 - 10 * 10), Math.PI * 800 * 0.01, 'ring area close to the drawn ring');

  // Y-flip and fit: the island centered at canvas (100, 380), radius 30.
  const box = outline(false, 100).g.getBoundingBox();
  near((box.min[1] + box.max[1]) / 2, -380, 1e-6, 'blob y flip');
  near((box.min[0] + box.max[0]) / 2, 100, 1e-6, 'blob x');
  // A cubic B-spline on a 72-gon of radius r sits r (1 - cos 5deg) / 3 inside
  // its points at worst: 0.038 ft here.
  const ring = outline(false, 100).g;
  const samples = [];
  for (let k = 0; k <= 2000; k++) samples.push(ring.pointAt(ring.domain[0] + ((ring.domain[1] - ring.domain[0]) * k) / 2000));
  let deviation = 0;
  for (const [px, py] of circle(100, 380, 30, 72)) {
    let best = Infinity;
    for (let k = 1; k < samples.length; k++) {
      const [ax, ay] = samples[k - 1];
      const [bx, by] = samples[k];
      const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (-py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
      best = Math.min(best, Math.hypot(ax + t * (bx - ax) - px, ay + t * (by - ay) + py));
    }
    deviation = Math.max(deviation, best);
  }
  near(deviation, (30 * (1 - Math.cos(Math.PI / 36))) / 3, 1e-3, 'outline deviation from its points');

  // Labels sit above the top-left of the value's largest island.
  const rsLabel = blobParts.find((p) => p.type === 'Text' && p.a.getUserString('Value') === 'Research Space');
  assert.equal(rsLabel.g.plainText, 'Research Space');
  near(rsLabel.g.getTextHeight(probe), cad.internals.BLOB_TITLE.SIZE * cad.internals.CAP, 1e-9, 'blob label height');
  assert.ok(rsLabel.g.plane.origin[1] > -350, 'blob label above the island top');
  assert.ok(rsLabel.g.plane.origin[0] > 70 && rsLabel.g.plane.origin[0] < 100, 'blob label near the left of the top edge');

  // The exact outline: lines and arcs of the offset radius only, the
  // offset box to 1e-6, y flipped, and its hatch the same area.
  const admin = blobParts.find((p) => p.type === 'PolyCurve' && p.a.getUserString('Value') === 'Administration');
  assert.ok(admin, 'Administration outline is a PolyCurve');
  const kinds = new Map();
  for (let i = 0; i < admin.g.segmentCount; i++) {
    const seg = admin.g.segmentCurve(i);
    const kind = seg.constructor.name;
    kinds.set(kind, (kinds.get(kind) || 0) + 1);
    if (kind === 'ArcCurve') near(seg.radius, ADMIN_OFFSET, 1e-9, 'Administration corner radius');
    else assert.equal(kind, 'LineCurve', 'Administration segment ' + i + ' is a line or an arc');
  }
  assert.deepEqual([kinds.get('LineCurve'), kinds.get('ArcCurve')], [4, 4], 'four straight sides, four corners');
  const adminBox = admin.g.getBoundingBox();
  near(adminBox.min[0], 300, 1e-6, 'Administration min x');
  near(adminBox.max[0], 380, 1e-6, 'Administration max x');
  near(adminBox.min[1], -400, 1e-6, 'Administration min y (flipped)');
  near(adminBox.max[1], -360, 1e-6, 'Administration max y (flipped)');
  const adminArea = 80 * 40 - (4 - Math.PI) * ADMIN_OFFSET * ADMIN_OFFSET;
  near(polygonArea(admin.g, 4000), adminArea, adminArea * 1e-5, 'Administration outline area');
  const adminHatch = blobParts.find((p) => p.type === 'Hatch' && p.a.getUserString('Value') === 'Administration');
  const [adminLoop] = hatchLoops(rhino, adminHatch.g);
  near(polygonArea(adminLoop.curve, 4000), adminArea, adminArea * 1e-5, 'Administration hatch area');
  assert.equal(cad.internals.blobSegs([{ k: 0, x0: NaN, y0: 0, x1: 1, y1: 1 }]), null, 'a broken contour falls back to points');

  // Unicode survives in text (read back) and in user text (as UTF-16 in the file).
  const uni = byId.get('s5').find((p) => p.type === 'Text');
  assert.ok(uni.g.plainText.replace(/\r?\n/g, ' ').includes(UNICODE_NAME.split(' ').slice(0, 2).join(' ')),
    'unicode label: ' + JSON.stringify(uni.g.plainText));
  assert.ok(uni.g.plainText.includes('\ud83d\ude00'), 'emoji in label');
  assert.ok(Buffer.from(bytes).indexOf(Buffer.from(UNICODE_NAME, 'utf16le')) >= 0, 'unicode user text in file');

  // Lines: open polylines, y flipped, Width user text.
  const l1 = byId.get('l1')[0];
  assert.equal(l1.type, 'PolylineCurve');
  assert.ok(!l1.g.isClosed, 'line open');
  assert.equal(l1.g.pointCount, 3);
  assert.deepEqual(l1.g.point(1), [100, -50, 0], 'line y flip');
  assert.equal(l1.a.getUserString('Width'), '2', 'line Width');
  assert.equal(byId.get('l2')[0].g.pointCount, 2, 'duplicate points dropped');

  // Texts: top-left at (x, -y), cap height = CAP * size.
  const t1 = byId.get('t1')[0];
  assert.equal(t1.g.plainText, 'North Wing');
  assert.deepEqual(t1.g.plane.origin, [12, 40, 0], 'text y flip');
  near(t1.g.getTextHeight(probe), 10 * cad.internals.CAP, 1e-9, 'text height');
  assert.equal(byId.get('t2')[0].g.plainText, 'Two\r\nLines', 'multi-line text');

  // Without blobs (absent, empty, or null) the file is exactly the pre-blob board.
  for (const blobs of [undefined, [], null]) {
    const plain = sampleScene();
    if (blobs !== undefined) plain.blobs = blobs;
    const d = rhino.File3dm.fromByteArray(await cad.export3dm(plain));
    const paths = [];
    for (let i = 0; i < d.layers().count; i++) paths.push(d.layers().get(i).fullPath);
    const what = 'blobs ' + JSON.stringify(blobs);
    assert.deepEqual(paths.sort(), baseLayers.slice().sort(), what + ': layers');
    assert.equal(d.objects().count, baseTotal, what + ': objects');
    assert.equal(d.groups().count, stickies.length, what + ': groups');
    const types = new Map();
    for (let i = 0; i < d.objects().count; i++) {
      const n = d.objects().get(i).geometry().constructor.name;
      types.set(n, (types.get(n) || 0) + 1);
    }
    assert.ok(!types.has('NurbsCurve'), what + ': no blob outlines');
    assert.equal(types.get('Hatch'), stickies.length, what + ': sticky hatches only');
  }

  // Labels the board fitted (the app's cadScene adds `label` to each
  // sticky): the 3DM text takes that size and those line breaks, so Rhino
  // matches the board, PNG, and SVG. A wide sticky's size follows its width.
  {
    const engine = require('./engine.js');
    const L = engine.LABEL;
    const em = (t) => cad.internals.measure(t) * cad.internals.CAP * L.REF;
    const withLabel = (s, own) => {
      const areaText = cad.internals.areaText(s.area);
      const f = engine.fitLabel(s.name, areaText, s.w, s.h, em, own && own.scale);
      s.label = { size: f.f, lines: f.lines, lineH: f.lineH, y0: f.y0, area: f.area, areaText, areaSize: f.f * L.AREA, areaY: f.areaY, color: own ? own.color : null };
      return s;
    };
    const fitted = [
      withLabel({ id: 'wide', x: 0, y: 0, w: 160, h: 50, radius: 0, fill: '#9fc5e8', name: 'North Lobby Lounge', area: 8000, department: 'Research Space', meta: {} }),
      withLabel({ id: 'tall', x: 200, y: 0, w: 24, h: 160, radius: 0, fill: '#3d4a5c', name: 'Alpha Beta Gamma Delta Epsilon Zeta', area: 3840, department: 'Building Support', meta: {} }),
      // Its own text size (0.6x) and ink: the 3DM follows the override.
      withLabel({ id: 'own', x: 400, y: 0, w: 160, h: 50, radius: 0, fill: '#9fc5e8', name: 'North Lobby Lounge', area: 8000, department: 'Research Space', meta: {} }, { scale: 0.6, color: '#1f6fb2' }),
    ];
    const noteInk = '#b0453a';
    const d = rhino.File3dm.fromByteArray(await cad.export3dm({ units: 'feet', stickies: fitted, lines: [], texts: [{ id: 'note', x: 0, y: -40, text: 'Note', size: 10, color: noteInk }] }));
    const partsOf = new Map();
    const paths = [];
    for (let i = 0; i < d.layers().count; i++) paths[d.layers().get(i).index] = d.layers().get(i).fullPath;
    for (let i = 0; i < d.objects().count; i++) {
      const o = d.objects().get(i);
      const a = o.attributes();
      const id = a.getUserString('Id');
      if (!partsOf.has(id)) partsOf.set(id, []);
      partsOf.get(id).push({ g: o.geometry(), a, type: o.geometry().constructor.name });
    }
    for (const s of fitted) {
      const parts = partsOf.get(s.id);
      const texts = parts.filter((p) => p.type === 'Text');
      const name = texts[0];
      assert.ok(name, s.id + ': fitted label written');
      near(name.g.getTextHeight(probe) / cad.internals.CAP, s.label.size, 1e-6, s.id + ': 3DM text size is the board-fitted size');
      near(name.g.getTextHeight(probe), cad.internals.CAP * s.label.size, 1e-6, s.id + ': 3DM cap height is CAP x the fitted size');
      assert.equal(name.g.plainText, s.label.lines.join('\r\n'), s.id + ': 3DM line breaks match the board');
      assert.equal(texts.length, s.label.area ? 2 : 1, s.id + ': the area line only when the board shows it');
      if (s.label.area) {
        assert.equal(texts[1].g.plainText, s.label.areaText, s.id + ': area text');
        near(texts[1].g.getTextHeight(probe), cad.internals.CAP * s.label.areaSize, 1e-6, s.id + ': area size');
      }
      const group = parts[0].a.getGroupList()[0];
      for (const t of texts) {
        assert.equal(paths[t.a.layerIndex], s.department, s.id + ': label on its department layer');
        assert.equal(t.a.getGroupList()[0], group, s.id + ': label grouped with its sticky');
        assert.equal(t.a.colorSource, rhino.ObjectColorSource.ColorFromObject, s.id + ': label colour from object');
        const o = t.g.plane.origin;
        assert.ok(o[0] >= s.x && o[0] < s.x + s.w / 2 && o[1] <= -s.y && o[1] > -(s.y + s.h), s.id + ': label anchored top-left inside its sticky');
      }
    }
    const own = fitted[2];
    const ownName = partsOf.get('own').find((p) => p.type === 'Text');
    assert.ok(own.label.size < fitted[0].label.size * 0.8, 'a 0.6x override writes smaller type than the plain fit');
    near(ownName.g.getTextHeight(probe), cad.internals.CAP * own.label.size, 1e-6, 'an overridden size reaches the 3DM');
    assert.equal(hex(ownName.a.objectColor), '#1f6fb2', 'an overridden label ink reaches the 3DM');
    const wideName = partsOf.get('wide').find((p) => p.type === 'Text');
    assert.equal(hex(wideName.a.objectColor), hex(cad.internals.INK), 'a label without an override follows the fill');
    const note = partsOf.get('note')[0];
    assert.equal(note.a.colorSource, rhino.ObjectColorSource.ColorFromObject, 'a coloured text block carries its own colour');
    assert.equal(hex(note.a.objectColor), noteInk, 'a text block ink reaches the 3DM');
    const wide = fitted[0];
    const old = cad.internals.fitLabel(wide.name, cad.internals.areaText(wide.area), wide.w, wide.h);
    assert.ok(wide.label.size * cad.internals.CAP > old.cap * 1.5, 'the wide sticky label is larger than the short-side fit');
    assert.ok(fitted[1].label.lines.length >= 3, 'the tall sticky wraps into several lines');
  }

  // Line colour and end caps: every cap on the Lines layer in the line's
  // colour; arrowheads, squares, and dots closed and hatched; open arrows,
  // ticks, and bars open polylines. A plain line keeps the layer colour.
  {
    const engine = require('./engine.js');
    const ink = '#b0453a';
    const src = [
      { id: 'a', points: [[0, 0], [60, 0]], width: 2, color: ink, start: 'dot', end: 'arrow' },
      { id: 'b', points: [[0, 20], [60, 20]], width: 2, color: ink, start: 'square', end: 'open' },
      { id: 'c', points: [[0, 40], [60, 40]], width: 2, color: ink, start: 'tick', end: 'bar' },
      { id: 'd', points: [[0, 60], [60, 60]], width: 2 },
    ];
    const lines = src.map((l) => Object.assign({}, l, { color: l.color || null, caps: engine.lineShape(l).caps }));
    const d = rhino.File3dm.fromByteArray(await cad.export3dm({ units: 'feet', stickies: [], lines, texts: [] }));
    const lineLayer = [...Array(d.layers().count).keys()].map((i) => d.layers().get(i)).find((l) => l.name === 'Lines').index;
    const parts = [...Array(d.objects().count).keys()].map((i) => {
      const o = d.objects().get(i);
      return { g: o.geometry(), a: o.attributes() };
    });
    const caps = parts.filter((p) => p.a.getUserString('Kind'));
    const kinds = (type) => caps.filter((p) => p.g.constructor.name === type).map((p) => p.a.getUserString('Kind')).sort();
    assert.ok(parts.every((p) => p.a.layerIndex === lineLayer), 'line caps sit on the Lines layer');
    assert.deepEqual(kinds('Hatch'), ['arrow', 'dot', 'square'], 'filled ends are hatched');
    assert.deepEqual(kinds('NurbsCurve'), ['dot'], 'a dot is a closed circle');
    assert.deepEqual(kinds('PolylineCurve'), ['arrow', 'bar', 'open', 'square', 'tick'], 'arrowheads and squares are closed polylines; open arrows, ticks, and bars open ones');
    for (const p of caps.filter((q) => q.g.constructor.name === 'PolylineCurve')) {
      const kind = p.a.getUserString('Kind');
      assert.equal(p.g.isClosed, kind === 'arrow' || kind === 'square', kind + ' closed only when filled');
    }
    for (const p of parts.filter((q) => q.a.getUserString('Id') !== 'd')) {
      assert.equal(p.a.colorSource, rhino.ObjectColorSource.ColorFromObject, 'line part colour from object');
      assert.equal(hex(p.a.objectColor), ink, 'line part in the line colour');
    }
    const plain = parts.find((p) => p.a.getUserString('Id') === 'd');
    assert.equal(plain.a.colorSource, rhino.ObjectColorSource.ColorFromLayer, 'a plain line follows its layer');
    assert.equal(caps.filter((p) => p.a.getUserString('End') === 'start').length, 2 + 2 + 1, 'start caps (a dot and a square are each a curve and a hatch; a tick one polyline)');
    const tip = caps.find((p) => p.a.getUserString('Kind') === 'arrow' && p.g.constructor.name === 'PolylineCurve');
    near(tip.g.point(0)[0], 60, 1e-9, 'the arrow tip x');
    near(tip.g.point(0)[1], 0, 1e-9, 'the arrow tip y');
  }

  // An empty board still writes a valid file.
  const bare = rhino.File3dm.fromByteArray(await cad.export3dm({ units: 'feet', stickies: [], lines: [], texts: [] }));
  assert.equal(bare.objects().count, 0);
  assert.equal(bare.settings().modelUnitSystem, rhino.UnitSystem.Feet);

  console.log('cad: ' + stickies.length + ' stickies, ' + objects.count + ' objects, ' + layers.count + ' layers, '
    + bytes.length + ' bytes in ' + exportMs.toFixed(0) + ' ms');
  console.log('cad: wrote ' + OUT);
  console.log('cad: all checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
