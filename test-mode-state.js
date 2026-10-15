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

const dormant=Engine.modelFromCsv('Name,Area,Phase\nOne,10,A\nDormant,0,B\n','dormant.csv');
const dormantBase={board:Engine.capture(dormant),view:{},camera:null};
const snapshot=model=>({board:Engine.capture(model),view:{},camera:null});
const activated=Engine.restore(dormantBase.board),remoteLive=Engine.restore(dormantBase.board);
Engine.editRowField(activated,1,'Area','36');
const activatedId=activated.stickies.find(s=>s.rowIndex===1).id;
Engine.editRowField(remoteLive,0,'Name','One renamed remotely');
const activatedMerge=api.reconcile(dormantBase,snapshot(activated),snapshot(remoteLive));
assert.equal(activatedMerge.board.rows.length,2,'Activating an imported zero-area row reuses its source row');
assert.equal(activatedMerge.board.rows[0].fields.Name,'One renamed remotely');
assert.equal(activatedMerge.board.rows[1].fields.Area,'36');
assert.equal(activatedMerge.board.stickies.length,2);
assert.equal(activatedMerge.board.stickies.find(s=>s.rowIndex===1).id,activatedId,'Activation preserves the new local cell ID');
assert.equal(Engine.alive(Engine.restore(activatedMerge.board)).length,2,'Merged activation restores as two live cells');

const dormantText=Engine.restore(dormantBase.board),remoteText=Engine.restore(dormantBase.board);
Engine.editRowField(dormantText,1,'Name','Dormant edited locally');
Engine.editRowField(remoteText,0,'Name','Live edited remotely');
Engine.editRowField(remoteText,1,'Phase','Remote phase');
remoteText.stickies[0].material='jelly';
const dormantTextMerge=api.reconcile(dormantBase,snapshot(dormantText),snapshot(remoteText));
assert.equal(dormantTextMerge.board.rows.length,2);
assert.equal(dormantTextMerge.board.rows[1].fields.Name,'Dormant edited locally','Rows without a cell still receive local table edits');
assert.equal(dormantTextMerge.board.rows[1].fields.Phase,'Remote phase','Independent edits on the same dormant row survive');
assert.equal(dormantTextMerge.board.rows[0].fields.Name,'Live edited remotely');
assert.equal(dormantTextMerge.board.stickies[0].material,'jelly');
assert.equal(dormantTextMerge.board.stickies.length,1,'A metadata edit does not activate a dormant row');

// A remote duplicate inserts ahead of the dormant row. Reorder that saved
// board as well, so the baseline index points at an unrelated live row.
const insertedRemote=Engine.restore(dormantBase.board);
const remoteCopy=Engine.duplicateStickies(insertedRemote,[insertedRemote.stickies[0].id])[0];
const reorderedRemote=snapshot(insertedRemote),order=[2,1,0];
const previousRows=reorderedRemote.board.rows;
reorderedRemote.board.rows=order.map(index=>previousRows[index]);
reorderedRemote.board.stickies.forEach(s=>{s.rowIndex=order.indexOf(s.rowIndex);});
reorderedRemote.board.rows[0].fields.Phase='Remote phase';
const reorderedMerge=api.reconcile(dormantBase,snapshot(activated),reorderedRemote);
assert.equal(reorderedMerge.board.rows.length,3,'Remote insertion and sorting do not duplicate the activated row');
assert.equal(reorderedMerge.board.rows[0].fields.Name,'Dormant');
assert.equal(reorderedMerge.board.rows[0].fields.Area,'36');
assert.equal(reorderedMerge.board.rows[0].fields.Phase,'Remote phase');
assert.equal(reorderedMerge.board.stickies.find(s=>s.id===activatedId).rowIndex,0,'Activation follows its source through remote row sorting');
assert(reorderedMerge.board.stickies.some(s=>s.id===remoteCopy.id),'An independent remote duplicate remains intact');
assert.equal(reorderedMerge.board.stickies.length,3);

const renamedRemote=JSON.parse(JSON.stringify(reorderedRemote));
renamedRemote.board.rows[0].fields.Name='Dormant renamed remotely';
renamedRemote.board.rows[0].fields.Phase='B';
const renamedMerge=api.reconcile(dormantBase,snapshot(activated),renamedRemote);
assert.equal(renamedMerge.board.rows.length,3);
assert.equal(renamedMerge.board.rows[0].fields.Name,'Dormant renamed remotely','Authored metadata identifies a renamed dormant row after remote sorting');
assert.equal(renamedMerge.board.rows[0].fields.Area,'36');
assert.equal(renamedMerge.board.stickies.find(s=>s.id===activatedId).rowIndex,0);

const omittedPair=Engine.modelFromCsv('Name,Area,Phase\nOne,10,Live\nAlpha,0,A\nBeta,0,B\n','omitted-pair.csv');
const pairBase=snapshot(omittedPair),pairLocal=Engine.restore(pairBase.board),pairRemote=JSON.parse(JSON.stringify(pairBase));
Engine.editRowField(pairLocal,1,'Name','Alpha edited');
[pairRemote.board.rows[1],pairRemote.board.rows[2]]=[pairRemote.board.rows[2],pairRemote.board.rows[1]];
const pairMerge=api.reconcile(pairBase,snapshot(pairLocal),pairRemote);
assert.equal(pairMerge.board.rows.length,3);
assert.equal(pairMerge.board.rows[1].fields.Name,'Beta');
assert.equal(pairMerge.board.rows[2].fields.Name,'Alpha edited','Sorting only dormant rows does not apply a local edit to their old indices');

const repeatedNames=Engine.modelFromCsv('Name,Area,Phase\nOne,10,Live\nStorage,0,A\nStorage,0,B\n','repeated-names.csv');
const repeatedBase=snapshot(repeatedNames),repeatedLocal=Engine.restore(repeatedBase.board),repeatedRemote=JSON.parse(JSON.stringify(repeatedBase));
Engine.editRowField(repeatedLocal,1,'Area','36');
const repeatedId=repeatedLocal.stickies.find(s=>s.rowIndex===1).id;
[repeatedRemote.board.rows[1],repeatedRemote.board.rows[2]]=[repeatedRemote.board.rows[2],repeatedRemote.board.rows[1]];
const repeatedMerge=api.reconcile(repeatedBase,snapshot(repeatedLocal),repeatedRemote);
assert.equal(repeatedMerge.board.rows.length,3);
assert.equal(repeatedMerge.board.rows[1].fields.Phase,'B');
assert.equal(repeatedMerge.board.rows[1].fields.Area,'0');
assert.equal(repeatedMerge.board.rows[2].fields.Phase,'A');
assert.equal(repeatedMerge.board.rows[2].fields.Area,'36','Other metadata distinguishes reordered dormant rows with the same name');
assert.equal(repeatedMerge.board.stickies.find(s=>s.id===repeatedId).rowIndex,2);

const renamedPair=JSON.parse(JSON.stringify(pairRemote));
renamedPair.board.rows[1].fields.Name='Beta remote';renamedPair.board.rows[2].fields.Name='Alpha remote';
const renamedPairMerge=api.reconcile(pairBase,snapshot(pairLocal),renamedPair);
assert.equal(renamedPairMerge.board.rows[1].fields.Name,'Beta remote');
assert.equal(renamedPairMerge.board.rows[2].fields.Name,'Alpha edited','Metadata identifies dormant rows sorted and renamed remotely');

const activatedAndCopied=Engine.restore(dormantBase.board);
Engine.editRowField(activatedAndCopied,1,'Area','36');
const originalActivation=activatedAndCopied.stickies.find(s=>s.rowIndex===1);
const activatedCopy=Engine.duplicateStickies(activatedAndCopied,[originalActivation.id])[0];
const activatedCopyMerge=api.reconcile(dormantBase,snapshot(activatedAndCopied),snapshot(remoteText));
assert.equal(activatedCopyMerge.board.rows.length,3,'Activation followed by duplication adds only the intentional duplicate row');
assert.equal(activatedCopyMerge.board.stickies.length,3);
assert.equal(activatedCopyMerge.board.stickies.find(s=>s.id===originalActivation.id).rowIndex,1);
assert.equal(activatedCopyMerge.board.rows[1].fields.Area,'36');
assert.equal(activatedCopyMerge.board.rows[1].fields.Phase,'Remote phase','The original activation keeps independent remote row edits');
assert.equal(activatedCopyMerge.board.rows[activatedCopyMerge.board.stickies.find(s=>s.id===activatedCopy.id).rowIndex].fields.Phase,'B','The intentional copy keeps its own metadata');

const localCopyModel=Engine.restore(dormantBase.board);
const localCopy=Engine.duplicateStickies(localCopyModel,[localCopyModel.stickies[0].id])[0];
const copiedMerge=api.reconcile(dormantBase,snapshot(localCopyModel),snapshot(remoteText));
assert.equal(copiedMerge.board.rows.length,3,'A genuinely new local duplicate still receives a new row');
assert.equal(copiedMerge.board.rows[1].fields.Name,'Dormant');
assert.equal(copiedMerge.board.rows[1].fields.Phase,'Remote phase');
assert.equal(copiedMerge.board.rows[copiedMerge.board.stickies.find(s=>s.id===localCopy.id).rowIndex].fields.Name,'One');

const remoteActivation=Engine.restore(dormantBase.board);
Engine.editRowField(remoteActivation,1,'Area','49');
const simultaneous=api.reconcile(dormantBase,snapshot(activated),snapshot(remoteActivation));
assert.equal(simultaneous.board.rows.length,2);
assert.equal(simultaneous.board.stickies.length,2,'Concurrent activation creates only one cell for the source row');
assert.equal(simultaneous.board.stickies.find(s=>s.rowIndex===1).id,activatedId);
assert.equal(simultaneous.board.rows[1].fields.Area,'36','The committing activation wins a direct area conflict');

const identifiedBase=JSON.parse(JSON.stringify(dormantBase));
identifiedBase.board.rows.push(JSON.parse(JSON.stringify(identifiedBase.board.rows[1])));
identifiedBase.board.rows.forEach((row,index)=>{row.id='source-row-'+index;});
const identifiedLocal=JSON.parse(JSON.stringify(identifiedBase)),identifiedRemote=JSON.parse(JSON.stringify(identifiedBase));
identifiedLocal.board.rows[1].fields={Name:'Activated locally',Area:'36',Phase:'Local phase'};
identifiedLocal.board.stickies.push({...activated.stickies.find(s=>s.id===activatedId),id:'identified-activation',rowIndex:1});
[identifiedRemote.board.rows[1],identifiedRemote.board.rows[2]]=[identifiedRemote.board.rows[2],identifiedRemote.board.rows[1]];
identifiedRemote.board.rows[1].fields={Name:'Edited remotely',Area:'0',Phase:'Remote phase'};
const identifiedMerge=api.reconcile(identifiedBase,identifiedLocal,identifiedRemote);
assert.equal(identifiedMerge.board.rows.length,3);
assert.equal(identifiedMerge.board.rows[1].id,'source-row-2');
assert.equal(identifiedMerge.board.rows[1].fields.Name,'Edited remotely');
assert.equal(identifiedMerge.board.rows[2].id,'source-row-1');
assert.equal(identifiedMerge.board.rows[2].fields.Name,'Activated locally','Stable row IDs distinguish identical source rows after sorting and independent field changes');
assert.equal(identifiedMerge.board.stickies.find(s=>s.id==='identified-activation').rowIndex,2);

const legacyBase=JSON.parse(JSON.stringify(dormantBase)),legacyLocal=snapshot(activated),legacyRemote=snapshot(remoteLive);
for(const saved of [legacyBase,legacyLocal,legacyRemote])saved.board.rows.forEach(row=>{delete row.id;});
const legacyMerge=api.reconcile(legacyBase,legacyLocal,legacyRemote);
assert.equal(legacyMerge.board.rows.length,2,'Legacy snapshots without row IDs still reuse a dormant source row');
assert.equal(legacyMerge.board.stickies.find(s=>s.id===activatedId).rowIndex,1);

const packDestination=local.api.href('pack.html',reconciled);
assert.deepStrictEqual(JSON.parse(JSON.stringify(browser(packDestination,true).api.read())),reconciled,'Board→Pack receives all shared edits');
http.data.set('program-board-v4',JSON.stringify(reconciled));assert.equal(http.api.latest().board.rows[0].fields.Name,'Renamed in Pack');
let notified=0;const unsubscribe=http.api.subscribe(()=>{notified++;});http.listeners.storage({key:'program-board-v4',newValue:JSON.stringify(reconciled)});unsubscribe();assert.equal(notified,1);
console.log('Mode state: UTF-8, file transitions, blocked storage, shared camera, transient sessions, dormant-row edits/activation, row insertion/sorting, duplicates, and local-only transport passed.');
