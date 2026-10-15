'use strict';
// Exercise the scene engine without a browser: hit selection, transaction rollback,
// history, marquee, commands, and import validation. Rendering is smoke-tested.
const assert = require('node:assert/strict');
const {create, geometry} = require('./stage.js');
class Element {
  constructor(tag, ownerDocument) { this.tagName=tag;this.ownerDocument=ownerDocument;this.style={};this.children=[];this.listeners={};this.value='';this.capture=new Set(); }
  addEventListener(type,fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type,fn) { this.listeners[type]=(this.listeners[type]||[]).filter(x=>x!==fn); }
  dispatch(type,event={}) { (this.listeners[type]||[]).forEach(fn=>fn({target:this,preventDefault(){},stopPropagation(){},...event})); }
  appendChild(element) { this.children.push(element);element.parentElement=this; }
  remove() { if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(x=>x!==this); }
  setAttribute() {}
  focus() { this.ownerDocument.activeElement=this; }
  select() {}
  getBoundingClientRect() { return {left:0,top:0,width:800,height:500}; }
  setPointerCapture(id) { this.capture.add(id); }
  hasPointerCapture(id) { return this.capture.has(id); }
  releasePointerCapture(id) { this.capture.delete(id); }
}
const document=new Element('document');document.ownerDocument=document;document.createElement=tag=>new Element(tag,document);document.body=new Element('body',document);
const canvas=new Element('canvas',document),overlay=new Element('div',document);overlay.appendChild(canvas);
const drawingMethods=['setTransform','clearRect','fillRect','strokeRect','beginPath','moveTo','lineTo','stroke','fill','closePath','setLineDash','arc','fillText','save','restore','quadraticCurveTo'];
const context=Object.fromEntries(drawingMethods.map(name=>[name,()=>{}]));context.measureText=text=>({width:text.length*6});canvas.getContext=()=>context;
let recordDrawing=false;const drawingLog=[],drawingStack=[];let currentDrawingPath=[];
const stateKeys=['globalAlpha','fillStyle','strokeStyle','lineWidth','shadowColor','shadowBlur','lineJoin','font','textAlign'];context.globalAlpha=1;context.shadowBlur=0;
context.save=()=>drawingStack.push(Object.fromEntries(stateKeys.map(key=>[key,context[key]])));
context.restore=()=>Object.assign(context,drawingStack.pop()||{});
context.beginPath=()=>{currentDrawingPath=[];};
for(const method of ['moveTo','lineTo','closePath','arc','quadraticCurveTo'])context[method]=(...args)=>currentDrawingPath.push({method,args});
for(const method of ['stroke','fill','strokeRect'])context[method]=(...args)=>{if(recordDrawing)drawingLog.push({method,args,path:currentDrawingPath.map(command=>({method:command.method,args:command.args.slice()})),...Object.fromEntries(stateKeys.map(key=>[key,context[key]]))});};
let frames=new Map(),frameId=1;global.requestAnimationFrame=fn=>{const id=frameId++;frames.set(id,fn);return id;};global.cancelAnimationFrame=id=>frames.delete(id);global.ResizeObserver=class {observe(){}disconnect(){}};
const events=[],scopedSettings={};const stage=create({canvas,overlay,settings:{snapEnabled:false},resolveSettings:object=>scopedSettings[object.id]||{},caseStudy:{mode:'selection',variant:'click'},onChange:event=>events.push(event)});
function flush(){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(performance.now()));}
function pointer(type,x,y,extra={}){canvas.dispatch(type,{clientX:x,clientY:y,pointerId:1,button:0,shiftKey:false,ctrlKey:false,altKey:false,...extra});}
function click(x,y,extra){pointer('pointerdown',x,y,extra);pointer('pointerup',x,y,extra);}
function key(key,extra={}){document.dispatch('keydown',{target:canvas,key,shiftKey:false,ctrlKey:false,altKey:false,...extra});}
function project(point){const c=stage.serialize().camera;return{x:400+(point.x-c.x)*c.zoom,y:250+(point.y-c.y)*c.zoom};}
function at(type,point,extra){const p=project(point);pointer(type,p.x,p.y,extra);}
function pick(point,extra){const p=project(point);click(p.x,p.y,extra);}
assert.deepEqual(geometry.intersection({x:0,y:0},{x:10,y:10},{x:0,y:10},{x:10,y:0}),{x:5,y:5});
assert.equal(geometry.inside({x:5,y:5},[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}]),true);
flush();
click(195,180);assert.deepEqual(stage.getSelection(),['block-a']);
click(600,170,{shiftKey:true});assert.equal(stage.getSelection().length,2,'Shift adds another object');
click(195,180,{ctrlKey:true});assert.deepEqual(stage.getSelection(),['circle-a'],'Ctrl removes only the hit object');
stage.setSelection(['block-a']);const original=stage.getObjects().find(o=>o.id==='block-a');
pointer('pointerdown',195,180);pointer('pointermove',235,200);key('Escape');pointer('pointerup',235,200);
assert.deepEqual(stage.getObjects().find(o=>o.id==='block-a'),original,'Escape rolls back an active drag');
pointer('pointerdown',195,180);pointer('pointermove',235,200);pointer('pointerup',235,200);
assert.notEqual(stage.getObjects().find(o=>o.id==='block-a').x,original.x,'Dragging commits translation');
stage.undo();assert.deepEqual(stage.getObjects().find(o=>o.id==='block-a'),original);stage.redo();assert.notEqual(stage.getObjects().find(o=>o.id==='block-a').x,original.x);
stage.reset();pointer('pointerdown',90,90);pointer('pointermove',290,300);pointer('pointerup',290,300);
assert.deepEqual(stage.getSelection(),['block-a'],'Left-to-right marquee requires complete enclosure');
stage.setCase({mode:'gumball',variant:'copy'});const count=stage.getObjects().length;
pointer('pointerdown',263,172,{altKey:true});pointer('pointermove',315,172,{altKey:true});pointer('pointerup',315,172,{altKey:true});
assert.equal(stage.getObjects().length,count+1,'Copy gumball creates geometry only after drag threshold');stage.undo();assert.equal(stage.getObjects().length,count);
stage.setCase({mode:'command',variant:'polyline'});click(100,330);click(200,340);click(260,390);key('Enter');
assert.equal(stage.getObjects().length,count+1,'Enter commits a point-pick polyline');assert.equal(stage.getObjects().at(-1).points.length,3);
stage.setCase({mode:'command',variant:'cancel'});click(110,330);click(210,340);key('Escape');assert.equal(stage.getObjects().length,count+1,'Escape discards uncommitted command geometry');
const saved=stage.serialize();stage.updateObjects(['block-a'],{width:200,locked:true});stage.restore(saved);assert.equal(stage.getObjects().find(o=>o.id==='block-a').width,132);assert.equal(stage.getObjects().find(o=>o.id==='block-a').locked,false);
assert.throws(()=>stage.restore({objects:[{id:'bad',x:'NaN'}]}),/Invalid x/);
assert.throws(()=>stage.restore(JSON.parse('{"objects":[{"id":"bad","__proto__":{"polluted":true}}]}')),/Unsafe scene property/);
assert.equal({}.polluted,undefined);
stage.reset();stage.setSettings({snapEnabled:false,typeFilter:'circle'});click(195,180);assert.deepEqual(stage.getSelection(),[],'Type filters exclude incompatible objects');click(600,170);assert.deepEqual(stage.getSelection(),['circle-a']);
stage.setSettings({snapEnabled:false});stage.setCase({mode:'selection',variant:'group'});click(195,180);assert.deepEqual(stage.getSelection(),['block-a','block-b']);click(195,180,{ctrlKey:true,shiftKey:true});assert.deepEqual(stage.getSelection(),['block-a'],'Group modifier isolates one member');
stage.setCase({mode:'subobject',variant:'vertex'});pick({x:-262.6,y:-109.8},{ctrlKey:true,shiftKey:true});assert.equal(events.at(-1).detail.subSelection[0].kind,'vertex');
const componentScene=stage.serialize(),savedComponents=componentScene.subSelection;stage.setSelection([]);componentScene.subSelection.push({objectId:'block-a',kind:'edge',index:999},{objectId:'missing',kind:'face',index:0},{objectId:'block-a',kind:'invalid',index:0});stage.restore(componentScene);assert.deepEqual(stage.serialize().subSelection,savedComponents.slice(0,1),'Scene import preserves valid selected components and drops invalid topology');
stage.setCase({mode:'subobject',variant:'filter'});stage.setSettings({snapEnabled:false,typeFilter:'subobjects'});click(195,180);assert.equal(events.at(-1).detail.subSelection[0].kind,'face');click(195,180,{ctrlKey:true,shiftKey:true});assert.deepEqual(events.at(-1).detail.subSelection,[],'Subobject filter inverts the modifier');
stage.setSettings({snapEnabled:false});stage.setCase({mode:'selection',variant:'overlap'});pick({x:0,y:-10});assert.equal(events.at(-1).type,'ambiguity');const menu=overlay.children.find(x=>x.className==='lab-stage-menu');assert.ok(menu.children.length>=3);menu.children.at(-1).dispatch('click');assert.equal(stage.getSelection().length,1);
stage.setCase({mode:'selection',variant:'locked'});pick({x:190,y:110});assert.equal(stage.getSelection().length,0);stage.setSelection(['reference-a']);assert.deepEqual(stage.getSelection(),['reference-a'],'Inspector can target a locked reference');stage.updateObjects(['reference-a'],{locked:false});pick({x:190,y:110});assert.deepEqual(stage.getSelection(),['reference-a']);
stage.reset();stage.setCase({mode:'gumball',variant:'numeric'});stage.setSettings({snapEnabled:false,cursorPolicy:'native'});pointer('pointermove',263,172);assert.equal(canvas.style.cursor,'default','Native policy retains arrow over widget');
scopedSettings['block-a']={hoverCursor:'pointer'};pointer('pointermove',263,172);assert.equal(canvas.style.cursor,'pointer','Object cursor override wins over policy');delete scopedSettings['block-a'];
scopedSettings['block-a']={cursorScale:150};pointer('pointermove',263,172);assert.match(canvas.style.cursor,/data:image\/svg/,'Object cursor scale creates a sized cursor');delete scopedSettings['block-a'];
click(263,172);const numeric=overlay.children.find(x=>x.className==='lab-stage-input');assert.ok(numeric);numeric.children[0].children[0].value='40';numeric.dispatch('submit');assert.equal(stage.getObjects().find(o=>o.id==='block-a').x,-205,'Numeric handle transform commits exact distance');stage.undo();
stage.setCase({mode:'gumball',variant:'relocate'});const beforeRelocate=stage.getObjects();pointer('dblclick',263,172);click(600,250);assert.deepEqual(stage.getObjects(),beforeRelocate,'Relocating origin preserves geometry');assert.ok(stage.serialize().pivot);stage.undo();assert.equal(stage.serialize().pivot,null);
stage.setCase({mode:'atlas',variant:'resize'});pointer('pointerdown',272,172);pointer('pointermove',302,172);pointer('pointerup',302,172);const resized=stage.getObjects().find(o=>o.id==='block-a');assert.ok(resized.width>132);assert.equal(resized.height,100,'Edge resize preserves perpendicular dimension');stage.undo();
stage.setCase({mode:'command',variant:'cancel'});pointer('pointerdown',195,180);pointer('pointermove',230,180);key('Escape');assert.equal(stage.getObjects().find(o=>o.id==='block-a').x,-245,'Cancel study permits transform and rolls it back');
const geometryBeforePan=stage.getObjects(),cameraBefore=stage.serialize().camera;key(' ',{code:'Space'});pointer('pointerdown',400,250);pointer('pointermove',460,290);pointer('pointerup',460,290);document.dispatch('keyup',{target:canvas,key:' ',code:'Space'});assert.notEqual(stage.serialize().camera.x,cameraBefore.x);assert.deepEqual(stage.getObjects(),geometryBeforePan,'Temporary pan preserves authored geometry');
stage.reset();stage.setCase({mode:'tracking',variant:'ortho'});stage.setSettings({snapEnabled:false,ortho:true,orthoAngle:90});click(100,330);click(220,380);let picked=events.filter(e=>e.type==='point').at(-1).detail.point;const first=events.filter(e=>e.type==='point').at(-2).detail.point;assert.equal(picked.y,first.y,'Persistent Ortho locks the nearest axis');click(260,440,{shiftKey:true});const shifted=events.filter(e=>e.type==='point').at(-1).detail.point;assert.notEqual(shifted.x,picked.x,'Shift inverts enabled Ortho');
stage.setCase({mode:'tracking',variant:'tab'});stage.setSettings({snapEnabled:false});click(100,300);pointer('pointermove',200,330);key('Tab');assert.match(events.at(-1).status,/Direction locked/);pointer('pointermove',230,350);key('Tab');assert.match(events.at(-1).status,/Radius locked/);click(250,400);const points=events.filter(e=>e.type==='point').slice(-2).map(e=>e.detail.point);const radiusPixels=Math.hypot(130,50);assert.ok(Math.abs(geometry.distance(...points)*stage.serialize().camera.zoom-radiusPixels)<.01,'Second Tab locks the captured radius');key('Tab');assert.match(events.at(-1).status,/released/);
stage.setCase({mode:'snap',variant:'mid'});stage.setSettings({snapEnabled:true});pointer('pointermove',177,102);flush();
assert.ok(events.some(event=>event.type==='snap'),'Snap acquisition produces inspectable events');
stage.setSettings({snapEnabled:false});scopedSettings['block-a']={snapEnabled:true};pointer('pointermove',177,102);click(177,102);assert.equal(events.at(-1).detail.snap.objectId,'block-a','Child snap enable overrides ancestor disable');scopedSettings['block-a']={snapEnabled:false};pointer('pointermove',177,102);click(177,102);assert.equal(events.at(-1).detail.snap,null,'Disabling source clears retained snap');delete scopedSettings['block-a'];
stage.setCase({mode:'snap',variant:'center'});stage.setSettings({snapEnabled:true});pick({x:-187.8,y:-48.4});assert.equal(events.at(-1).detail.snap,null,'Center snap does not invent a box bounding-box center');pick({x:179,y:-46});assert.equal(events.at(-1).detail.snap.label,'Center');assert.equal(events.at(-1).detail.snap.objectId,'circle-a');
stage.setCase({mode:'snap',variant:'mid'});pick({x:215.3,y:-13.07});assert.equal(events.at(-1).detail.snap,null,'Mid snap ignores circle render tessellation');
async function testComponentPresentationAndCurvePicking(){
  const selectionColor='#2345ef',highlightColor='#ed1234',chord={ctrlKey:true,shiftKey:true};
  const componentCases=[
    {variant:'face',point:{x:-200,y:-55},kind:'face',index:2},
    {variant:'edge',point:{x:-196.6,y:-109.8},kind:'edge',index:0},
    {variant:'vertex',point:{x:-262.6,y:-109.8},kind:'vertex',index:0}
  ];
  function setup(variant,typeFilter='all'){
    stage.setCase({mode:'subobject',variant});stage.reset();
    stage.setSettings({snapEnabled:false,prehighlight:true,hoverDelay:0,tooltipDelay:2500,selectionColor,highlightColor,hoverPresentation:'outline-fill',typeFilter});
    pointer('pointermove',760,440);
  }
  function capture(color){
    drawingLog.length=0;recordDrawing=true;flush();recordDrawing=false;
    return drawingLog.filter(call=>call.method==='fill'?call.fillStyle===color:call.strokeStyle===color);
  }
  function assertPartOnly(calls,kind,label){
    const fills=calls.filter(call=>call.method==='fill'),strokes=calls.filter(call=>call.method==='stroke');
    assert.ok(!calls.some(call=>call.method==='strokeRect'),label+' has no parent selection bounds');
    assert.equal(strokes.length,kind==='vertex'?0:1,label+' draws only the component outline');
    assert.equal(fills.length,kind==='edge'?0:1,label+' fills only a face or vertex');
    if(kind==='edge')assert.deepEqual(strokes[0].path.map(command=>command.method),['moveTo','lineTo'],label+' paints a single segment rather than a polyline or parent wire');
    if(kind==='face')assert.deepEqual(strokes[0].path.map(command=>command.method),['moveTo','lineTo','lineTo','lineTo','closePath'],label+' paints only one face perimeter');
    if(kind==='vertex')assert.deepEqual(fills[0].path.map(command=>command.method),['arc'],label+' paints only one vertex marker');
  }
  for(const study of componentCases){
    setup(study.variant);pick(study.point,chord);
    assert.deepEqual(stage.serialize().subSelection.map(({objectId,kind,index})=>({objectId,kind,index})),[{objectId:'block-a',kind:study.kind,index:study.index}],'Ctrl+Shift picks the intended box '+study.kind);
    assertPartOnly(capture(selectionColor),study.kind,'Selected box '+study.kind);
    stage.setSelection([]);at('pointermove',study.point,chord);await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(events.filter(event=>event.type==='hover').at(-1).detail.subSelection.length,0,'Hover does not select '+study.kind);
    assertPartOnly(capture(highlightColor),study.kind,'Hovered box '+study.kind);
  }
  const segmentPoint={x:-151,y:138},otherSegmentPoint={x:-63.5,y:148};
  for(const variant of ['face','edge','vertex','filter'])for(const filter of (variant==='filter'?['all','subobjects']:['all'])){
    setup(variant,filter);at('pointermove',segmentPoint,chord);await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(canvas.style.cursor,'crosshair',variant+'/'+filter+' presents a component cursor on a polyline segment');
    const hoverCalls=capture(highlightColor);assertPartOnly(hoverCalls,'edge',variant+'/'+filter+' hovered polyline');
    const expected=[project({x:-196,y:158}),project({x:-106,y:118})];
    assert.deepEqual(hoverCalls[0].path.map(command=>command.args),expected.map(point=>[point.x,point.y]),variant+'/'+filter+' previews the first segment endpoints only');
    pick(segmentPoint,chord);assert.deepEqual(stage.serialize().subSelection.map(({objectId,kind,index})=>({objectId,kind,index})),[{objectId:'curve-a',kind:'edge',index:0}],variant+'/'+filter+' selects a single polyline segment with Ctrl+Shift');
    pointer('pointermove',760,440);assertPartOnly(capture(selectionColor),'edge',variant+'/'+filter+' selected polyline');
    pick(otherSegmentPoint,chord);assert.deepEqual(stage.serialize().subSelection.map(part=>part.index),[0,1],variant+'/'+filter+' adds another segment without selecting its parent');
    pick(segmentPoint,chord);assert.deepEqual(stage.serialize().subSelection.map(part=>part.index),[1],variant+'/'+filter+' toggles only the picked segment off');
    pick(otherSegmentPoint,chord);assert.deepEqual(stage.getSelection(),[],variant+'/'+filter+' clears the owner when its last selected segment is removed');
  }
  setup('filter','subobjects');pick(segmentPoint);assert.equal(stage.serialize().subSelection[0].kind,'edge','Sub-objects filter also supports plain-click segment selection');
  setup('face');pick(segmentPoint,chord);const stored=stage.serialize();stage.setSelection([]);stage.restore(stored);
  assert.equal(stage.serialize().subSelection[0].index,0,'A selected polyline segment survives scene persistence');
  pointer('pointermove',760,440);assertPartOnly(capture(selectionColor),'edge','Restored polyline segment');
  stage.setCase({mode:'selection',variant:'click'});stage.reset();stage.setSettings({selectionColor,snapEnabled:false});pick({x:-200,y:-55});
  const whole=capture(selectionColor);assert.equal(whole.filter(call=>call.method==='stroke').length,3,'Whole-object picking retains all three box face outlines');assert.equal(whole.filter(call=>call.method==='strokeRect').length,1,'Whole-object picking retains its selection bounds');
  pick({x:179,y:-46},{shiftKey:true});assert.equal(stage.getSelection().length,2,'Shift-add whole-object selection remains available after component studies');pick({x:-200,y:-55},{ctrlKey:true});assert.deepEqual(stage.getSelection(),['circle-a'],'Ctrl-remove still removes only the whole-object hit');
}
async function testCursorAndHoverPresentations(){
  const catalog=require('./catalog.js');
  assert.equal(catalog.cursorChoices.length,36,'Every standard CSS cursor keyword has a preview');
  assert.equal(new Set(catalog.cursorChoices.map(choice=>choice.value)).size,36,'Cursor values are unique');
  assert.ok(catalog.cursorChoices.every(choice=>choice.icon.startsWith('<svg ')&&!/href=|<image|<text|url\(/.test(choice.icon)),'Cursor previews use static local SVG geometry');
  stage.setCase({mode:'selection',variant:'click'});stage.reset();
  stage.setSettings({snapEnabled:false,cursorPolicy:'native',idleCursor:'help'});pointer('pointermove',760,440);
  assert.equal(canvas.style.cursor,'help','An explicit base cursor applies over empty space');
  for(const {value} of catalog.cursorChoices){
    stage.setSettings({snapEnabled:false,cursorPolicy:'native',hoverCursor:value,cursorScale:100});pointer('pointermove',195,180);
    assert.equal(canvas.style.cursor,value==='auto'?'default':value,'Hover accepts '+value+' at native size');
  }
  scopedSettings['block-a']={idleCursor:'cell',hoverCursor:'auto'};stage.setSettings({snapEnabled:false,cursorPolicy:'native'});pointer('pointermove',195,180);
  assert.equal(canvas.style.cursor,'cell','An object base cursor overrides inherited automatic presentation');
  scopedSettings['block-a']={hoverCursor:'none'};pointer('pointermove',195,180);assert.equal(canvas.style.cursor,'none','An object can hide its hover cursor');delete scopedSettings['block-a'];
  stage.setSettings({snapEnabled:false,idleCursor:'none',hoverCursor:'wait'});pointer('pointermove',760,440);assert.equal(canvas.style.cursor,'none','Hidden base cursor survives empty-space hover');
  pointer('pointerdown',195,180);pointer('pointermove',230,180);assert.equal(canvas.style.cursor,'move','Hover presentation does not replace the active transform cursor');key('Escape');pointer('pointerup',230,180);
  stage.setCase({mode:'atlas',variant:'rename'});pointer('dblclick',195,180);const rename=overlay.children.find(element=>element.className==='lab-stage-input');
  assert.ok(rename,'Inline text input opens with cursor overrides enabled');
  const focusedInput=document.activeElement;stage.setSettings({idleCursor:'crosshair',hoverCursor:'not-allowed'});assert.equal(document.activeElement,focusedInput,'Cursor setting changes preserve text-input focus');key('Escape');
  stage.setCase({mode:'selection',variant:'click'});stage.reset();
  const hoverColor='#ff1234';
  async function hoverProfile(presentation,extra={}){
    stage.setSettings({snapEnabled:false,prehighlight:true,hoverDelay:0,tooltipDelay:2500,highlightColor:hoverColor,hoverPresentation:presentation,hoverOpacity:40,...extra});
    pointer('pointermove',195,180);await new Promise(resolve=>setTimeout(resolve,5));
    drawingLog.length=0;recordDrawing=true;flush();recordDrawing=false;
    return drawingLog.filter(call=>call.method==='fill'?call.fillStyle===hoverColor:call.strokeStyle===hoverColor);
  }
  const profiles={};for(const presentation of catalog.fields.hoverPresentation.options)profiles[presentation]=await hoverProfile(presentation);
  assert.equal(profiles.none.length,0,'None suppresses passive geometry presentation');
  assert.ok(profiles.outline.some(call=>call.method==='stroke')&&!profiles.outline.some(call=>call.method==='fill'),'Outline paints edges only');
  assert.ok(profiles.fill.some(call=>call.method==='fill'&&Math.abs(call.globalAlpha-.4)<.001)&&!profiles.fill.some(call=>call.method==='stroke'),'Fill uses the chosen opacity without replacing edges');
  assert.ok(profiles['outline-fill'].some(call=>call.method==='fill')&&profiles['outline-fill'].some(call=>call.method==='stroke'),'Outline and fill paint both treatments');
  assert.ok(profiles.bounds.some(call=>call.method==='strokeRect'),'Bounds paints a surrounding rectangle');
  assert.equal(profiles.corners.filter(call=>call.method==='stroke').length,1,'Corners paints one bracket path');
  assert.ok(profiles.halo.some(call=>call.method==='stroke'&&call.shadowBlur===12&&call.shadowColor===hoverColor),'Halo paints a soft expanded silhouette');
  assert.equal((await hoverProfile('fill',{prehighlight:false})).length,0,'Passive highlight disables every geometry hover style');
  scopedSettings['block-a']={hoverPresentation:'corners',hoverOpacity:75};const scoped=await hoverProfile('fill');assert.equal(scoped.filter(call=>call.method==='stroke').length,1,'Object hover style overrides the document style');assert.ok(!scoped.some(call=>call.method==='fill'));delete scopedSettings['block-a'];
  stage.setSelection(['block-a']);assert.equal((await hoverProfile('fill')).length,0,'Selected geometry keeps its selection treatment while hovered');
}
testComponentPresentationAndCurvePicking().then(testCursorAndHoverPresentations).then(()=>{
  stage.destroy();assert.equal(frames.size,0);console.log('Stage tests passed: selection, directional marquee, type filters, groups, subobjects, overlap, locked references, all 36 cursor presentations, scoped hover styles, numeric transforms, relocation, resize, cancellation, history, duplication, pan, commands, Ortho, Tab constraints, persistence, snap events, and rendering.');
}).catch(error=>{stage.destroy();console.error(error);process.exitCode=1;});
