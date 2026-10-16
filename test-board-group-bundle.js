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

const concentric = fixture([
  [0, 0, 'A'], [120, 120, 'A'], [0, 120, 'A'], [120, 0, 'A'],
  [30, 30, 'B'], [90, 90, 'B'], [30, 90, 'B'], [90, 30, 'B'],
]);
const concentricBefore = areaByCategory(concentric);
const cloudState = GroupBundle.begin(Engine, concentric);
const anchors = JSON.stringify(cloudState.clusters.map(cluster => cluster.center));
const cloudCenter = cluster => {
  let x = 0, y = 0, area = 0;
  cluster.stickies.forEach(sticky => {
    const a = sticky.w * sticky.h;
    x += (sticky.x + sticky.w / 2) * a;
    y += (sticky.y + sticky.h / 2) * a;
    area += a;
  });
  return {x: x / area, y: y / area};
};
const centerDistance = state => {
  const [a, b] = state.clusters.map(cloudCenter);
  return Math.hypot(a.x - b.x, a.y - b.y);
};
assert.equal(centerDistance(cloudState), 0, 'Concentric categories start with the same center of gravity');
assert.notDeepEqual(cloudState.clusters[0].center, cloudState.clusters[1].center, 'Cloud footprint planning gives coincident categories distinct anchors');
for (let i = 0; i < 18; i++) {
  GroupBundle.step(cloudState, {pull: 0.1, maxPush: 9});
  assert.equal(cloudState.phase, 'siblings', 'Whole clouds do not gather while siblings are compacting');
  assert.equal(JSON.stringify(cloudState.clusters.map(cluster => cluster.center)), anchors, 'Sibling anchors stay fixed instead of following the moving centroid');
}
assert(centerDistance(cloudState) > 15, 'Sibling centers move apart before any whole-cloud gathering');
for (let i = 0; cloudState.phase === 'siblings' && i < 500; i++) GroupBundle.step(cloudState);
assert.equal(cloudState.phase, 'clusters', 'Compact clouds eventually enter the gathering phase');
const compactAreas = areaByCategory(concentric);
Object.keys(concentricBefore).forEach(key => assert(compactAreas[key] < concentricBefore[key] * 0.2, 'Clouds compact before their centers are pulled together'));
const cloudBoxes = cloudState.clusters.map(cluster => Engine.boundsOf(cluster.stickies));
assert.equal(Engine.mtv(cloudBoxes[0], cloudBoxes[1], Engine.gapOf(concentric)), null, 'Clouds have separate clear bounds at the end of sibling compaction');
const readyDistance = centerDistance(cloudState);
for (let i = 0; !cloudState.done && i < 500; i++) GroupBundle.step(cloudState);
assert(cloudState.done && !Engine.overlapsAny(concentric), 'Gathered autonomous clouds finish without overlaps');
assert(centerDistance(cloudState) < readyDistance, 'Whole-cloud gathering starts only after sibling compaction');

const remote = fixture([
  [0, 0, 'A'], [2400, 2400, 'A'], [0, 2400, 'A'], [2400, 0, 'A'],
  [600, 600, 'B'], [1800, 1800, 'B'], [600, 1800, 'B'], [1800, 600, 'B'],
]);
remote.frame = {x: -10, y: -10, w: 2450, h: 2450};
const remoteState = GroupBundle.begin(Engine, remote);
for (let i = 0; i < 420; i++) GroupBundle.step(remoteState, {maxPush: 2});
assert.equal(remoteState.phase, 'siblings', 'Slow distant siblings do not hit the old fixed timeout and gather before arrival');
for (let i = 0; remoteState.phase === 'siblings' && i < 2500; i++) GroupBundle.step(remoteState, {maxPush: 2});
assert.equal(remoteState.phase, 'clusters', 'Distant siblings still finish compacting at the selected animation speed');
Object.values(areaByCategory(remote)).forEach(area => assert(area < 1000, 'Remote sibling clouds are compact before becoming rigid gather bodies'));

// The optional center changes only callers that supply valid world coordinates.
for (const invalid of [{x: NaN, y: 0}, {x: 0, y: Infinity}, {x: '100', y: 0}, null]) {
  const a = fixture(stripes), b = fixture(stripes);
  Engine.bundleStep(a, [], {pull: 0.1, maxPush: 9});
  Engine.bundleStep(b, [], {pull: 0.1, maxPush: 9, center: invalid});
  assert.deepEqual(a.stickies.map(s => [s.x, s.y]), b.stickies.map(s => [s.x, s.y]), 'Invalid centers preserve ordinary Bundle all behavior');
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

const divided = fixture([[20, 20, 'A'], [40, 160, 'A'], [140, 20, 'B'], [160, 160, 'B']]);
divided.lines = [{id: 'divider', points: [[100, -10], [100, 210]], width: 2}];
divided.lineGen += 1;
const lineBefore = JSON.stringify(divided.lines);
const dividedState = GroupBundle.begin(Engine, divided);
for (let i = 0; !dividedState.done && i < 1000; i++) {
  GroupBundle.step(dividedState);
  assert(!Engine.lineOverlap(divided, 0), 'Cloud planning and gathering never cross a drawn line');
  divided.stickies.forEach(sticky => {
    const left = divided.rows[sticky.rowIndex].fields.Program === 'A';
    assert(left ? sticky.x + sticky.w < 100 : sticky.x > 100, 'Every sibling stays on its authored side of the divider');
  });
}
assert(dividedState.done, 'Line-constrained clouds finish without chasing unreachable centers forever');
assert.equal(JSON.stringify(divided.lines), lineBefore, 'Cloud planning does not rewrite line constraints');
assert.equal(Engine.settleNow(divided).jam, null, 'Line-constrained clouds settle without a jam');

const narrow = fixture(stripes);
narrow.frame = {x: -10, y: -10, w: 190, h: 130};
solve(narrow, 'narrow frame');

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

console.log('Grouped bundle: fixed spaced cloud centers separate coincident categories, siblings compact before gathering, walls hold, final overlaps clear, authored groups remain rigid, and cancellation leaks no proxy state.');
