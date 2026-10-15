'use strict';
const assert=require('node:assert/strict');
const Stage=require('./stage.js'),Precision=require('./scene-precision.js');
class Element{
  constructor(ownerDocument){this.ownerDocument=ownerDocument;this.style={};this.children=[];this.listeners={};this.capture=new Set();}
  addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);} removeEventListener(type,fn){this.listeners[type]=(this.listeners[type]||[]).filter(x=>x!==fn);}
  dispatch(type,event={}){for(const fn of this.listeners[type]||[])fn({target:this,preventDefault(){},stopPropagation(){},...event});}
  appendChild(child){this.children.push(child);child.parentElement=this;} remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(x=>x!==this);}
  setAttribute(){} focus(){} getBoundingClientRect(){return{left:0,top:0,width:800,height:500};}
  setPointerCapture(id){this.capture.add(id);} hasPointerCapture(id){return this.capture.has(id);} releasePointerCapture(id){this.capture.delete(id);}
}
const doc=new Element();doc.ownerDocument=doc;doc.body=new Element(doc);doc.createElement=()=>new Element(doc);
const canvas=new Element(doc),overlay=new Element(doc);overlay.appendChild(canvas);
const context=new Proxy({measureText:text=>({width:text.length*6})},{get:(obj,key)=>key in obj?obj[key]:()=>{}});canvas.getContext=()=>context;
const frames=new Map();let next=0;global.requestAnimationFrame=fn=>{frames.set(++next,fn);return next;};global.cancelAnimationFrame=id=>frames.delete(id);global.ResizeObserver=class{observe(){}disconnect(){}};
const events=[],scoped={};const stage=Stage.create({canvas,overlay,resolveSettings:o=>scoped[o.id]||{},onChange:event=>events.push(event)});
const circle={id:'profile',name:'Profile',kind:'circle',group:'Profiles',x:100,y:0,width:80,height:40,depth:0,rotation:30,color:'#123456',locked:false};
const box={id:'solid',name:'Solid',kind:'box',group:'Solids',x:0,y:0,width:100,height:100,depth:20,rotation:0,color:'#123456',locked:false};
function line(id,x,y,height){return{id,name:id,kind:'polyline',group:'Profiles',x,y,width:1,height,depth:0,rotation:0,color:'#123456',locked:false,points:[{x:0,y:0},{x:0,y:height}]};}
function setup(mode,variant,objects,settings={}){stage.setCase({mode,variant});stage.setSettings({snapEnabled:true,snapRadius:3,snapRelease:3,trackDelay:0,...settings});stage.restore({objects,selection:[],camera:{x:0,y:0,zoom:1,orbit:0}});events.length=0;}
function pointer(type,p,extra={}){canvas.dispatch(type,{clientX:400+p.x,clientY:250+p.y,pointerId:1,button:0,shiftKey:false,ctrlKey:false,altKey:false,...extra});}
function pick(p,extra={}){pointer('pointermove',p,extra);pointer('pointerdown',p,extra);pointer('pointerup',p,extra);return events.filter(e=>e.type==='point').at(-1);}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
(async()=>{try{
  const a=[{x:0,y:0},{x:10,y:0}],b=[{x:5,y:-5},{x:5,y:5}];
  assert.deepEqual(Precision.trueIntersection(a,a,b,b).point,{x:5,y:0});
  assert.equal(Precision.trueIntersection(a,a.map(p=>({...p,z:10})),b,b),null,'Crossing at different modeled elevations is rejected');
  assert.equal(Precision.trueIntersection(a,[{x:50,y:0,z:0},{x:60,y:0,z:0}],b,b),null,'Same projected point but different modeled XY is rejected');
  assert.equal(Precision.trueIntersection(a,[{x:1e9,y:0,z:0},{x:1e9+10,y:0,z:0}],b,[{x:1e9+5,y:-5,z:1},{x:1e9+5,y:5,z:1}]),null,'Large coordinate origins cannot make separated elevations count as an intersection');
  setup('snap','inter',[box,line('cross',50,-30,160)]);
  assert.equal(pick({x:50,y:-11.4}).detail.snap,null,'Projected top-face crossing cannot acquire an Intersection snap');
  let event=pick({x:50,y:0});assert.equal(event.detail.snap.label,'Intersection');near(event.detail.point.x,50);near(event.detail.point.y,0);assert.equal(event.detail.snap.modelPoint.z,0);
  setup('snap','center',[circle],{snapRadius:8,snapRelease:10});
  event=pick({x:174.64101615137756,y:40});assert.equal(event.detail.snap.label,'Center');assert.equal(event.detail.snap.objectId,'profile');assert.deepEqual(event.detail.point,{x:140,y:20},'Hovering the rotated elliptical boundary acquires the actual center');
  assert.equal(pick({x:240,y:80}).detail.snap,null,'Leaving the source boundary releases remote center acquisition');
  scoped.profile={snapEnabled:false};assert.equal(pick({x:174.64101615137756,y:40}).detail.snap,null);delete scoped.profile;
  const round={...circle,height:80,rotation:0};const tangentPoint={x:140+Math.SQRT1_2*40,y:40+Math.SQRT1_2*40};
  setup('tracking','smarttrack',[round,line('target',220,-50,180)],{snapRadius:8,snapRelease:8});
  pointer('pointermove',{x:tangentPoint.x-.6,y:tangentPoint.y-.6});await new Promise(resolve=>setTimeout(resolve,8));
  const reference=events.filter(e=>e.type==='tracking').at(-1).detail.references[0];assert.equal(reference.label,'Tangent');assert.equal(reference.directions.length,1);near(Math.abs(reference.directions[0].x),Math.SQRT1_2);near(reference.directions[0].x+reference.directions[0].y,0);
  const target={x:220,y:tangentPoint.y-(220-tangentPoint.x)};event=pick(target);assert.equal(event.detail.tracking.kind,'intersection');assert.equal(event.detail.tracking.targetObjectId,'target');near(event.detail.point.x,target.x);near(event.detail.point.y,target.y);
  const acquisitions=events.filter(e=>e.type==='tracking-snap').length;for(const fn of [...frames.values()])fn(performance.now());frames.clear();assert.equal(events.filter(e=>e.type==='tracking-snap').length,acquisitions,'Rendering a guide cannot emit another acquisition');pointer('pointermove',target);assert.equal(events.filter(e=>e.type==='tracking-snap').length,acquisitions,'Unchanged pointer acquisition is emitted once');
  setup('tracking','ortho',[],{snapEnabled:false,ortho:true});const anchor=pick({x:-200,y:-100}).detail.point;event=pick({x:-140,y:-43});near(event.detail.point.x-anchor.x,event.detail.point.y-anchor.y);
  event=pick({x:-100,y:10},{shiftKey:true});near(event.detail.point.x,-100);near(event.detail.point.y,10);
  setup('tracking','ortho',[],{snapEnabled:false,ortho:true,orthoAngle:90});pick({x:-200,y:-100});event=pick({x:-140,y:-43});near(event.detail.point.y,-100);
  console.log('Precision stage tests passed: boundary center acquisition/release/scoped disable, modeled XYZ intersections, inherited tangent dwell and guide intersections, and 45/90 degree constraints with Shift inversion.');
}finally{stage.destroy();}})().catch(error=>{console.error(error);process.exitCode=1;});
