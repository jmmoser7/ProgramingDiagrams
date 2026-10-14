'use strict';

const assert = require('assert');
const Engine = require('./engine.js');
const fs = require('fs');
const vm = require('vm');
const api = require('./mode-state.js');
const state = {
  board: { columns: ['Name', 'SF'], rows: [{ fields: { Name: 'Caf\u00e9 \ud83e\uddf8', SF: '40' } }], stickies: [{ id: 'a', height: 8, z: 4, material: 'jelly' }] },
  view: { mode: 'iso', isoDirection: 'NW', leaderThreshold: 20 }, camera: { x: 12, y: 15, z: 2 },
};
assert.deepStrictEqual(api.decode(api.encode(state)), state, 'UTF-8 state survives fragment transport');
assert.strictEqual(api.decode('#other'), null);
assert.strictEqual(api.decode('#pb-mode=broken'), null);
const copy = api.capture(state);
copy.board.stickies[0].height = 90;
assert.strictEqual(state.board.stickies[0].height, 8, 'Capture owns a snapshot');
assert.deepStrictEqual(api.capture({ modeState: state }), state, 'Iso can supply its shared Board camera');
assert.strictEqual(api.capture({...state,camera:null}).camera,null,'A newly imported program keeps the auto-fit camera sentinel');
let flushed=false;api.capture({flushEdits(){flushed=true;},modeState:state});assert(flushed,'Navigation commits an active editor before capture');

function browser(url, blocked) {
  const at = new URL(url);
  const data = new Map();
  const location = { href: at.href, pathname: at.pathname, search: at.search, hash: at.hash, protocol: at.protocol };
  const listeners={};
  const root = { location: location, addEventListener(k,fn){listeners[k]=fn;},removeEventListener(k){delete listeners[k];}, localStorage: { getItem(k){return data.get(k)||null;},setItem(k, v) { if (blocked) throw Error('blocked'); data.set(k, v); } }, history: { replaceState(a, b, value) { root.cleared = value; } } };
  const context = { window: root, URL: URL, TextEncoder: TextEncoder, TextDecoder: TextDecoder, btoa: btoa, atob: atob, Uint8Array: Uint8Array };
  vm.runInNewContext(fs.readFileSync(require.resolve('./mode-state.js'), 'utf8'), context);
  return { root: root, api: root.ProgramModeState, data: data, listeners };
}

const local = browser('file:///C:/board/index.html', true);
const target = local.api.href('iso.html', state);
assert(new URL(target).hash.startsWith('#pb-mode='), 'Local file transition works with storage blocked');
const destination = browser(target, true);
assert.deepStrictEqual(JSON.parse(JSON.stringify(destination.api.read())), state);
assert.strictEqual(destination.root.cleared, '/C:/board/iso.html');
assert.deepStrictEqual(destination.api.read(), destination.api.read(), 'Read remains available after fragment cleanup');

const http = browser('https://example.test/board/index.html', false);
assert.strictEqual(http.api.href('iso.html', state), 'https://example.test/board/iso.html');
assert(http.data.has('program-board-v4'), 'HTTP saves immediately before navigation');
const noStore = browser('https://example.test/board/index.html', true);
assert(new URL(noStore.api.href('iso.html', state)).hash, 'Blocked HTTP storage also has a portable handoff');
assert.strictEqual(noStore.api.href('https://elsewhere.test/iso.html', state), 'https://elsewhere.test/iso.html', 'Private data stays out of external links');
assert(new URL(noStore.api.href('pack.html', state)).hash, 'Pack receives the same program when storage is blocked');

const demo = browser('https://example.test/board/iso.html?demo', false);
const demoState = demo.api.capture(state);
assert.strictEqual(demoState.ephemeral, true);
const demoTarget = new URL(demo.api.href('index.html', demoState));
assert(demoTarget.searchParams.has('fresh') && demoTarget.hash, 'Demo remains transient through view transitions');
assert.strictEqual(demo.data.size, 0, 'Transient state never replaces a saved board');

const all=Engine.modelFromCsv('Name,Area,Phase\nOne,10,A\nTwo,20,B\n','reconcile.csv');
const baseline={board:Engine.capture(all),view:{pack:{aspect:1.6},leaderThreshold:0},camera:{x:0,y:0,z:1}};
const localEdit=JSON.parse(JSON.stringify(baseline)),remoteEdit=JSON.parse(JSON.stringify(baseline));
localEdit.board.rows[0].fields.Name='Renamed in Pack';localEdit.board.stickies[0].radius=2;localEdit.view.pack.aspect=2;
remoteEdit.board.rows[1].fields.Phase='Built in Board';remoteEdit.board.stickies[1].material='jelly';remoteEdit.view.isoDirection='SW';
const reconciled=api.reconcile(baseline,localEdit,remoteEdit);
assert.equal(reconciled.board.rows[0].fields.Name,'Renamed in Pack');assert.equal(reconciled.board.rows[1].fields.Phase,'Built in Board');
assert.equal(reconciled.board.stickies[0].radius,2);assert.equal(reconciled.board.stickies[1].material,'jelly');
assert.equal(reconciled.view.pack.aspect,2);assert.equal(reconciled.view.isoDirection,'SW');
const packDestination=local.api.href('pack.html',reconciled);
assert.deepStrictEqual(JSON.parse(JSON.stringify(browser(packDestination,true).api.read())),reconciled,'Board→Pack receives all shared edits');
http.data.set('program-board-v4',JSON.stringify(reconciled));assert.equal(http.api.latest().board.rows[0].fields.Name,'Renamed in Pack');
let notified=0;const unsubscribe=http.api.subscribe(()=>{notified++;});http.listeners.storage({key:'program-board-v4',newValue:JSON.stringify(reconciled)});unsubscribe();assert.equal(notified,1);
console.log('Mode state: UTF-8, file transitions, blocked storage, shared camera, transient sessions, and local-only transport passed.');
