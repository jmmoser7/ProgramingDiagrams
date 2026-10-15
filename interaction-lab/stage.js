/* Interaction lab: a small, dependency-free 2.5D interaction workbench.
 * All geometry is illustrative. This is deliberately not Rhino's geometry kernel.
 */
(function (root, factory) {
  const api = factory(typeof module==='object'&&module.exports?require('./tracking-guides.js'):root.InteractionTracking,typeof module==='object'&&module.exports?require('./direction-constraint.js'):root.InteractionDirectionConstraint,typeof module==='object'&&module.exports?require('./scene-precision.js'):root.InteractionScenePrecision);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.InteractionStage = api;
})(typeof window !== 'undefined' ? window : globalThis, function (Tracking,Direction,Precision) {
  'use strict';
  const DEFAULTS = {
    hoverDelay: 65, tooltipDelay: 450, hitRadius: 8, dragThreshold: 4,
    highlightColor: '#e58b27', selectionColor: '#00ffee', strokeWidth: 1.5,
    handleSize: 8, cursorScale: 100, showLabels: true, prehighlight: true,
    snapRadius: 13, snapRelease: 20, snapEnabled: true, gridSize: 25,
    ortho: false, trackDelay: 500, gumballSize: 76, dragStrength: 100,
    rotationStep: 15, zoomSpeed: 100, animationMs: 120, opacity: 100,
    locked: false, width: 120, height: 85, depth: 36, cornerRadius: 0,
    cursorPolicy: 'affordance', idleCursor: 'auto', hoverCursor: 'auto',
    hoverPresentation: 'outline', hoverOpacity: 30, typeFilter: 'all'
  };
  const clone = value => JSON.parse(JSON.stringify(value));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const mix = (a, b, t) => ({x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t});
  const degrees = radians => radians * 180 / Math.PI;
  const radians = angle => angle * Math.PI / 180;
  const rectContains = (r, p) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
  const validNumber = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  function rotate(p, center, angle) {
    const c = Math.cos(radians(angle || 0)), s = Math.sin(radians(angle || 0));
    return {x: center.x + (p.x - center.x) * c - (p.y - center.y) * s,
      y: center.y + (p.x - center.x) * s + (p.y - center.y) * c};
  }
  function pointSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, den = dx * dx + dy * dy;
    const t = den ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / den, 0, 1) : 0;
    const point = mix(a, b, t);
    return {point, t, distance: distance(p, point)};
  }
  function inside(p, poly) {
    let answer = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) answer = !answer;
    }
    return answer;
  }
  function intersection(a, b, c, d) {
    const x1 = b.x - a.x, y1 = b.y - a.y, x2 = d.x - c.x, y2 = d.y - c.y;
    const den = x1 * y2 - y1 * x2;
    if (Math.abs(den) < 1e-8) return null;
    const t = ((c.x - a.x) * y2 - (c.y - a.y) * x2) / den;
    const u = ((c.x - a.x) * y1 - (c.y - a.y) * x1) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? mix(a, b, t) : null;
  }
  function bounds(points) {
    if (!points.length) return {x: 0, y: 0, width: 0, height: 0};
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return {x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y};
  }
  function scene() {
    return [
      {id: 'block-a', name: 'Study block A', group: 'Assembly A', kind: 'box', x: -245, y: -87, width: 132, height: 100, depth: 40, rotation: 0, color: '#c7d8e4', locked: false},
      {id: 'block-b', name: 'Study block B', group: 'Assembly A', kind: 'box', x: -75, y: -92, width: 116, height: 126, depth: 52, rotation: 0, color: '#ded5bc', locked: false},
      {id: 'block-c', name: 'Overlapping block', group: 'Assembly B', kind: 'box', x: -15, y: -25, width: 92, height: 84, depth: 25, rotation: 0, color: '#ced9ce', locked: false},
      {id: 'circle-a', name: 'Circular profile', group: 'Profiles', kind: 'circle', x: 130, y: -95, width: 98, height: 98, depth: 0, rotation: 0, color: '#d6d5e5', locked: false},
      {id: 'curve-a', name: 'Open polyline', group: 'Profiles', kind: 'polyline', x: -196, y: 118, width: 290, height: 68, depth: 0, points: [{x: 0,y: 40},{x: 90,y: 0},{x: 175,y: 60},{x: 290,y: 10}], rotation: 0, color: '#8dacae', locked: false},
      {id: 'curve-b', name: 'Crossing segment', group: 'Profiles', kind: 'polyline', x: 18, y: 100, width: 1, height: 102, depth: 0, points: [{x:0,y:0},{x:0,y:102}], rotation:0, color:'#b1a3bd', locked:false},
      {id: 'reference-a', name: 'Reference plate', group: 'References', kind: 'box', x: 143, y: 87, width: 106, height: 58, depth: 18, rotation: 0, color: '#d8dde2', locked: true}
    ];
  }
  function create(options) {
    if (!options || !options.canvas || typeof options.canvas.getContext !== 'function') throw new Error('InteractionStage requires a canvas.');
    const canvas = options.canvas, ctx = canvas.getContext('2d'), doc = canvas.ownerDocument;
    const overlay = options.overlay || canvas.parentElement;
    let caseStudy = options.caseStudy || {mode: 'selection', variant: 'click'};
    let settings = Object.assign({}, DEFAULTS, options.settings || {});
    let objects = scene(), selected = [], subSelection = [], camera = {x: 0, y: 20, zoom: 1, orbit: 0};
    let width = 800, height = 500, dpr = 1, disposed = false, raf = 0;
    let hover = null, hoverCandidate = null, hoverTimer = 0, tooltipTimer = 0;
    let pointer = null, drag = null, snap = null, status = '', cursor = 'default';
    let history = [], future = [], pivotOverride = null, popup = null, numeric = null;
    let commandPoints = [], trackPoints = [], trackTimer = 0, trackCandidate = null, trackingGuide = null, trackingAcquisition = null, axisLock = null;
    let filterIndex = 0, keyState = {shiftKey: false, ctrlKey: false, altKey: false, space: false}, idSequence = 1;
    let relocatePending = false, hoverHandle = null, visibleCursorScale = 100;
    let lastRenderTime = 0, selectionTransition = 0, lastSelectionStamp = 0;
    const filters = ['All geometry', 'Solids', 'Curves', 'Circles'];
    const listeners = [];
    const mode = () => String(caseStudy.mode || 'selection').toLowerCase();
    const variant = () => String(caseStudy.variant || '').toLowerCase();
    const is = word => variant().includes(word);
    const effective = object => {
      let scoped = null;
      try { scoped = options.resolveSettings && options.resolveSettings(object); } catch (_) { /* Editor can update in the middle of a frame. */ }
      return Object.assign({}, settings, scoped || {});
    };
    const isLocked = object => {
      try{const scoped=options.resolveSettings&&options.resolveSettings(object);if(scoped&&Object.prototype.hasOwnProperty.call(scoped,'locked'))return !!scoped.locked;}catch(_){}
      return !!(object.locked||settings.locked);
    };
    const permitted = object => {
      const filter=settings.typeFilter||'all';
      if(filter!=='all'&&filter!=='subobjects' && (filter==='curve'?object.kind!=='polyline'&&object.kind!=='circle':object.kind!==filter))return false;
      return filterIndex===0 || (filterIndex===1?object.kind==='box':filterIndex===2?object.kind==='polyline'||object.kind==='circle':object.kind==='circle');
    };
    const subTargeting = event => settings.typeFilter==='subobjects' ? !(event.ctrlKey&&event.shiftKey) : mode()==='subobject'&&event.ctrlKey&&event.shiftKey;
    const selectedObjects = () => objects.filter(o => selected.includes(o.id));
    function emit(type, message, detail) {
      if (message) status = message;
      if (typeof options.onChange === 'function') options.onChange({
        type, status, cursor, selection: selected.slice(), objects: clone(objects),
        detail: Object.assign({mode: mode(), variant: variant(), subSelection: clone(subSelection), filter: filters[filterIndex]}, detail || {})
      });
    }
    function requestDraw() {
      if (!raf && !disposed) raf = requestAnimationFrame(render);
    }
    function setCursor(value, force, object) {
      const cursorSettings=object?effective(object):settings;
      const scalePercent=clamp(validNumber(cursorSettings.cursorScale,100),50,220);
      if (cursor === value && visibleCursorScale===scalePercent && !force) return;
      cursor = value;
      visibleCursorScale=scalePercent;
      if(Math.abs(scalePercent-100)>5){
        const scale=scalePercent/100,side=Math.round(32*scale);let shape='',hot={x:16,y:16};
        if(value==='default'||value==='copy'){shape='<path d="M3 2L3 25L9 19L14 29L19 26L14 17L23 17Z" fill="#202832" stroke="white" stroke-width="1.5"/>';hot={x:3,y:2};if(value==='copy')shape+='<path d="M21 20H31V30H21Z" fill="white" stroke="#202832"/><path d="M26 22V28M23 25H29" stroke="#202832"/>';}
        else if(value==='pointer'||value==='grab'||value==='grabbing'){shape='<path d="M9 17V6Q9 3 12 4Q14 4 14 7V14V9Q14 6 17 7Q19 7 19 10V14V11Q19 8 22 9Q24 9 24 12V16V14Q24 12 27 13Q29 13 29 17V23L25 29H13L7 23L4 19Q3 16 6 15Z" fill="white" stroke="#202832" stroke-width="1.5"/>';hot={x:12,y:5};}
        else if(value==='not-allowed')shape='<circle cx="16" cy="16" r="11" fill="white" stroke="#202832" stroke-width="2.5"/><path d="M8 8L24 24" stroke="#202832" stroke-width="2.5"/>';
        else if(value==='crosshair')shape='<path d="M16 2V30M2 16H30" stroke="white" stroke-width="3"/><path d="M16 2V30M2 16H30" stroke="#202832"/>';
        else if(['move','ew-resize','ns-resize','nwse-resize','nesw-resize'].includes(value)){
          const angle=value==='ns-resize'?90:value==='nwse-resize'?45:value==='nesw-resize'?-45:0;
          const arrow='<path d="M3 16L9 10V14H23V10L29 16L23 22V18H9V22Z" fill="#202832" stroke="white" stroke-width="1"/>';
          shape='<g transform="rotate('+angle+' 16 16)">'+arrow+'</g>'+(value==='move'?'<g transform="rotate(90 16 16)">'+arrow+'</g>':'');
        }
        if(shape){const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+side+'" height="'+side+'" viewBox="0 0 32 32">'+shape+'</svg>';canvas.style.cursor='url("data:image/svg+xml,'+encodeURIComponent(svg)+'") '+Math.round(hot.x*scale)+' '+Math.round(hot.y*scale)+', '+value;return;}
      }
      canvas.style.cursor = value;
    }
    function idleCursor(value,object){const s=object?effective(object):settings;return value==='default'&&s.idleCursor&&s.idleCursor!=='auto'?s.idleCursor:value;}
    function hoverCursor(value,object){const s=object?effective(object):settings;if(s.hoverCursor&&s.hoverCursor!=='auto')return s.hoverCursor;return idleCursor(s.cursorPolicy==='native'?'default':value,object);}
    const restingCursor = () => idleCursor(mode()==='navigation'&&settings.cursorPolicy!=='native'?'grab':'default');
    function world(screen) { return {x: (screen.x - width / 2) / camera.zoom + camera.x, y: (screen.y - height / 2) / camera.zoom + camera.y}; }
    function screen(point) { return {x: (point.x - camera.x) * camera.zoom + width / 2, y: (point.y - camera.y) * camera.zoom + height / 2}; }
    function eventPoint(event) { const r = canvas.getBoundingClientRect(); return {x: event.clientX - r.left, y: event.clientY - r.top}; }
    function depthVector(depth) { return {x: (-.44 + Math.sin(camera.orbit) * .38) * depth, y: (-.57 + (1 - Math.cos(camera.orbit)) * .2) * depth}; }
    function geometry(object) {
      const center = {x: object.x + object.width / 2, y: object.y + object.height / 2};
      const local = p => rotate(p, center, object.rotation || 0);
      if (object.kind === 'polyline') {
        const vertices = (object.points || []).map(p => local({x: object.x + p.x, y: object.y + p.y}));
        const edges=vertices.slice(1).map((p,i)=>[vertices[i],p]);return {vertices,edges,modelEdges:edges.map(edge=>edge.map(p=>({...p,z:0}))),faces:[],center};
      }
      if (object.kind === 'circle') {
        const vertices = [], count = 64;
        for (let i = 0; i < count; i++) { const t = i / count * Math.PI * 2; vertices.push(local({x: center.x + Math.cos(t) * object.width / 2, y: center.y + Math.sin(t) * object.height / 2})); }
        const edges=vertices.map((p,i)=>[p,vertices[(i+1)%vertices.length]]);return {vertices,edges,modelEdges:edges.map(edge=>edge.map(p=>({...p,z:0}))),faces:[{points:vertices,name:'Profile'}],center};
      }
      const base = [{x:object.x,y:object.y},{x:object.x+object.width,y:object.y},{x:object.x+object.width,y:object.y+object.height},{x:object.x,y:object.y+object.height}].map(local);
      const dv = depthVector(object.depth || 0), top = base.map(p => ({x:p.x+dv.x,y:p.y+dv.y}));
      const faces = [
        {points: [base[1],base[2],top[2],top[1]], name: 'Right face', shade: -.10},
        {points: [base[2],base[3],top[3],top[2]], name: 'Front face', shade: -.04},
        {points: top, name: 'Top face', shade: .06}
      ];
      const edges = [],modelEdges=[],modelBase=base.map(p=>({...p,z:0})),modelTop=base.map(p=>({...p,z:object.depth||0}));
      for (let i=0;i<4;i++){edges.push([top[i],top[(i+1)%4]], [base[i],base[(i+1)%4]], [base[i],top[i]]);modelEdges.push([modelTop[i],modelTop[(i+1)%4]],[modelBase[i],modelBase[(i+1)%4]],[modelBase[i],modelTop[i]]);}
      return {vertices: top.concat(base), edges,modelEdges, faces, center: {x:center.x+dv.x/2,y:center.y+dv.y/2}};
    }
    function objectBounds(object, inScreen) { const points = geometry(object).vertices; return bounds(inScreen ? points.map(screen) : points); }
    function selectionBounds() { return bounds(selectedObjects().flatMap(o => geometry(o).vertices)); }
    function pivot() { const b = selectionBounds(); return pivotOverride || {x:b.x+b.width/2,y:b.y+b.height/2}; }
    function hitAll(p, subobject, modifiers) {
      const hits = [];
      for (let n = objects.length - 1; n >= 0; n--) {
        const object = objects[n], s = effective(object);
        if (!permitted(object)) continue;
        const g = geometry(object), radius = Math.max(2, validNumber(s.hitRadius, 8));
        let hit = null;
        // Curves retain segment/vertex targeting in every component study. The
        // solid Sub-objects filter inversion must not turn a Ctrl+Shift segment
        // pick into selection of the entire polyline.
        const curveComponent=object.kind==='polyline'&&modifiers&&modifiers.ctrlKey&&modifiers.shiftKey&&(mode()==='subobject'||settings.typeFilter==='subobjects');
        if (subobject || curveComponent) {
          const type = object.kind==='polyline' ? 'auto' : is('vertex') ? 'vertex' : is('edge') ? 'edge' : is('face') ? 'face' : 'auto';
          if (type === 'vertex' || type === 'auto') {
            let best = radius;
            g.vertices.forEach((v,i) => { const d = distance(p, screen(v)); if (d <= best) {best=d; hit={object,part:{kind:'vertex',index:i,point:v},distance:d};} });
          }
          if (!hit && (type === 'edge' || type === 'auto')) {
            let best = radius;
            g.edges.forEach((edge,i) => { const d = pointSegment(p,screen(edge[0]),screen(edge[1])).distance; if (d <= best) {best=d; hit={object,part:{kind:'edge',index:i},distance:d};} });
          }
          if (!hit && (type === 'face' || type === 'auto')) {
            for (let i=g.faces.length-1;i>=0;i--) if (inside(p,g.faces[i].points.map(screen))) {hit={object,part:{kind:'face',index:i},distance:0}; break;}
          }
        } else {
          if (g.faces.some(f => inside(p, f.points.map(screen)))) hit = {object,part:null,distance:0};
          if (!hit) {
            let best = radius;
            g.edges.forEach(edge => { const d = pointSegment(p,screen(edge[0]),screen(edge[1])).distance; if (d <= best) {best=d;hit={object,part:null,distance:d};} });
          }
        }
        if (hit) hits.push(hit);
      }
      return hits;
    }
    function snapshot() { return {objects:clone(objects),selected:selected.slice(),subSelection:clone(subSelection),pivot:clone(pivotOverride)}; }
    function applySnapshot(state) { objects=clone(state.objects);selected=state.selected.slice();subSelection=clone(state.subSelection || []);pivotOverride=clone(state.pivot || null);clearHover();requestDraw(); }
    function commit(before, message) {
      if (JSON.stringify(before) === JSON.stringify(snapshot())) return;
      history.push(before); if (history.length > 100) history.shift(); future=[];
      emit('transform', message || 'Geometry updated.'); requestDraw();
    }
    function clearHover() { clearTimeout(hoverTimer);clearTimeout(tooltipTimer);hover=null;hoverCandidate=null;removeTooltip(); }
    let tooltip = null;
    function removeTooltip() { if (tooltip) tooltip.remove(); tooltip=null; }
    function showTooltip(hit) {
      if (!overlay || !hit || !pointer || drag) return;
      removeTooltip(); tooltip=doc.createElement('div');tooltip.className='lab-stage-tooltip';
      Object.assign(tooltip.style,{position:'absolute',pointerEvents:'none',left:clamp(pointer.x+14,8,width-180)+'px',top:clamp(pointer.y+18,8,height-56)+'px',zIndex:'8',background:'#223345',color:'#fff',padding:'7px 10px',borderRadius:'6px',font:'12px system-ui',boxShadow:'0 4px 16px #172d4426',maxWidth:'200px'});
      const handle=hit.part&&hit.part.kind.endsWith(' handle')?hit.part.kind.slice(0,-7):null;
      const actions={x:'Move along X · drag or click to enter a distance',y:'Move along Y · drag or click to enter a distance',z:'Change extrusion depth · drag or click for a value',plane:'Move in XY plane · drag the square',rotate:'Rotate around the pivot · drag or click for degrees',scale:'Scale uniformly · drag or click for a factor',origin:'Widget origin · double-click a handle to relocate'};
      tooltip.textContent=handle?(actions[handle]||handle)+' · '+hit.object.name:hit.object.name+(hit.part?' · '+hit.part.kind+' '+(hit.part.index+1):'')+(isLocked(hit.object)?' · Locked':'');
      overlay.appendChild(tooltip);
    }
    function scheduleHover(hit) {
      const key = hit ? hit.object.id+':'+(hit.part ? hit.part.kind+hit.part.index : '') : '';
      const previous = hoverCandidate ? hoverCandidate.object.id+':'+(hoverCandidate.part ? hoverCandidate.part.kind+hoverCandidate.part.index : '') : '';
      if (key === previous) return;
      clearHover();hoverCandidate=hit;
      if (!hit) {requestDraw();return;}
      const s=effective(hit.object);
      hoverTimer=setTimeout(()=>{if(!disposed&&hoverCandidate===hit){hover=hit;emit('hover',(isLocked(hit.object)?'Locked: ':'Hover: ')+hit.object.name+(hit.part?' · '+hit.part.kind:''));requestDraw();}},Math.max(0,validNumber(s.hoverDelay,65)));
      tooltipTimer=setTimeout(()=>showTooltip(hit),Math.max(0,validNumber(s.tooltipDelay,450)));
    }
    function expandGroups(ids,modifiers) {
      if (!(mode()==='selection' && is('group')) || modifiers&&modifiers.ctrlKey&&modifiers.shiftKey) return ids;
      const groups = objects.filter(o=>ids.includes(o.id)).map(o=>o.group);
      return objects.filter(o=>groups.includes(o.group) && !isLocked(o)).map(o=>o.id);
    }
    function select(ids, modifiers, message) {
      const eligible=expandGroups(ids,modifiers).filter(id=>objects.some(o=>o.id===id&&!isLocked(o)));
      if (mode()==='selection'&&is('group')&&modifiers&&modifiers.ctrlKey&&modifiers.shiftKey)selected=eligible;
      else if (modifiers && modifiers.ctrlKey && !modifiers.shiftKey) selected=selected.filter(id=>!eligible.includes(id));
      else if (modifiers && modifiers.shiftKey) selected=Array.from(new Set(selected.concat(eligible)));
      else selected=eligible;
      subSelection=[];pivotOverride=null;lastSelectionStamp=performance.now();
      emit('selection',message || (selected.length?selected.length+' object'+(selected.length===1?'':'s')+' selected.':'Selection cleared.'));requestDraw();
    }
    function showMenu(p, items, title) {
      closePopup();if(!overlay)return;
      popup=doc.createElement('div');popup.className='lab-stage-menu';popup.setAttribute('role','menu');
      Object.assign(popup.style,{position:'absolute',left:clamp(p.x+10,8,width-230)+'px',top:clamp(p.y+10,8,height-items.length*37-42)+'px',zIndex:'20',minWidth:'205px',maxWidth:'240px',padding:'5px',background:'#fff',border:'1px solid #bccbd7',borderRadius:'8px',boxShadow:'0 12px 36px #14334b28',font:'12px system-ui'});
      if(title){const label=doc.createElement('div');label.textContent=title;Object.assign(label.style,{padding:'6px 8px',color:'#617185',fontSize:'11px'});popup.appendChild(label);}
      items.forEach(item=>{const button=doc.createElement('button');button.type='button';button.textContent=item.label;button.setAttribute('role','menuitem');Object.assign(button.style,{display:'block',width:'100%',textAlign:'left',border:'0',background:'transparent',padding:'9px 8px',borderRadius:'4px',font:'inherit',cursor:'pointer',color:'#223345'});button.addEventListener('mouseenter',()=>{button.style.background='#eaf1f7';if(item.hover)item.hover();});button.addEventListener('mouseleave',()=>{button.style.background='transparent';});button.addEventListener('click',event=>{event.stopPropagation();closePopup();item.action();});popup.appendChild(button);});
      popup.addEventListener('pointerdown',e=>e.stopPropagation());overlay.appendChild(popup);
    }
    function closePopup(){if(popup)popup.remove();popup=null;}
    function showOverlap(hits,p,event){
      showMenu(p,hits.map(hit=>({label:hit.object.name+(isLocked(hit.object)?' · Locked':''),hover:()=>{hover=hit;requestDraw();},action:()=>select([hit.object.id],event,'Chose '+hit.object.name+' from overlapping candidates.')})),'Choose an overlapping object');
      emit('ambiguity','Overlapping candidates: hover a row to preview, click to choose.',{candidates:hits.map(h=>h.object.id)});
    }
    function showContext(p,hit){
      if(hit && !selected.includes(hit.object.id))select([hit.object.id]);
      showMenu(p,[
        {label:'Rename selected…',action:()=>openRename()},
        {label:'Duplicate selected',action:()=>duplicateSelection()},
        {label:'Lock / unlock selected',action:()=>{const before=snapshot();selectedObjects().forEach(o=>o.locked=!o.locked);commit(before,'Lock state changed.');}},
        {label:'Reset selected geometry',action:()=>{const before=snapshot(),original=scene();objects=objects.map(o=>selected.includes(o.id)?clone(original.find(x=>x.id===o.id)||o):o);commit(before,'Selected geometry reset.');}}
      ],'Object actions');emit('context','Object actions opened.');
    }
    function inputBox(p,label,value,accept){
      closeNumeric();if(!overlay)return;
      numeric=doc.createElement('form');numeric.className='lab-stage-input';Object.assign(numeric.style,{position:'absolute',left:clamp(p.x+15,8,width-230)+'px',top:clamp(p.y+15,8,height-85)+'px',zIndex:'22',background:'#fff',padding:'10px',border:'1px solid #a7bfd1',borderRadius:'8px',boxShadow:'0 9px 25px #14334b22',font:'12px system-ui'});
      const text=doc.createElement('label');text.textContent=label;Object.assign(text.style,{display:'block',marginBottom:'6px',color:'#4f6478'});const input=doc.createElement('input');input.value=String(value);input.setAttribute('aria-label',label);Object.assign(input.style,{width:'180px',padding:'7px',border:'1px solid #b6c8d5',borderRadius:'4px',font:'13px system-ui'});text.appendChild(input);numeric.appendChild(text);
      const help=doc.createElement('div');help.textContent='Enter to apply · Esc to cancel';help.style.color='#7b8792';help.style.fontSize='10px';numeric.appendChild(help);
      numeric.addEventListener('pointerdown',e=>e.stopPropagation());numeric.addEventListener('submit',e=>{e.preventDefault();const value=input.value;closeNumeric();accept(value);canvas.focus();});input.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){closeNumeric();canvas.focus();emit('cancel','Input cancelled.');}});overlay.appendChild(numeric);input.focus();input.select();
    }
    function closeNumeric(){if(numeric)numeric.remove();numeric=null;}
    function openRename(){const o=selectedObjects()[0];if(!o)return;inputBox(pointer||{x:width/2,y:height/2},'Object name',o.name,value=>{if(!value.trim())return;const before=snapshot();o.name=value.trim().slice(0,120);commit(before,'Renamed to “'+o.name+'”.');emit('rename','Renamed to “'+o.name+'”.');});}
    function duplicateSelection(){if(!selected.length)return;const before=snapshot();const copies=selectedObjects().filter(o=>!isLocked(o)).map(o=>{const copy=clone(o);copy.id=o.id+'-copy-'+idSequence++;copy.name=o.name+' copy';copy.x+=25;copy.y+=25;return copy;});objects.push(...copies);selected=copies.map(o=>o.id);commit(before,'Duplicated '+copies.length+' object'+(copies.length===1?'':'s')+'.');}
    function snapFeatures(p,anchor){
      const all=[],edges=[];const v=variant(),kind=mode()==='snap'?v:'all';
      function add(point,label,object,extra){all.push({point,label,objectId:object&&object.id,...extra});}
      objects.forEach(o=>{
        if(effective(o).snapEnabled===false||drag&&drag.kind==='transform'&&drag.ids.includes(o.id))return;const g=geometry(o);edges.push(...g.edges.map((edge,index)=>({edge,modelEdge:g.modelEdges[index],object:o})));
        if(kind==='all'||kind.includes('vertex')||kind.includes('end')){
          const vertices=o.kind==='circle'?[]:g.vertices;vertices.forEach(pt=>add(pt,kind.includes('vertex')?'Vertex':'End',o));
        }
        if(o.kind!=='circle'&&(kind==='all'||kind.includes('mid')))g.edges.forEach(edge=>add(mix(edge[0],edge[1],.5),'Mid',o));
        if(o.kind==='circle'&&(kind==='all'||kind.includes('center'))){const nearest=kind.includes('center')?g.edges.reduce((best,edge)=>{const candidate=pointSegment(p,...edge);return !best||candidate.distance<best.distance?candidate:best;},null):null;add(g.center,'Center',o,nearest?{acquisitionPoint:distance(p,g.center)>nearest.distance?nearest.point:g.center}:{});}
        if(o.kind==='circle'){
          const c=g.center,rx=o.width/2,ry=o.height/2;
          if(kind.includes('quad'))for(let n=0;n<4;n++)add(rotate({x:c.x+Math.cos(n*Math.PI/2)*rx,y:c.y+Math.sin(n*Math.PI/2)*ry},c,o.rotation),'Quadrant',o);
          if(kind.includes('tangent')&&anchor){
            const dx=anchor.x-c.x,dy=anchor.y-c.y,d=Math.hypot(dx,dy),r=rx;
            if(d>r){const base=Math.atan2(dy,dx),off=Math.acos(r/d);[base-off,base+off].forEach(t=>add({x:c.x+Math.cos(t)*r,y:c.y+Math.sin(t)*r},'Tangent',o));}
          }
          if(kind.includes('near')||is('smarttrack')){const unrotated=rotate(p,c,-(o.rotation||0)),t=Math.atan2((unrotated.y-c.y)/ry,(unrotated.x-c.x)/rx);add(rotate({x:c.x+Math.cos(t)*rx,y:c.y+Math.sin(t)*ry},c,o.rotation),'Near',o);}
        }
        if((kind.includes('near')||is('smarttrack'))&&o.kind!=='circle')g.edges.forEach(edge=>add(pointSegment(p,edge[0],edge[1]).point,'Near',o));
        if(kind.includes('perp')&&anchor)g.edges.forEach(edge=>{const pr=pointSegment(anchor,edge[0],edge[1]);if(pr.t>0&&pr.t<1)add(pr.point,'Perpendicular',o);});
        if(kind.includes('project'))g.vertices.slice(0,o.kind==='box'?4:g.vertices.length).forEach(pt=>{const dv=depthVector(o.depth||0);add({x:pt.x-dv.x,y:pt.y-dv.y},'Projected to CPlane',o);});
      });
      if(kind.includes('inter'))for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++)if(edges[i].object.id!==edges[j].object.id){const hit=Precision.trueIntersection(edges[i].edge,edges[i].modelEdge,edges[j].edge,edges[j].modelEdge);if(hit)add(hit.point,'Intersection',edges[i].object,{modelPoint:hit.modelPoint});}
      if(kind.includes('grid')&&settings.snapEnabled){const step=Math.max(1,validNumber(settings.gridSize,25));add({x:Math.round(p.x/step)*step,y:Math.round(p.y/step)*step},'Grid',null);}
      return all;
    }
    function pickSnap(p,anchor){
      if(!(mode()==='snap'||mode()==='tracking'||mode()==='command'||mode()==='gumball')){snap=null;return p;}
      const target=screen(p),radius=Math.max(2,validNumber(settings.snapRadius,13));
      const previousSettings=snap&&snap.objectId?effective(objects.find(o=>o.id===snap.objectId)):settings;
      if(snap&&previousSettings.snapEnabled!==false&&distance(target,screen(snap.point))<=Math.max(validNumber(previousSettings.snapRadius,radius),validNumber(previousSettings.snapRelease,20))){return snap.point;}
      let best=null,bestDist=Infinity;
      const snapAnchor=anchor||((is('tangent')||is('perp'))?{x:0,y:0}:null);
      snapFeatures(p,snapAnchor).forEach(candidate=>{const candidateSettings=candidate.objectId?effective(objects.find(o=>o.id===candidate.objectId)):settings;const d=distance(target,screen(candidate.acquisitionPoint||candidate.point));if(d<=validNumber(candidateSettings.snapRadius,radius)&&d<=bestDist){bestDist=d;best=candidate;}});
      const old=snap;snap=best;
      if(best&&(!old||old.label!==best.label||distance(old.point,best.point)>.01))emit('snap',best.label+' snap acquired.',{snap:clone(best)});
      return best?best.point:p;
    }
    function trackingReference(source,point,label){
      if(!source)return Tracking.makeReference(null,{...point,z:0},null,{label:'Reference'});
      const g=geometry(source),edges=g.edges.map((edge,index)=>edge.map((p,i)=>({...p,z:g.modelEdges[index][i].z}))),nearest=g.edges.reduce((best,edge,index)=>{const hit=pointSegment(point,...edge);return !best||hit.distance<best.distance?{...hit,index}:best;},null);
      const z=nearest&&nearest.distance<1e-5?g.modelEdges[nearest.index][0].z+(g.modelEdges[nearest.index][1].z-g.modelEdges[nearest.index][0].z)*nearest.t:0;
      return Tracking.makeReference(source,{...point,z},{...g,edges},{label:['circle','polyline'].includes(source.kind)&&label!=='Center'?'Tangent':'Reference'});
    }
    function track(p){
      trackingGuide=null;if(mode()!=='tracking'){trackingAcquisition=null;return p;}
      if(is('smarttrack')&&snap){
        const key=snap.objectId+':'+snap.point.x.toFixed(2)+':'+snap.point.y.toFixed(2);
        if(trackCandidate!==key){clearTimeout(trackTimer);trackCandidate=key;const target=clone(snap.point),source=objects.find(o=>o.id===snap.objectId),s=source?effective(source):settings,reference=trackingReference(source,target,snap.label);trackTimer=setTimeout(()=>{if(reference&&!trackPoints.some(t=>distance(t.point,target)<.1)){trackPoints.push(reference);if(trackPoints.length>3)trackPoints.shift();emit('tracking',reference.inherited?'SmartTrack tangent / edge reference acquired. Follow its dotted guide.':'SmartTrack reference acquired. Move along its dotted guides.',{references:clone(trackPoints)});requestDraw();}},Math.max(0,validNumber(s.trackDelay,500)));}
      }else{clearTimeout(trackTimer);trackCandidate=null;}
      const radius=validNumber(settings.snapRadius,13)/camera.zoom,edges=[];
      objects.forEach(object=>{if(!permitted(object)||effective(object).snapEnabled===false)return;const g=geometry(object);g.edges.forEach((edge,index)=>{const model=g.modelEdges[index];if(Math.abs(model[0].z-model[1].z)<1e-8)edges.push({edge:edge.map((point,i)=>({...point,z:model[i].z})),objectId:object.id});});});
      const guides=Tracking.guideCandidates(trackPoints,edges,p,{radius});trackingGuide=guides[0]||null;
      const acquisition=trackingGuide?.kind==='intersection'?JSON.stringify([trackingGuide.objectId,trackingGuide.targetObjectId,trackingGuide.reference.point,trackingGuide.point]):null;
      if(acquisition&&acquisition!==trackingAcquisition)emit('tracking-snap','Tracking intersection acquired.',{tracking:clone(trackingGuide)});trackingAcquisition=acquisition;
      return trackingGuide?{x:trackingGuide.point.x,y:trackingGuide.point.y}:p;
    }
    function constrained(p,anchor,event){
      let result=track(pickSnap(p,anchor));if(!anchor)return result;
      const ortho=!!settings.ortho!==!!event.shiftKey;
      if(axisLock&&axisLock.phase==='direction'){
        const d=(result.x-axisLock.anchor.x)*axisLock.x+(result.y-axisLock.anchor.y)*axisLock.y;
        result={x:axisLock.anchor.x+axisLock.x*d,y:axisLock.anchor.y+axisLock.y*d};
      }else if(axisLock&&axisLock.phase==='radius'){
        const a=Math.atan2(result.y-axisLock.anchor.y,result.x-axisLock.anchor.x);
        result={x:axisLock.anchor.x+Math.cos(a)*axisLock.radius,y:axisLock.anchor.y+Math.sin(a)*axisLock.radius};
      }
      else if(ortho){result=Direction.constrainDirection(result,anchor,validNumber(settings.orthoAngle,mode()==='tracking'&&is('ortho')?45:90));}
      return result;
    }
    function handles(){
      if(!selected.length||!(mode()==='gumball'||mode()==='feedback'&&is('cursor')))return[];
      const s=effective(selectedObjects()[0]),p=screen(pivot()),size=clamp(validNumber(s.gumballSize,76),35,180),h=Math.max(4,validNumber(s.handleSize,8));
      return [{type:'origin',point:p,r:h+3},{type:'x',point:{x:p.x+size,y:p.y},r:h+5},{type:'y',point:{x:p.x,y:p.y-size},r:h+5},{type:'z',point:{x:p.x-size*.53,y:p.y-size*.49},r:h+5},{type:'plane',point:{x:p.x+17,y:p.y-17},r:12},{type:'scale',point:{x:p.x+size*.74,y:p.y-size*.74},r:h+5},{type:'rotate',point:{x:p.x+size*.72,y:p.y+size*.42},r:14}];
    }
    function hitHandle(p){
      const found=handles().filter(h=>distance(p,h.point)<=h.r).sort((a,b)=>distance(p,a.point)-distance(p,b.point))[0];
      if(found)return found;
      if(selected.length&&mode()==='gumball'&&is('rotate')){const center=screen(pivot()),size=clamp(validNumber(effective(selectedObjects()[0]).gumballSize,76),35,180);if(Math.abs(distance(p,center)-size*.8)<10)return{type:'rotate',point:p,r:10};}
      return null;
    }
    function atlasHandle(p){
      if(mode()!=='atlas'||!selected.length)return null;const o=selectedObjects()[0];if(!o)return null;
      const b=objectBounds(o,true),h=validNumber(effective(o).handleSize,8);
      if(is('fillet')){const q={x:b.x+b.width*.25,y:b.y};if(distance(p,q)<=h+7)return{type:'fillet',object:o,point:q};}
      if(is('resize')){for(const [name,fx,fy] of [['nw',0,0],['ne',1,0],['se',1,1],['sw',0,1],['n',.5,0],['e',1,.5],['s',.5,1],['w',0,.5]]){const q={x:b.x+b.width*fx,y:b.y+b.height*fy};if(distance(p,q)<=h+6)return{type:'resize-'+name,object:o,point:q};}}
      return null;
    }
    function applyTransform(state,p,event){
      const dx=p.x-state.anchor.x,dy=p.y-state.anchor.y,s=state.settings,gain=validNumber(s.dragStrength,100)/100;
      const current=state.ids.map(id=>objects.find(o=>o.id===id)).filter(Boolean);
      const originals=state.originals;
      const handle=state.handle;
      current.forEach((o,i)=>{const original=originals[i];if(original)Object.assign(o,clone(original),{id:o.id,name:o.name});});
      if(handle==='origin'&&is('relocate')){pivotOverride={x:state.pivot.x+dx,y:state.pivot.y+dy};return;}
      if(handle==='rotate'){
        const a=Math.atan2(p.y-state.pivot.y,p.x-state.pivot.x)-Math.atan2(state.anchor.y-state.pivot.y,state.anchor.x-state.pivot.x);
        let angle=degrees(a)*gain;if(event.shiftKey){const step=Math.max(.1,validNumber(s.rotationStep,15));angle=Math.round(angle/step)*step;}
        current.forEach((o,i)=>{const origin=originals[i],c={x:origin.x+origin.width/2,y:origin.y+origin.height/2},q=rotate(c,state.pivot,angle);o.x=q.x-origin.width/2;o.y=q.y-origin.height/2;o.rotation=(origin.rotation||0)+angle;});
        state.measure=angle.toFixed(1)+'°';return;
      }
      if(handle==='scale'){
        const start=Math.max(1,distance(state.anchor,state.pivot));let ratio=clamp(distance(p,state.pivot)/start,.05,20);ratio=1+(ratio-1)*gain;
        if(event.shiftKey)ratio=Math.max(.1,Math.round(ratio*10)/10);
        current.forEach((o,i)=>{const original=originals[i];o.x=state.pivot.x+(original.x-state.pivot.x)*ratio;o.y=state.pivot.y+(original.y-state.pivot.y)*ratio;o.width=original.width*ratio;o.height=original.height*ratio;o.depth=(original.depth||0)*ratio;if(o.points)o.points=original.points.map(pt=>({x:pt.x*ratio,y:pt.y*ratio}));});
        state.measure=ratio.toFixed(2)+'×';return;
      }
      if(handle==='fillet'){
        current.forEach((o,i)=>o.cornerRadius=clamp((originals[i].cornerRadius||0)+dx*gain,0,Math.min(o.width,o.height)/2));state.measure='Radius '+current[0].cornerRadius.toFixed(1);return;
      }
      if(handle&&handle.startsWith('resize-')){
        const dir=handle.slice(7);current.forEach((o,i)=>{const original=originals[i];if(dir.includes('e'))o.width=Math.max(12,original.width+dx*gain);else if(dir.includes('w')){o.width=Math.max(12,original.width-dx*gain);o.x=original.x+original.width-o.width;}if(dir.includes('s'))o.height=Math.max(12,original.height+dy*gain);else if(dir.includes('n')){o.height=Math.max(12,original.height-dy*gain);o.y=original.y+original.height-o.height;}});state.measure=current[0].width.toFixed(1)+' × '+current[0].height.toFixed(1);return;
      }
      let tx=dx*gain,ty=dy*gain;
      if(handle==='x')ty=0;if(handle==='y')tx=0;
      current.forEach((o,i)=>{const original=originals[i];if(handle==='z')o.depth=Math.max(0,(original.depth||0)-dy*gain);else{o.x=original.x+tx;o.y=original.y+ty;}});
      state.measure=handle==='z'?'Depth '+current[0].depth.toFixed(1):'Δ '+tx.toFixed(1)+', '+ty.toFixed(1);
    }
    function numericTransform(handle){
      if(!selected.length)return;const p=pointer||screen(pivot());
      const type=handle==='rotate'?'Rotation in degrees':handle==='scale'?'Scale factor':handle==='z'?'Depth delta':'Move '+(handle==='y'?'Y':'X')+' in scene units';
      inputBox(p,type,handle==='scale'?1:25,value=>{
        const n=Number(value);if(!Number.isFinite(n)||(handle==='scale'&&n<=0)){emit('input','Enter a finite number'+(handle==='scale'?' greater than zero.':'.'));return;}
        const before=snapshot(),center=pivot();
        selectedObjects().filter(o=>!isLocked(o)).forEach(o=>{
          if(handle==='rotate'){const c=rotate({x:o.x+o.width/2,y:o.y+o.height/2},center,n);o.x=c.x-o.width/2;o.y=c.y-o.height/2;o.rotation=(o.rotation||0)+n;}
          else if(handle==='scale'){o.x=center.x+(o.x-center.x)*n;o.y=center.y+(o.y-center.y)*n;o.width*=n;o.height*=n;o.depth*=n;if(o.points)o.points=o.points.map(pt=>({x:pt.x*n,y:pt.y*n}));}
          else if(handle==='z')o.depth=Math.max(0,o.depth+n);else if(handle==='y')o.y+=n;else o.x+=n;
        });commit(before,'Applied '+n+(handle==='rotate'?'°':handle==='scale'?'×':' units')+' to '+selected.length+' object'+(selected.length===1?'':'s')+'.');
      });
    }
    function beginTransform(p,event,handle,object){
      const ids=selected.filter(id=>{const o=objects.find(o=>o.id===id);return o&&!isLocked(o);});if(!ids.length)return;
      const before=snapshot(),originals=ids.map(id=>clone(objects.find(o=>o.id===id)));
      drag={kind:'transform',start:p,anchor:world(p),before,ids,originals,pivot:clone(pivot()),handle:handle||'plane',fromHandle:!object,settings:effective(object||objects.find(o=>o.id===ids[0])),active:false,duplicate:false,measure:''};
      if(event.altKey&&(mode()==='gumball'||mode()==='feedback'))drag.wantDuplicate=true;
    }
    function activateTransform(){
      if(!drag||drag.active)return;drag.active=true;removeTooltip();
      if(drag.wantDuplicate){const copies=drag.originals.map(original=>{const copy=clone(original);copy.id=original.id+'-copy-'+idSequence++;copy.name=original.name+' copy';return copy;});objects.push(...copies);drag.ids=copies.map(o=>o.id);drag.originals=clone(copies);selected=drag.ids.slice();drag.duplicate=true;}
    }
    function addCommandPoint(p,event){
      const anchor=commandPoints.length?commandPoints[commandPoints.length-1]:null;
      const q=constrained(world(p),anchor,event);commandPoints.push(clone(q));
      emit('command','Point '+commandPoints.length+' placed. '+(commandPoints.length>1?'Enter / double-click finishes; Backspace removes last point.':'Pick another point; Esc cancels.'),{points:clone(commandPoints),snap:clone(snap)});requestDraw();
    }
    function finishCommand(){
      if(commandPoints.length<2){emit('command','Place at least two points to finish a polyline.');return;}
      const before=snapshot(),b=bounds(commandPoints),id='drawn-curve-'+idSequence++;
      const object={id,name:'Drawn polyline '+idSequence,group:'User studies',kind:'polyline',x:b.x,y:b.y,width:b.width||1,height:b.height||1,depth:0,rotation:0,color:'#9cc8c8',locked:false,points:commandPoints.map(p=>({x:p.x-b.x,y:p.y-b.y}))};
      objects.push(object);selected=[id];commandPoints=[];snap=null;axisLock=null;commit(before,'Polyline committed.');emit('command','Polyline completed. Pick a point to begin another.');requestDraw();
    }
    function down(event){
      if(disposed)return;canvas.focus();pointer=eventPoint(event);keyState={shiftKey:event.shiftKey,ctrlKey:event.ctrlKey,altKey:event.altKey,space:keyState.space};
      closePopup();closeNumeric();removeTooltip();
      if(event.button===2){
        if(mode()==='navigation'&&is('orbit')){drag={kind:'orbit',start:pointer,camera:clone(camera)};canvas.setPointerCapture(event.pointerId);setCursor('grabbing');}
        else {drag={kind:'contextPending',start:pointer,camera:clone(camera),hit:hitAll(pointer,false)[0]};canvas.setPointerCapture(event.pointerId);}event.preventDefault();return;
      }
      if(event.button===1||keyState.space||(mode()==='navigation'&&(is('pan')||event.shiftKey))){drag={kind:'pan',start:pointer,camera:clone(camera)};canvas.setPointerCapture(event.pointerId);setCursor('grabbing');event.preventDefault();return;}
      if(event.button!==0)return;
      canvas.setPointerCapture(event.pointerId);
      if(mode()==='navigation'&&is('orbit')){drag={kind:'orbit',start:pointer,camera:clone(camera)};setCursor('grabbing');return;}
      if(relocatePending&&mode()==='gumball'){
        const before=snapshot();pivotOverride=clone(pickSnap(world(pointer),pivot()));relocatePending=false;commit(before,'Gumball origin relocated without changing geometry.');setCursor(restingCursor());return;
      }
      if(mode()==='command'&&!is('cancel')){addCommandPoint(pointer,event);return;}
      if(mode()==='snap'||mode()==='tracking'){
        const anchor=commandPoints.length?commandPoints[commandPoints.length-1]:null;
        const q=constrained(world(pointer),anchor,event);commandPoints.push(clone(q));if(commandPoints.length>2)commandPoints.shift();
        emit('point','Point picked'+(trackingGuide?' at '+trackingGuide.label:snap?' at '+snap.label:'')+' · '+q.x.toFixed(1)+', '+q.y.toFixed(1)+'.',{point:clone(q),snap:clone(snap),tracking:clone(trackingGuide)});requestDraw();return;
      }
      const handle=hitHandle(pointer),atlas=atlasHandle(pointer);
      if(handle){beginTransform(pointer,event,is('relocate')?'origin':is('rotate')?'rotate':is('scale')?'scale':is('plane')?'plane':handle.type);return;}
      if(atlas){beginTransform(pointer,event,atlas.type,atlas.object);return;}
      const sub=subTargeting(event),hits=hitAll(pointer,sub,event),hit=hits[0];
      if(hit&&isLocked(hit.object)){setCursor('not-allowed');emit('locked',hit.object.name+' is locked. Select an unlocked object.');return;}
      if(hit&&hit.part){
        const key=hit.object.id+':'+hit.part.kind+':'+hit.part.index;
        if(subSelection.some(s=>s.key===key))subSelection=subSelection.filter(s=>s.key!==key);else subSelection.push({key,objectId:hit.object.id,kind:hit.part.kind,index:hit.part.index});
        selected=Array.from(new Set(subSelection.map(s=>s.objectId)));emit('subselection',subSelection.length+' subobject'+(subSelection.length===1?'':'s')+' selected.',{picked:clone(hit.part)});requestDraw();return;
      }
      if(hit&&hits.length>1&&is('overlap')){showOverlap(hits,pointer,event);return;}
      if(hit){
        if(event.shiftKey||event.ctrlKey||!selected.includes(hit.object.id))select([hit.object.id],event);
        if(selected.includes(hit.object.id)&&!(event.ctrlKey||event.shiftKey))beginTransform(pointer,event,'plane',hit.object);
        return;
      }
      // The point-pick inversion of the Sub-objects filter stays local to a
      // click. Ctrl+Shift dragging from empty space always collects parts in a
      // component study, including parts owned by several different objects.
      const components=sub||event.ctrlKey&&event.shiftKey&&(mode()==='subobject'||settings.typeFilter==='subobjects');
      drag={kind:'marquee',start:pointer,current:pointer,active:false,components,modifiers:{shiftKey:event.shiftKey,ctrlKey:event.ctrlKey}};
      setCursor('crosshair');requestDraw();
    }
    function move(event){
      if(disposed)return;pointer=eventPoint(event);keyState={shiftKey:event.shiftKey,ctrlKey:event.ctrlKey,altKey:event.altKey,space:keyState.space};
      if(drag){
        if(drag.kind==='contextPending'){
          if(distance(pointer,drag.start)<validNumber(settings.dragThreshold,4))return;
          drag.kind='pan';closePopup();
        }
        if(drag.kind==='pan'){camera.x=drag.camera.x-(pointer.x-drag.start.x)/camera.zoom;camera.y=drag.camera.y-(pointer.y-drag.start.y)/camera.zoom;setCursor('grabbing');requestDraw();return;}
        if(drag.kind==='orbit'){camera.orbit=drag.camera.orbit+(pointer.x-drag.start.x)/200;camera.y=drag.camera.y+(pointer.y-drag.start.y)/camera.zoom*.22;setCursor('grabbing');requestDraw();return;}
        if(drag.kind==='marquee'){drag.current=pointer;drag.active=distance(pointer,drag.start)>=validNumber(settings.dragThreshold,4);requestDraw();return;}
        if(drag.kind==='transform'){
          if(!drag.active&&distance(pointer,drag.start)<validNumber(drag.settings.dragThreshold,4))return;
          activateTransform();let p=world(pointer);
          if(drag.handle!=='rotate'&&drag.handle!=='scale'&&drag.handle!=='fillet'&&drag.handle!=='z'&&!drag.handle.startsWith('resize')){
            let target={x:drag.pivot.x+p.x-drag.anchor.x,y:drag.pivot.y+p.y-drag.anchor.y};
            if(drag.handle==='x')target.y=drag.pivot.y;if(drag.handle==='y')target.x=drag.pivot.x;
            const resolved=constrained(target,drag.pivot,event);p={x:drag.anchor.x+resolved.x-drag.pivot.x,y:drag.anchor.y+resolved.y-drag.pivot.y};
          }
          applyTransform(drag,p,event);setCursor(drag.duplicate?'copy':drag.handle==='scale'?'nwse-resize':drag.handle==='rotate'?'grabbing':'move');
          status=(drag.duplicate?'Copy · ':'')+drag.measure+' · Esc cancels';requestDraw();return;
        }
      }
      if(mode()==='snap'||mode()==='tracking'||mode()==='command'&&!is('cancel')||relocatePending){
        const anchor=commandPoints.length?commandPoints[commandPoints.length-1]:null;constrained(world(pointer),anchor,event);setCursor('crosshair');requestDraw();
      }else{
        const h=hitHandle(pointer),a=atlasHandle(pointer),hit=hitAll(pointer,subTargeting(event),event)[0];
        hoverHandle=h&&h.type;scheduleHover(h?{object:selectedObjects()[0],part:{kind:h.type+' handle',index:-1}}:hit);
        if(h)setCursor(hoverCursor(h.type==='scale'?'nwse-resize':h.type==='rotate'?'grab':is('relocate')?'move':event.altKey?'copy':h.type==='origin'?'move':'grab',selectedObjects()[0]),false,selectedObjects()[0]);
        else if(a)setCursor(hoverCursor(a.type==='fillet'?'ew-resize':a.type.endsWith('nw')||a.type.endsWith('se')?'nwse-resize':'nesw-resize',a.object),false,a.object);
        else if(hit&&isLocked(hit.object))setCursor(hoverCursor('not-allowed',hit.object),false,hit.object);
        else if(mode()==='navigation')setCursor(restingCursor());
        else if(hit)setCursor(hoverCursor(event.altKey&&mode()==='gumball'?'copy':hit.part?'crosshair':selected.includes(hit.object.id)?'move':'default',hit.object),false,hit.object);
        else setCursor(restingCursor());
        requestDraw();
      }
    }
    function marqueeCandidates(state){
      const r={x:Math.min(state.start.x,state.current.x),y:Math.min(state.start.y,state.current.y),width:Math.abs(state.current.x-state.start.x),height:Math.abs(state.current.y-state.start.y)};
      const crossing=state.current.x<state.start.x;
      const corners=[{x:r.x,y:r.y},{x:r.x+r.width,y:r.y},{x:r.x+r.width,y:r.y+r.height},{x:r.x,y:r.y+r.height}];
      function touches(points,closed){
        if(!crossing)return points.every(p=>rectContains(r,p));
        if(points.some(p=>rectContains(r,p)))return true;
        if(closed&&corners.some(p=>inside(p,points)))return true;
        const count=closed?points.length:Math.max(0,points.length-1);
        for(let i=0;i<count;i++)for(let j=0;j<4;j++)if(intersection(points[i],points[(i+1)%points.length],corners[j],corners[(j+1)%4]))return true;
        return false;
      }
      if(state.components){
        return objects.flatMap(object=>{
          if(isLocked(object)||!permitted(object))return[];
          const g=geometry(object),kind=is('vertex')?'vertex':object.kind==='polyline'||is('edge')?'edge':'face';
          const candidates=kind==='vertex'?g.vertices.map(p=>[p]):kind==='edge'?g.edges:g.faces.map(face=>face.points);
          return candidates.flatMap((points,index)=>touches(points.map(screen),kind==='face')?[{key:object.id+':'+kind+':'+index,objectId:object.id,kind,index}]:[]);
        });
      }
      return objects.filter(o=>{
        if(isLocked(o)||!permitted(o))return false;const g=geometry(o),pts=g.vertices.map(screen);
        if(!crossing)return pts.every(p=>rectContains(r,p));
        if(pts.some(p=>rectContains(r,p)))return true;
        if(g.faces.some(f=>corners.some(p=>inside(p,f.points.map(screen)))))return true;
        return g.edges.some(edge=>corners.some((p,i)=>intersection(screen(edge[0]),screen(edge[1]),p,corners[(i+1)%4])));
      }).map(o=>o.id);
    }
    function selectMarqueeComponents(parts,modifiers,message){
      if(modifiers.ctrlKey&&!modifiers.shiftKey){const keys=new Set(parts.map(part=>part.key));subSelection=subSelection.filter(part=>!keys.has(part.key));}
      else if(modifiers.shiftKey){const keys=new Set(subSelection.map(part=>part.key));subSelection=subSelection.concat(parts.filter(part=>!keys.has(part.key)));}
      else subSelection=parts;
      selected=Array.from(new Set(subSelection.map(part=>part.objectId)));pivotOverride=null;lastSelectionStamp=performance.now();clearHover();
      emit('subselection',message+' '+subSelection.length+' subobject'+(subSelection.length===1?'':'s')+' selected.');requestDraw();
    }
    function up(event){
      if(canvas.hasPointerCapture&&canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
      if(!drag)return;const state=drag;drag=null;
      if(state.kind==='contextPending'){showContext(state.start,state.hit);}
      else if(state.kind==='marquee'){
        if(state.active){const message=(state.current.x<state.start.x?'Crossing':'Window')+(state.components?' sub-object':'')+' selection completed.';if(state.components)selectMarqueeComponents(marqueeCandidates(state),state.modifiers,message);else select(marqueeCandidates(state),state.modifiers,message);}
        else if(!state.modifiers.shiftKey&&!state.modifiers.ctrlKey)select([]);
      }else if(state.kind==='transform'){
        if(state.active){commit(state.before,state.handle==='origin'&&is('relocate')?'Gumball origin relocated.':(state.duplicate?'Copied · ':'')+state.measure+'.');}
        else if(mode()==='gumball'&&!is('relocate')&&state.fromHandle&&state.handle!=='origin'&&state.handle!=='plane')numericTransform(state.handle);
      }else emit('navigation',state.kind==='orbit'?'Orbit changed the illustrative 2.5D projection.':'View panned.');
      setCursor(restingCursor());requestDraw();
    }
    function doubleClick(event){pointer=eventPoint(event);if(mode()==='command'&&!is('cancel')){if(commandPoints.length>2&&distance(commandPoints[commandPoints.length-1],commandPoints[commandPoints.length-2])<2/camera.zoom)commandPoints.pop();finishCommand();}else if(mode()==='atlas'&&is('rename')){const hit=hitAll(pointer,false)[0];if(hit){select([hit.object.id]);openRename();}}else if(mode()==='gumball'){const handle=hitHandle(pointer);if(handle&&is('relocate')){relocatePending=true;setCursor('crosshair');emit('relocate','Pick the new Gumball origin. Geometry stays in place; Esc cancels.');}else if(handle)numericTransform(is('rotate')?'rotate':is('scale')?'scale':handle.type);}else if(mode()==='navigation')fit();}
    function wheel(event){event.preventDefault();pointer=eventPoint(event);const before=world(pointer),speed=clamp(validNumber(settings.zoomSpeed,100),10,400)/100;camera.zoom=clamp(camera.zoom*Math.exp(-event.deltaY*.0014*speed),.18,7);const after=world(pointer);camera.x+=before.x-after.x;camera.y+=before.y-after.y;emit('navigation','Zoom '+Math.round(camera.zoom*100)+'% · pointer position stays anchored.',{zoom:camera.zoom});requestDraw();}
    function cancel(){
      if(drag&&drag.before)applySnapshot(drag.before);else if(drag&&drag.camera)camera=clone(drag.camera);
      drag=null;relocatePending=false;commandPoints=[];snap=null;trackPoints=[];trackingGuide=null;trackingAcquisition=null;trackCandidate=null;clearTimeout(trackTimer);axisLock=null;closePopup();closeNumeric();clearHover();setCursor(restingCursor());emit('cancel','Active interaction cancelled. Geometry restored to its previous state.');requestDraw();
    }
    function keydown(event){
      if(event.target!==canvas&&event.target!==doc.body)return;
      keyState={shiftKey:event.shiftKey,ctrlKey:event.ctrlKey,altKey:event.altKey,space:event.code==='Space'||event.key===' '?true:keyState.space};
      if(event.code==='Space'||event.key===' ')event.preventDefault();
      if(event.key==='Escape'){event.preventDefault();cancel();}
      else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();event.shiftKey?redo():undo();}
      else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='y'){event.preventDefault();redo();}
      else if(event.key==='Enter'&&mode()==='command'){event.preventDefault();finishCommand();}
      else if(event.key==='Backspace'&&commandPoints.length){event.preventDefault();commandPoints.pop();emit('command','Last point removed.');requestDraw();}
      else if(event.key==='Tab'&&mode()==='tracking'){
        event.preventDefault();const p=pointer?world(pointer):{x:1,y:0},a=commandPoints[commandPoints.length-1]||{x:0,y:0};
        if(!axisLock){const d=Math.max(.001,distance(p,a));axisLock={phase:'direction',x:(p.x-a.x)/d,y:(p.y-a.y)/d,anchor:clone(a),radius:d};}
        else if(axisLock.phase==='direction'){axisLock.phase='radius';axisLock.radius=distance(p,axisLock.anchor);}
        else axisLock=null;
        emit('tracking',axisLock?axisLock.phase==='direction'?'Direction locked. Tab captures radius.':'Radius locked. Tab releases.':'Direction and radius locks released.');requestDraw();
      }
      else if(event.key.toLowerCase()==='f'&&(is('filter')||mode()==='selection')){event.preventDefault();filterIndex=(filterIndex+1)%filters.length;clearHover();emit('filter','Selection filter: '+filters[filterIndex]+'. Press F to cycle.');requestDraw();}
      else if(event.key==='F2'&&selected.length){event.preventDefault();openRename();}
      else if(event.key==='Home'){event.preventDefault();fit();}
      else if(event.key.toLowerCase()==='d'&&event.altKey){event.preventDefault();duplicateSelection();}
      else if(event.key==='Delete'&&selected.length){event.preventDefault();const before=snapshot();objects=objects.filter(o=>!selected.includes(o.id)||isLocked(o));selected=[];subSelection=[];commit(before,'Selected objects deleted. Undo restores them.');}
      if(pointer&&!drag)move({clientX:pointer.x+canvas.getBoundingClientRect().left,clientY:pointer.y+canvas.getBoundingClientRect().top,shiftKey:event.shiftKey,ctrlKey:event.ctrlKey,altKey:event.altKey});
    }
    function keyup(event){keyState={shiftKey:event.shiftKey,ctrlKey:event.ctrlKey,altKey:event.altKey,space:event.code==='Space'||event.key===' '?false:keyState.space};if(pointer&&!drag)move({clientX:pointer.x+canvas.getBoundingClientRect().left,clientY:pointer.y+canvas.getBoundingClientRect().top,shiftKey:event.shiftKey,ctrlKey:event.ctrlKey,altKey:event.altKey});}
    function leave(){if(!drag){pointer=null;hoverHandle=null;clearHover();snap=null;trackingGuide=null;trackingAcquisition=null;trackCandidate=null;clearTimeout(trackTimer);requestDraw();}}
    function fit(){camera={x:0,y:25,zoom:clamp(Math.min(width/650,height/440),.25,2),orbit:0};emit('navigation','Scene fitted to the viewport.');requestDraw();}
    function resize(){const r=canvas.getBoundingClientRect();const oldWidth=width; width=Math.max(10,r.width||800);height=Math.max(10,r.height||500);dpr=clamp(typeof devicePixelRatio==='number'?devicePixelRatio:1,1,3);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);if(oldWidth===800&&!history.length&&!drag)camera.zoom=clamp(Math.min(width/650,height/440),.25,2);requestDraw();}
    function shade(color,amount){const match=/^#([0-9a-f]{6})$/i.exec(color||'');if(!match)return color||'#ccd6df';const n=parseInt(match[1],16),r=clamp((n>>16)+amount*255,0,255),g=clamp((n>>8&255)+amount*255,0,255),b=clamp((n&255)+amount*255,0,255);return'rgb('+Math.round(r)+','+Math.round(g)+','+Math.round(b)+')';}
    function path(points,close){ctx.beginPath();points.forEach((p,i)=>{const q=screen(p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);});if(close)ctx.closePath();}
    function roundRectPath(object,points){
      const radius=clamp(validNumber(object.cornerRadius,0)*camera.zoom,0,Math.min(object.width,object.height)*camera.zoom/2);
      if(!radius||points.length!==4){path(points,true);return;}
      const p=points.map(screen);ctx.beginPath();for(let i=0;i<4;i++){const prior=p[(i+3)%4],current=p[i],next=p[(i+1)%4],d1=distance(prior,current),d2=distance(current,next);const a=mix(current,prior,Math.min(.45,radius/d1)),b=mix(current,next,Math.min(.45,radius/d2));if(i===0)ctx.moveTo(a.x,a.y);else ctx.lineTo(a.x,a.y);ctx.quadraticCurveTo(current.x,current.y,b.x,b.y);}ctx.closePath();
    }
    function drawGrid(){
      const step=Math.max(5,validNumber(settings.gridSize,25));let stride=step;while(stride*camera.zoom<12)stride*=2;
      const a=world({x:0,y:0}),b=world({x:width,y:height});ctx.lineWidth=1;
      for(let x=Math.floor(a.x/stride)*stride;x<=b.x;x+=stride){const p=screen({x,y:0});ctx.strokeStyle=Math.abs(x/stride%5)<.001?'#dce5eb':'#eaf0f4';ctx.beginPath();ctx.moveTo(Math.round(p.x)+.5,0);ctx.lineTo(Math.round(p.x)+.5,height);ctx.stroke();}
      for(let y=Math.floor(a.y/stride)*stride;y<=b.y;y+=stride){const p=screen({x:0,y});ctx.strokeStyle=Math.abs(y/stride%5)<.001?'#dce5eb':'#eaf0f4';ctx.beginPath();ctx.moveTo(0,Math.round(p.y)+.5);ctx.lineTo(width,Math.round(p.y)+.5);ctx.stroke();}
      const origin=screen({x:0,y:0});ctx.setLineDash([6,5]);ctx.strokeStyle='#d9bdbb';ctx.beginPath();ctx.moveTo(0,origin.y);ctx.lineTo(width,origin.y);ctx.stroke();ctx.strokeStyle='#b9cbb9';ctx.beginPath();ctx.moveTo(origin.x,0);ctx.lineTo(origin.x,height);ctx.stroke();ctx.setLineDash([]);
    }
    function drawHover(object,g,s,presentation){
      ctx.save();ctx.strokeStyle=s.highlightColor;ctx.fillStyle=s.highlightColor;ctx.lineWidth=validNumber(s.strokeWidth,1.5)+1;
      if(presentation==='fill'||presentation==='outline-fill'){
        ctx.globalAlpha*=clamp(validNumber(s.hoverOpacity,30)/100,.1,1);
        g.faces.forEach(face=>{if(object.kind==='box')roundRectPath(object,face.points);else path(face.points,true);ctx.fill();});
        if(object.kind==='polyline'){path(g.vertices,false);ctx.lineWidth=Math.max(6,validNumber(s.strokeWidth,1.5)+4);ctx.stroke();}
      }else if(presentation==='bounds'||presentation==='corners'){
        const b=objectBounds(object,true),x=b.x-6,y=b.y-6,w=b.width+12,h=b.height+12;
        if(presentation==='bounds')ctx.strokeRect(x,y,w,h);
        else{
          const arm=Math.min(18,w/4,h/4);ctx.beginPath();
          [[x,y,1,1],[x+w,y,-1,1],[x+w,y+h,-1,-1],[x,y+h,1,-1]].forEach(([cx,cy,dx,dy])=>{ctx.moveTo(cx+dx*arm,cy);ctx.lineTo(cx,cy);ctx.lineTo(cx,cy+dy*arm);});ctx.stroke();
        }
      }else if(presentation==='halo'){
        ctx.globalAlpha*=.8;ctx.shadowColor=s.highlightColor;ctx.shadowBlur=12;ctx.lineWidth=validNumber(s.strokeWidth,1.5)+4;
        g.faces.forEach(face=>{if(object.kind==='box')roundRectPath(object,face.points);else path(face.points,true);ctx.stroke();});
        if(object.kind==='polyline'){path(g.vertices,false);ctx.stroke();}
      }
      ctx.restore();
    }
    function drawObject(object,preview){
      const s=effective(object),g=geometry(object),components=subSelection.filter(part=>part.objectId===object.id),sel=selected.includes(object.id)&&!components.length,presentation=s.hoverPresentation||'outline';
      const passive=hover&&hover.object.id===object.id&&s.prehighlight!==false&&presentation!=='none';
      const componentHover=passive&&hover.part&&['face','edge','vertex'].includes(hover.part.kind);
      const highlight=passive&&!sel&&!componentHover,outline=highlight&&(presentation==='outline'||presentation==='outline-fill');
      const locked=isLocked(object),eligible=permitted(object);ctx.save();ctx.globalAlpha=clamp(validNumber(s.opacity,100)/100,.04,1)*(eligible?1:.2)*(locked?.6:1);
      const color=object.color||'#ccd6df';
      g.faces.forEach(face=>{if(object.kind==='box')roundRectPath(object,face.points);else path(face.points,true);ctx.fillStyle=shade(color,face.shade||0);ctx.fill();ctx.strokeStyle=sel?s.selectionColor:outline?s.highlightColor:'#8194a4';ctx.lineWidth=validNumber(s.strokeWidth,1.5)+(sel||outline?.8:0);ctx.stroke();});
      if(object.kind==='polyline'){path(g.vertices,false);ctx.strokeStyle=sel?s.selectionColor:outline?s.highlightColor:'#577c83';ctx.lineWidth=validNumber(s.strokeWidth,1.5)+(sel||outline?1.3:.5);ctx.lineJoin='round';ctx.stroke();}
      if(highlight)drawHover(object,g,s,presentation);
      if(locked){const b=objectBounds(object,true);ctx.fillStyle='#738393';ctx.font='12px system-ui';ctx.fillText('▣',b.x+b.width-12,b.y+14);}
      if(componentHover)drawPart(object,hover.part,s.highlightColor,3);
      components.forEach(part=>drawPart(object,part,s.selectionColor,3));
      if(s.showLabels!==false){const b=objectBounds(object,true);ctx.globalAlpha=eligible?.92:.25;ctx.font='11px system-ui';ctx.textAlign='center';ctx.fillStyle=sel?'#176db0':'#65798a';ctx.fillText(object.name,b.x+b.width/2,b.y+b.height+18);ctx.textAlign='left';}
      if(sel){const b=objectBounds(object,true);ctx.globalAlpha=.7;ctx.strokeStyle=s.selectionColor;ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.strokeRect(b.x-5,b.y-5,b.width+10,b.height+10);ctx.setLineDash([]);}
      ctx.restore();
    }
    function drawPart(object,part,color,lineWidth){
      const g=geometry(object);ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=lineWidth;
      if(part.kind==='vertex'&&g.vertices[part.index]){const p=screen(g.vertices[part.index]);ctx.beginPath();ctx.arc(p.x,p.y,validNumber(effective(object).handleSize,8)/2+2,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();}
      if(part.kind==='edge'&&g.edges[part.index]){path(g.edges[part.index],false);ctx.stroke();}
      if(part.kind==='face'&&g.faces[part.index]){path(g.faces[part.index].points,true);ctx.globalAlpha=.25;ctx.fill();ctx.globalAlpha=1;ctx.stroke();}ctx.restore();
    }
    function drawGumball(){
      const list=handles();if(!list.length)return;const s=effective(selectedObjects()[0]),p=list[0].point,size=clamp(validNumber(s.gumballSize,76),35,180),h=validNumber(s.handleSize,8);
      ctx.save();ctx.lineWidth=2;ctx.setLineDash([]);
      const ring=size*.8;ctx.strokeStyle='#6398c799';ctx.beginPath();ctx.arc(p.x,p.y,ring,0,Math.PI*2);ctx.stroke();
      [['x','#d25753'],['y','#6b9c61'],['z','#558cc0']].forEach(([type,color])=>{const end=list.find(q=>q.type===type).point;const hovered=hoverHandle===type&&s.cursorPolicy==='native';ctx.strokeStyle=hovered?'#202020':color;ctx.fillStyle=hovered?'#202020':color;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(end.x,end.y);ctx.stroke();const angle=Math.atan2(end.y-p.y,end.x-p.x);ctx.beginPath();ctx.moveTo(end.x+Math.cos(angle)*5,end.y+Math.sin(angle)*5);ctx.lineTo(end.x-Math.cos(angle)*7+Math.sin(angle)*4,end.y-Math.sin(angle)*7-Math.cos(angle)*4);ctx.lineTo(end.x-Math.cos(angle)*7-Math.sin(angle)*4,end.y-Math.sin(angle)*7+Math.cos(angle)*4);ctx.closePath();ctx.fill();ctx.font='10px system-ui';ctx.fillText(type.toUpperCase(),end.x+8,end.y-7);});
      const plane=list.find(q=>q.type==='plane').point;ctx.fillStyle='#e4c96e88';ctx.strokeStyle='#ba983a';ctx.fillRect(plane.x-8,plane.y-8,16,16);ctx.strokeRect(plane.x-8,plane.y-8,16,16);
      const scale=list.find(q=>q.type==='scale').point;ctx.fillStyle='#fff';ctx.strokeStyle='#728ca3';ctx.fillRect(scale.x-h/2,scale.y-h/2,h,h);ctx.strokeRect(scale.x-h/2,scale.y-h/2,h,h);
      const ringHandle=list.find(q=>q.type==='rotate').point;ctx.fillStyle='#fff';ctx.strokeStyle='#558cc0';ctx.beginPath();ctx.arc(ringHandle.x,ringHandle.y,h/2,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.fillStyle=is('relocate')?'#e4c96e':'#fff';ctx.strokeStyle='#566e83';ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();
    }
    function drawAtlas(){
      if(mode()!=='atlas'||!selected.length)return;const object=selectedObjects()[0];if(!object)return;const b=objectBounds(object,true),h=validNumber(effective(object).handleSize,8);
      ctx.save();ctx.fillStyle='#fff';ctx.strokeStyle=settings.selectionColor;ctx.lineWidth=1.5;
      if(is('resize'))for(const [fx,fy] of [[0,0],[1,0],[1,1],[0,1],[.5,0],[1,.5],[.5,1],[0,.5]]){const x=b.x+b.width*fx,y=b.y+b.height*fy;ctx.fillRect(x-h/2,y-h/2,h,h);ctx.strokeRect(x-h/2,y-h/2,h,h);}
      if(is('fillet')){const x=b.x+b.width*.25,y=b.y;ctx.fillStyle='#ebba58';ctx.beginPath();ctx.arc(x,y,h/2+2,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.font='11px system-ui';ctx.fillStyle='#7c6428';ctx.fillText('R '+validNumber(object.cornerRadius,0).toFixed(1),x+10,y-8);}
      ctx.restore();
    }
    function drawMarquee(){
      if(!drag||drag.kind!=='marquee'||!drag.active)return;const x=Math.min(drag.start.x,drag.current.x),y=Math.min(drag.start.y,drag.current.y),w=Math.abs(drag.current.x-drag.start.x),h=Math.abs(drag.current.y-drag.start.y),cross=drag.current.x<drag.start.x;
      ctx.save();ctx.fillStyle=cross?'#48a78114':'#2781d414';ctx.strokeStyle=cross?'#38936c':'#2b7fbd';ctx.lineWidth=1;if(cross)ctx.setLineDash([5,4]);ctx.fillRect(x,y,w,h);ctx.strokeRect(x+.5,y+.5,w,h);ctx.setLineDash([]);ctx.font='11px system-ui';ctx.fillStyle=cross?'#377b61':'#306f9d';ctx.fillText((cross?'Crossing · touches count':'Window · fully inside')+(drag.components?' · Sub-objects':''),x+5,Math.max(15,y-7));ctx.restore();
    }
    function drawSnaps(){
      if(!pointer)return;ctx.save();
      if(snap){const p=screen(snap.point),size=validNumber(settings.handleSize,8)+2;ctx.strokeStyle='#ca7820';ctx.fillStyle='#fff8e9';ctx.lineWidth=1.7;ctx.fillRect(p.x-size/2,p.y-size/2,size,size);ctx.strokeRect(p.x-size/2,p.y-size/2,size,size);ctx.font='11px system-ui';ctx.fillStyle='#95601d';ctx.fillText(snap.label,p.x+10,p.y-9);ctx.setLineDash([3,3]);ctx.globalAlpha=.5;ctx.beginPath();ctx.moveTo(pointer.x,pointer.y);ctx.lineTo(p.x,p.y);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1;}
      trackPoints.forEach(reference=>{const p=screen(reference.point),span=Math.max(width,height)*2;ctx.strokeStyle='#8c9db9';ctx.setLineDash([3,5]);ctx.beginPath();reference.directions.forEach(direction=>{ctx.moveTo(p.x-direction.x*span,p.y-direction.y*span);ctx.lineTo(p.x+direction.x*span,p.y+direction.y*span);});ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#647fa1';ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fill();});
      if(trackingGuide){const p=screen(trackingGuide.point);ctx.strokeStyle='#647fa1';ctx.fillStyle='#fff';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(p.x,p.y,5,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#456288';ctx.font='11px system-ui';ctx.fillText(trackingGuide.label,p.x+10,p.y-10);}
      if(commandPoints.length){const pts=commandPoints.map(screen);ctx.strokeStyle='#578eae';ctx.lineWidth=1.6;ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();pts.forEach(p=>{ctx.fillStyle='#fff';ctx.strokeStyle='#4085af';ctx.fillRect(p.x-3,p.y-3,6,6);ctx.strokeRect(p.x-3,p.y-3,6,6);});
        if(mode()==='command'||mode()==='tracking'){const anchor=commandPoints[commandPoints.length-1],p=constrained(world(pointer),anchor,keyState);const end=screen(p),last=pts[pts.length-1];ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(end.x,end.y);ctx.stroke();ctx.setLineDash([]);ctx.font='11px system-ui';ctx.fillStyle='#4f7189';ctx.fillText(distance(anchor,p).toFixed(1)+' u',end.x+12,end.y+16);}
      }
      if(axisLock){ctx.strokeStyle='#9a6ab4';ctx.setLineDash([8,4]);const a=screen(axisLock.anchor);ctx.beginPath();if(axisLock.phase==='direction'){const span=Math.max(width,height)*2;ctx.moveTo(a.x-axisLock.x*span,a.y-axisLock.y*span);ctx.lineTo(a.x+axisLock.x*span,a.y+axisLock.y*span);}else ctx.arc(a.x,a.y,axisLock.radius*camera.zoom,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);}
      ctx.restore();
    }
    function drawHUD(){
      ctx.save();ctx.font='10px system-ui';ctx.fillStyle='#758697';ctx.fillText('XY construction plane · scene units',15,height-16);const text=Math.round(camera.zoom*100)+'%';ctx.textAlign='right';ctx.fillText(text,width-15,height-16);ctx.textAlign='left';
      if(filterIndex){ctx.fillStyle='#edf4fa';ctx.fillRect(12,12,155,24);ctx.fillStyle='#4e7290';ctx.fillText(filters[filterIndex]+' · F to cycle',20,28);}
      if(mode()==='tracking'&&is('planar')){ctx.fillStyle='#e5eff5';ctx.fillRect(12,12,185,24);ctx.fillStyle='#54778e';ctx.fillText('CPlane XY · all picked points at Z=0',20,28);}
      if(drag&&drag.kind==='transform'&&drag.active){ctx.font='12px system-ui';const text=drag.measure+(drag.duplicate?' · Copy':'');const tw=ctx.measureText(text).width;ctx.fillStyle='#fff';ctx.strokeStyle='#c6d6e1';const p=pointer||{x:20,y:20};ctx.fillRect(p.x+18,p.y+16,tw+16,27);ctx.strokeRect(p.x+18,p.y+16,tw+16,27);ctx.fillStyle='#335a78';ctx.fillText(text,p.x+26,p.y+34);}
      const origin=screen({x:0,y:0});ctx.fillStyle='#8a9cac';ctx.beginPath();ctx.arc(origin.x,origin.y,2,0,Math.PI*2);ctx.fill();ctx.restore();
    }
    function render(time){
      raf=0;if(disposed)return;lastRenderTime=time;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);ctx.fillStyle='#f8fafb';ctx.fillRect(0,0,width,height);drawGrid();
      objects.forEach(object=>drawObject(object));drawGumball();drawAtlas();drawMarquee();drawSnaps();drawHUD();
    }
    function undo(){
      if(drag){cancel();return;}if(mode()==='command'&&commandPoints.length){commandPoints.pop();emit('history','Removed the last uncommitted command point.');requestDraw();return;}
      if(!history.length){emit('history','Nothing to undo.');return;}future.push(snapshot());applySnapshot(history.pop());emit('history','Undo applied.');
    }
    function redo(){if(!future.length){emit('history','Nothing to redo.');return;}history.push(snapshot());applySnapshot(future.pop());emit('history','Redo applied.');}
    function setCase(value){cancelSilently();caseStudy=value||{mode:'selection',variant:'click'};filterIndex=0;trackPoints=[];commandPoints=[];axisLock=null;
      if(mode()==='gumball'||mode()==='atlas'||mode()==='feedback'&&is('cursor'))selected=objects.some(o=>o.id==='block-a')?['block-a']:objects.length?[objects[0].id]:[];else selected=[];subSelection=[];pivotOverride=null;
      setCursor(restingCursor(),true);emit('case','Ready: '+(caseStudy.title||variant()||mode())+'.');requestDraw();}
    function cancelSilently(){if(drag&&drag.before)applySnapshot(drag.before);drag=null;relocatePending=false;hoverHandle=null;clearHover();closePopup();closeNumeric();snap=null;trackingGuide=null;trackingAcquisition=null;trackCandidate=null;clearTimeout(trackTimer);}
    function setSettings(value){
      settings=Object.assign({},DEFAULTS,value||{});clearHover();
      if(drag)setCursor(cursor,true);
      else if(pointer){const r=canvas.getBoundingClientRect();move({clientX:pointer.x+r.left,clientY:pointer.y+r.top,...keyState});}
      else setCursor(restingCursor(),true);
      requestDraw();
    }
    function reset(){cancelSilently();objects=scene();history=[];future=[];selected=[];subSelection=[];pivotOverride=null;commandPoints=[];trackPoints=[];axisLock=null;filterIndex=0;fit();setCase(caseStudy);emit('reset','Dummy scene reset.');}
    function setSelection(ids){
      // The inspector may target locked references so their lock state can be edited.
      // Pointer selection still excludes locked geometry.
      selected=Array.from(new Set((Array.isArray(ids)?ids:[]).filter(id=>objects.some(o=>o.id===id))));subSelection=[];pivotOverride=null;
      emit('selection',selected.length+' inspector target'+(selected.length===1?'':'s')+' selected.');requestDraw();
    }
    function updateObjects(ids,patch){
      const before=snapshot(),keys=['name','group','kind','x','y','width','height','depth','rotation','cornerRadius','locked','color','points'];
      objects.forEach(o=>{if(!ids.includes(o.id))return;keys.forEach(key=>{if(!(key in patch))return;if(['x','y','width','height','depth','rotation','cornerRadius'].includes(key)){const value=Number(patch[key]);if(Number.isFinite(value))o[key]=['width','height'].includes(key)?Math.max(1,value):['depth','cornerRadius'].includes(key)?Math.max(0,value):value;}else if(key==='locked')o.locked=!!patch.locked;else if(key==='points'&&Array.isArray(patch.points))o.points=clone(patch.points);else if(['name','group','color'].includes(key))o[key]=String(patch[key]).slice(0,160);else if(key==='kind'&&['box','circle','polyline'].includes(patch.kind))o.kind=patch.kind;});});
      commit(before,'Updated '+ids.length+' object'+(ids.length===1?'':'s')+'.');
    }
    function serialize(){return{version:1,objects:clone(objects),selection:selected.slice(),subSelection:clone(subSelection),camera:clone(camera),pivot:clone(pivotOverride),idSequence};}
    function restore(state){
      if(!state||!Array.isArray(state.objects))throw new Error('Scene must contain an objects array.');
      if(state.objects.length>1000)throw new Error('A study scene may contain at most 1,000 objects.');
      if(state.selection!==undefined&&!Array.isArray(state.selection))throw new Error('Scene selection must be an array.');
      const ids=new Set();const imported=state.objects.map((source,i)=>{
        if(!source||typeof source!=='object')throw new Error('Invalid scene object '+i+'.');const id=String(source.id||'imported-'+i);if(id.length>160||['__proto__','constructor','prototype'].includes(id))throw new Error('Invalid scene object ID.');if(ids.has(id))throw new Error('Duplicate object ID: '+id);ids.add(id);
        for(const key of Object.keys(source))if(['__proto__','constructor','prototype'].includes(key))throw new Error('Unsafe scene property: '+key);
        const object={id,name:'Imported object '+(i+1),group:'Imported',kind:'box',x:0,y:0,width:100,height:80,depth:20,rotation:0,color:'#c7d8e4',locked:false};
        for(const key of ['name','group','kind','x','y','width','height','depth','rotation','cornerRadius','color','locked','points'])if(Object.prototype.hasOwnProperty.call(source,key))object[key]=clone(source[key]);
        for(const key of ['name','group']){if(typeof object[key]!=='string'||object[key].length>160)throw new Error('Invalid '+key+' for '+id+'.');}
        if(typeof object.color!=='string'||!/^#[0-9a-f]{6}$/i.test(object.color))throw new Error('Invalid color for '+id+'.');
        if(typeof object.locked!=='boolean')throw new Error('Invalid lock state for '+id+'.');
        if(!['box','circle','polyline'].includes(object.kind))throw new Error('Unsupported geometry kind: '+object.kind);
        for(const key of ['x','y','width','height','depth','rotation']){object[key]=Number(object[key]);if(!Number.isFinite(object[key])||Math.abs(object[key])>1e9)throw new Error('Invalid '+key+' for '+id+'.');}object.width=Math.max(1,object.width);object.height=Math.max(1,object.height);object.depth=Math.max(0,object.depth);
        if(object.cornerRadius!==undefined){object.cornerRadius=Number(object.cornerRadius);if(!Number.isFinite(object.cornerRadius)||object.cornerRadius<0)throw new Error('Invalid corner radius.');}
        if(object.kind==='polyline'){if(!Array.isArray(object.points)||object.points.length<2||object.points.length>10000)throw new Error('A polyline requires between 2 and 10,000 points.');object.points=object.points.map(p=>{if(!p||!Number.isFinite(Number(p.x))||!Number.isFinite(Number(p.y)))throw new Error('Invalid polyline point.');return{x:Number(p.x),y:Number(p.y)};});}return object;
      });
      const before=snapshot();cancelSilently();objects=imported;selected=(state.selection||[]).filter(id=>ids.has(id));
      const componentKeys=new Set();subSelection=(Array.isArray(state.subSelection)?state.subSelection:[]).slice(0,10000).flatMap(part=>{
        if(!part||!ids.has(part.objectId)||!['face','edge','vertex'].includes(part.kind)||!Number.isInteger(part.index)||part.index<0)return[];
        const object=objects.find(o=>o.id===part.objectId),g=geometry(object),list=part.kind==='face'?g.faces:part.kind==='edge'?g.edges:g.vertices;
        if(part.index>=list.length)return[];const key=part.objectId+':'+part.kind+':'+part.index;if(componentKeys.has(key))return[];componentKeys.add(key);
        return[{key,objectId:part.objectId,kind:part.kind,index:part.index}];
      });
      selected=Array.from(new Set(selected.concat(subSelection.map(part=>part.objectId))));
      pivotOverride=state.pivot&&Number.isFinite(state.pivot.x)&&Number.isFinite(state.pivot.y)?clone(state.pivot):null;
      if(state.camera&&Number.isFinite(state.camera.x)&&Number.isFinite(state.camera.y)&&Number.isFinite(state.camera.zoom))camera={x:state.camera.x,y:state.camera.y,zoom:clamp(state.camera.zoom,.18,7),orbit:validNumber(state.camera.orbit,0)};
      idSequence=Math.max(idSequence,validNumber(state.idSequence,1));commit(before,'Imported scene restored.');emit('restore','Imported scene restored.');requestDraw();
    }
    function on(target,event,handler,opts){target.addEventListener(event,handler,opts);listeners.push(()=>target.removeEventListener(event,handler,opts));}
    canvas.tabIndex=0;canvas.setAttribute('aria-label','Interactive geometry scene. Click to focus. Shift adds selection, Ctrl removes, Escape cancels, Ctrl Z undoes.');canvas.style.touchAction='none';
    on(canvas,'pointerdown',down);on(canvas,'pointermove',move);on(canvas,'pointerup',up);on(canvas,'pointercancel',cancel);on(canvas,'pointerleave',leave);on(canvas,'dblclick',doubleClick);on(canvas,'wheel',wheel,{passive:false});on(canvas,'contextmenu',e=>e.preventDefault());on(doc,'keydown',keydown);on(doc,'keyup',keyup);
    let resizeObserver=null;if(typeof ResizeObserver!=='undefined'){resizeObserver=new ResizeObserver(resize);resizeObserver.observe(canvas);}else on(window,'resize',resize);
    resize();setCase(caseStudy);
    return {setCase,setSettings,reset,undo,redo,getObjects:()=>clone(objects),getSelection:()=>selected.slice(),getGroups:()=>Array.from(new Set(objects.map(o=>o.group))),setSelection,updateObjects,serialize,restore,
      destroy(){disposed=true;cancelSilently();listeners.forEach(remove=>remove());if(resizeObserver)resizeObserver.disconnect();if(raf)cancelAnimationFrame(raf);clearTimeout(hoverTimer);clearTimeout(tooltipTimer);clearTimeout(trackTimer);}
    };
  }
  return {create,defaults:clone(DEFAULTS),geometry:{distance,pointSegment,inside,intersection,bounds,rotate},makeScene:scene};
});
