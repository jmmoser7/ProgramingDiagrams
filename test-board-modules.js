'use strict';

const assert = require('assert');
const Board = require('./engine.js');

function sample() {
  return Board.modelFromCsv('Name,Area,Department,Level,Seats,Width,Depth,Alternate\nOffice,100,Work,1,20,6,4,225\nStudio,81,Work,2,13,6,4,144\nDormant,0,Other,2,0,6,4,0\n', 'modules.csv');
}
function near(a, b, message) { assert(Math.abs(a - b) < 1e-7, message || (a + ' equals ' + b)); }
function bounded(layout, sticky) {
  near(layout.cells.reduce((sum, cell) => sum + cell.w * cell.h, 0), sticky.w * sticky.h, 'Cells cover the complete footprint.');
  for (let i = 0; i < layout.cells.length; i++) {
    const a = layout.cells[i];
    assert(a.x >= -1e-8 && a.y >= -1e-8 && a.x + a.w <= sticky.w + 1e-8 && a.y + a.h <= sticky.h + 1e-8, 'Every cell stays in its sticky.');
    for (let j = 0; j < i; j++) {
      const b = layout.cells[j];
      assert(!(a.x < b.x + b.w - 1e-8 && b.x < a.x + a.w - 1e-8 && a.y < b.y + b.h - 1e-8 && b.y < a.y + a.h - 1e-8), 'Cells do not overlap.');
    }
  }
  layout.lines.forEach((line) => {
    assert(line.x1 >= 0 && line.x2 <= sticky.w + 1e-8 && line.y1 >= 0 && line.y2 <= sticky.h + 1e-8, 'Subdivision lines stay bounded.');
  });
}

const automatic = sample();
assert.strictEqual(Board.getColumnRoles(automatic).areaKey, 'Area');
assert(Board.getColumnRoles(automatic).groupKeys.includes('Department'), 'Existing categorical detection is visible as group tags.');
assert.deepStrictEqual(Board.getColumnTags(automatic).Area, ['area']);
Board.setColumnRoles(automatic, { groupKeys: ['Level', 'Department'], countKey: 'Seats' });
assert.deepStrictEqual(Board.categoricalKeys(automatic).map((column) => column.key), ['Level', 'Department'], 'Authored grouping includes numeric categories and keeps tag order.');
assert.deepStrictEqual(Board.rowHierarchy(automatic), ['Level', 'Department']);
Board.alive(automatic).forEach((sticky) => {
  const layout = Board.moduleLayout(automatic, sticky);
  assert.strictEqual(layout.count, Number(automatic.rows[sticky.rowIndex].fields.Seats), 'Requested counts include prime counts exactly.');
  bounded(layout, sticky);
});
Board.setColumnRoles(automatic, { groupKeys: [] });
assert.deepStrictEqual(Board.categoricalKeys(automatic), [], 'Clearing group tags disables automatic categories.');
assert.throws(() => Board.setColumnRoles(automatic, { areaKey: 'Missing' }), /Unknown column/);

const hard = sample();
const sticky = hard.stickies[0];
const sourceArea = Board.trueArea(sticky);
Board.setParams(hard, 4, 10, 10, true);
Board.setColumnRoles(hard, { moduleWidthKey: 'Width', moduleDepthKey: 'Depth', moduleLock: 'hard' });
near(sticky.w, 12); near(sticky.h, 12);
let layout = Board.moduleLayout(hard, sticky);
assert.strictEqual(layout.count, 6);
layout.cells.forEach((cell) => { near(cell.w, 6); near(cell.h, 4); });
bounded(layout, sticky);
near(Board.trueArea(sticky), sourceArea, 'Module fudge never edits the source area.');
assert.strictEqual(hard.rows[0].fields.Area, '100');
Board.setParams(hard, 4, 7, 7, true);
near(sticky.w, 12); near(sticky.h, 12);
Board.setColumnRoles(hard, { countKey: 'Seats' });
layout = Board.moduleLayout(hard, sticky);
assert.strictEqual(layout.count, 20);
layout.cells.forEach((cell) => { near(cell.w, 6); near(cell.h, 4); });
bounded(layout, sticky);

const loose = sample();
Board.setColumnRoles(loose, { moduleWidthKey: 'Width', moduleDepthKey: 'Depth', moduleLock: 'loose' });
const looseSticky = loose.stickies[0];
near(looseSticky.w, 12); near(looseSticky.h, 12);
Board.setParams(loose, 4, 0, 10, false);
near(looseSticky.w, 12); near(looseSticky.h, 12);
Board.setParams(loose, 4, 0, 10, true);
near(looseSticky.w, 10); near(looseSticky.h, 10);
layout = Board.moduleLayout(loose, looseSticky);
assert.strictEqual(layout.count, 6, 'Scaling the loose envelope retains its module arrangement.');
bounded(layout, looseSticky);
near(Board.trueArea(looseSticky), 100);
Board.setParams(loose, 4, 0, 10, false);
near(looseSticky.w, 12); near(looseSticky.h, 12);

const stretched = Board.stretchBox(sticky, 'e', sticky.x + 35, sticky.y, {
  step: 10, cell: 10, gridActive: true, module: Board.moduleForSticky(hard, sticky),
});
near(stretched.tw * stretched.th, sourceArea);
near(stretched.w / 6, Math.round(stretched.w / 6));
near(stretched.h / 4, Math.round(stretched.h / 4));
const stretchLoose = Board.stretchBox(looseSticky, 'e', looseSticky.x + 35, looseSticky.y, {
  step: 10, cell: 0, gridActive: true, module: Board.moduleForSticky(loose, looseSticky),
});
near(stretchLoose.tw * stretchLoose.th, 100);
near(stretchLoose.w / 10, Math.round(stretchLoose.w / 10));
near(stretchLoose.h / 10, Math.round(stretchLoose.h / 10));

const snapHard = sample();
Board.setColumnRoles(snapHard, { moduleWidthKey: 'Width', moduleDepthKey: 'Depth', moduleLock: 'hard' });
snapHard.rows[1].dropped = true;
Board.setParams(snapHard, 0, 10, 10, true);
const snapSticky = snapHard.stickies[0];
snapSticky.x = 6; snapSticky.y = 4;
Board.settleNow(snapHard);
near(snapSticky.x, 6); near(snapSticky.y, 4);
snapSticky.x = 7; snapSticky.y = 5;
Board.settleNow(snapHard);
near(snapSticky.x, 6); near(snapSticky.y, 4);

const mixed = Board.modelFromCsv('Name,Area,Width,Depth\nFirst,100,6,4\nSecond,81,5,3\n');
Board.setColumnRoles(mixed, { moduleWidthKey: 'Width', moduleDepthKey: 'Depth', moduleLock: 'hard' });
Board.setParams(mixed, 0, 10, 10, true);
mixed.stickies[0].x = 6; mixed.stickies[0].y = 4;
mixed.stickies[1].x = 37; mixed.stickies[1].y = 8;
Board.groupStickies(mixed, mixed.stickies.map((s) => s.id));
Board.settleNow(mixed);
near(mixed.stickies[0].x, 6); near(mixed.stickies[0].y, 4);
mixed.stickies.forEach((s) => { s.x += 2.2; s.y += 1.3; });
Board.settleNow(mixed);
near(mixed.stickies[1].x - mixed.stickies[0].x, 31, 'A mixed-module group keeps its authored horizontal offset.');
near(mixed.stickies[1].y - mixed.stickies[0].y, 4, 'A mixed-module group keeps its authored vertical offset.');
assert(mixed.stickies.some((s) => {
  const module = Board.moduleForSticky(mixed, s);
  return Math.abs(s.x / module.width - Math.round(s.x / module.width)) < 1e-7 && Math.abs(s.y / module.depth - Math.round(s.y / module.depth)) < 1e-7;
}), 'A mixed-module rigid group aligns its nearest member instead of being forced onto the primary grid.');

const wall = { x0: 0, y0: 0, x1: 20, y1: 20 };
const origin = { x: 0, y: 0, w: 12, h: 12, tw: 10, th: 10 };
const walled = Board.stretchBox(origin, 'e', 19, 0, { wall, module: { width: 6, depth: 4, lock: 'hard' }, step: 10, gridActive: true });
near(walled.w, 18, 'The nearest fitting module width is used before an envelope crosses its wall.');
near(walled.h, 8); near(walled.tw * walled.th, 100);
for (const edge of ['e', 'w', 'n', 's', 'ne', 'nw', 'se', 'sw']) {
  const box = { x: 8, y: 8, w: 12, h: 12, tw: 10, th: 10 };
  const room = { x0: 0, y0: 0, x1: 40, y1: 40 };
  const r = Board.stretchBox(box, edge, edge.includes('w') ? -50 : 90, edge.includes('n') ? -50 : 90, {
    wall: room, module: { width: 6, depth: 4, lock: 'hard' },
  });
  assert(r.x >= room.x0 - 1e-7 && r.y >= room.y0 - 1e-7 && r.x + r.w <= room.x1 + 1e-7 && r.y + r.h <= room.y1 + 1e-7, 'Every hard-module stretch edge stays inside its walls: ' + edge);
  near(r.tw * r.th, 100);
  near(r.w / 6, Math.round(r.w / 6)); near(r.h / 4, Math.round(r.h / 4));
}
const countedOrigin = { x: 0, y: 0, w: 24, h: 20, tw: 10, th: 10 };
const countedWall = { x0: 0, y0: 0, x1: 28, y1: 24 };
const countedFit = Board.stretchBox(countedOrigin, 'e', 27, 0, { wall: countedWall, module: { width: 6, depth: 4, lock: 'hard', count: 20 } });
assert(countedFit.x + countedFit.w <= countedWall.x1 && countedFit.y + countedFit.h <= countedWall.y1, 'An exact-count module grid selects a fitting factor arrangement.');
near(countedFit.w * countedFit.h, 20 * 6 * 4); near(countedFit.tw * countedFit.th, 100);
const looseWallOrigin = { x: 0, y: 0, w: 10, h: 10, tw: 10, th: 10 };
const looseWallFit = Board.stretchBox(looseWallOrigin, 'e', 19, 0, { wall, module: { width: 6, depth: 4, lock: 'loose' }, step: 10, gridActive: true });
assert(looseWallFit.x + looseWallFit.w <= wall.x1 && looseWallFit.y >= wall.y0 && looseWallFit.y + looseWallFit.h <= wall.y1, 'Loose envelope scaling respects its walls.');
near(looseWallFit.w / 10, Math.round(looseWallFit.w / 10)); near(looseWallFit.h / 10, Math.round(looseWallFit.h / 10));
near(looseWallFit.tw * looseWallFit.th, 100);
const impossible = Board.stretchBox(origin, 'e', 19, 0, { wall, module: { width: 21, depth: 4, lock: 'hard' } });
assert.deepStrictEqual(impossible, origin, 'A module larger than the available room keeps the original bounded box.');

const edited = sample();
const firstId = edited.stickies[0].id;
Board.editRowField(edited, 0, 'Area', '225');
near(Board.trueArea(edited.stickies[0]), 225);
assert.strictEqual(edited.stickies[0].id, firstId);
Board.editRowField(edited, 0, 'Area', '0');
assert.strictEqual(Board.alive(edited).length, 1);
Board.setParams(edited, 4, 0, 10, false);
const zeroBack = Board.restore(Board.capture(edited));
assert(zeroBack.stickies.some((s) => s.id === firstId), 'A zero-area sticky keeps its id through persistence.');
Board.editRowField(zeroBack, 0, 'Area', '100');
assert.strictEqual(zeroBack.stickies[0].id, firstId);
Board.editRowField(edited, 2, 'Area', '36');
assert.strictEqual(Board.alive(edited).length, 2, 'An originally omitted row can create a sticky.');
assert.strictEqual(edited.rows.length, 3);
const beforeInvalid = JSON.stringify(Board.capture(edited));
for (const bad of ['-2', '', 'nonsense']) assert.throws(() => Board.editRowField(edited, 1, 'Area', bad), /non-negative/);
assert.strictEqual(JSON.stringify(Board.capture(edited)), beforeInvalid, 'Invalid edits leave the board intact.');
Board.setColumnRoles(edited, { areaKey: 'Alternate' });
near(Board.trueArea(edited.stickies[0]), 225);
assert.strictEqual(Board.getColumnTags(edited).Alternate[0], 'area');
assert.strictEqual(edited.stickies[0].id, firstId);

const full = Board.modelFromMatrix([['Name', 'Area', 'Alternative'], ...Array.from({ length: 201 }, (_, i) => ['Room ' + i, i < 200 ? '1' : '0', '1'])]);
const fullSnapshot = JSON.stringify(Board.capture(full));
assert.throws(() => Board.editRowField(full, 200, 'Area', '1'), /200/);
assert.throws(() => Board.setColumnRoles(full, { areaKey: 'Alternative' }), /200/);
assert.strictEqual(JSON.stringify(Board.capture(full)), fullSnapshot, 'The sticky limit is checked before committing a table edit or role change.');

const snapshotBoard = Board.capture(hard);
hard.bookmarks = [{ id: 'b1', name: 'By program', createdAt: '2026-10-15T12:00:00Z', state: { board: snapshotBoard, view: { grid: true }, camera: { x: 4, y: 8, z: 1 } } }];
const saved = Board.capture(hard);
const restored = Board.restore(saved);
assert.deepStrictEqual(Board.getColumnRoles(restored), Board.getColumnRoles(hard));
assert.strictEqual(restored.bookmarks[0].name, 'By program');
assert(!('bookmarks' in saved.bookmarks[0].state.board), 'Bookmark snapshots do not recursively embed the catalog.');
restored.bookmarks[0].name = 'Changed';
assert.strictEqual(saved.bookmarks[0].name, 'By program', 'Restored bookmark catalogs own their data.');
const packed = Board.packLayout(hard, { grid: true, gridStep: 7 });
const reopened = Board.unpackLayout(JSON.parse(JSON.stringify(packed))).model;
assert.deepStrictEqual(Board.getColumnRoles(reopened), Board.getColumnRoles(hard));
const changedCsv = Board.exportCsv(hard).replace('Office,100', 'Office,121');
const merged = Board.openSave({ csvText: changedCsv, layout: packed }).model;
assert.deepStrictEqual(Board.getColumnRoles(merged), Board.getColumnRoles(hard), 'CSV/layout reconciliation retains authored column roles.');
assert.strictEqual(merged.bookmarks[0].name, 'By program');
near(Board.trueArea(merged.stickies.find((s) => s.rowIndex === 0)), 121);

const identities = sample();
const initialIds = identities.rows.map((row) => row.id);
assert.strictEqual(new Set(initialIds).size, identities.rows.length, 'Every imported row has an identity, including omitted zero rows.');
assert(initialIds.every((id) => typeof id === 'string' && id.length > 0));
const dormantId = identities.rows[2].id;
Board.editRowField(identities, 2, 'Area', '36');
assert.strictEqual(identities.rows[2].id, dormantId, 'Activating an omitted row preserves its source identity.');
Board.editRowField(identities, 2, 'Area', '0');
const identityBack = Board.restore(JSON.parse(JSON.stringify(Board.capture(identities))));
assert.deepStrictEqual(identityBack.rows.map((row) => row.id), initialIds, 'Row identities survive persistence and zero-area changes.');
const copied = Board.duplicateStickies(identityBack, [identityBack.stickies[0].id]);
assert(copied && copied.length === 1);
assert.notStrictEqual(identityBack.rows[copied[0].rowIndex].id, initialIds[0], 'A duplicate receives a fresh source row identity.');
assert.strictEqual(new Set(identityBack.rows.map((row) => row.id)).size, identityBack.rows.length);
const identityHeader = Board.parseCsv(Board.exportCsv(identityBack))[0];
assert.deepStrictEqual(identityHeader, identityBack.columns, 'Internal row identities are never exported as spreadsheet columns.');

const legacyIdentity = Board.capture(sample());
legacyIdentity.rows.forEach((row) => { delete row.id; });
const legacyOne = Board.restore(legacyIdentity);
Board.uid('r'); Board.uid('s');
const legacyTwo = Board.restore(legacyIdentity);
assert.deepStrictEqual(legacyOne.rows.map((row) => row.id), legacyTwo.rows.map((row) => row.id), 'The same legacy snapshot receives deterministic row IDs in separate views.');
assert.strictEqual(legacyOne.rows[0].id, 'row-' + legacyIdentity.stickies[0].id);
assert.strictEqual(legacyOne.rows[2].id, 'row-legacy-2');
const collisionLegacy = JSON.parse(JSON.stringify(legacyIdentity));
collisionLegacy.rows[2].id = 'row-' + collisionLegacy.stickies[0].id;
const collisionOne = Board.restore(collisionLegacy);
const collisionTwo = Board.restore(collisionLegacy);
assert.strictEqual(new Set(collisionOne.rows.map((row) => row.id)).size, collisionOne.rows.length, 'Legacy assignment reserves existing row IDs before deriving missing IDs.');
assert.deepStrictEqual(collisionOne.rows.map((row) => row.id), collisionTwo.rows.map((row) => row.id));
const manual = sample();
manual.rows.forEach((row) => { delete row.id; });
const capturedManual = Board.capture(manual);
assert(capturedManual.rows.every((row, index) => row.id && row.id === manual.rows[index].id), 'Capture assigns missing metadata to manually authored rows.');

const mergeIdentity = sample();
const savedRowIds = new Map(mergeIdentity.rows.map((row) => [row.fields.Name, row.id]));
Board.pack(mergeIdentity); Board.frameAround(mergeIdentity);
const identityLayout = Board.packLayout(mergeIdentity, {});
const identityCsv = Board.exportCsv(mergeIdentity).replace('Office,100', 'Office,121').trimEnd() + '\r\nNew room,16,New,3,2,6,4,16\r\n';
const mergedIdentity = Board.openSave({ csvText: identityCsv, layout: identityLayout }).model;
mergedIdentity.rows.forEach((row) => {
  if (savedRowIds.has(row.fields.Name)) assert.strictEqual(row.id, savedRowIds.get(row.fields.Name), 'CSV reconciliation preserves saved source row identities.');
  else assert(!initialIds.includes(row.id) && !Array.from(savedRowIds.values()).includes(row.id), 'An unmatched CSV row has a fresh identity.');
});
assert.strictEqual(new Set(mergedIdentity.rows.map((row) => row.id)).size, mergedIdentity.rows.length);

console.log('Board modules: column roles, exact bounded counts, hard and loose grid behavior, source area, table edits, stable row identities, row activation, limits, persistence, and CSV reconciliation passed.');
