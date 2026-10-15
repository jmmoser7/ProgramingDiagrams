'use strict';
// Component marquee behavior uses actual pointer handlers and authored geometry.
const assert=require('node:assert/strict');
const Stage=require('./stage.js'),Model=require('./model.js'),Catalog=require('./catalog.js');
class Element{
  constructor(ownerDocument){this.ownerDocument=ownerDocument;this.style={};this.children=[];this.listeners={};this.capture=new Set();}
  addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}
  removeEventListener(type,fn){this.listeners[type]=(this.listeners[type]||[]).filter(item=>item!==fn);}
  dispatch(type,event={}){for(const fn of this.listeners[type]||[])fn({target:this,preventDefault(){},stopPropagation(){},...event});}
  appendChild(child){this.children.push(child);child.parentElement=this;}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);}
  setAttribute(){} focus(){} getBoundingClientRect(){return{left:0,top:0,width:800,height:500};}
  setPointerCapture(id){this.capture.add(id);} hasPointerCapture(id){return this.capture.has(id);} releasePointerCapture(id){this.capture.delete(id);}
}
const doc=new Element();doc.ownerDocument=doc;doc.body=new Element(doc);doc.createElement=()=>new Element(doc);
const canvas=new Element(doc),overlay=new Element(doc);overlay.appendChild(canvas);
const context=Object.fromEntries(['setTransform','clearRect','fillRect','strokeRect','beginPath','moveTo','lineTo','stroke','fill','closePath','setLineDash','arc','fillText','save','restore','quadraticCurveTo'].map(name=>[name,()=>{}]));
context.measureText=text=>({width:text.length*6});canvas.getContext=()=>context;
let nextFrame=0;global.requestAnimationFrame=()=>++nextFrame;global.cancelAnimationFrame=()=>{};global.ResizeObserver=class{observe(){}disconnect(){}};
const events=[],scoped={};
const stage=Stage.create({canvas,overlay,onChange:event=>events.push(event),resolveSettings:object=>scoped[object.id]||{}});
const box=(id,x,y,locked=false)=>({id,name:id,group:'Assembly',kind:'box',x,y,width:80,height:60,depth:20,rotation:0,color:'#c7d8e4',locked});
const curve={id:'curve',name:'Curve',group:'Profiles',kind:'polyline',x:80,y:-60,width:80,height:60,depth:0,rotation:0,color:'#8dacae',locked:false,points:[{x:0,y:0},{x:80,y:0},{x:80,y:60}]};
const objects=[box('a',-220,-80),box('b',-80,-80),curve,box('locked',210,-80,true)];
const chord={ctrlKey:true,shiftKey:true};
function setup(variant='face',settings={},geometry=objects){
  stage.setCase({mode:'subobject',variant});stage.setSettings({snapEnabled:false,...settings});
  for(const key of Object.keys(scoped))delete scoped[key];
  stage.restore({objects:geometry,selection:[],camera:{x:0,y:0,zoom:1,orbit:0}});events.length=0;
}
function pointer(type,p,modifiers={}){canvas.dispatch(type,{clientX:p.x+400,clientY:p.y+250,pointerId:1,button:0,shiftKey:false,ctrlKey:false,altKey:false,...modifiers});}
function drag(start,end,modifiers=chord){pointer('pointerdown',start,modifiers);pointer('pointermove',end,modifiers);pointer('pointerup',end,modifiers);}
function click(p,modifiers=chord){pointer('pointerdown',p,modifiers);pointer('pointerup',p,modifiers);}
const parts=()=>stage.serialize().subSelection;
function assertParts(kind,count,ownerCount){assert.equal(parts().length,count);assert.ok(parts().every(part=>part.kind===kind));assert.equal(stage.getSelection().length,ownerCount);}
try{
  setup();drag({x:-250,y:-110},{x:20,y:10});assertParts('face',6,2);
  assert.equal(events.at(-1).type,'subselection','Face marquee emits a selection event rather than geometry mutation');
  assert.match(events.at(-1).status,/Window sub-object/);
  setup('edge');drag({x:-250,y:-110},{x:20,y:10});assertParts('edge',24,2);
  setup('vertex');drag({x:-250,y:-110},{x:20,y:10});assertParts('vertex',16,2);
  setup();drag({x:-250,y:-110},{x:180,y:10});assert.equal(parts().length,8);assert.equal(parts().filter(part=>part.objectId==='curve'&&part.kind==='edge').length,2,'Face study includes individual polyline segments alongside solid faces');
  setup('vertex');drag({x:-250,y:-110},{x:180,y:10});assert.equal(parts().length,19);assert.equal(parts().filter(part=>part.objectId==='curve'&&part.kind==='vertex').length,3,'Vertex study includes polyline vertices across mixed geometry');
  setup();drag({x:-250,y:-110},{x:310,y:10});assert.ok(!stage.getSelection().includes('locked'),'Object locks reject component marquee');
  setup();scoped.b={locked:true};drag({x:-250,y:-110},{x:20,y:10});assertParts('face',3,1);assert.deepEqual(stage.getSelection(),['a'],'Scoped object lock rejects all its components');
  setup('edge',{typeFilter:'curve'});drag({x:-250,y:-110},{x:310,y:10});assertParts('edge',2,1);assert.deepEqual(stage.getSelection(),['curve'],'Type filter excludes solid components');
  setup('filter',{typeFilter:'subobjects'});drag({x:-250,y:-110},{x:20,y:10});assertParts('face',6,2);
  setup('filter',{typeFilter:'subobjects'});drag({x:-250,y:-110},{x:20,y:10},{});assertParts('face',6,2);click({x:-190,y:-60},{});assert.equal(parts().length,5,'Plain component-filter click still toggles a face');
  setup('filter',{typeFilter:'subobjects'});click({x:-190,y:-60},{});assertParts('face',1,1);click({x:-190,y:-60},chord);assert.equal(parts().length,0);assert.deepEqual(stage.getSelection(),['a'],'Ctrl+Shift point click still inverts the solid filter to a parent pick');
  setup();drag({x:-250,y:-110},{x:-130,y:10});assertParts('face',3,1);drag({x:-110,y:-110},{x:20,y:10});assertParts('face',6,2);drag({x:-250,y:-110},{x:20,y:10});assertParts('face',6,2);assert.equal(new Set(parts().map(part=>part.key)).size,6,'Repeated additive marquees do not duplicate components');
  const line={...curve,id:'line',x:-100,y:0,width:200,height:1,points:[{x:0,y:0},{x:200,y:0}]};
  setup('edge',{},[line]);drag({x:-20,y:-15},{x:20,y:15});assertParts('edge',0,0);
  drag({x:20,y:-15},{x:-20,y:15});assertParts('edge',1,1);assert.match(events.at(-1).status,/Crossing sub-object/,'Crossing selects a segment with both endpoints outside');
  setup('face',{},[objects[0]]);drag({x:-195,y:-110},{x:-205,y:-60});assertParts('face',1,1);assert.equal(parts()[0].index,2,'Crossing includes a face when the marquee reaches its interior without enclosing vertices');
  setup('vertex',{},[objects[0]]);drag({x:-250,y:-110},{x:-215,y:-85});assertParts('vertex',1,1);assert.equal(parts()[0].index,0,'Window independently encloses a vertex without its owner');
  setup();stage.setCase({mode:'selection',variant:'window'});drag({x:-250,y:-110},{x:20,y:10},{});assert.equal(parts().length,0);assert.deepEqual(stage.getSelection(),['a','b'],'Plain whole-object window selection is preserved');
  setup('face');const study=Catalog.cases.find(item=>item.id==='subobject-face'),workspace=Model.fresh(),before=Model.preferenceSnapshot(workspace,study,stage.serialize());drag({x:-250,y:-110},{x:20,y:10});assert.deepEqual(Model.preferenceSnapshot(workspace,study,stage.serialize()),before,'Selection-only marquee cannot dirty authored preferences or feedback');assert.ok(events.every(event=>!['transform','point','command'].includes(event.type)),'Component selection never emits an authored geometry event');
  console.log('Component marquee tests passed: multi-object faces/edges/vertices, mixed polyline parts, directional containment/crossing, additive deduplication, object/scoped locks, type filters, filter inversion, parent picking, and unchanged preference snapshots.');
}finally{stage.destroy();}
