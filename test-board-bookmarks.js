'use strict';

const assert = require('assert');
const bookmarks = require('./board-bookmarks.js');

const state = {
  board: { stickies: [{ id: 'office', x: 10, y: 20, w: 40, h: 60 }], rows: [{ fields: { Name: 'Office', Level: '2' } }], columnTags: { Area: ['area'] }, bookmarks: [] },
  camera: { x: 30, y: 40, z: 2 },
  view: { grid: true, gridStep: 5, leaderThreshold: 40 },
  selection: ['office'], selLines: ['line-1'], selTexts: ['text-1'], tool: 'select',
};
const list = bookmarks.add([], state, 'By program', '2026-10-15T14:00:00Z');
assert.strictEqual(list[0].name, 'By program');
assert.strictEqual(list[0].createdAt, '2026-10-15T14:00:00.000Z');
assert(!Object.hasOwn(list[0].state.board, 'bookmarks'), 'Snapshots omit their own catalogue');
assert.deepStrictEqual(list[0].state.selection, ['office']);
assert.deepStrictEqual(list[0].state.selLines, ['line-1']);
assert.deepStrictEqual(list[0].state.selTexts, ['text-1']);
assert(Object.isFrozen(list[0].state.board.stickies[0]), 'A saved snapshot cannot be edited in place');

state.board.stickies[0].x = 999;
state.board.rows[0].fields.Level = '3';
state.camera.z = 5;
assert.strictEqual(list[0].state.board.stickies[0].x, 10, 'Later movement does not alter the saved arrangement');
assert.strictEqual(list[0].state.board.rows[0].fields.Level, '2', 'Later data edits do not alter the saved data');
assert.strictEqual(list[0].state.camera.z, 2, 'Later zoom does not alter the saved camera');
assert.throws(() => { list[0].state.board.stickies[0].x = 500; }, TypeError);

// Catalogue stripping happens before serialization so even a live catalogue
// pointing at the active state cannot be recursively embedded in a bookmark.
state.board.bookmarks = [{ state: state }];
state.bookmarks = state.board.bookmarks;
const second = bookmarks.add(list, state, 'By level', '2026-10-15T15:00:00Z');
assert.strictEqual(second.length, 2);
assert(!Object.hasOwn(second[1].state, 'bookmarks'));
assert(!Object.hasOwn(second[1].state.board, 'bookmarks'));
assert.notStrictEqual(second[0].id, second[1].id, 'Each bookmark has a stable distinct ID');
assert.strictEqual(second[1].state.board.rows[0].fields.Level, '3');

const renamed = bookmarks.rename(second, second[0].id, '  Programs / offices  ');
assert.strictEqual(renamed[0].name, 'Programs / offices');
assert.strictEqual(second[0].name, 'By program', 'Renaming produces a new catalogue');
assert.strictEqual(bookmarks.rename(renamed, renamed[0].id, '  ')[0].name, renamed[0].name, 'A blank rename preserves the existing name');
assert.strictEqual(bookmarks.rename(renamed, renamed[0].id, 'x'.repeat(200))[0].name.length, 96);
const deleted = bookmarks.remove(renamed, renamed[0].id);
assert.strictEqual(deleted.length, 1);
assert.strictEqual(deleted[0].id, renamed[1].id, 'Deletion preserves the remaining bookmark ID');
assert.deepStrictEqual(bookmarks.remove(renamed, 'missing'), renamed, 'Deleting a stale ID is harmless');
assert.strictEqual(renamed.length, 2, 'Deletion does not mutate the previous catalogue');

const restored = JSON.parse(JSON.stringify(renamed[0].state));
restored.board.bookmarks = renamed;
restored.board.stickies[0].x = 77;
assert.strictEqual(renamed[0].state.board.stickies[0].x, 10, 'A restored board remains independent of its snapshot');
assert.strictEqual(restored.board.bookmarks.length, 2, 'The current catalogue can be retained across restores');

let full = [];
for (let i = 0; i < bookmarks.MAX_BOOKMARKS; i++) full = bookmarks.add(full, state);
assert.strictEqual(full.length, 30);
assert.throws(() => bookmarks.add(full, state), /Delete one/, 'Capacity is explicit and never discards older snapshots');
assert.strictEqual(full.length, 30);
assert.strictEqual(new Set(full.map(item => item.name)).size, 30, 'Default bookmark names are unique');
const imported = full.concat([{ ...full[0], id: 'extra', name: 'Extra imported bookmark' }]);
assert.strictEqual(bookmarks.normalize(imported).length, 31, 'Imported catalogues over capacity are preserved');
assert.strictEqual(bookmarks.rename(imported, 'extra', 'Extra renamed').length, 31);
const duplicate = bookmarks.normalize([full[0], full[0]]);
assert.notStrictEqual(duplicate[0].id, duplicate[1].id, 'Duplicate imported IDs do not alias delete or restore actions');
assert.strictEqual(bookmarks.normalize([null, {}, { state: {} }]).length, 0);
assert.throws(() => bookmarks.snapshot(null), /Open a program/);
assert.throws(() => bookmarks.add([], state, 'Broken date', 'invalid'), /valid date/);

const Engine = require('./engine.js');
const model = Engine.modelFromCsv('Name,Area,Program\nOffice,100,Work\n', 'bookmark-import.csv');
const savedState = { board: Engine.capture(model), view: { grid: true }, camera: { x: 0, y: 0, z: 1 } };
model.bookmarks = Array.from({ length: 31 }, (_, i) => ({ id: 'saved-' + i, name: 'Saved ' + i, createdAt: '2026-10-15T12:00:00Z', state: savedState }));
const persisted = Engine.capture(model);
assert.strictEqual(persisted.bookmarks.length, 31, 'Engine capture retains imports over the creation cap');
assert.strictEqual(Engine.restore(persisted).bookmarks.length, 31, 'Engine restore retains imports over the creation cap');
const packed = Engine.packLayout(model, { grid: true }, { x: 1, y: 2, z: 3 });
assert.strictEqual(Engine.unpackLayout(packed).model.bookmarks.length, 31, 'Layout transport retains every imported bookmark');

savedState.bookmarks = model.bookmarks;
savedState.board.bookmarks = model.bookmarks;
const isolated = Engine.capture(model);
assert.strictEqual(isolated.bookmarks.length, 31, 'Engine strips circular catalogues before serialization');
assert(!Object.hasOwn(isolated.bookmarks[0].state, 'bookmarks'));
assert(!Object.hasOwn(isolated.bookmarks[0].state.board, 'bookmarks'));
assert.strictEqual(savedState.board.bookmarks, model.bookmarks, 'Serialization does not mutate the live catalogue');

const valid = isolated.bookmarks[0];
const uncloneable = { ...valid, id: 'cycle', state: { ...valid.state, extra: {} } };
uncloneable.state.extra.self = uncloneable.state.extra;
model.bookmarks = [null, {}, { ...valid, state: { board: {} } },
  { ...valid, state: { board: { columns: ['Name'], rows: [null], stickies: [] } } },
  uncloneable, valid, { ...valid, name: ' ', createdAt: 'invalid' }];
const cleaned = Engine.capture(model).bookmarks;
assert.strictEqual(cleaned.length, 2, 'Malformed optional entries cannot prevent loading the valid snapshots');
assert.notStrictEqual(cleaned[0].id, cleaned[1].id, 'Engine resolves duplicate imported IDs safely');
assert(cleaned[1].name.length > 0, 'Blank imported names receive a fallback');
assert.strictEqual(cleaned[1].createdAt, '', 'Invalid optional timestamps are harmless');
assert.strictEqual(Engine.restore({ ...persisted, bookmarks: model.bookmarks }).bookmarks.length, 2);

console.log('Board bookmarks: complete immutable snapshots, catalogue isolation, safe rename/delete, IDs, capacity, and import retention passed.');
