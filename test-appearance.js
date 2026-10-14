'use strict';

const assert = require('assert');
const board = require('./engine.js');
const paint = require('./appearance.js');

function model() {
  return board.modelFromCsv('Space,Area,Group\nSmall,100,A\nMedium,200,A\nLarge,300,A\nOther,400,B\n', 'ramps.csv');
}

(async function () {
  const m = model();
  const notes = m.stickies;
  notes[0].color = '#123456';
  assert.strictEqual(paint.fillFor(m, notes[0]), '#123456', 'plain notes retain their authored fill');
  const id = paint.setScopeGradient(m, { key: 'Group', value: 'A' }, '#ff0000', '#0000ff');
  assert.strictEqual(paint.scopeMembers(m, id).length, 3);
  assert.deepStrictEqual(notes.slice(0, 3).map((s) => paint.fillFor(m, s)), ['#ff0000', '#800080', '#0000ff']);
  assert.strictEqual(paint.fillFor(m, notes[3]), board.STICKY_FILL);
  const prepared = paint.prepare(m);
  assert.deepStrictEqual(notes.map((s) => paint.fillFor(m, s, prepared)), notes.map((s) => paint.fillFor(m, s)));
  assert.strictEqual(paint.commonGradient(m, notes.slice(0, 3)).id, id);
  assert.strictEqual(paint.commonGradient(m, notes), null);

  // A resize changes the ranking on demand, including true area on a
  // snapped board. A duplicate joins its original ramp cohort.
  board.setField(m, [notes[0].id], m.areaKey, '500');
  assert.strictEqual(paint.fillFor(m, notes[0]), '#0000ff');
  assert.strictEqual(paint.fillFor(m, notes[1]), '#ff0000');
  const copy = board.duplicateStickies(m, [notes[0].id])[0];
  assert.strictEqual(copy.gradientId, id);
  assert.strictEqual(paint.fillFor(m, copy), '#0000ff');
  notes[0].height = 17;
  notes[0].z = 6;
  notes[0].material = 'glass';
  const styledCopy = board.duplicateStickies(m, [notes[0].id])[0];
  assert.deepStrictEqual([styledCopy.height, styledCopy.z, styledCopy.material], [17, 6, 'glass']);

  // Applying a new ramp to a subset must not change the others' stops.
  const before = paint.gradientFor(m, notes[1]);
  const subsetId = paint.setGradient(m, [notes[0]], '#ffffff', '#000000');
  assert.notStrictEqual(subsetId, id);
  assert.deepStrictEqual(paint.gradientFor(m, notes[1]), before);
  assert.strictEqual(paint.fillFor(m, notes[0]), '#808080', 'single/equal-area scopes use a neutral midpoint');
  paint.clearGradient(m, [notes[0].id]);
  assert.strictEqual(paint.fillFor(m, notes[0]), '#123456', 'returning to solid reveals the prior color');

  const captured = board.capture(m);
  const back = board.restore(JSON.parse(JSON.stringify(captured)));
  assert.deepStrictEqual(paint.gradientFor(back, back.stickies[1]), paint.gradientFor(m, notes[1]));
  assert.deepStrictEqual([back.stickies[0].height, back.stickies[0].z, back.stickies[0].material], [17, 6, 'glass']);
  assert.deepStrictEqual(board.buildCadScene(back, {}).stickies.map((s) => s.fill), back.stickies.map((s) => paint.fillFor(back, s)), 'CAD exports use the shared colors');
  const view = { leaderThreshold: 42, mode: 'iso', isoDirection: 'nw' };
  const saved = await board.buildSave(m, view, { x: 0, y: 0, z: 1 });
  const zip = await board.readSaveZip(saved.bytes.buffer.slice(saved.bytes.byteOffset, saved.bytes.byteOffset + saved.bytes.byteLength));
  const restored = await board.openSave(zip);
  assert.deepStrictEqual(paint.gradientFor(restored.model, restored.model.stickies[1]), paint.gradientFor(m, notes[1]));
  assert.strictEqual(restored.view.leaderThreshold, 42);
  assert.strictEqual(restored.view.isoDirection, 'nw');
  assert.strictEqual(restored.model.stickies[0].height, 17);

  // Earlier layouts have no ramp or 3D metadata; malformed additions are
  // ignored without contaminating the old solid styling.
  const old = board.capture(model());
  delete old.gradients;
  old.stickies.forEach((s) => { delete s.gradientId; delete s.height; delete s.z; delete s.material; });
  old.stickies[0].color = '#aabbcc';
  const legacy = board.restore(old);
  assert.strictEqual(paint.fillFor(legacy, legacy.stickies[0]), '#aabbcc');
  assert.deepStrictEqual([legacy.stickies[0].height, legacy.stickies[0].z, legacy.stickies[0].material], [8, 0, 'matte']);
  old.gradients = { r1: { start: 'red', end: '#000000' }, r2: { start: '#ABCDEF', end: '#123456' } };
  old.stickies[0].gradientId = 'r1';
  old.stickies[0].height = -5;
  old.stickies[0].z = Infinity;
  old.stickies[0].material = 'anything';
  const safe = board.restore(old);
  assert.strictEqual(safe.stickies[0].gradientId, null);
  assert.strictEqual(safe.gradients.r2.start, '#abcdef');
  assert.deepStrictEqual([safe.stickies[0].height, safe.stickies[0].z, safe.stickies[0].material], [8, 0, 'matte']);
  assert.strictEqual(paint.interpolate('#000000', '#ffffff', -1), '#000000');
  assert.strictEqual(paint.interpolate('#000000', '#ffffff', 2), '#ffffff');
  console.log('appearance tests passed');
})().catch((error) => { console.error(error); process.exit(1); });
