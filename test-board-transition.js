'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Transition = require('./board-transition.js');
const clone = value => JSON.parse(JSON.stringify(value));
const near = (actual, expected) => assert(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

const source = freeze({
  board: {
    columns: ['Name', 'Area'], rows: [{id: 'row-a', fields: {Name: 'Before', Area: '600'}}],
    stickies: [{id: 'a', rowIndex: 0, x: 0, y: 10, w: 20, h: 30, tw: 20, th: 30, z: 0, height: 8, radius: 2, stroke: 1, shadow: 3, group: 'before', color: '#ffffff'}],
    frame: {x: 0, y: 0, w: 100, h: 200, title: 'Before frame'},
    lines: [{id: 'line', points: [[0, 0], [20, 10], [30, 40]], width: 1, color: '#111111'}],
    texts: [{id: 'text', x: 0, y: 10, w: 20, size: 4, text: 'Before text'}],
  }, camera: {x: 0, y: 10, z: 1},
});
const canonical = freeze({
  columns: ['Name', 'Area', 'Phase'], rows: [{id: 'row-a', fields: {Name: 'After', Area: '9900', Phase: 'Target'}}],
  stickies: [{id: 'a', rowIndex: 0, x: 100, y: 70, w: 40, h: 50, tw: 99, th: 100, z: 12, height: 20, radius: 6, stroke: 3, shadow: 11, group: 'target', color: '#ff0000', locked: true, material: 'glass'}],
  frame: {x: 100, y: 20, w: 200, h: 300, title: 'After frame', color: '#aabbcc'},
  lines: [{id: 'line', points: [[10, 20], [40, 30], [50, 60]], width: 7, color: '#abcdef'}],
  texts: [{id: 'text', x: 10, y: 30, w: 40, size: 8, text: 'After text', textColor: '#ff0000'}],
  gradients: {r1: {start: '#ffffff', end: '#000000'}}, bookmarks: [{id: 'bookmark'}],
});
const targetCamera = freeze({x: 100, y: 50, z: 16, direction: 'NW'});
const sourceBefore = JSON.stringify(source), targetBefore = JSON.stringify(canonical);
const render = clone(canonical), plan = Transition.create(source, render, targetCamera);
assert.equal(plan.model, render);
assert.notEqual(plan.camera, targetCamera);
assert.equal(plan.needsCrossfade, false);
assert.equal(render.stickies[0].x, 0, 'Creation starts matching geometry at the source');
assert.equal(plan.camera.z, 1);

function semantics(board) {
  const copy = clone(board);
  for (const sticky of copy.stickies) for (const key of ['x', 'y', 'w', 'h', 'z', 'height', 'radius', 'stroke', 'shadow']) delete sticky[key];
  for (const text of copy.texts) for (const key of ['x', 'y', 'w', 'size']) delete text[key];
  for (const line of copy.lines) delete line.points;
  if (copy.frame) for (const key of ['x', 'y', 'w', 'h']) delete copy.frame[key];
  return copy;
}
assert.equal(plan.apply(0.5), 0.5);
assert.deepEqual(render.stickies[0], {...canonical.stickies[0], x: 50, y: 40, w: 30, h: 40, z: 6, height: 14, radius: 4, stroke: 2, shadow: 7});
assert.deepEqual(render.frame, {...canonical.frame, x: 50, y: 10, w: 150, h: 250});
assert.deepEqual(render.lines[0].points, [[5, 10], [30, 20], [40, 50]]);
assert.deepEqual(render.texts[0], {...canonical.texts[0], x: 5, y: 20, w: 30, size: 6});
near(plan.camera.x, 50);near(plan.camera.y, 30);near(plan.camera.z, 4);
assert.deepEqual(semantics(render), semantics(canonical), 'Only allowed render geometry changes; true dimensions, rows, metadata and styles remain target values');
near(plan.apply(0.25), 0.103515625);
near(render.stickies[0].x, 10.3515625);
plan.apply(0.8);plan.apply(0.25);
near(render.stickies[0].x, 10.3515625, 'Sampling does not accumulate previous samples');
assert.equal(plan.apply(-1), 0);
assert.equal(render.stickies[0].x, source.board.stickies[0].x);
assert.equal(plan.apply(2), 1);
assert.deepEqual(render, canonical, 'The final render geometry is the exact target');
assert.deepEqual(plan.camera, targetCamera, 'Camera endpoints avoid rounding drift');
assert.equal(JSON.stringify(source), sourceBefore);
assert.equal(JSON.stringify(canonical), targetBefore);

const changedSource = {board: {stickies: [{id: 'old', x: -40, y: -30, w: 2, h: 3}], lines: [], texts: [], frame: null}, camera: {x: 2, y: 3, z: 2}};
const changedTarget = {stickies: [{id: 'new', x: 20, y: 30, w: 40, h: 50}], lines: [], texts: [], frame: {x: 0, y: 0, w: 100, h: 100}};
const changed = Transition.create(changedSource, clone(changedTarget), {x: 2, y: 3, z: 2});
assert.equal(changed.needsCrossfade, true);
changed.apply(0.5);
assert.deepEqual(changed.model, changedTarget, 'Unmatched IDs stay at target positions and removed objects stay absent');

const reorderedSource = {board: {stickies: [{id: 'a', x: 0, y: 0, w: 10, h: 10}, {id: 'b', x: 20, y: 0, w: 10, h: 10}]}};
const reorderedTarget = {stickies: [{id: 'b', x: 40, y: 0, w: 10, h: 10}, {id: 'a', x: 10, y: 0, w: 10, h: 10}]};
const reordered = Transition.create(reorderedSource, clone(reorderedTarget), {});
assert.equal(reordered.needsCrossfade, false);
reordered.apply(0.5);
assert.equal(reordered.model.stickies[0].x, 30, 'Matches use IDs rather than array positions');
assert.equal(reordered.model.stickies[1].x, 5);

const missingSource = {board: {stickies: [{id: 'a', x: 0, y: 0, w: 20, h: 10}], lines: [{id: 'line', points: [[0, undefined], [10, 20]]}], texts: [{id: 'text', x: 0, y: 0}]}, camera: {x: NaN, z: -1}};
const missingTarget = {stickies: [{id: 'a', x: 10, y: 20, w: 30, h: 40, radius: 3}], lines: [{id: 'line', points: [[10, 30], [20, 40]]}], texts: [{id: 'text', x: 10, y: 20, size: 8}]};
const missing = Transition.create(missingSource, clone(missingTarget), {x: 5, y: 6, z: 0});
missing.apply(0.5);
assert.equal(missing.model.stickies[0].radius, 3, 'Missing source properties start at their target value');
assert(!Object.hasOwn(missing.model.stickies[0], 'height'), 'Missing optional target properties remain missing');
assert.equal(missing.model.lines[0].points[0][1], 30);
assert(missing.camera.z > 0);
function finiteNumbers(value) {
  if (typeof value === 'number') assert(Number.isFinite(value), 'Sampling introduces no non-finite numbers');
  else if (value && typeof value === 'object') Object.values(value).forEach(finiteNumbers);
}
finiteNumbers(missing.model);finiteNumbers(missing.camera);
assert.equal(missing.apply(NaN), 0);
missing.apply(Infinity);
assert.deepEqual(missing.model, missingTarget);

const differentPath = Transition.create({board: {lines: [{id: 'line', points: [[0, 0], [1, 1]]}]}}, {lines: [{id: 'line', points: [[10, 10], [20, 20], [30, 30]]}]}, {});
assert.equal(differentPath.needsCrossfade, true);
differentPath.apply(0.5);
assert.deepEqual(differentPath.model.lines[0].points, [[10, 10], [20, 20], [30, 30]], 'Incompatible paths use the target geometry');

const browser = {window: {}};
vm.runInNewContext(fs.readFileSync(require.resolve('./board-transition.js'), 'utf8'), browser);
assert.equal(typeof browser.window.ProgramBoardTransition.create, 'function', 'UMD exposes the browser API without an engine dependency');
console.log('Board transition: exact endpoints, quintic easing, render-only geometry, log zoom, IDs, missing values, crossfade detection and browser API passed.');
