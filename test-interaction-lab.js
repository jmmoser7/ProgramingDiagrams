'use strict';

// node test-interaction-lab.js
// Exercises the reusable catalog and settings model without a browser or dependencies.
const assert = require('node:assert/strict');
const Catalog = require('./interaction-lab/catalog.js');
const Model = require('./interaction-lab/model.js');
const fs = require('node:fs');
const path = require('node:path');
const testCases = [];
function test(name, fn) { testCases.push([name, fn]); }
const study = id => { const c = Catalog.cases.find(item => item.id === id); assert.ok(c, id); return c; };
const boxA = {id:'box-a',group:'assembly',kind:'box',x:10,y:20,width:100,height:80,depth:20};
const boxB = {id:'box-b',group:'assembly',kind:'box',x:160,y:20,width:120,height:80,depth:30};
const boxC = {id:'box-c',group:'reference',kind:'box',x:280,y:20,width:90,height:60,depth:15};
const curve = {id:'curve-a',group:'assembly',kind:'polyline',points:[{x:0,y:0},{x:50,y:40}]};

test('catalog has unique categories, cases, valid references, and substantive coverage', () => {
  assert.equal(new Set(Catalog.categories.map(c => c.id)).size, Catalog.categories.length);
  assert.equal(new Set(Catalog.cases.map(c => c.id)).size, Catalog.cases.length);
  assert.ok(Catalog.cases.length >= 45, 'retain the researched interaction families');
  const categories = new Set(Catalog.categories.map(c => c.id));
  for (const c of Catalog.cases) {
    assert.ok(categories.has(c.category), `unknown category: ${c.id}`);
    assert.ok(Catalog.sources[c.source], `unknown source: ${c.id}`);
    for (const key of ['title','gesture','expected','fidelity','status']) assert.ok(c[key]?.length, `${c.id}.${key}`);
    for (const key of Catalog.keysFor(c)) assert.ok(Object.hasOwn(Catalog.fields, key), `${c.id}.${key}`);
    assert.equal(new Set(Catalog.keysFor(c)).size, Catalog.keysFor(c).length, c.id);
  }
  for (const [id, [url, label]] of Object.entries(Catalog.sources)) {
    assert.ok(label.length > 5, id);
    if (url.startsWith('https:')) {
      const parsed = new URL(url);
      assert.equal(parsed.hostname, 'docs.mcneel.com', id);
      assert.ok(parsed.pathname.startsWith('/rhino/8/help/en-us/'), id);
      assert.ok(parsed.pathname.endsWith('.htm'), id);
    } else {
      assert.ok(url.startsWith('docs/'), id);
      assert.ok(fs.existsSync(path.resolve(__dirname, url)), `${id}: local source does not exist`);
    }
  }
  assert.ok(Catalog.sources.tab[0].endsWith('/user_interface/accurate_modeling.htm'));
  assert.ok(Catalog.sources.navigation[0].endsWith('/seealso/sak_navigate.htm'));
  assert.match(study('tracking-planar').fidelity, /plane|planar/i);
  assert.match(study('navigation-orbit').fidelity, /projection|camera/i);
  assert.match(study('tracking-tab').fidelity, /lab convenience/i);
});

test('settings inheritance resolves document, category, prototype, group, then object', () => {
  const state = Model.fresh(), c = study('gumball-move');
  assert.equal(Model.effective(state, c, boxA).hitRadius, Catalog.fields.hitRadius.default);
  state.document.hitRadius = 9;
  state.categories.gumball = {hitRadius:10, opacity:80};
  state.prototypes[c.id] = {hitRadius:11};
  state.groups[`${c.id}:assembly`] = {hitRadius:12};
  state.objects[`${c.id}:box-a`] = {hitRadius:13};
  assert.equal(Model.effective(state, c, boxA).hitRadius, 13);
  assert.equal(Model.effective(state, c, boxB).hitRadius, 12);
  assert.equal(Model.effective(state, c, boxC).hitRadius, 11);
  assert.equal(Model.effective(state, study('gumball-plane'), boxA).hitRadius, 10);
  assert.equal(Model.effective(state, study('selection-click'), boxA).hitRadius, 9);
  assert.equal(Model.effective(state, c, boxA).opacity, 80, 'unrelated inherited values survive');
  delete state.objects[`${c.id}:box-a`].hitRadius;
  assert.equal(Model.effective(state, c, boxA).hitRadius, 12, 'clearing an override restores its parent');
  assert.equal(Model.effective(state, c).hitRadius, 11, 'prototype inspection must not inherit a geometry selection');
});

test('document common controls are the capability intersection of every case', () => {
  const state = Model.fresh(), c = study('gumball-move');
  const targets = Model.targets(state, 'document', c, [], [boxA]);
  assert.deepEqual(Model.commonKeys(targets).slice().sort(), Catalog.common.slice().sort());
  assert.ok(!Model.commonKeys(targets).includes('rotationStep'));
  assert.ok(!Model.commonKeys(targets).includes('width'));
});

test('category controls do not inherit unrelated categories from selected prototypes', () => {
  const state = Model.fresh(), c = study('snap-end');
  const targets = Model.targets(state, 'category', c, ['navigation-pan'], []);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].id, 'snap');
  assert.ok(targets[0].cases.every(item => item.category === 'snap'));
  assert.ok(Model.commonKeys(targets).includes('snapRadius'));
  assert.ok(!Model.commonKeys(targets).includes('zoomSpeed'));
});

test('multi-prototype controls intersect capabilities and apply only the edited field', () => {
  const state = Model.fresh(), c = study('gumball-move');
  state.prototypes[c.id] = {opacity:65};
  state.prototypes['snap-end'] = {opacity:90};
  const targets = Model.targets(state, 'prototype', c, [c.id, 'snap-end'], []);
  const keys = Model.commonKeys(targets);
  assert.ok(keys.includes('snapRadius'));
  assert.ok(!keys.includes('rotationStep'));
  assert.ok(!keys.includes('gridSize'));
  Model.apply(state, targets, 'snapRadius', 21);
  assert.equal(state.prototypes[c.id].snapRadius, 21);
  assert.equal(state.prototypes['snap-end'].snapRadius, 21);
  assert.equal(state.prototypes[c.id].opacity, 65);
  assert.equal(state.prototypes['snap-end'].opacity, 90);
  assert.equal(Model.commonKeys(Model.targets(state, 'prototype', c, [c.id,'navigation-pan'], [])).includes('snapRadius'), false);
  assert.throws(() => Model.apply(state, targets, 'rotationStep', 30), /shared/);
});

test('group and object overrides are isolated by case and geometry identity', () => {
  const state = Model.fresh(), c = study('gumball-move');
  const groups = Model.targets(state, 'group', c, [], [boxA,boxB,boxC]);
  assert.equal(groups.length, 2, 'same group is patched once');
  assert.deepEqual(groups.map(t => t.id), [`${c.id}:assembly`,`${c.id}:reference`]);
  assert.equal(groups[0].objects.length, 2);
  assert.ok(Model.commonKeys(groups).includes('depth'));
  Model.apply(state, groups, 'hitRadius', 19);
  assert.equal(Model.effective(state, c, boxA).hitRadius, 19);
  assert.equal(Model.effective(state, study('gumball-plane'), boxA).hitRadius, Catalog.fields.hitRadius.default);
  const objects = Model.targets(state, 'object', c, [], [boxA,boxB]);
  Model.apply(state, objects, 'selectionColor', '#12ab34');
  assert.equal(Model.effective(state, c, boxA).selectionColor, '#12ab34');
  assert.equal(Model.effective(state, c, boxC).selectionColor, Catalog.fields.selectionColor.default);
  assert.ok(!Model.commonKeys(Model.targets(state, 'group', c, [], [boxA,curve])).includes('depth'));
  assert.ok(!Model.commonKeys(Model.targets(state, 'group', c, [], [boxA,curve])).includes('width'), 'polyline point geometry does not support direct width editing');
  assert.ok(Model.commonKeys(Model.targets(state, 'group', c, [], [boxA,curve])).includes('locked'));
  for (const id of ['snap-grid','tracking-ortho','navigation-zoom']) {
    const local = Model.commonKeys(Model.targets(state, 'object', study(id), [], [boxA]));
    for (const key of ['gridSize','ortho','zoomSpeed']) assert.ok(!local.includes(key), `${id}.${key} belongs to the view/point domain`);
  }
});

test('mixed effective values remain mixed until explicitly edited', () => {
  const state = Model.fresh(), a = study('snap-end'), b = study('snap-mid');
  state.document.opacity = 70;
  state.prototypes[b.id] = {opacity:90};
  const before = [Model.effective(state,a).opacity,Model.effective(state,b).opacity];
  assert.deepEqual(before, [70,90]);
  const targets = Model.targets(state, 'prototype', a, [a.id,b.id], []);
  // Asking for common keys must not normalize away values that the inspector shows as Mixed.
  Model.commonKeys(targets);
  assert.deepEqual([Model.effective(state,a).opacity,Model.effective(state,b).opacity], before);
  Model.apply(state, targets, 'strokeWidth', 2.5);
  assert.deepEqual([Model.effective(state,a).opacity,Model.effective(state,b).opacity], before);
  Model.apply(state, targets, 'opacity', 85);
  assert.deepEqual([Model.effective(state,a).opacity,Model.effective(state,b).opacity], [85,85]);
});

test('editing validation clamps finite values and rejects invalid colors or unsupported keys', () => {
  const state = Model.fresh(), c = study('selection-click');
  const targets = Model.targets(state, 'prototype', c, [], []);
  assert.equal(Model.apply(state, targets, 'hitRadius', -100), Catalog.fields.hitRadius.min);
  assert.equal(Model.apply(state, targets, 'hitRadius', 9999), Catalog.fields.hitRadius.max);
  assert.throws(() => Model.apply(state, targets, 'hitRadius', Infinity), /finite/);
  assert.throws(() => Model.apply(state, targets, 'selectionColor', 'red'), /six-digit/);
  assert.throws(() => Model.apply(state, targets, '__proto__', {}), /shared/);
  assert.equal(Model.apply(state, targets, 'cursorPolicy', 'native'), 'native');
  assert.equal(Model.apply(state, targets, 'hoverCursor', 'grab'), 'grab');
  assert.throws(() => Model.apply(state, targets, 'hoverCursor', 'url(malicious.svg)'), /supported/);
  assert.throws(() => Model.apply(state, targets, 'cursorPolicy', '__proto__'), /supported/);
  assert.equal(Model.apply(state, targets, 'cursorScale', 999), 200);
});

test('import rejects unsupported envelopes and sanitizes property types', () => {
  for (const raw of [null,{},[],{version:2},'lab']) assert.throws(() => Model.validate(raw), /version 1/);
  const state = Model.validate({version:1,document:{hitRadius:99999,opacity:NaN,prehighlight:'false',showLabels:false,highlightColor:'#11aa88',selectionColor:'url(x)',unknown:12,cursorPolicy:'native',hoverCursor:'invalid'},activeCase:'unknown'});
  assert.equal(state.document.hitRadius, Catalog.fields.hitRadius.max);
  assert.equal(state.document.showLabels, false);
  assert.equal(state.document.highlightColor, '#11aa88');
  assert.equal(state.document.cursorPolicy, 'native');
  for (const key of ['opacity','prehighlight','selectionColor','unknown','hoverCursor']) assert.equal(Object.hasOwn(state.document,key), false, key);
  assert.equal(state.activeCase, 'gumball-move');
});

test('import blocks dangerous dictionary keys without changing object prototypes', () => {
  const raw = JSON.parse('{"version":1,"document":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}},"categories":{"__proto__":{"hitRadius":29},"constructor":{"hitRadius":29},"prototype":{"hitRadius":29}},"objects":{"__proto__":{"hitRadius":30}}}');
  const state = Model.validate(raw);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf(state.document), Object.prototype);
  assert.equal(Object.getPrototypeOf(state.categories), Object.prototype);
  assert.equal(Object.hasOwn(state.categories,'__proto__'), false);
  assert.equal(Object.hasOwn(state.categories,'constructor'), false);
  assert.equal(Object.hasOwn(state.categories,'prototype'), false);
});

test('imported observation metadata cannot become executable markup or invalid date objects', () => {
  const state=Model.validate({version:1,feedback:[{caseId:'selection-click',text:'<b>Observation</b>',createdAt:{toString:'invalid'},selection:{length:'<img src=x onerror=alert(1)>'},verdict:{text:'invalid'},scope:17}]});
  assert.deepEqual(state.feedback[0].selection,[]);
  assert.equal(state.feedback[0].createdAt,null);
  assert.equal(state.feedback[0].verdict,'Needs tuning');
  assert.equal(state.feedback[0].scope,'prototype');
  assert.equal(state.feedback[0].text,'<b>Observation</b>');
});

test('feedback and drafts are scoped, bounded, and survive a JSON round trip', () => {
  const state = Model.fresh();
  state.feedback = [{caseId:'snap-end',text:'Too sticky',scope:'prototype'},{caseId:'unknown',text:'Ignore'},{caseId:'snap-mid',text:17}];
  state.drafts = {'snap-end':'Useful feedback draft','unknown':'Ignore'};
  state.activeCase = 'snap-end';
  const imported = Model.validate(JSON.parse(JSON.stringify(state)));
  assert.equal(imported.activeCase, 'snap-end');
  assert.equal(imported.feedback.length, 1);
  assert.equal(imported.feedback[0].text, 'Too sticky');
  assert.equal(imported.drafts['snap-end'], 'Useful feedback draft');
  assert.equal(Object.hasOwn(imported.drafts,'unknown'), false);
});

function sampleScene() {
  return {version:1,objects:[{...boxA,name:'Test box',rotation:0,color:'#abcdef',locked:false},{...boxB,name:'Second box',rotation:12,color:'#123456',locked:true}],selection:['box-a'],subSelection:[],camera:{x:0,y:0,zoom:1,orbit:0},pivot:{x:10,y:20},idSequence:4};
}

test('scene validation preserves a valid geometry snapshot without aliasing input', () => {
  const raw = sampleScene();
  const state = Model.validate({version:1,scenes:{'gumball-move':raw}});
  assert.deepEqual(state.scenes['gumball-move'], raw);
  raw.objects[0].x = 999;
  assert.equal(state.scenes['gumball-move'].objects[0].x, 10);
  assert.deepEqual(Model.cleanScene({...sampleScene(),selection:['box-a','missing','box-a']}).selection, ['box-a']);
});

test('invalid scene geometry fails before changing the workspace', () => {
  const mutations = [
    s => {s.objects = {};},
    s => {s.objects[0].x = '10';},
    s => {s.objects[0].y = NaN;},
    s => {s.objects[0].width = 0;},
    s => {s.objects[0].kind = 'nurbs';},
    s => {s.objects[1].id = s.objects[0].id;},
    s => {s.objects[0].id = '__proto__';},
    s => {s.objects[0].kind = 'polyline';s.objects[0].points = [{x:0,y:0}];},
    s => {s.objects[0].kind = 'polyline';s.objects[0].points = [{x:0,y:0},{x:Infinity,y:1}];},
    s => {s.camera.zoom = 0;},
    s => {s.camera.x = Infinity;},
    s => {s.selection = 'box-a';},
    s => {s.pivot = {x:0,y:'2'};},
    s => {s.objects = new Array(501).fill(s.objects[0]);}
  ];
  for (const mutate of mutations) {
    const scene = sampleScene();mutate(scene);
    assert.throws(() => Model.validate({version:1,scenes:{'gumball-move':scene}}), /scene|geometry/i);
  }
});

test('scene and feedback allowlists strip prototype payloads recursively', () => {
  const scene = sampleScene();
  scene.objects[0] = JSON.parse(JSON.stringify(scene.objects[0]).replace(/}$/, ',"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"unexpected":"discard"}'));
  const note = JSON.parse('{"caseId":"snap-end","text":"Retain note","settings":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"hitRadius":12}}');
  const state = Model.validate({version:1,scenes:{'gumball-move':scene},feedback:[note]});
  const object = state.scenes['gumball-move'].objects[0];
  assert.equal(Object.getPrototypeOf(object), Object.prototype);
  for (const key of ['__proto__','constructor','unexpected']) assert.equal(Object.hasOwn(object,key), false, key);
  assert.equal(Object.hasOwn(state.feedback[0].settings,'__proto__'), false);
  assert.equal(Object.hasOwn(state.feedback[0].settings,'constructor'), false);
  assert.equal(state.feedback[0].settings.hitRadius, 12);
  assert.equal({}.polluted, undefined);
});

test('imported preset buckets cannot shadow authored dimensions or lock state', () => {
  const imported = Model.validate({version:1,document:{width:400,hitRadius:10},objects:{'gumball-move:box-a':{locked:true,width:999,hoverCursor:'grab'}},scenes:{'gumball-move':sampleScene()}});
  assert.equal(Object.hasOwn(imported.document,'width'), false);
  assert.equal(Object.hasOwn(imported.objects['gumball-move:box-a'],'width'), false);
  assert.equal(Object.hasOwn(imported.objects['gumball-move:box-a'],'locked'), false);
  assert.equal(imported.objects['gumball-move:box-a'].hoverCursor, 'grab');
  assert.equal(imported.scenes['gumball-move'].objects[0].width, 100);
  assert.equal(imported.scenes['gumball-move'].objects[0].locked, false);
  const longName = sampleScene();longName.objects[0].name='a'.repeat(2000);
  assert.equal(Model.cleanScene(longName).objects[0].name.length, 160, 'model produces names accepted by stage restore');
});

test('explicit preference commits capture effective settings, local overrides, and authored geometry', () => {
  const state=Model.fresh(),c=study('gumball-move'),scene=sampleScene();
  state.document.hitRadius=14;
  state.categories.gumball={opacity:75};
  state.prototypes[c.id]={hoverCursor:'grab'};
  state.groups[c.id+':assembly']={hitRadius:18};
  state.objects[c.id+':box-a']={selectionColor:'#12ab34'};
  state.groups['snap-end:assembly']={hitRadius:29};
  Model.initializePreferences(state,{[c.id]:scene});
  assert.deepEqual(Model.preferenceStatus(state,c,scene),{committed:false,dirty:false,settingsDirty:false,feedbackDirty:false,feedback:[],revision:0,savedAt:null,state:'unaltered'});
  const result=Model.commitPreferences(state,[c.id,c.id],{[c.id]:scene});
  const entry=state.commits[c.id];
  assert.equal(entry.revision,1,'duplicate batch members are committed once');
  assert.ok(Number.isFinite(Date.parse(entry.savedAt)));
  assert.deepEqual(entry.snapshot.settings, Object.fromEntries(Catalog.keysFor(c).map(key=>[key,Model.effective(state,c)[key]])));
  assert.deepEqual(entry.snapshot.groups,{assembly:{hitRadius:18}});
  assert.deepEqual(entry.snapshot.objects,{'box-a':{selectionColor:'#12ab34'}});
  assert.deepEqual(entry.snapshot.geometry,Model.cleanScene(scene).objects);
  assert.equal(Object.hasOwn(entry.snapshot.settings,'zoomSpeed'),false,'snapshots only include supported controls');
  assert.equal(Model.preferenceStatus(state,c,scene).dirty,false);
  result[c.id].snapshot.settings.hitRadius=99;
  assert.equal(entry.snapshot.settings.hitRadius,14,'returned metadata cannot mutate the accepted snapshot');
});

test('draft changes and inherited tuning do not change accepted preferences until explicit update', () => {
  const state=Model.fresh(),a=study('gumball-move'),b=study('gumball-plane'),scene=sampleScene();
  Model.commitPreferences(state,[a.id,b.id],{[a.id]:scene,[b.id]:scene});
  const accepted=JSON.stringify(state.commits[a.id].snapshot);
  state.document.hitRadius=22;
  state.categories.gumball={opacity:65};
  state.groups[a.id+':assembly']={hoverCursor:'grab'};
  state.objects[a.id+':box-a']={strokeWidth:3};
  scene.objects[0].width=150;
  assert.equal(Model.preferenceStatus(state,a,scene).dirty,true);
  assert.equal(Model.preferenceStatus(state,b,scene).dirty,true,'document/category changes are visible to every affected interface');
  assert.equal(JSON.stringify(state.commits[a.id].snapshot),accepted);
  assert.equal(state.commits[b.id].snapshot.geometry[0].width,100,'batch snapshots do not alias each other or live geometry');
  Model.commitPreferences(state,[a.id],{[a.id]:scene});
  assert.equal(Model.preferenceStatus(state,a,scene).dirty,false);
  assert.equal(state.commits[a.id].revision,2);
  assert.equal(state.commits[a.id].snapshot.geometry[0].width,150);
  assert.equal(state.commits[b.id].revision,1,'updating one interface never commits another');
  Model.commitPreferences(state,[a.id],{[a.id]:scene});
  assert.equal(state.commits[a.id].revision,3,'each deliberate update gets a revision even when unchanged');
});

test('browsing and selection keep settings clean while written feedback requires an explicit update', () => {
  const state=Model.fresh(),c=study('gumball-move'),scene=sampleScene();
  state.scenes[c.id]=scene;
  Model.commitPreferences(state,[c.id]);
  scene.selection=['box-b'];
  scene.subSelection=[{objectId:'box-a',kind:'vertex',index:1}];
  scene.camera={x:150,y:300,zoom:2,orbit:180};
  scene.pivot={x:200,y:200};scene.idSequence=100;
  state.activeCase='snap-end';
  assert.equal(Model.preferenceStatus(state,c).dirty,false);
  state.drafts[c.id]='Draft observation';state.feedback.push({caseId:c.id,text:'Observation'});
  const status=Model.preferenceStatus(state,c);assert.equal(status.settingsDirty,false);assert.equal(status.feedbackDirty,true);assert.equal(status.state,'altered');
  scene.objects[0].group='new assembly';
  assert.equal(Model.preferenceStatus(state,c).dirty,true,'authored group membership is part of the interface scene');
  scene.objects[0].group='assembly';scene.objects[0].x+=1;
  assert.equal(Model.preferenceStatus(state,c).dirty,true,'geometry edits require explicit update');
});

test('commit captures saved and draft feedback immutably and later text cannot inherit completion', () => {
  const state=Model.fresh(),c=study('subobject-face'),other=study('subobject-edge');
  state.feedback=[{id:'note-a',caseId:c.id,text:' Only the face ',verdict:'Needs tuning',prototypeIds:[other.id]}];state.drafts[c.id]='Also select polyline segments';
  Model.commitPreferences(state,[c.id,other.id]);
  assert.deepEqual(state.commits[c.id].feedback,[{id:'note-a',text:'Only the face',verdict:'Needs tuning',source:'saved'},{id:'draft:'+c.id,text:'Also select polyline segments',verdict:'Needs tuning',source:'draft'}]);
  assert.equal(state.commits[other.id].feedback.length,1,'bulk observation applies to associated marked studies');
  assert.equal(Model.preferenceStatus(state,c).feedbackDirty,false);assert.equal(state.drafts[c.id],'Also select polyline segments','commit preserves draft text');
  state.feedback[0].text='Only the edge';assert.equal(state.commits[c.id].feedback[0].text,'Only the face');assert.equal(Model.preferenceStatus(state,c).state,'altered');assert.equal(Model.preferenceStatus(state,other).feedbackDirty,true);
  state.drafts[c.id]='Changed draft';assert.equal(state.commits[c.id].feedback[1].text,'Also select polyline segments');
  const imported=Model.validate(JSON.parse(JSON.stringify(state)));assert.deepEqual(imported.commits,state.commits);assert.equal(Model.preferenceStatus(imported,c).feedbackDirty,true);
});

test('legacy settings commits cannot hide written requests and imported feedback IDs are stable and unique', () => {
  const c=study('subobject-face'),state=Model.fresh();Model.commitPreferences(state,[c.id]);delete state.commits[c.id].feedback;
  state.feedback=[{caseId:c.id,text:'First request'},{id:'same',caseId:c.id,text:'Second request'},{id:'same',caseId:c.id,text:'Third request'}];state.drafts[c.id]='Draft request';
  const imported=Model.validate(JSON.parse(JSON.stringify(state))),again=Model.validate(JSON.parse(JSON.stringify(imported)));
  assert.deepEqual(imported.commits[c.id].feedback,[]);assert.equal(Model.preferenceStatus(imported,c).state,'altered');assert.equal(Model.feedbackForCase(imported,c).length,4);
  assert.equal(new Set(imported.feedback.map(n=>n.id)).size,3);assert.deepEqual(again.feedback,imported.feedback);
});

test('restoring accepted preferences pins effective values without changing parent settings or other cases', () => {
  const state=Model.fresh(),c=study('gumball-move'),other=study('snap-end'),scene=sampleScene();
  state.document.hitRadius=12;state.categories.gumball={opacity:70};
  state.groups[c.id+':assembly']={hitRadius:18};state.objects[c.id+':box-a']={hoverCursor:'grab'};
  Model.commitPreferences(state,[c.id],{[c.id]:scene});
  state.document.hitRadius=25;state.categories.gumball.opacity=60;
  state.prototypes[c.id]={hitRadius:29};state.prototypes[other.id]={hitRadius:19};
  state.groups[c.id+':assembly']={hitRadius:30};state.groups[c.id+':extra']={hitRadius:28};state.groups[other.id+':assembly']={hitRadius:16};
  state.objects[c.id+':box-a']={hoverCursor:'pointer'};state.objects[c.id+':extra']={opacity:30};state.objects[other.id+':box-a']={hoverCursor:'crosshair'};
  const restored=Model.restorePreferences(state,[c.id]);
  assert.equal(state.document.hitRadius,25);assert.equal(state.categories.gumball.opacity,60);
  assert.equal(Model.effective(state,c).hitRadius,12);assert.equal(Model.effective(state,c).opacity,70);
  assert.equal(Model.effective(state,c,boxA).hitRadius,18);assert.equal(Model.effective(state,c,boxA).hoverCursor,'grab');
  assert.equal(Object.hasOwn(state.groups,c.id+':extra'),false);assert.equal(Object.hasOwn(state.objects,c.id+':extra'),false);
  assert.deepEqual(state.prototypes[other.id],{hitRadius:19});assert.deepEqual(state.groups[other.id+':assembly'],{hitRadius:16});assert.deepEqual(state.objects[other.id+':box-a'],{hoverCursor:'crosshair'});
  assert.equal(Model.preferenceStatus(state,c,{...scene,objects:restored[c.id]}).dirty,false);
  restored[c.id][0].x=999;
  assert.equal(state.commits[c.id].snapshot.geometry[0].x,10,'restored geometry is a copy');
});

test('legacy workspaces migrate and accepted preferences survive export/import independently of drafts', () => {
  assert.deepEqual(Model.validate({version:1,document:{hitRadius:10}}).commits,{});
  const state=Model.fresh(),c=study('gumball-move');
  state.scenes[c.id]=sampleScene();state.prototypes[c.id]={hitRadius:13};
  Model.commitPreferences(state,[c.id]);state.prototypes[c.id].hitRadius=20;
  const imported=Model.validate(JSON.parse(JSON.stringify(state)));
  assert.equal(imported.prototypes[c.id].hitRadius,20);assert.equal(imported.commits[c.id].snapshot.settings.hitRadius,13);
  assert.equal(Model.preferenceStatus(imported,c).dirty,true);
  assert.deepEqual(imported.commits,state.commits);
  const noGeometry=Model.fresh();Model.commitPreferences(noGeometry,[c.id]);
  assert.equal(noGeometry.commits[c.id].snapshot.geometry,null);
  assert.equal(Model.preferenceStatus(Model.validate(JSON.parse(JSON.stringify(noGeometry))),c).dirty,false);
});

test('preference import allowlists supported properties and blocks dangerous nested dictionary keys', () => {
  const c=study('gumball-move');
  const snapshot=JSON.parse('{"settings":{"hitRadius":9999,"opacity":"bad","zoomSpeed":2,"unknown":true,"width":500,"__proto__":{"polluted":true}},"groups":{"assembly":{"hitRadius":18,"width":999},"__proto__":{"polluted":true},"constructor":{"hitRadius":22},"prototype":{"hitRadius":23}},"objects":{"box-a":{"hoverCursor":"grab","locked":true},"__proto__":{"polluted":true}},"geometry":null}');
  const commits=JSON.parse('{"__proto__":{"polluted":true},"constructor":{"polluted":true},"unknown":{"revision":1}}');
  commits[c.id]={snapshot,revision:4,savedAt:'2026-10-14T12:00:00Z',unknown:'strip'};
  const imported=Model.validate({version:1,commits});
  const entry=imported.commits[c.id];
  assert.equal(entry.revision,4);assert.equal(entry.savedAt,'2026-10-14T12:00:00.000Z');
  assert.equal(entry.snapshot.settings.hitRadius,Catalog.fields.hitRadius.max);
  assert.equal(entry.snapshot.settings.opacity,Catalog.fields.opacity.default,'invalid values fall back to supported defaults');
  for(const key of ['__proto__','unknown','width','zoomSpeed'])assert.equal(Object.hasOwn(entry.snapshot.settings,key),false,key);
  assert.deepEqual(entry.snapshot.groups,{assembly:{hitRadius:18}});assert.deepEqual(entry.snapshot.objects,{'box-a':{hoverCursor:'grab'}});
  assert.equal(Object.getPrototypeOf(entry.snapshot.groups),Object.prototype);assert.equal(Object.hasOwn(imported.commits,'__proto__'),false);assert.equal({}.polluted,undefined);
  for(const invalid of [{revision:0,savedAt:entry.savedAt,snapshot},{revision:1,savedAt:'invalid',snapshot},{revision:1,savedAt:entry.savedAt,snapshot:[]}])assert.equal(Object.hasOwn(Model.validate({version:1,commits:{[c.id]:invalid}}).commits,c.id),false);
  assert.throws(()=>Model.validate({version:1,commits:{[c.id]:{...entry,snapshot:{...entry.snapshot,geometry:[{id:'unsafe'}]}}}}),/scene|geometry/i);
});

test('invalid interface batches or geometry cannot partially replace accepted preferences', () => {
  const state=Model.fresh(),a=study('gumball-move'),b=study('gumball-plane');
  Model.commitPreferences(state,[a.id,b.id]);const before=JSON.stringify(state.commits);
  assert.throws(()=>Model.commitPreferences(state,[a.id,'__proto__']),/Unknown interface/);
  assert.equal(JSON.stringify(state.commits),before);
  assert.throws(()=>Model.commitPreferences(state,[a.id,b.id],{[a.id]:sampleScene(),[b.id]:{objects:[{id:'bad'}]}}),/scene|geometry/i);
  assert.equal(JSON.stringify(state.commits),before);
});

test('preference baselines distinguish unaltered, altered, and explicitly committed interfaces across reloads', () => {
  const state=Model.validate({version:1,document:{hitRadius:12}}),a=study('gumball-move'),b=study('snap-end');
  const scenes={[a.id]:sampleScene(),[b.id]:sampleScene()};
  assert.equal(Model.initializePreferences(state,scenes),Catalog.cases.length);
  assert.equal(Model.preferenceStatus(state,a,scenes[a.id]).state,'unaltered','legacy customizations become the initial baseline');
  state.prototypes[a.id]={hitRadius:18};
  assert.equal(Model.preferenceStatus(state,a,scenes[a.id]).state,'altered');
  assert.equal(Model.preferenceStatus(state,b,scenes[b.id]).state,'unaltered');
  assert.equal(Model.initializePreferences(state,scenes),0,'reinitialization cannot accept later edits as a new baseline');
  const imported=Model.validate(JSON.parse(JSON.stringify(state)));
  assert.equal(Model.preferenceStatus(imported,a,scenes[a.id]).state,'altered','draft color survives reload');
  assert.equal(Model.preferenceStatus(imported,b,scenes[b.id]).state,'unaltered');
  Model.commitPreferences(imported,[a.id],scenes);
  assert.equal(Model.preferenceStatus(imported,a,scenes[a.id]).state,'committed');
  imported.prototypes[a.id].hitRadius=20;
  const status=Model.preferenceStatus(imported,a,scenes[a.id]);
  assert.equal(status.committed,true,'accepted snapshot remains available');assert.equal(status.dirty,true);assert.equal(status.state,'altered','subsequent edits turn an accepted capsule back to altered');
  Model.commitPreferences(imported,[a.id],scenes);
  assert.equal(Model.preferenceStatus(imported,a,scenes[a.id]).state,'committed');
});

test('document and category edits update every affected capsule without moving persisted baselines', () => {
  const state=Model.fresh(),a=study('gumball-move'),b=study('gumball-plane'),other=study('snap-end');
  Model.initializePreferences(state);
  const baseline=JSON.stringify(state.preferenceBaselines);
  state.categories.gumball={hitRadius:22};
  assert.equal(Model.preferenceStatus(state,a).state,'altered');assert.equal(Model.preferenceStatus(state,b).state,'altered');assert.equal(Model.preferenceStatus(state,other).state,'unaltered');
  state.document.opacity=55;
  assert.ok(Catalog.cases.every(c=>Model.preferenceStatus(state,c).state==='altered'),'shared document edits affect the whole library');
  assert.equal(JSON.stringify(state.preferenceBaselines),baseline);
});

test('accepted presets seed new workspaces without inventing commits or sharing mutable geometry', () => {
  const source=Model.fresh(),c=study('gumball-move'),other=study('snap-end'),scene=sampleScene();
  source.prototypes[c.id]={hitRadius:17};source.groups[c.id+':assembly']={hoverCursor:'grab'};source.objects[c.id+':box-a']={strokeWidth:3};
  scene.objects[1].id='drawn-curve-42';
  const data={version:1,cases:{[c.id]:Model.preferenceSnapshot(source,c,scene),[other.id]:Model.preferenceSnapshot(source,other)}};
  const seeded=Model.fresh();assert.deepEqual(seeded.prototypes,{},'fresh state remains unseeded for model consumers');
  assert.equal(Model.seedAcceptedPreferences(seeded,data),2);
  assert.equal(Model.effective(seeded,c).hitRadius,17);assert.equal(Model.effective(seeded,c,boxA).hoverCursor,'grab');assert.equal(Model.effective(seeded,c,boxA).strokeWidth,3);
  assert.deepEqual(seeded.commits,{});assert.deepEqual(seeded.preferenceBaselines,{});
  assert.equal(seeded.scenes[c.id].idSequence,43,'seeded authored geometry cannot collide with newly created IDs');
  assert.deepEqual(seeded.scenes[c.id].selection,[]);assert.deepEqual(seeded.scenes[c.id].subSelection,[]);
  assert.equal(Object.hasOwn(seeded.scenes,other.id),false,'absent geometry does not replace the normal fixture');
  data.cases[c.id].geometry[0].x=999;data.cases[c.id].settings.hitRadius=29;
  assert.equal(seeded.scenes[c.id].objects[0].x,10);assert.equal(Model.effective(seeded,c).hitRadius,17);
  Model.initializePreferences(seeded);
  assert.equal(Model.preferenceStatus(seeded,c).state,'unaltered','new workspaces begin at the accepted starting behavior');
  assert.deepEqual(Model.validate(JSON.parse(JSON.stringify(seeded))),seeded);
});

test('accepted preset seeding preserves existing local overrides, scenes, feedback, and commit metadata', () => {
  const c=study('gumball-move'),source=Model.fresh(),state=Model.fresh();
  source.prototypes[c.id]={hitRadius:17,opacity:65};source.groups[c.id+':assembly']={hitRadius:18,opacity:70};source.objects[c.id+':box-a']={hoverCursor:'grab',strokeWidth:3};
  const data={version:1,cases:{[c.id]:Model.preferenceSnapshot(source,c,sampleScene())}};
  state.document={selectionColor:'#12ab34'};state.categories.gumball={hoverDelay:150};state.prototypes[c.id]={hitRadius:22};state.groups[c.id+':assembly']={hitRadius:25};state.objects[c.id+':box-a']={strokeWidth:4};
  state.scenes[c.id]=sampleScene();state.scenes[c.id].objects[0].x=90;state.feedback=[{caseId:c.id,text:'Keep note'}];state.drafts[c.id]='Keep draft';
  Model.commitPreferences(state,[c.id]);const before=JSON.stringify(state.commits);
  Model.seedAcceptedPreferences(state,data);
  assert.deepEqual(state.document,{selectionColor:'#12ab34'});assert.deepEqual(state.categories.gumball,{hoverDelay:150});
  assert.equal(state.prototypes[c.id].hitRadius,22);assert.equal(state.prototypes[c.id].opacity,65);
  assert.equal(state.groups[c.id+':assembly'].hitRadius,25);assert.equal(state.groups[c.id+':assembly'].opacity,70);
  assert.equal(state.objects[c.id+':box-a'].strokeWidth,4);assert.equal(state.objects[c.id+':box-a'].hoverCursor,'grab');
  assert.equal(state.scenes[c.id].objects[0].x,90);assert.equal(state.feedback[0].text,'Keep note');assert.equal(state.drafts[c.id],'Keep draft');assert.equal(JSON.stringify(state.commits),before);
});

test('accepted preset validation sanitizes known settings and rejects invalid batches atomically', () => {
  const c=study('gumball-move'),other=study('snap-end'),state=Model.fresh();
  const snapshot=JSON.parse('{"settings":{"hitRadius":9999,"unknown":true,"width":400,"__proto__":{"polluted":true}},"groups":{"assembly":{"hoverCursor":"grab","locked":true},"__proto__":{"polluted":true}},"objects":{"box-a":{"hoverCursor":"url(unsafe.svg)"},"constructor":{"polluted":true}},"geometry":null}');
  assert.equal(Model.seedAcceptedPreferences(state,{version:1,cases:{[c.id]:snapshot}}),1);
  assert.equal(state.prototypes[c.id].hitRadius,Catalog.fields.hitRadius.max);assert.equal(Object.hasOwn(state.prototypes[c.id],'unknown'),false);assert.equal(Object.hasOwn(state.prototypes[c.id],'width'),false);
  assert.deepEqual(state.groups[c.id+':assembly'],{hoverCursor:'grab'});assert.deepEqual(state.objects[c.id+':box-a'],{});assert.equal({}.polluted,undefined);
  const before=JSON.stringify(state);
  for(const invalid of [null,{version:2,cases:{}},{version:1,cases:[]},{version:1,cases:{unknown:snapshot}},{version:1,cases:{[other.id]:snapshot,[c.id]:{settings:[]}}},{version:1,cases:{[other.id]:snapshot,[c.id]:{settings:{},geometry:[{id:'bad'}]}}}]){
    assert.throws(()=>Model.seedAcceptedPreferences(state,invalid),/preferences|interface|snapshot|scene|geometry/i);
    assert.equal(JSON.stringify(state),before,'invalid seed cannot partially replace local preferences');
  }
  assert.throws(()=>Model.seedAcceptedPreferences(state,JSON.parse('{"version":1,"cases":{"__proto__":{"settings":{}}}}')),/interface/i);
  assert.equal({}.polluted,undefined);
});

test('explicit global selection color replaces only color overrides and preserves authored workspace data', () => {
  const state=Model.fresh(),c=study('selection-click');
  assert.equal(Catalog.fields.selectionColor.default,'#00ffee');
  assert.equal(Model.effective(state,c).selectionColor,'#00ffee');
  state.document={selectionColor:'#111111',opacity:80};
  state.categories.selection={selectionColor:'#222222',hitRadius:10};
  state.categories.gumball={opacity:65};
  state.prototypes[c.id]={selectionColor:'#333333',hoverDelay:150};
  state.prototypes['gumball-move']={selectionColor:'#444444',dragStrength:110};
  state.groups[c.id+':assembly']={selectionColor:'#555555',strokeWidth:3};
  state.groups[c.id+':reference']={hoverCursor:'help'};
  state.objects[c.id+':box-a']={selectionColor:'#666666',hitRadius:12};
  state.objects[c.id+':box-b']={hoverCursor:'grab'};
  state.feedback=[{id:'keep-note',caseId:c.id,text:'Keep this written observation.'}];
  state.drafts[c.id]='Keep the unsent draft.';
  state.scenes[c.id]=sampleScene();
  Model.initializePreferences(state);Model.commitPreferences(state,[c.id]);
  const before=JSON.parse(JSON.stringify(state));
  assert.equal(Model.applySelectionColor(state,'#00ffee'),'#00ffee');
  const expected=JSON.parse(JSON.stringify(before));expected.document.selectionColor='#00ffee';
  for(const store of ['categories','prototypes','groups','objects'])for(const values of Object.values(expected[store]))if(Object.hasOwn(values,'selectionColor'))values.selectionColor='#00ffee';
  assert.deepEqual(state,expected,'only authored selection-color values change at each hierarchy level');
  assert.equal(Model.effective(state,c,boxA).selectionColor,'#00ffee');
  assert.equal(Model.effective(state,c,boxB).selectionColor,'#00ffee');
  assert.equal(Model.effective(state,study('gumball-move')).selectionColor,'#00ffee');
  assert.deepEqual(state.commits,before.commits,'locked preferences remain separate from the global draft change');
  assert.deepEqual(state.preferenceBaselines,before.preferenceBaselines);
  assert.deepEqual(state.feedback,before.feedback);assert.deepEqual(state.drafts,before.drafts);assert.deepEqual(state.scenes,before.scenes);
  const unchanged=JSON.stringify(state);
  for(const invalid of ['cyan','#abc','#1234567','#00ffgg',null,{},0])assert.throws(()=>Model.applySelectionColor(state,invalid),/six-digit/);
  assert.equal(JSON.stringify(state),unchanged,'invalid colors are rejected before any override changes');
});

test('Ortho study has a 45 degree default without changing other cases or authored overrides', () => {
  const state=Model.fresh(),c=study('tracking-ortho'),other=study('tracking-tab');
  assert.equal(Model.effective(state,c).orthoAngle,45);
  assert.equal(Model.effective(state,other).orthoAngle,90);
  assert.ok(Catalog.keysFor(c).includes('orthoAngle'));
  assert.ok(!Catalog.keysFor(other).includes('orthoAngle'));
  assert.ok(!Model.commonKeys(Model.targets(state,'category',c,[],[])).includes('orthoAngle'));
  assert.ok(!Model.commonKeys(Model.targets(state,'object',c,[],[boxA])).includes('orthoAngle'));
  const target=Model.targets(state,'prototype',c,[],[]);
  Model.apply(state,target,'orthoAngle',30);
  assert.equal(Model.effective(state,c).orthoAngle,30,'the individual prototype overrides its default');
  delete state.prototypes[c.id].orthoAngle;
  state.document.orthoAngle=60;
  assert.equal(Model.effective(state,c).orthoAngle,60,'authored parent values take precedence over a case default');
  delete state.document.orthoAngle;
  state.categories.tracking={orthoAngle:15};
  assert.equal(Model.effective(state,c).orthoAngle,15);
  const imported=Model.validate({version:1,prototypes:{[c.id]:{ortho:true}},commits:{[c.id]:{revision:1,savedAt:'2026-10-14T12:00:00.000Z',snapshot:{settings:{ortho:true},geometry:null}}}});
  assert.equal(Model.effective(imported,c).orthoAngle,45,'existing workspaces acquire the new field when not explicitly configured');
  assert.equal(imported.commits[c.id].snapshot.settings.orthoAngle,45,'legacy preference snapshots use the case default');
  assert.equal(Model.preferenceStatus(imported,c).settingsDirty,false,'adding a default does not dirty imported commitments');
  const accepted=Model.fresh();
  Model.seedAcceptedPreferences(accepted,{version:1,cases:{[c.id]:{settings:{ortho:true},geometry:null}}});
  assert.equal(Model.effective(accepted,c).orthoAngle,45);
  state.prototypes[c.id].orthoAngle=22;
  Model.commitPreferences(state,[c.id]);
  assert.equal(Model.validate(JSON.parse(JSON.stringify(state))).commits[c.id].snapshot.settings.orthoAngle,22,'explicit increments survive commit and import');
});

test('workspace identity and explicit background requests survive export/import while legacy commits stay local', () => {
  const state=Model.fresh(),c=study('gumball-move');
  assert.equal(state.workspaceId,null);state.workspaceId='workspace_ABC-123';
  Model.commitPreferences(state,[c.id]);assert.equal(state.commits[c.id].backgroundRequested,false);
  state.commits[c.id].backgroundRequested=true;
  const imported=Model.validate(JSON.parse(JSON.stringify(state)));
  assert.equal(imported.workspaceId,state.workspaceId);assert.equal(imported.commits[c.id].backgroundRequested,true);
  Model.commitPreferences(imported,[c.id]);assert.equal(imported.commits[c.id].backgroundRequested,false,'each new revision requires its own deliberate background request');
  const legacy=JSON.parse(JSON.stringify(state));delete legacy.commits[c.id].backgroundRequested;
  assert.equal(Model.validate(legacy).commits[c.id].backgroundRequested,false);
  legacy.commits[c.id].backgroundRequested='true';assert.equal(Model.validate(legacy).commits[c.id].backgroundRequested,false);
  for(const workspaceId of ['', '../outside','has space','x'.repeat(101),{},'__proto__','constructor'])assert.equal(Model.validate({version:1,workspaceId}).workspaceId,null);
  assert.equal(Model.validate({version:1,workspaceId:'x'.repeat(100)}).workspaceId,'x'.repeat(100));
});

let failed = 0;
for (const [name, fn] of testCases) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}\n${error.stack}`); }
}
if (failed) process.exitCode = 1;
else console.log(`Interaction lab: ${testCases.length} checks passed.`);
