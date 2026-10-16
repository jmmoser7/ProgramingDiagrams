'use strict';

const assert = require('node:assert/strict');
const Board = require('./engine.js');

function near(a, b, message) {
  assert(Math.abs(a - b) < 1e-7, message || (a + ' equals ' + b));
}

function fixture(rects) {
  const model = Board.modelFromCsv('Name,Area\n' + rects.map((r, i) => 'Room ' + i + ',' + r[2] * r[3]).join('\n'), 'area-sort.csv');
  model.stickies.forEach((s, i) => {
    const r = rects[i];
    s.x = r[0]; s.y = r[1]; s.w = s.tw = r[2]; s.h = s.th = r[3];
  });
  Board.setParams(model, 4, 0, 0, false);
  return model;
}

function ids(model) { return model.stickies.map(s => s.id); }
function order(model, axis) { return model.stickies.slice().sort((a, b) => a[axis] - b[axis]).map(s => s.rowIndex); }
function identity(model) {
  return { rows: JSON.stringify(model.rows), columns: model.columns.slice(), roles: model.columnRoles,
    stickies: model.stickies.map(s => [s.id, s.rowIndex, s.w, s.h, s.tw, s.th, s.group, s.color]) };
}

function assertRow(model, axis, originalBounds) {
  const size = axis === 'x' ? 'w' : 'h';
  const cross = axis === 'x' ? 'y' : 'x';
  const crossSize = axis === 'x' ? 'h' : 'w';
  const notes = model.stickies.slice().sort((a, b) => a[axis] - b[axis]);
  notes.forEach(s => near(s[cross] + s[crossSize] / 2, notes[0][cross] + notes[0][crossSize] / 2, 'The sorted row shares a cross-axis center.'));
  for (let i = 1; i < notes.length; i++) {
    assert(notes[i][axis] - notes[i - 1][axis] - notes[i - 1][size] >= Board.gapOf(model) - 1e-7, 'The sorted row respects the buffer.');
  }
  const bounds = Board.boundsOf(notes);
  if (originalBounds) {
    near(bounds.x + bounds.w / 2, originalBounds.x + originalBounds.w / 2, 'Sorting retains the selection horizontal center.');
    near(bounds.y + bounds.h / 2, originalBounds.y + originalBounds.h / 2, 'Sorting retains the selection vertical center.');
  }
}

for (const [mode, expected] of [['areaasc', [1, 2, 0]], ['areadesc', [0, 2, 1]]]) {
  const model = fixture([[0, 5, 30, 30], [180, 40, 10, 10], [360, 0, 20, 20]]);
  const before = identity(model);
  const bounds = Board.boundsOf(model.stickies);
  const saved = Board.capture(model);
  assert(Board.alignPlan(model, ids(model), mode).length, 'An unsorted row produces a plan.');
  Board.alignSelection(model, ids(model), mode);
  assert.deepEqual(order(model, 'x'), expected, 'The longer horizontal selection sorts in the requested area direction.');
  assertRow(model, 'x', bounds);
  assert.deepEqual(identity(model), before, 'Sorting changes positions only; data and source row order are preserved.');
  assert.equal(Board.settleNow(model, model.stickies).jam, null, 'The sorted row settles without a jam.');
  assert.deepEqual(order(model, 'x'), expected, 'Settling preserves the resulting area order.');
  assert(!Board.crowdedAny(model), 'The sorted row rests at the buffer.');
  assert.deepEqual(identity(Board.restore(saved)), before, 'The existing snapshot path restores a sort without changing source identity.');
  assert.equal(Board.alignPlan(model, ids(model), mode).length, 0, 'Repeating an already satisfied sort is a no-op.');
}

for (const [mode, expected] of [['areaasc', [2, 0, 1]], ['areadesc', [1, 0, 2]]]) {
  const model = fixture([[5, 0, 20, 20], [30, 180, 30, 30], [0, 360, 10, 10]]);
  const bounds = Board.boundsOf(model.stickies);
  Board.alignSelection(model, ids(model), mode);
  assert.deepEqual(order(model, 'y'), expected, 'The longer vertical selection sorts from top to bottom.');
  assertRow(model, 'y', bounds);
}

for (const axis of ['x', 'y']) for (const mode of ['areaasc', 'areadesc']) {
  const positions = axis === 'x' ? [[200, 0], [0, 0], [100, 0]] : [[0, 200], [0, 0], [0, 100]];
  const model = fixture(positions.map(p => [p[0], p[1], 10, 10]));
  Board.alignSelection(model, ids(model), mode);
  assert.deepEqual(order(model, axis), [1, 2, 0], 'Equal-area ties keep their current spatial order in either sort direction.');
}

for (const mode of ['areaasc', 'areadesc']) for (const squareFirst of [true, false]) {
  const side = Math.sqrt(550);
  const model = fixture([[squareFirst ? 0 : 200, 0, side, side], [squareFirst ? 200 : 0, 0, 25, 22]]);
  assert.notEqual(Board.trueArea(model.stickies[0]), Board.trueArea(model.stickies[1]), 'Differing aspects introduce real floating-point roundoff in equal mathematical areas.');
  Board.alignSelection(model, ids(model), mode);
  assert.deepEqual(order(model, 'x'), squareFirst ? [0, 1] : [1, 0], 'Mathematically equal areas retain spatial tie order despite floating-point products.');

  const halfSide = Math.sqrt(275);
  const squareX = squareFirst ? 0 : 200, exactX = squareFirst ? 200 : 0;
  const sums = fixture([[squareX, 0, halfSide, halfSide], [squareX + 40, 10, halfSide, halfSide],
    [exactX, 0, 10, 25], [exactX + 40, 10, 15, 20]]);
  Board.groupStickies(sums, sums.stickies.slice(0, 2).map(s => s.id));
  Board.groupStickies(sums, sums.stickies.slice(2).map(s => s.id));
  assert.notEqual(sums.stickies.slice(0, 2).reduce((sum, s) => sum + Board.trueArea(s), 0),
    sums.stickies.slice(2).reduce((sum, s) => sum + Board.trueArea(s), 0), 'Summing group members retains the equal-area roundoff case.');
  Board.alignSelection(sums, ids(sums), mode);
  assert.equal(sums.stickies[0].x < sums.stickies[2].x, squareFirst, 'Mathematically equal summed group areas retain spatial tie order in either direction.');
}

const grouped = fixture([[0, 0, 10, 10], [80, 35, 10, 10], [220, 0, 20, 15], [400, 0, 10, 10]]);
const pair = grouped.stickies.slice(0, 2);
Board.groupStickies(grouped, pair.map(s => s.id));
const groupOffset = [pair[1].x - pair[0].x, pair[1].y - pair[0].y];
const groupedBefore = identity(grouped);
// Selecting one member expands to its entire authored rigid body.
Board.alignSelection(grouped, [pair[0].id, grouped.stickies[2].id, grouped.stickies[3].id], 'areaasc');
assert(grouped.stickies[3].x < pair[0].x && pair[0].x < grouped.stickies[2].x, 'A rigid group sorts by summed member source area, rather than its much larger bounding box.');
near(pair[1].x - pair[0].x, groupOffset[0]); near(pair[1].y - pair[0].y, groupOffset[1]);
assert.deepEqual(identity(grouped), groupedBefore, 'Rigid sorting retains member offsets, dimensions, and source data.');
assert.equal(Board.settleNow(grouped, grouped.stickies).jam, null);
near(pair[1].x - pair[0].x, groupOffset[0]); near(pair[1].y - pair[0].y, groupOffset[1]);
assert(!Board.crowdedAny(grouped));

const fudged = fixture([[200, 0, 24, 5], [0, 0, 11, 11]]);
Board.setParams(fudged, 4, 10, 10, true);
assert(fudged.stickies[0].w * fudged.stickies[0].h > fudged.stickies[1].w * fudged.stickies[1].h, 'This fixture reverses the source and drawn-area rankings.');
const fudgeIdentity = identity(fudged);
Board.alignSelection(fudged, ids(fudged), 'areaasc');
assert.deepEqual(order(fudged, 'x'), [0, 1], 'Fudge sorts by true source area rather than rounded cells.');
assert.deepEqual(identity(fudged), fudgeIdentity);

const modules = Board.modelFromCsv('Name,Area,Width,Depth\nSmall source,100,20,20\nLarge source,121,1,1\n', 'module-sort.csv');
Board.setParams(modules, 4, 0, 0, false);
Board.setColumnRoles(modules, { moduleWidthKey: 'Width', moduleDepthKey: 'Depth', moduleLock: 'hard' });
modules.stickies[0].x = 200; modules.stickies[0].y = 0;
modules.stickies[1].x = 0; modules.stickies[1].y = 0;
assert(modules.stickies[0].w * modules.stickies[0].h > modules.stickies[1].w * modules.stickies[1].h);
const moduleIdentity = identity(modules);
Board.alignSelection(modules, ids(modules), 'areaasc');
assert.deepEqual(order(modules, 'x'), [0, 1], 'Exact hard modules retain the source-area ranking.');
assert.deepEqual(identity(modules), moduleIdentity);

const fitting = fixture([[-20, 10, 30, 10], [40, 20, 20, 10], [110, 0, 10, 10]]);
fitting.frame = { x: 0, y: -20, w: 100, h: 100 };
Board.alignSelection(fitting, ids(fitting), 'areaasc');
assert.deepEqual(order(fitting, 'x'), [2, 1, 0]);
assertRow(fitting, 'x');
assert.equal(Board.outsideFrame(fitting).length, 0, 'A row reduces surplus spacing to fit the frame without violating its buffer.');
assert.equal(Board.settleNow(fitting, fitting.stickies).jam, null);
assert.equal(Board.outsideFrame(fitting).length, 0);

const cramped = fixture([[4, 4, 40, 10], [48, 20, 40, 10], [4, 40, 40, 10]]);
cramped.frame = { x: 0, y: 0, w: 100, h: 100 };
const crampedBefore = Board.capture(cramped);
assert.equal(Board.alignPlan(cramped, ids(cramped), 'areaasc').length, 0, 'A row that cannot fit even at the minimum buffer is rejected.');
assert.deepEqual(Board.alignSelection(cramped, ids(cramped), 'areaasc'), []);
assert.deepEqual(Board.capture(cramped), crampedBefore, 'A rejected frame-constrained sort leaves the board untouched.');

const walled = fixture([[0, 0, 30, 30], [120, 0, 10, 10], [220, 0, 20, 20]]);
walled.lines.push({ id: 'wall', points: [[80, -200], [80, 200]], width: 2 });
walled.lineGen++;
const walledBefore = identity(walled);
Board.alignSelection(walled, ids(walled), 'areaasc');
assert(walled.stickies[0].x + walled.stickies[0].w <= 75 + 1e-7, 'An area sort stops the left-side body before the wall.');
assert(walled.stickies.slice(1).every(s => s.x >= 85 - 1e-7), 'An area sort never pulls right-side bodies across a wall.');
const rest = Board.settleNow(walled, walled.stickies);
assert.equal(rest.jam, null, 'A blocked sort still reaches a clear resting state.');
assert(!Board.lineOverlap(walled)); assert(!Board.crowdedAny(walled));
assert(walled.stickies[0].x + walled.stickies[0].w <= 75 + 1e-7);
assert(walled.stickies.slice(1).every(s => s.x >= 85 - 1e-7));
assert.deepEqual(identity(walled), walledBefore, 'Wall protection does not alter any source or rigid-body data.');

const solo = fixture([[0, 0, 10, 10], [30, 0, 10, 10]]);
for (const mode of ['areaasc', 'areadesc']) {
  assert.deepEqual(Board.alignPlan(solo, [], mode), []);
  assert.deepEqual(Board.alignPlan(solo, [solo.stickies[0].id], mode), []);
}
Board.groupStickies(solo, ids(solo));
assert.deepEqual(Board.alignPlan(solo, ids(solo), 'areaasc'), [], 'One rigid group cannot sort against itself.');

console.log('Board area-sort regressions passed.');
