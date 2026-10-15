'use strict';

const assert = require('node:assert/strict');
const Engine = require('./engine.js');
const GroupBundle = require('./board-group-bundle.js');

const checkerboard = Array.from({ length: 16 }, (_, i) => [
  i % 4 * 40, Math.floor(i / 4) * 40, (i % 4 + Math.floor(i / 4)) % 2 ? 'B' : 'A',
]);
const stripes = Array.from({ length: 12 }, (_, i) => [
  i % 6 * 30, Math.floor(i / 6) * 100, ['A', 'B', 'C'][i % 3],
]);

function fixture(entries, groups) {
  const model = Engine.modelFromCsv('Name,Area,Program\n' + entries.map((entry, i) => 'Room ' + i + ',100,' + entry[2]).join('\n'), 'bundle-test.csv');
  Engine.setColumnRoles(model, { areaKey: 'Area', groupKeys: ['Program'] });
  Engine.setParams(model, 1, 0, 0, false);
  model.frame = { x: -10, y: -10, w: 300, h: 220 };
  model.stickies.forEach((sticky, i) => {
    sticky.x = entries[i][0]; sticky.y = entries[i][1];
    sticky.w = sticky.tw = 10; sticky.h = sticky.th = 10;
  });
  (groups || []).forEach(indices => Engine.groupStickies(model, indices.map(i => model.stickies[i].id)));
  return model;
}

function identity(model) {
  return {
    rows: JSON.stringify(model.rows),
    roles: JSON.stringify(model.columnRoles),
    groups: model.stickies.map(sticky => sticky.group),
    sizes: model.stickies.map(sticky => [sticky.w, sticky.h, sticky.tw, sticky.th]),
  };
}

function assertIdentity(model, before) {
  assert.deepEqual(identity(model), before, 'Bundling only changes positions, preserving data, dimensions, tags, and authored groups');
  assert(!JSON.stringify(Engine.capture(model)).includes('bundle-cluster-'), 'Temporary proxy group IDs never enter captured board state');
}

function areaByCategory(model) {
  const keys = new Set(model.stickies.map(sticky => model.rows[sticky.rowIndex].fields.Program));
  return Object.fromEntries([...keys].map(key => {
    const box = Engine.boundsOf(model.stickies.filter(sticky => model.rows[sticky.rowIndex].fields.Program === key));
    return [key, box.w * box.h];
  }));
}

function solve(model, label) {
  const original = identity(model);
  const state = GroupBundle.begin(Engine, model);
  let frames = 0;
  let suspended = false;
  while (!state.done && frames++ < 1000) {
    GroupBundle.step(state, { pull: 0.1, maxPush: 9 });
    suspended ||= state.phase === 'siblings' && Engine.overlapsAny(model);
    assert.equal(Engine.outsideFrame(model).length, 0, label + ': every frame respects the frame walls');
    assertIdentity(model, original);
  }
  assert(state.done, label + ': grouped bundle finishes');
  assert(frames < 1000);
  assert(!Engine.overlapsAny(model), label + ': compacted clusters have no final overlaps');
  // The app's endBundle follows the animated helper with the usual settle,
  // closing any sub-pixel buffer shortfall using the authored groups.
  const rest = Engine.settleNow(model);
  assert.equal(rest.jam, null, label + ': final settle reports no jam');
  assert(!Engine.crowdedAny(model), label + ': final buffer is clear');
  assert.equal(Engine.outsideFrame(model).length, 0);
  assertIdentity(model, original);
  return { state, frames, suspended };
}

for (const [name, entries, count] of [['checkerboard', checkerboard, 2], ['stripes', stripes, 3]]) {
  const model = fixture(entries);
  const before = areaByCategory(model);
  const result = solve(model, name);
  assert.equal(result.state.grouped, count);
  const after = areaByCategory(model);
  Object.keys(before).forEach(key => assert(after[key] < before[key] * 0.2, name + ': siblings form a compact cluster'));
  if (name === 'checkerboard') assert(result.suspended, 'Intergroup collisions are suspended while siblings compact');
  assert.deepEqual(GroupBundle.step(result.state), { done: true, moved: 0 }, 'Stepping a completed bundle is harmless');
}

const rigid = fixture(checkerboard, [[0, 2], [1, 3]]);
const offsets = [0, 1].map(i => ({
  a: rigid.stickies[i], b: rigid.stickies[i + 2],
  dx: rigid.stickies[i + 2].x - rigid.stickies[i].x,
  dy: rigid.stickies[i + 2].y - rigid.stickies[i].y,
}));
solve(rigid, 'authored rigid groups');
offsets.forEach(pair => {
  assert(Math.abs(pair.b.x - pair.a.x - pair.dx) < 1e-7, 'Authored group X offsets survive');
  assert(Math.abs(pair.b.y - pair.a.y - pair.dy) < 1e-7, 'Authored group Y offsets survive');
});

const bridge = fixture(checkerboard, [[0, 1]]);
const bridgeState = GroupBundle.begin(Engine, bridge);
assert.equal(bridgeState.clusters.length, 1, 'An authored group crossing category boundaries keeps its linked siblings together');
solve(bridge, 'authored cross-category group');

for (const cancelAt of ['siblings', 'clusters']) {
  const model = fixture(checkerboard, [[0, 2]]);
  const original = identity(model);
  const state = GroupBundle.begin(Engine, model);
  if (cancelAt === 'siblings') {
    for (let i = 0; i < 18; i++) GroupBundle.step(state);
  } else {
    for (let i = 0; state.phase !== 'clusters' && i < 500; i++) GroupBundle.step(state);
    assert.equal(state.phase, 'clusters');
    GroupBundle.step(state);
  }
  // Discarding the helper needs no group cleanup: only proxy copies carry
  // temporary groups. The app must still settle the intentionally suspended
  // intergroup contacts when it cancels an animation.
  assertIdentity(model, original);
  const rest = Engine.settleNow(model);
  assert.equal(rest.jam, null, cancelAt + ': cancellation settles without a jam');
  assert(!Engine.overlapsAny(model), cancelAt + ': cancellation leaves no overlaps');
  assert.equal(Engine.outsideFrame(model).length, 0);
  assertIdentity(model, original);
}

const blank = fixture([[0, 0, ''], [40, 0, ''], [80, 0, 'A'], [120, 0, 'A']]);
const blankState = GroupBundle.begin(Engine, blank);
assert.equal(blankState.grouped, 1);
assert.deepEqual(blankState.clusters.map(cluster => cluster.stickies.length).sort(), [1, 1, 2], 'Blank tags leave unclassified spaces independent');
assert.equal(GroupBundle.begin(Engine, blank, []).grouped, 0, 'No grouping keys do not merge unrelated spaces');

let seed = 57;
const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 | 0) >>> 0) / 4294967296;
for (let trial = 0; trial < 5; trial++) {
  const entries = Array.from({ length: 24 }, (_, i) => [i % 6 * 45, Math.floor(i / 6) * 45, ['A', 'B', 'C', 'D'][Math.floor(random() * 4)]]);
  solve(fixture(entries), 'seeded interleaving ' + trial);
}

console.log('Grouped bundle: interleaved siblings compact, walls hold, final overlaps clear, authored groups remain rigid, and cancellation leaks no proxy state.');
