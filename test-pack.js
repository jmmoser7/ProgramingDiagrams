'use strict';

// Run with Node. No browser, server, sample writes, or external packages needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const PB = require('./pack-engine.js');
const Engine = require('./engine.js');
assert.deepEqual(PB.selfTest(), []);

const elements = new Map();
const drawing = new Proxy({ measureText: (s) => ({ width: s.length * 6 }) }, {
  get: (target, key) => key in target ? target[key] : () => {},
});
function element() {
  return {
    value: '', hidden: true, style: {}, dataset: {}, children: [],
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener(type, fn) { (this.listeners ||= {})[type] = fn; }, setAttribute() {}, append(...nodes) { this.children.push(...nodes); },
    appendChild(node) { this.children.push(node); }, querySelectorAll: () => [],
    getContext: () => drawing, getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture() {}, focus() {}, select() {}, remove() {},
  };
}
const document = {
  body: element(), activeElement: null, addEventListener() {},
  getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
  createElement: element,
};
let now = 0;
const frames = [];
const savedStorage = new Map();
const modeState = require('./mode-state.js');
const sandbox = {
  window: { PackBoard: PB, ProgramBoard: Engine, ProgramAppearance: require('./appearance.js'), ProgramLeaders: require('./leaders.js'), ProgramModeState:{latest:()=>JSON.parse(savedStorage.get('program-board-v4')||'null'),reconcile:modeState.reconcile}, innerWidth: 1280, innerHeight: 720, addEventListener() {} },
  document, console, TextDecoder, TextEncoder, performance: { now: () => now },
  requestAnimationFrame: (fn) => frames.push(fn),
  setTimeout: () => 0, clearTimeout() {},
  getComputedStyle: () => ({ fontFamily: 'sans-serif' }),
  localStorage: { setItem(k,v) {savedStorage.set(k,v);} },
};
let source = fs.readFileSync(require.resolve('./pack.js'), 'utf8');
source = source.slice(0, source.indexOf('  fresh = new URLSearchParams')) + `
  globalThis.testPack = { openCsv, serialize, applySaved, settled, items, totalArea,
    onDown, onMove, onUp, openName, commitName, buildPackSave, openFile, cancelDrag, draw, fitArea, undo, redo, deleteIds, duplicate,
    setAlgorithm, setNest, setAspect, repack, modelFromCsv, csv, w2s, displayed, styleSelection, nullText,
    ensureSwatches, applyColor, editSwatch, addSwatch, addMetadataField, departmentSeams, setDepartmentDividers, applyShared:state=>{localStorage.setItem(STORE,JSON.stringify(state));applyShared(state);}, sharedState, flushEdits, leaderLayout,
    color(id) { return colorOf(sticky(id), palette()); },
    select(id) { selected = new Set(Array.isArray(id) ? id : [id]); },
    appearance(b, f) { buffer = b; fillet = f; },
    editArea(id, area) { const tree = PB.treeOf(settled().tiles); pushUndo(); setDataArea(sticky(id), area); reflow(tree); },
    setLeader(value) {pushUndo();leaderThreshold=value;persist();},
    state() { return { model, order, scale, aspect, manual, chrome, selected, drag, camera, areaHits, buffer, fillet, nameEdit, colorSwatches, departmentDividers }; }
  };
})();`;
vm.runInNewContext(source, sandbox, { filename: 'pack.js' });
const app = sandbox.testPack;
function flush() {
  for (let i = 0; frames.length && i < 100; i++) {
    const batch = frames.splice(0);
    now += 50;
    batch.forEach((fn) => fn(now));
  }
  assert.equal(frames.length, 0, 'animation finishes');
}
function verify(label) {
  const { frame, tiles } = app.settled();
  const live = app.items().filter((t) => t.area > 0);
  const total = app.totalArea();
  assert.equal(tiles.length, live.length, label + ': ids');
  assert.equal(new Set(tiles.map((t) => t.id)).size, live.length);
  let sum = 0;
  for (const t of tiles) {
    const item = live.find((s) => s.id === t.id);
    assert.ok(Math.abs(t.w * t.h - item.area * app.state().scale) < Math.max(1e-7, total * 1e-8), label + ': proportional area');
    assert.ok(t.x >= frame.x - 1e-7 && t.y >= frame.y - 1e-7 && t.x + t.w <= frame.x + frame.w + 1e-7 && t.y + t.h <= frame.y + frame.h + 1e-7, label + ': bounds');
    sum += t.w * t.h;
    for (const other of tiles) if (other !== t) {
      const w = Math.min(t.x + t.w, other.x + other.w) - Math.max(t.x, other.x);
      const h = Math.min(t.y + t.h, other.y + other.h) - Math.max(t.y, other.y);
      assert.ok(w < 1e-7 || h < 1e-7, label + ': overlap');
    }
  }
  assert.ok(Math.abs(sum - frame.w * frame.h) < 1e-6, label + ': coverage');
}
const canvas = document.getElementById('board');
function event(p, extra = {}) { return { target: canvas, clientX: p.x, clientY: p.y, button: 0, pointerId: 1, detail: 1, ...extra }; }
function drag(from, to, alt = false) {
  app.onDown(event(from)); app.onMove(event(to)); app.onUp(event(to, { altKey: alt })); flush();
}
app.openCsv(fs.readFileSync(require.resolve('./fixtures/program.csv'), 'utf8'), 'sample.csv'); flush();
assert.equal(app.state().model.rows.length, 76);
assert.equal(app.settled().tiles.length, 69);
verify('sample');
assert.equal(app.state().chrome.corner, undefined, 'no resize handle');
app.setAspect(2); flush();
assert.equal(app.state().scale, 1);
assert.ok(Math.abs(app.settled().frame.w / app.settled().frame.h - 2) < 1e-12);
verify('aspect preserves area');
const unchanged = app.settled().tiles;
app.setAlgorithm('slice'); flush();
for (const t of app.settled().tiles) { const old=unchanged.find(o=>o.id===t.id); for(const k of ['x','y','w','h']) assert.ok(Math.abs(t[k]-old[k])<1e-9, 'strategy choice alone does not solve'); }
app.repack(); flush(); verify('explicit optimize');
app.setAlgorithm('squarify'); app.repack(); flush();
const sourceTile = app.settled().tiles[0], targetTile = app.settled().tiles[3];
const from = app.w2s(sourceTile.x + sourceTile.w / 2, sourceTile.y + sourceTile.h / 2);
const to = app.w2s(targetTile.x + targetTile.w * 0.25, targetTile.y + targetTile.h / 2);
drag(from, to);
assert.ok(app.state().manual, 'drag placement retained'); verify('local insertion');
const placed = JSON.stringify(app.settled().tiles);
app.applySaved(JSON.parse(JSON.stringify(app.serialize()))); verify('saved local placement');
assert.equal(JSON.stringify(app.settled().tiles), placed);

app.openCsv('Department,Group,Space,SubTotal\nA,G,One,30.25\nB,H,Two,10.5\nB,H,Zero,0', 'test.csv');
app.setAlgorithm('dice'); app.repack(); flush();
function seam(alt) {
  const t = app.settled().tiles[0];
  const from = app.w2s(t.x + t.w, t.y + t.h / 2);
  drag(from, { x: from.x + 20, y: from.y }, alt);
}
const areasBeforeEdge = app.items().map(t => t.area);
seam(false); verify('edge drag');
assert.deepEqual(app.items().map(t => t.area), areasBeforeEdge, 'edge drag cannot edit area');
const saved = JSON.parse(JSON.stringify(app.serialize()));
app.applySaved(saved); verify('manual save and reload');
app.repack(); assert.equal(app.state().manual, null); verify('repack');
seam(false); app.deleteIds([app.state().order[0]]); verify('delete from manual');
app.undo(); verify('undo deletion');
app.redo(); verify('redo deletion');
const id = app.state().order[0];
app.duplicate(id); verify('duplicate');
app.editArea(id, 0.125); verify('fractional area edit');
assert.ok(app.csv().includes('0.125'));
app.editArea(id, 0); verify('zero edit');
app.applySaved(JSON.parse(JSON.stringify(app.serialize()))); verify('zero reload');
const styledId = app.state().order[0];
app.select(styledId); app.styleSelection('face', 'mono');
app.nullText(); app.undo();
assert.equal(app.state().model.stickies.find(s=>s.id===styledId).style.face, 'mono', 'text reset is undoable');
app.applySaved(JSON.parse(JSON.stringify(app.serialize())));
assert.ok(app.state().model.stickies.some(s=>s.style?.face === 'mono'), 'styles survive reload');
const parsed = app.modelFromCsv('Space,SF,Qty,SubTotal\nExplicit zero,100,2,0\nFraction,0.125,3,\nNo quantity,100,0,', 'areas.csv');
assert.equal(parsed.rows.length, 3);
assert.equal(parsed.stickies.length, 1);
assert.ok(Math.abs(parsed.stickies[0].tw * parsed.stickies[0].th - 0.375) < 1e-12);
assert.equal(app.modelFromCsv('Space,SF,Qty\nZero,100,0', 'zero.csv').stickies.length, 0);
assert.equal(PB.parseAspect('Infinity'), null);
console.log('PackBoard.selfTest(): [] (675 scale/aspect/strategy/nesting combinations plus baseline checks)');
console.log('Pack controller: fixed area, explicit optimize, local insertion, persistent placement, explicit-only areas, undo/redo, metadata areas, zeros passed.');

// All strategies produce recoverable local topology, and every animation frame
// tiles the frame. During transfer the dragged card has two shrinking/growing
// placeholders; its combined area and every neighbor's area remain exact.
const sample = app.modelFromCsv(fs.readFileSync(require.resolve('./fixtures/program.csv'), 'utf8'), 'sample.csv');
const weights = sample.stickies.map((s) => ({ id:s.id, area:s.tw*s.th, dept:sample.rows[s.rowIndex].fields[sample.deptKey], group:sample.rows[s.rowIndex].fields[sample.groupKey] }));
const frame = PB.frameOf(PB.sumArea(weights), 1.6, 1);
for (const algo of PB.ALGORITHMS) for (const nest of PB.NESTS) {
  const tiles = PB.pack(weights, frame, {algorithm:algo.id,nest:nest.id}).tiles;
  const move = PB.localMoveMany(tiles, weights, frame, [tiles[0].id,tiles[2].id,tiles[4].id], tiles[tiles.length-1].id, 'left');
  assert.ok(move, algo.id + '/' + nest.id + ' has local move');
  for (const progress of [0,0.25,0.5,0.75,1]) {
    const result = PB.layoutTree(move.transition, weights, frame, progress);
    for (const item of weights) assert.ok(Math.abs(result.filter(t=>t.id===item.id).reduce((n,t)=>n+t.w*t.h,0)-item.area)<1e-6);
    assert.ok(Math.abs(result.reduce((n,t)=>n+t.w*t.h,0)-frame.area)<1e-6);
    for (let i=0;i<result.length;i++) for(let j=i+1;j<result.length;j++) {
      const a=result[i],b=result[j];
      assert.ok(Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)<1e-7 || Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)<1e-7);
    }
  }
}
console.log('Local moves and intermediate animation coverage passed for all 27 strategy/nesting combinations.');

// Exercise actual controller selection/drag paths, including atomic Alt copies.
app.openCsv('Department,Space,SubTotal\nA,One,400\nA,Two,300\nB,Three,200\nB,Four,100', 'gestures.csv');
app.setAlgorithm('dice'); app.repack(); app.fitArea(); flush();
let ts = app.settled().tiles, f = app.settled().frame;
const corner = app.w2s(f.x - 2, f.y - 2);
const end = app.w2s(ts[1].x + ts[1].w / 2, f.y + f.h + 2);
drag(corner, end);
assert.deepEqual([...app.state().selected], [ts[0].id], 'L to R requires full containment');
const crossStart = app.w2s(f.x + f.w + 2, f.y - 2);
const crossEnd = app.w2s(ts[2].x + ts[2].w / 2, f.y + f.h + 2);
drag(crossStart, crossEnd);
assert.deepEqual([...app.state().selected].sort(), [ts[2].id,ts[3].id].sort(), 'R to L includes touched cards');
const ids = [ts[0].id, ts[1].id];
app.select(ids);
const start = app.w2s(ts[0].x + ts[0].w / 2, ts[0].y + ts[0].h / 2);
const dest = app.w2s(ts[3].x + ts[3].w / 2, ts[3].y + ts[3].h * .2);
app.onDown(event(start)); app.onMove(event(dest));
const preview = JSON.stringify(app.state().drag.preview.tiles);
app.onUp(event(dest)); flush(); verify('multi drag');
for (const t of JSON.parse(preview)) { const end=app.settled().tiles.find(v=>v.id===t.id); for (const k of ['x','y','w','h']) assert.ok(Math.abs(t[k]-end[k])<1e-8, 'preview matches drop'); }
assert.equal(app.state().selected.size, 2, 'selection survives move');
app.undo(); flush(); ts = app.settled().tiles; app.select(ids);
const beforeCopy = app.totalArea();
app.onDown(event(start, {altKey: true})); app.onMove(event(dest, {altKey: true})); app.onUp(event(dest, {altKey: true})); flush();
verify('Alt multi-copy'); assert.equal(app.totalArea(), beforeCopy + 700); assert.equal(app.state().selected.size, 2);
assert.ok(ids.every(id => app.state().model.stickies.some(s=>s.id===id)), 'originals retained');
app.undo(); verify('one undo removes all copies'); assert.equal(app.settled().tiles.length,4);
app.redo(); verify('redo multi-copy');
app.select(ids); const beforeCancel=app.totalArea(); ts=app.settled().tiles;
const first=ts.find(t=>t.id===ids[0]);
app.onDown(event(app.w2s(first.x+first.w/2,first.y+first.h/2),{altKey:true})); app.onMove(event(dest,{altKey:true})); app.cancelDrag(); flush();
assert.equal(app.totalArea(),beforeCancel,'cancel restores all pending copies'); verify('cancel copy');
app.draw(); const areaId=app.settled().tiles[0].id, hit=app.state().areaHits.get(areaId);
canvas.listeners.dblclick(event({x:hit.x+2,y:hit.y+hit.h/2}));
assert.equal(app.state().nameEdit.area,true,'double click area selects numeric editor');
elements.get('name-input').value='123.5'; app.commitName(); flush(); verify('double click area edit');
assert.equal(app.items().find(t=>t.id===areaId).area,123.5);
app.appearance(2,8); app.select(areaId); app.styleSelection('align','right'); app.styleSelection('valign','bottom');
app.applySaved(JSON.parse(JSON.stringify(app.serialize()))); verify('appearance reload');
assert.equal(app.state().buffer,2); assert.equal(app.state().fillet,8);
app.openCsv('Department,Space,SubTotal\nA,One,30\nA,Two,20\nB,Three,10\nB,Zero,0', 'swatches.csv');
const palette = app.ensureSwatches('fill', ['auto', '#e9e5de']);
const [a,b,c] = app.state().order;
const category = palette.find(entry => entry.dept === 'A');
app.editSwatch('fill', category.id, '#bbccdd');
assert.equal(app.color(a), '#bbccdd'); assert.equal(app.color(b), '#bbccdd', 'automatic category subscribers update');
app.select([a,b]);
const swatch = app.addSwatch('fill', '#ccddee', (color,id,record)=>app.applyColor('fill',color,id,record));
app.select(c);
const other = app.addSwatch('fill', '#ccddee', (color,id,record)=>app.applyColor('fill',color,id,record));
app.editSwatch('fill', swatch.id, '#ddccbb');
assert.equal(app.color(a), '#ddccbb'); assert.equal(app.color(b), '#ddccbb');
assert.equal(app.color(c), '#ccddee', 'distinct swatch subscriptions stay independent even with identical initial colors');
app.undo(); assert.equal(app.color(a), '#ccddee'); app.redo(); assert.equal(app.color(a), '#ddccbb');
assert.equal(app.addMetadataField('Phase'), 'Phase');
assert.ok(app.state().model.rows.every(row=>row.fields.Phase === ''), 'metadata field includes zero-area rows');
assert.equal(app.addMetadataField(' phase '), null, 'duplicate field names rejected');
app.undo(); assert.ok(!app.state().model.columns.includes('Phase')); app.redo();
app.state().model.rows[0].fields.Phase = 'Concept';
const savedSwatches = JSON.parse(JSON.stringify(app.serialize()));
app.applySaved(savedSwatches);
assert.equal(app.state().model.rows[0].fields.Phase, 'Concept');
assert.ok(app.csv().includes('Phase') && app.csv().includes('Concept'));
assert.ok(app.state().colorSwatches.fill.some(entry=>entry.id===other.id), 'added swatches survive save/reopen');
app.editSwatch('fill', swatch.id, '#aabbcc');
assert.equal(app.color(app.state().order[0]), '#aabbcc', 'saved subscriptions survive ID remapping');
assert.equal(app.color(app.state().order[1]), '#aabbcc');
console.log('Linked swatch edits, independent subscriptions, undo/redo, new metadata columns and persistence passed.');
assert.ok(app.departmentSeams(app.settled().tiles).length > 0, 'department boundaries found');
app.setDepartmentDividers(false);
assert.equal(app.departmentSeams(app.settled().tiles).length, 0, 'dividers hidden');
app.undo(); assert.ok(app.departmentSeams(app.settled().tiles).length > 0, 'divider toggle is undoable');
app.redo(); app.applySaved(JSON.parse(JSON.stringify(app.serialize())));
assert.equal(app.state().departmentDividers, false, 'divider preference survives save/reopen');

// One authority through Board -> Pack -> Isometric -> Board. Packing is a
// presentation: reordering its tiles never overwrites the authored plan XY.
const authority = Engine.modelFromCsv('Space,Area,Group,Phase\nOne,100,A,Plan\nTwo,225,A,Build\nThree,400,B,Use\n', 'same-program.csv');
Engine.pack(authority); Engine.frameAround(authority);
const appearance = require('./appearance.js'), transport = require('./mode-state.js');
const [firstAuthority,secondAuthority] = authority.stickies;
Object.assign(firstAuthority,{height:13,z:7,material:'jelly',radius:2,locked:true});
appearance.setGradient(authority,[firstAuthority,secondAuthority],'#ff3597','#ff947e');
const originalXY = new Map(authority.stickies.map(s=>[s.id,[s.x,s.y,s.w,s.h]]));
app.applyShared({board:Engine.capture(authority),view:{leaderThreshold:120,isoCamera:{x:1,y:2,z:3,scale:4,direction:'NW'}},camera:{x:20,y:30,z:1}});
app.setAlgorithm('dice'); app.repack(); flush();
for(const s of app.state().model.stickies) assert.deepEqual([s.x,s.y,s.w,s.h],originalXY.get(s.id),'Pack layout preserves Board geometry');
app.openName(firstAuthority.id); elements.get('name-input').value='Shared name';app.commitName();
app.editArea(secondAuthority.id,12.5);app.select(firstAuthority.id);app.styleSelection('fillet',3);app.styleSelection('stroke',0.75);
app.duplicate(firstAuthority.id); const copiedId=[...app.state().selected][0];
assert.equal(app.state().model.rows[app.state().model.stickies.find(s=>s.id===copiedId).rowIndex].fields.Phase,'Plan','Copies preserve arbitrary metadata');
app.deleteIds([authority.stickies[2].id]);
const packedState=transport.decode(transport.encode(app.sharedState()));
const isoModel=Engine.restore(packedState.board);
assert.equal(Engine.nameOf(isoModel,isoModel.stickies.find(s=>s.id===firstAuthority.id)),'Shared name');
assert.ok(Math.abs(Engine.trueArea(isoModel.stickies.find(s=>s.id===secondAuthority.id))-12.5)<1e-10);
const isoFirst=isoModel.stickies.find(s=>s.id===firstAuthority.id);
assert.deepEqual([isoFirst.height,isoFirst.z,isoFirst.material,isoFirst.radius,isoFirst.locked],[13,7,'jelly',3,true]);
assert.equal(isoFirst.gradientId,firstAuthority.gradientId,'Group gradient survives Pack and Iso');
assert.equal(Engine.alive(isoModel).length,3,'Duplicate and deletion reach every view');
isoFirst.z=19;isoFirst.material='ceramic';
const backToBoard=Engine.restore(transport.decode(transport.encode({...packedState,board:Engine.capture(isoModel)})).board);
assert.equal(backToBoard.stickies.find(s=>s.id===firstAuthority.id).z,19);
assert.equal(backToBoard.stickies.find(s=>s.id===firstAuthority.id).material,'ceramic');
const rememberedPack=packedState.view.pack;
app.applyShared({...packedState,board:Engine.capture(backToBoard)});
assert.equal(app.serialize().view.pack.algorithm,rememberedPack.algorithm);
assert.deepEqual([...app.state().order.filter(id=>Engine.alive(backToBoard).some(s=>s.id===id))],rememberedPack.order);
const zeroId=secondAuthority.id;app.editArea(zeroId,0);
const zeroBack=Engine.restore(app.serialize().board), dormant=zeroBack.stickies.find(s=>s.id===zeroId);
assert(dormant && Engine.trueArea(dormant)===0 && !Engine.alive(zeroBack).includes(dormant),'Zero hides a cell while retaining its ID and metadata');
assert(Engine.exportCsv(zeroBack).includes('Two,0,A,Build'),'Zero remains a zero spreadsheet row');
Engine.setField(zeroBack,[zeroId],zeroBack.areaKey,'0.125');
assert(Engine.alive(zeroBack).some(s=>s.id===zeroId),'Reactivating an area retains its ID');
console.log('Shared Board/Pack/Iso IDs, metadata, exact areas, duplicates/deletes, gradients, 3D styles and preserved plan geometry passed.');
const smallCells=Engine.modelFromCsv('Name,Area\nLarge,10000\nSmall,1\nTiny,0.25\n','leader-frame.csv');Engine.pack(smallCells);Engine.frameAround(smallCells);
app.applyShared({board:Engine.capture(smallCells),view:{leaderThreshold:120},camera:null});app.fitArea();flush();
const packed=app.settled(),screenA=app.w2s(packed.frame.x,packed.frame.y),screenB=app.w2s(packed.frame.x+packed.frame.w,packed.frame.y+packed.frame.h);
const callouts=app.leaderLayout(packed,app.state().camera.z,app.w2s,{width:1280,height:720});
assert.ok(callouts.items.length,'Pack exposes small-cell leaders');
for(const item of callouts.items){assert(item.label.x>=screenA.x && item.label.y>=screenA.y && item.label.x+item.label.w<=screenB.x && item.label.y+item.label.h<=screenB.y,'Callout stays within Pack frame');assert(Math.abs(Math.abs(item.elbow.x-item.anchor.x)-Math.abs(item.elbow.y-item.anchor.y))<1e-7,'Leader remains 45 degrees');assert.equal(item.elbow.y,item.end.y);}
console.log('Pack small-cell leaders stay within the frame and retain the shared constant angle.');
app.setLeader(90);assert.equal(app.serialize().view.leaderThreshold,90,'Local leader edit survives reconciliation against saved threshold');
assert.equal(JSON.parse(savedStorage.get('program-board-v4')).view.leaderThreshold,90);
app.undo();assert.equal(app.serialize().view.leaderThreshold,120,'Leader threshold undo restores previous value');
app.redo();assert.equal(app.serialize().view.leaderThreshold,90,'Leader threshold redo restores persisted edit');
(async () => {
  const bytes=await app.buildPackSave(), files=await Engine.unzip(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'test');
  assert.equal(Object.keys(files).length,3,'Save contains the shared CSV, layout and manifest');
  const jsonName=Object.keys(files).find(n=>n.endsWith('.layout.json'));
  const saved=JSON.parse(new TextDecoder().decode(files[jsonName]));
  assert.equal(saved.kind,'program-board-layout');
  const before=app.totalArea();
  app.openCsv('Space,SubTotal\nTemporary,10','temporary.csv');
  await app.openFile({name:'roundtrip.pack.zip',arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
  assert.equal(app.totalArea(),before); verify('ZIP restored through file loader');
  console.log('CAD selection, multi-move, exact preview, Alt copies/cancel, double-click area, appearance, ZIP round-trip passed.');
})().catch(err=>{console.error(err);process.exitCode=1;});
