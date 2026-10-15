'use strict';

(() => {
  const Engine = window.ProgramBoard, Geo = window.ProgramIsoGeometry, Appearance = window.ProgramAppearance, Physics = window.ProgramIsoPhysics;
  const $ = id => document.getElementById(id), scene = $('scene'), overlay = $('overlay'), ground = $('ground');
  const ctx = overlay.getContext('2d'), floor = ground.getContext('2d');
  const KEY = 'program-board-v4', ISO_KEY = 'program-board-iso-v1';
  const DIRECTIONS = ['NW', 'NE', 'SE', 'SW'], ANGLES = [-Math.PI / 4, Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4];
  const PARAMS = new URLSearchParams(location.search);
  const EPHEMERAL = PARAMS.has('fresh') || PARAMS.has('demo');
  const MAX_HISTORY = 60;
  let model = null, shared = {}, view = {}, selected = new Set(), topMode = false, defaultMaterial = 'matte';
  let width = innerWidth, height = innerHeight, pixelRatio = Math.min(devicePixelRatio || 1, 2);
  let camera = { x: 0, y: 0, z: 0, scale: 4, direction: 'NE' }, angle = ANGLES[1], turn = null;
  let undoStack = [], redoStack = [], drag = null, spaceHeld = false, hover = null, lastHits = [], digIndex = 0;
  let scheduled = false, toastTimer = 0, rangeBefore = null, fileBusy = false, dropDepth = 0, saveTimer = 0;
  let gl = null, renderer = null, fallbackCtx = null, depthRange = 1000, projected = new Map(), gizmo = null;
  const meshes = new Map();
  let lastPhysics = 0, gravityActive = false, velocities = new Map(), interactionHandles = [], lastPointer = null, modifiers = {}, metaEditor = null, guides = [];
  let pendingShared = null;
  let dataDashboard = null;
  const live = () => model ? Engine.alive(model) : [];
  const selection = () => live().filter(s => selected.has(s.id));
  const thickness = s => Math.max(0.1, s.height || 8), elevation = s => Math.max(0, s.z || 0);
  const center = s => [s.x + s.w / 2, s.y + s.h / 2, elevation(s) + thickness(s) / 2];
  const color = s => Appearance ? Appearance.fillFor(model, s) : (s.color || '#d7a38a');
  const rgb = hex => /^#[0-9a-f]{6}$/i.test(hex || '') ? [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) : [0.84, 0.76, 0.70];
  const safe = (n, fallback) => Number.isFinite(n) ? n : fallback;
  const same = (list, value) => list.length && list.every(s => Math.abs(value(s) - value(list[0])) < 0.00001);
  function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3200); }
  function basis() { return Geo.axes(angle); }
  function project(point) {
    const b = basis(), p = [point[0] - camera.x, point[1] - camera.y, point[2] - camera.z];
    return { x: width / 2 + Geo.dot(p, b.right) * camera.scale, y: height / 2 - Geo.dot(p, b.up) * camera.scale, depth: Geo.dot(p, b.toward) };
  }
  function screenRay(x, y) {
    const b = basis(), sx = (x - width / 2) / camera.scale, sy = -(y - height / 2) / camera.scale;
    const origin = [camera.x, camera.y, camera.z].map((v, i) => v + b.right[i] * sx + b.up[i] * sy + b.toward[i] * depthRange);
    return { origin, direction: b.toward.map(v => -v) };
  }
  function onPlane(x, y, z) {
    const ray = screenRay(x, y), t = (z - ray.origin[2]) / ray.direction[2];
    return ray.origin.map((v, i) => v + ray.direction[i] * t);
  }
  function hitsAt(x, y) {
    const ray = screenRay(x, y);
    return live().map(s => { const hit = Geo.rayHit(ray.origin, ray.direction, s); return hit ? { ...hit, sticky: s } : null; }).filter(Boolean).sort((a, b) => a.t - b.t);
  }
  function snapshot() { return { board: model ? Engine.capture(model) : null, selected: [...selected], view: { ...view } }; }
  function remember(before) { undoStack.push(before || snapshot()); if (undoStack.length > MAX_HISTORY) undoStack.shift(); redoStack = []; }
  function restore(snap) { drag?.physics?.release(); drag = null; gravityActive = false; velocities.clear(); model = snap.board ? Engine.restore(snap.board) : null; selected = new Set(snap.selected); view = { ...snap.view }; lastHits = []; sync(); persist(); requestDraw(); }
  function mutate(fn) { const before = snapshot(); fn(); remember(before); changed(); }
  function changed() { sync(); persist(); requestDraw(); }
  function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); }
  function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); }
  function persist() {
    if (EPHEMERAL) return;
    clearTimeout(saveTimer);
    if (dataDashboard?.hasPendingEdits()) { persistSoon(); return; }
    try {
      view.isoDirection = camera.direction; view.isoCamera = { ...camera };
      const local = { ...shared, board: model ? Engine.capture(model) : null, view: { ...view } }, remote = window.ProgramModeState?.latest();
      let next = local;
      if (remote && shared.board && local.board) {
        if (remote.board.fileName !== shared.board.fileName && local.board.fileName === shared.board.fileName) next = remote;
        else if (remote.board.fileName === shared.board.fileName) next = window.ProgramModeState.reconcile(shared, local, remote);
      }
      pendingShared = null;
      const mergedBoard = next?.board && JSON.stringify(next.board) !== JSON.stringify(local.board);
      view = { ...(next?.view || view), isoDirection: camera.direction, isoCamera: { ...camera } };
      if (mergedBoard) { model = Engine.restore(next.board); selected = new Set([...selected].filter(id => live().some(s => s.id === id))); sync(); requestDraw(); }
      shared = next;
      if (shared.board) localStorage.setItem(KEY, JSON.stringify(shared));
      localStorage.setItem(ISO_KEY, JSON.stringify({ camera, autoStack: $('auto-stack').checked, labels: $('labels-on').checked }));
    } catch (err) { /* private storage and full quotas do not interrupt editing */ }
  }
  function applyShared(next) {
    if (!next?.board) return;
    if (drag || metaEditor || dataDashboard?.hasPendingEdits() || document.activeElement?.matches('input,textarea,select')) {
      pendingShared = next;
      if (dataDashboard?.hasPendingEdits()) persistSoon();
      return;
    }
    const local = { ...shared, board: model ? Engine.capture(model) : next.board, view }, merged = shared.board && shared.board.fileName === next.board.fileName ? window.ProgramModeState.reconcile(shared, local, next) : next;
    pendingShared = null; const newDocument = model?.fileName !== merged.board.fileName;
    // Keep the received snapshot as the merge baseline until persistence;
    // the displayed merge may already contain local edits absent remotely.
    model = Engine.restore(merged.board); shared = JSON.parse(JSON.stringify(next)); view = { ...merged.view, isoDirection: camera.direction, isoCamera: { ...camera } }; selected = new Set([...selected].filter(id => live().some(s => s.id === id))); gravityActive = false; velocities.clear(); sync(); if (newDocument) fit(); else requestDraw();
  }
  function finishMotion() {
    if (drag) endPointer({ clientX: drag.pointer?.x || 0, clientY: drag.pointer?.y || 0 });
    if (turn) {
      angle = turn.to;
      const finalBasis = basis();
      camera.x = turn.pivot[0] + finalBasis.right[0] * turn.offset;
      camera.y = turn.pivot[1] + finalBasis.right[1] * turn.offset;
      turn = null;
    }
    if (gravityActive) Physics.gravity(live(), 100000, new Set(), velocities);
    gravityActive = false; velocities.clear(); guides = []; spaceHeld = false;
    if (rangeBefore) { remember(rangeBefore); rangeBefore = null; }
    scene.style.cursor = 'default';
    requestDraw();
  }
  function flushEdits() {
    const saved = dataDashboard?.commitActive();
    if (saved && typeof saved.then === 'function') return saved.then(ok => ok === false ? false : flushEdits());
    if (saved === false) return false;
    if (document.activeElement?.matches('input:not([type=file]),textarea')) document.activeElement.blur();
    finishMotion();
    if (pendingShared) applyShared(pendingShared);
    persist();
    return true;
  }
  function editDashboard(operation) {
    if (!model) return false;
    finishMotion();
    const before = snapshot(), candidate = Engine.restore(before.board);
    const step = Number(view.gridStep) || 10;
    const params = target => Engine.setParams(target, Math.max(0, (Number(target.bufferMul) || 0) * step), target.fudge && view.grid ? step : 0, step, !!view.grid);
    params(candidate);
    const result = operation(candidate);
    if (result === 0 || result === false) return result;
    params(candidate);
    const old = new Map(model.stickies.map(sticky => [sticky.rowIndex, sticky]));
    const resized = Engine.alive(candidate).filter(sticky => {
      const previous = old.get(sticky.rowIndex);
      return !previous || Math.abs(sticky.w - previous.w) > 1e-7 || Math.abs(sticky.h - previous.h) > 1e-7;
    });
    if (resized.length) {
      const frame = candidate.frame;
      if (frame && resized.some(sticky => sticky.x < frame.x || sticky.y < frame.y || sticky.x + sticky.w > frame.x + frame.w || sticky.y + sticky.h > frame.y + frame.h)) {
        throw new Error('Those cell dimensions reach outside the frame. Enlarge the frame or use smaller values.');
      }
      if (!Physics.separate(Engine.alive(candidate), new Set(), { ...physicsOptions(), frame: frame, lines: candidate.lines })) {
        throw new Error('Those cell dimensions cannot fit inside this frame.');
      }
    }
    // Validate against a copy, then mutate the original rows so the shared
    // editor keeps its row references and an invalid edit changes nothing.
    operation(model); params(model);
    const placements = new Map(candidate.stickies.map(sticky => [sticky.rowIndex, sticky]));
    model.stickies.forEach(sticky => {
      const placement = placements.get(sticky.rowIndex);
      if (placement) { sticky.x = placement.x; sticky.y = placement.y; }
    });
    selected = new Set([...selected].filter(id => live().some(sticky => sticky.id === id)));
    lastHits = []; remember(before); changed();
    return true;
  }
  function persistSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 180); }
  function setSelection(ids) { selected = new Set(model ? Engine.expandToGroups(model, ids) : ids); sync(); requestDraw(); }
  function meshFor(s) {
    const h = thickness(s), radius = Geo.radiusFor(s.w, s.h, h, s.radius), key = [s.w, s.h, h, radius].map(v => v.toFixed(4)).join('/');
    if (!meshes.has(key)) {
      const mesh = Geo.mesh(s.w, s.h, h, radius, 5);
      if (gl && renderer) {
        mesh.positionBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, mesh.positionBuffer); gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
        mesh.normalBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normalBuffer); gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
      }
      meshes.set(key, mesh);
      // A long height drag should not leave hundreds of GPU meshes behind.
      if (meshes.size > 240) { const oldest = meshes.keys().next().value, old = meshes.get(oldest); if (gl) { gl.deleteBuffer(old.positionBuffer); gl.deleteBuffer(old.normalBuffer); } meshes.delete(oldest); }
    }
    return meshes.get(key);
  }
  function initRenderer() {
    renderer = window.ProgramIsoRenderer.create({ canvas: scene, ground, geometry: Geo, software: PARAMS.has('software') });
  }

  function convexHull(points) {
    points.sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [], upper = [];
    for (const p of points) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
    for (let i = points.length - 1; i >= 0; i--) { const p = points[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    lower.pop(); upper.pop(); return lower.concat(upper);
  }
  function silhouette(s, zOverride) {
    const mesh = meshFor(s), offset = center(s), points = [];
    for (let i = 0; i < mesh.positions.length; i += 3) points.push(project([mesh.positions[i] + offset[0], mesh.positions[i + 1] + offset[1], zOverride == null ? mesh.positions[i + 2] + offset[2] : zOverride]));
    return convexHull(points);
  }
  function path(context, points) { context.beginPath(); points.forEach((p, i) => i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y)); context.closePath(); }

  function arrow(a, b, color, label) {
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    const theta = Math.atan2(b.y - a.y, b.x - a.x); ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - Math.cos(theta - 0.45) * 9, b.y - Math.sin(theta - 0.45) * 9); ctx.lineTo(b.x - Math.cos(theta + 0.45) * 9, b.y - Math.sin(theta + 0.45) * 9); ctx.closePath(); ctx.fill();
    if (label) { ctx.font = '10px "Segoe UI",sans-serif'; ctx.fillText(label, b.x + 9, b.y + 3); }
  }
  function drawGizmo() {
    const s = selection()[0]; gizmo = null; if (!s || turn) return;
    const anchor = project([s.x + s.w / 2, s.y + s.h / 2, elevation(s) + thickness(s)]), top = { x: anchor.x, y: anchor.y - 68 };
    const origin = project([s.x + s.w / 2, s.y + s.h / 2, elevation(s)]), bx = project([s.x + s.w / 2 + 1, s.y + s.h / 2, elevation(s)]), by = project([s.x + s.w / 2, s.y + s.h / 2 + 1, elevation(s)]);
    const x = { x: origin.x + (bx.x - origin.x) / camera.scale * 50, y: origin.y + (bx.y - origin.y) / camera.scale * 50 }, y = { x: origin.x + (by.x - origin.x) / camera.scale * 50, y: origin.y + (by.y - origin.y) / camera.scale * 50 };
    ctx.save(); ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 4;
    if (!topMode) { arrow(origin, x, '#c6746f', 'X'); arrow(origin, y, '#719b7d', 'Y'); }
    arrow(anchor, top, '#5c91c4', 'Z'); ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(anchor.x, anchor.y, 5, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = '#5c91c4'; ctx.lineWidth = 1.5; ctx.stroke();
    const label = `${topMode ? 'H' : 'Z'} ${Number((topMode ? thickness(s) : elevation(s)).toFixed(1))} ft`;
    ctx.font = '10px "Segoe UI",sans-serif'; const tw = ctx.measureText(label).width;
    ctx.fillStyle = '#fffffff2'; ctx.beginPath(); ctx.roundRect(top.x - tw / 2 - 8, top.y - 27, tw + 16, 19, 8); ctx.fill(); ctx.fillStyle = '#577da1'; ctx.fillText(label, top.x - tw / 2, top.y - 14); ctx.restore();
    gizmo = { anchor, top, origin, x, y, label: { x: top.x - tw / 2 - 8, y: top.y - 27, w: tw + 16, h: 19 } };
  }
  function isVisibleRoof(s) {
    const p = project([s.x + s.w / 2, s.y + s.h / 2, elevation(s) + thickness(s) + 0.001]);
    if (p.x < 0 || p.x > width || p.y < 0 || p.y > height) return false;
    const hit = hitsAt(p.x, p.y)[0]; return !hit || hit.sticky.id === s.id;
  }
  function isoFrame() {
    const f = model?.frame;
    if (!f) return null;
    const polygon = [[f.x,f.y],[f.x+f.w,f.y],[f.x+f.w,f.y+f.h],[f.x,f.y+f.h]].map(p => project([p[0],p[1],0]));
    return { polygon, x:Math.min(...polygon.map(p=>p.x)), y:Math.min(...polygon.map(p=>p.y)), w:Math.max(...polygon.map(p=>p.x))-Math.min(...polygon.map(p=>p.x)), h:Math.max(...polygon.map(p=>p.y))-Math.min(...polygon.map(p=>p.y)) };
  }
  function drawLabels(list) {
    const frame = isoFrame();
    if (frame) { ctx.save(); path(ctx,frame.polygon);ctx.strokeStyle='#99a4ac70';ctx.lineWidth=0.7;ctx.stroke();ctx.restore(); }
    if (!$('labels-on').checked) return;
    const points = [];
    for (const s of list) {
      const p=project([s.x+s.w/2,s.y+s.h/2,elevation(s)+thickness(s)]),name=Engine.nameOf(model,s)||'';
      if (!name || !isVisibleRoof(s)) continue;
      const roofWidth=Math.min(s.w,s.h)*camera.scale*0.82;
      points.push({id:s.id,x:p.x-roofWidth/2,y:p.y-roofWidth/3,w:roofWidth,h:roofWidth*2/3,text:name,meta:s});
    }
    const leaders=window.ProgramLeaders && frame && Number(view.leaderThreshold)>0
      ? window.ProgramLeaders.layout(points,{width,height},{threshold:Number(view.leaderThreshold),frame,polygon:frame.polygon,labelWidth:130,labelHeight:22,margin:9,top:10,bottom:10,gap:27}) : {items:[]};
    const external=new Set(leaders.items.map(item=>item.id));
    ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';
    for (const p of points) {
      if (external.has(p.id)) continue;
      const s=p.meta, style=Engine.textStyleOf(s,view), font=style.face==='mono'?'Consolas,monospace':style.face==='sans'?'system-ui,sans-serif':"'Replica Std','Segoe UI',sans-serif";
      const available=p.w*0.88, maximum=Math.max(0.5,Math.min(p.w*0.105,p.h*0.3)) * style.scale;
      let size=maximum;ctx.font=size+'px '+font;
      while(size>maximum*0.35&&ctx.measureText(p.text).width>available){size*=0.92;ctx.font=size+'px '+font;}
      const fill=rgb(color(s)),luminance=fill[0]*.299+fill[1]*.587+fill[2]*.114;
      ctx.fillStyle=s.textColor||view.textColor||(luminance<.38?'#ffffffef':'#404442df');
      ctx.fillText(p.text,p.x+p.w/2,p.y+p.h/2);
      if(p.h>55&&available>90){ctx.font=(size*.5)+'px '+font;ctx.fillStyle='#606561a8';ctx.fillText(Math.round(Engine.trueArea(s)).toLocaleString('en-US')+' sf',p.x+p.w/2,p.y+p.h/2+size*.82);}
    }
    for(const item of leaders.items){
      const b=item.label;ctx.strokeStyle='#77838b8c';ctx.lineWidth=.75;ctx.beginPath();ctx.moveTo(item.anchor.x,item.anchor.y);ctx.lineTo(item.elbow.x,item.elbow.y);ctx.lineTo(item.end.x,item.end.y);ctx.stroke();
      ctx.fillStyle='#fffffff0';ctx.fillRect(b.x-3,b.y-2,b.w+6,b.h+4);ctx.textAlign=item.side==='left'?'right':'left';const x=item.side==='left'?b.x+b.w:b.x;
      ctx.font='11px "Segoe UI",sans-serif';let text=item.text;while(text.length>1&&ctx.measureText(text).width>b.w)text=text.slice(0,-2)+'…';
      ctx.fillStyle='#414844';ctx.fillText(text,x,b.y+6);ctx.font='9px "Segoe UI",sans-serif';ctx.fillStyle='#858c87';ctx.fillText(Math.round(Engine.trueArea(item.source.meta)).toLocaleString('en-US')+' sf',x,b.y+18);
    }
    ctx.restore();
  }
  function draw(time) {
    scheduled = false;
    tickPhysics(time);
    if (turn) {
      const t = Math.min(1, (time - turn.start) / 240), ease = 1 - Math.pow(1 - t, 3); angle = turn.from + (turn.to - turn.from) * ease;
      const turningBasis = basis(); camera.x = turn.pivot[0] + turningBasis.right[0] * turn.offset; camera.y = turn.pivot[1] + turningBasis.right[1] * turn.offset;
      if (t === 1) { angle = turn.to; turn = null; persistSoon(); } else requestDraw();
    }
    const list = live(); const fills = Appearance && Appearance.prepare ? Appearance.prepare(model || { stickies: [] }) : null;
    depthRange = Math.max(1000, ...list.map(s => Math.hypot(...center(s)) + s.w + s.h + thickness(s) + Math.hypot(camera.x, camera.y, camera.z))) * 2;
    projected = new Map();
    for (const s of list) {
      const corners = []; for (const x of [s.x, s.x + s.w]) for (const y of [s.y, s.y + s.h]) for (const z of [elevation(s), elevation(s) + thickness(s)]) corners.push(project([x, y, z]));
      projected.set(s.id, { x: Math.min(...corners.map(p => p.x)), y: Math.min(...corners.map(p => p.y)), w: Math.max(...corners.map(p => p.x)) - Math.min(...corners.map(p => p.x)), h: Math.max(...corners.map(p => p.y)) - Math.min(...corners.map(p => p.y)) });
    }
    ctx.clearRect(0, 0, width, height);
    renderer.render({ list, camera, basis: basis(), width, height, selected, topMode, fills, view, hover, frame: model?.frame, active: !!(drag || turn) });
    for (const s of selection()) { ctx.save(); path(ctx, silhouette(s)); ctx.strokeStyle = '#318b7fb0'; ctx.lineWidth = 1.2; if (topMode) ctx.setLineDash([3, 3]); ctx.stroke(); ctx.restore(); }
    if (hover && !selected.has(hover.id) && !drag) { path(ctx, silhouette(hover)); ctx.strokeStyle = '#899cae75'; ctx.lineWidth = 1; ctx.stroke(); }
    drawLabels(list); drawGizmo(); drawInteractionOverlay();
    $('status').textContent = `Isometric · ${camera.direction}${turn ? ' · rotating' : ''}\n${topMode ? 'Top-face selection' : 'Ground plane'} · ${Math.round(camera.scale * 100)}%`;
  }
  function requestDraw() { if (!scheduled) { scheduled = true; requestAnimationFrame(draw); } }
  function inspectorWidth() { return 0; }
  function resize() {
    width = innerWidth; height = innerHeight; pixelRatio = Math.min(devicePixelRatio || 1, 2);
    [scene, ground, overlay, ...(fallbackCtx && fallbackCtx.canvas !== scene ? [fallbackCtx.canvas] : [])].forEach(c => { c.width = Math.round(width * pixelRatio); c.height = Math.round(height * pixelRatio); });
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0); floor.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0); requestDraw();
    renderer?.resize(width, height, pixelRatio);
  }
  function fit() {
    const list = live(); if (!list.length) return;
    const corners = [];
    list.forEach(s => { for (const x of [s.x, s.x + s.w]) for (const y of [s.y, s.y + s.h]) for (const z of [elevation(s), elevation(s) + thickness(s)]) corners.push([x, y, z]); });
    const b = basis(), right = corners.map(p => Geo.dot(p, b.right)), up = corners.map(p => Geo.dot(p, b.up));
    const minR = Math.min(...right), maxR = Math.max(...right), minU = Math.min(...up), maxU = Math.max(...up), usableW = Math.max(100, width - inspectorWidth() - 100), usableH = Math.max(120, height - 180);
    camera.scale = Geo.clamp(Math.min(usableW / Math.max(20, maxR - minR), usableH / Math.max(20, maxU - minU)), 0.025, 40);
    const r = (minR + maxR) / 2 + inspectorWidth() / 2 / camera.scale, u = (minU + maxU) / 2;
    camera.x = b.right[0] * r + b.up[0] * u; camera.y = b.right[1] * r + b.up[1] * u; camera.z = b.up[2] * u;
    persistSoon(); requestDraw();
  }
  function zoom(factor, x = (width - inspectorWidth()) / 2, y = height / 2) {
    const b = basis(), before = [(x - width / 2) / camera.scale, -(y - height / 2) / camera.scale]; camera.scale = Geo.clamp(camera.scale * factor, 0.025, 40);
    const after = [(x - width / 2) / camera.scale, -(y - height / 2) / camera.scale];
    camera.x += b.right[0] * (before[0] - after[0]) + b.up[0] * (before[1] - after[1]); camera.y += b.right[1] * (before[0] - after[0]) + b.up[1] * (before[1] - after[1]); camera.z += b.up[2] * (before[1] - after[1]); persistSoon(); requestDraw();
  }
  function rotate(direction, explicitStep) {
    if (!DIRECTIONS.includes(direction)) return; const target = ANGLES[DIRECTIONS.indexOf(direction)];
    let delta = target - angle; while (delta > Math.PI) delta -= Math.PI * 2; while (delta < -Math.PI) delta += Math.PI * 2;
    if (explicitStep) delta = explicitStep * Math.PI / 2;
    if (Math.abs(delta) < 0.001) return;
    // Rotate about the visual board center, rather than the offset camera
    // center, so the inspector does not shove the program during a turn.
    const oldB = basis(), offset = inspectorWidth() / 2 / camera.scale, pivot = [camera.x - oldB.right[0] * offset, camera.y - oldB.right[1] * offset, camera.z];
    turn = { from: angle, to: angle + delta, start: performance.now(), pivot, offset }; camera.direction = direction; sync(); requestDraw();
  }
  function rotateStep(step) { const idx = DIRECTIONS.indexOf(camera.direction); rotate(DIRECTIONS[(idx + step + 4) % 4], step); }
  function setTopMode(enabled) { topMode = !!enabled; sync(); requestDraw(); }
  function sync() {
    const list = selection(), count = live().length, first = list[0], enabled = !!first;
    $('empty').hidden = count > 0; $('src-name').textContent = model ? model.fileName || 'Program' : 'Open program'; $('selection-count').textContent = list.length ? `${list.length} selected / ${count}` : `${count} cells`;
    $('inspector-title').textContent = list.length > 1 ? `${list.length} cells` : first ? (topMode ? 'Top face' : 'Selected cell') : 'Isometric cells';
    $('selection-help').textContent = first ? (topMode ? 'Drag the blue Z arrow to extrude the top face.' : 'Drag to move. The blue Z arrow lifts the whole cell.') : 'Select a cell to edit. Drag to move in the ground plane.';
    $('tool-object').setAttribute('aria-pressed', String(!topMode)); $('tool-face').setAttribute('aria-pressed', String(topMode));
    ['cell-name', 'cell-height', 'cell-z', 'cell-radius', 'radius-slider', 'cell-color', 'gradient-on', 'gradient-start', 'gradient-end', 'stack', 'ground-selected', 'duplicate'].forEach(id => { $(id).disabled = !enabled; });
    $('cell-name').disabled = list.length !== 1;
    if (document.activeElement !== $('cell-name')) $('cell-name').value = list.length === 1 ? Engine.nameOf(model, first) : list.length > 1 ? 'Multiple cells' : '';
    [['cell-height', thickness], ['cell-z', elevation], ['cell-radius', s => Geo.radiusFor(s.w, s.h, thickness(s), s.radius)]].forEach(([id, read]) => {
      if (document.activeElement !== $(id)) $(id).value = same(list, read) ? Number(read(first).toFixed(3)) : '';
      $(id).placeholder = list.length > 1 ? 'Mixed' : '—';
    });
    const maxRadius = enabled ? Math.min(...list.map(s => Math.min(s.w, s.h, thickness(s)) / 2)) : 4;
    $('cell-radius').max = maxRadius; $('radius-slider').max = maxRadius;
    if (document.activeElement !== $('radius-slider')) $('radius-slider').value = first ? Geo.radiusFor(first.w, first.h, thickness(first), first.radius) : 0;
    $('cell-color').value = first ? color(first) : '#d7a38a';
    const ramp = Appearance && Appearance.commonGradient && enabled ? Appearance.commonGradient(model, list) : null;
    $('gradient-on').checked = !!ramp; if (ramp) { $('gradient-start').value = ramp.start; $('gradient-end').value = ramp.end; }
    document.querySelectorAll('[data-material]').forEach(button => button.setAttribute('aria-pressed', String(first ? list.every(s => (s.material || 'matte') === button.dataset.material) : defaultMaterial === button.dataset.material)));
    $('appearance-note').textContent = first ? ({ matte: 'Soft, diffuse surface.', ceramic: 'White ceramic · soft studio finish.', glossy: 'Polished surface with broad reflections.', jelly: 'A translucent, gummy solid.', glass: 'Frosted translucency with a fine grain.' }[first.material || 'matte']) : 'Choose a material for your next sticky.';
    $('leaders').value = Number(view.leaderThreshold) || 0; $('leaders-value').textContent = Number(view.leaderThreshold) ? `< ${view.leaderThreshold}px` : 'Off';
    document.querySelectorAll('[data-direction]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.direction === camera.direction)));
    $('undo').disabled = !undoStack.length; $('redo').disabled = !redoStack.length; $('save').disabled = !model?.rows.length;
    $('dig-section').hidden = lastHits.length < 2;
    $('dig-list').replaceChildren(); lastHits.slice(0, 8).forEach((hit, i) => { const button = document.createElement('button'); button.textContent = `${i + 1}. ${Engine.nameOf(model, hit.sticky)} · ${Number(elevation(hit.sticky).toFixed(1))} ft`; button.classList.toggle('active', selected.has(hit.sticky.id)); button.addEventListener('click', () => { digIndex = i; setSelection([hit.sticky.id]); }); $('dig-list').append(button); });
    if ($('cell-area')) { $('cell-area').disabled = list.length !== 1; if (document.activeElement !== $('cell-area')) $('cell-area').value = first ? Number(Engine.trueArea(first).toFixed(2)) : ''; }
    if ($('cell-locked')) { $('cell-locked').disabled = !enabled; $('cell-locked').checked = enabled && list.every(s => s.locked); }
    if ($('group-selected')) $('group-selected').disabled = list.length < 2;
    if ($('ungroup-selected')) $('ungroup-selected').disabled = !list.some(s => s.group);
    if ($('delete-selected')) $('delete-selected').disabled = !enabled;
    if ($('grid')) $('grid').setAttribute('aria-pressed', String(!!view.grid));
    $('src-data').disabled = !model;
    syncMetadata(); window.ProgramIsoUI?.refresh(); dataDashboard?.refresh();
  }
  function newCell(x, y) {
    if (live().length >= Engine.MAX_STICKIES) { toast('This board is limited to ' + Engine.MAX_STICKIES + ' cells.'); return; }
    const before = snapshot();
    if (!model) {
      model = Engine.modelFromCsv('Name,Area\nUntitled,400\n', 'untitled.csv'); model.stickies[0].x = 0; model.stickies[0].y = 0;
      const s = model.stickies[0]; s.height = 1.4; s.z = 0; s.material = defaultMaterial; s.color = '#d7a38a'; s.radius = 0.7; selected = new Set([s.id]);
      remember(before); changed(); fit(); return;
    }
    const fields = Object.fromEntries(model.columns.map(k => [k, ''])); fields[model.nameKey] = 'Untitled'; fields[model.areaKey] = '400';
    const rowIndex = model.rows.length; model.rows.push({ id: Engine.uid('r'), fields, dropped: false });
    const point = Number.isFinite(x) && Number.isFinite(y) ? onPlane(x, y, 0) : onPlane((width - inspectorWidth()) / 2, height / 2, 0);
    const s = { id: Engine.uid('s'), rowIndex, x: point[0] - 10, y: point[1] - 10, w: 20, h: 20, tw: 20, th: 20, height: 1.4, z: 0, material: defaultMaterial, color: '#d7a38a', radius: 0.7, stroke: 0, shadow: 0, group: null, textFace: null, textScale: null, textColor: null, dragging: false, dragTarget: null, passId: null };
    model.stickies.push(s); selected = new Set([s.id]); remember(before); changed();
  }
  function duplicate() {
    const list = selection(); if (!list.length) return; const before = snapshot();
    const copies = Engine.duplicateStickies(model, list.map(s => s.id)); if (!copies) { toast('Too many cells to duplicate.'); return; }
    copies.forEach(s => { s.passId = null; });
    if (!Physics.separate(live(), new Set(list.map(s => s.id)), physicsOptions())) { restore(before); toast('There is no room for a duplicate inside this frame.'); return; }
    selected = new Set(copies.map(s => s.id)); remember(before); gravityActive = true; changed();
  }
  const overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  function supportFor(s, excluded) {
    return live().filter(other => !excluded.has(other.id) && overlapArea(s, other) >= Math.min(s.w * s.h, other.w * other.h) * 0.25).sort((a, b) => (elevation(b) + thickness(b)) - (elevation(a) + thickness(a)))[0];
  }
  function stackSelected() {
    const list = selection(); if (!list.length) return;
    if (list.length === 1) { const support = supportFor(list[0], selected); if (!support) { toast('Move this cell over another cell, or select several cells to stack.'); return; } mutate(() => { list[0].z = elevation(support) + thickness(support); }); return; }
    mutate(() => { const ordered = list.slice().sort((a, b) => elevation(a) - elevation(b) || b.w * b.h - a.w * a.h), first = ordered[0], cx = first.x + first.w / 2, cy = first.y + first.h / 2; let z = elevation(first); for (const s of ordered) { s.x = cx - s.w / 2; s.y = cy - s.h / 2; s.z = z; z += thickness(s); } });
    toast('Stacked ' + list.length + ' cells. Alt+click digs through the stack.');
  }
  function removeSelected() { if (!selection().length) return; mutate(() => { for (const s of selection()) Engine.dropSticky(model, s); selected.clear(); lastHits = []; }); }
  function stackState() { return live().map(s => ({ id: s.id, x: s.x, y: s.y, w: s.w, h: s.h, z: elevation(s), height: thickness(s) })); }
  function applyVertical(before, desired, key) {
    const originalPairs = new Set(); for (let i = 0; i < before.length; i++) for (let j = i + 1; j < before.length; j++) if (Physics.intersects(before[i], before[j])) originalPairs.add([before[i].id, before[j].id].sort().join('/'));
    const current = live(), byId = new Map(before.map(s => [s.id, s]));
    function apply(fraction) {
      current.forEach(s => { const old = byId.get(s.id); if (old) { s.z = old.z; s.height = old.height; if (desired.has(s.id)) s[key] = old[key] + (desired.get(s.id) - old[key]) * fraction; } });
      Geo.followSupports(current, before, key === 'z' ? new Set(desired.keys()) : new Set());
      for (const s of current) { const old = byId.get(s.id); if (old && Physics.locked(s) && (Math.abs(elevation(s) - old.z) > 0.00001 || Math.abs(thickness(s) - old.height) > 0.00001)) return false; }
      for (let i = 0; i < current.length; i++) for (let j = i + 1; j < current.length; j++) if (!originalPairs.has([current[i].id, current[j].id].sort().join('/')) && Physics.intersects(current[i], current[j])) return false;
      return true;
    }
    if (apply(1)) return; let lo = 0, hi = 1; for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (apply(mid)) lo = mid; else hi = mid; } apply(lo);
  }
  function editVertical(key, value) { applyVertical(stackState(), new Map(selection().map(s => [s.id, value])), key); }
  function physicsOptions(mode = 'normal') { return { mode, gap: Math.max(0, (Number(model?.bufferMul) || 0) * (Number(view.gridStep) || 10)), frame: model?.frame || null, lines: model?.lines || [], hopping: $('auto-stack').checked, maxSpeed: 240 }; }
  function dragMode(e) { return (e.ctrlKey || e.metaKey) ? e.shiftKey ? 'ghost' : 'isolate' : 'normal'; }
  function capturePointer(e) { try { scene.setPointerCapture(e.pointerId); } catch (err) { /* synthetic QA events have no captured pointer */ } }
  function tickPhysics(time) {
    const dt = Math.min(0.04, Math.max(1 / 240, lastPhysics ? (time - lastPhysics) / 1000 : 1 / 60)); lastPhysics = time;
    if (drag?.physics && drag.moved) { const result = drag.physics.step(dt); drag.pressure = result.pressure; drag.hop = result.hop; drag.carried = result.carried; sync(); requestDraw(); }
    if (gravityActive) { const held = drag ? Physics.supporters(live(), selected) : new Set(); gravityActive = Physics.gravity(live(), dt, held, velocities); if (gravityActive) requestDraw(); else { sync(); persistSoon(); } }
  }
  function roofHandles() {
    const s = selection().length === 1 ? selection()[0] : null; if (!s || topMode || Physics.locked(s) || turn) return [];
    const top = elevation(s) + thickness(s), x = s.x, y = s.y, w = s.w, h = s.h;
    const handles = [['nw', x, y], ['ne', x + w, y], ['se', x + w, y + h], ['sw', x, y + h], ['n', x + w / 2, y], ['e', x + w, y + h / 2], ['s', x + w / 2, y + h], ['w', x, y + h / 2]].map(([edge, wx, wy]) => ({ kind: 'resize', edge, s, ...project([wx, wy, top]) }));
    const r = Geo.radiusFor(w, h, thickness(s), s.radius); handles.push({ kind: 'fillet', s, ...project([x + Math.max(r, 7 / camera.scale), y, top]) }); return handles;
  }
  function hitRoofHandle(p) { return roofHandles().slice().reverse().find(handle => Math.hypot(p.x - handle.x, p.y - handle.y) <= (handle.kind === 'fillet' ? 6 : 7)); }
  function drawInteractionOverlay() {
    interactionHandles = roofHandles(); ctx.save();
    for (const handle of interactionHandles) { ctx.beginPath(); if (handle.kind === 'fillet') ctx.arc(handle.x, handle.y, 3.5, 0, Math.PI * 2); else ctx.rect(handle.x - 2.5, handle.y - 2.5, 5, 5); ctx.fillStyle = '#ffffff'; ctx.strokeStyle = handle.kind === 'fillet' ? '#e0a95b' : '#3b9487'; ctx.lineWidth = 1; ctx.fill(); ctx.stroke(); }
    if (drag?.kind === 'marquee') { const r = { x: Math.min(drag.start.x, drag.pointer.x), y: Math.min(drag.start.y, drag.pointer.y), w: Math.abs(drag.start.x - drag.pointer.x), h: Math.abs(drag.start.y - drag.pointer.y) }; ctx.fillStyle = '#3c9d8910'; ctx.strokeStyle = '#3b9687a0'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.fillRect(r.x, r.y, r.w, r.h); ctx.strokeRect(r.x, r.y, r.w, r.h); ctx.setLineDash([]); }
    if (drag?.pressure?.ratio > 0 && drag.cells?.[0]) { const s = drag.cells[0].s, p = project([s.x + s.w / 2, s.y + s.h / 2, elevation(s) + thickness(s)]); ctx.beginPath(); ctx.arc(p.x, p.y - 15, 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * drag.pressure.ratio); ctx.strokeStyle = '#489a8b'; ctx.lineWidth = 2; ctx.stroke(); }
    for (const guide of guides) { const a = project(guide.a), b = project(guide.b); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.strokeStyle = '#5e9b8c70'; ctx.lineWidth = 0.7; ctx.setLineDash([3, 4]); ctx.stroke(); } ctx.restore();
  }
  function snapTarget(dx, dy) {
    guides = []; const anchor = drag.cells[0], s = anchor.s;
    if (view.grid) { const snapped = Engine.snapDelta(anchor.x + dx, anchor.y + dy, s.w, s.h, Number(view.gridStep) || 10); if (drag.axis !== 'y') dx += snapped.dx; if (drag.axis !== 'x') dy += snapped.dy; }
    else {
      const tolerance = 5 / camera.scale, others = live().filter(q => !drag.cells.some(c => c.s.id === q.id) && Math.abs(elevation(q) - elevation(s)) < 0.1);
      for (const axis of ['x', 'y']) {
        if (axis === 'x' && drag.axis === 'y' || axis === 'y' && drag.axis === 'x') continue;
        const size = axis === 'x' ? 'w' : 'h', base = (axis === 'x' ? anchor.x + dx : anchor.y + dy), edges = [base, base + s[size] / 2, base + s[size]]; let best = tolerance, adjustment = 0, guide = null;
        for (const q of others) for (const edge of [q[axis], q[axis] + q[size] / 2, q[axis] + q[size]]) for (const own of edges) if (Math.abs(edge - own) < best) { best = Math.abs(edge - own); adjustment = edge - own; guide = axis === 'x' ? { a: [edge, Math.min(s.y, q.y) - 4, elevation(s)], b: [edge, Math.max(s.y + s.h, q.y + q.h) + 4, elevation(s)] } : { a: [Math.min(s.x, q.x) - 4, edge, elevation(s)], b: [Math.max(s.x + s.w, q.x + q.w) + 4, edge, elevation(s)] }; }
        if (axis === 'x') dx += adjustment; else dy += adjustment; if (guide) guides.push(guide);
      }
    }
    return { dx, dy };
  }
  function editMetadata(kind = 'name', sticky = selection()[0]) {
    if (!sticky) return; metaEditor?.remove(); const input = document.createElement('input'); input.id = 'iso-inline-edit'; input.type = kind === 'area' ? 'number' : 'text';
    const p = project([sticky.x + sticky.w / 2, sticky.y + sticky.h / 2, elevation(sticky) + thickness(sticky)]), field = kind === 'area' ? model.areaKey : model.nameKey;
    input.value = kind === 'area' ? String(Engine.trueArea(sticky)) : Engine.nameOf(model, sticky); input.setAttribute('aria-label', kind === 'area' ? 'Cell area in square feet' : 'Cell name'); input.style.cssText = `position:fixed;left:${Math.max(8, Math.min(width - 210, p.x - 100))}px;top:${Math.max(8, p.y - 15)}px;width:200px;padding:7px 10px;border:1px solid #4a9e8e;border-radius:10px;background:#fff;box-shadow:var(--shadow);z-index:60;font:12px var(--font)`; document.body.append(input); metaEditor = input;
    let done = false; function finish(commit) { if (done) return; done = true; if (commit && input.value.trim()) mutate(() => Engine.setField(model, [sticky.id], field, input.value.trim())); input.remove(); metaEditor = null; }
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') finish(false); }); input.addEventListener('blur', () => finish(true)); input.focus(); input.select();
  }
  function groupSelection(ungroup = false) { if (!selection().length) return; mutate(() => { if (ungroup || selection().every(s => s.group && s.group === selection()[0].group)) Engine.ungroupStickies(model, selected); else Engine.groupStickies(model, selected); }); }
  function editField(key, value) {
    if (!model || !selection().length) return; const before = snapshot(); Engine.setField(model, selected, key, value);
    if (key === model.areaKey && !Physics.separate(live(), selected, physicsOptions())) { restore(before); toast('The area cannot fit inside this frame.'); return; }
    selected = new Set([...selected].filter(id => live().some(s => s.id === id))); remember(before); changed();
  }
  function syncMetadata() {
    const box = $('metadata-fields'); if (!box) return; const columns = (model?.columns || []).filter(key => key !== model.nameKey && key !== model.areaKey), signature = JSON.stringify(columns);
    if (box.dataset.fields !== signature) {
      box.dataset.fields = signature; box.replaceChildren();
      for (const key of columns) { const label = document.createElement('label'), input = document.createElement('input'); label.className = 'field'; label.textContent = key; input.type = 'text'; input.dataset.field = key; input.setAttribute('aria-label', key); input.addEventListener('change', () => editField(key, input.value)); label.append(input); box.append(label); }
    }
    box.querySelectorAll('[data-field]').forEach(input => { input.disabled = !selection().length; const common = model ? Engine.commonField(model, selected, input.dataset.field) : { value: '', mixed: false }; if (document.activeElement !== input) input.value = common.value || ''; input.placeholder = common.mixed ? 'Mixed' : ''; });
  }
  function exportPng() {
    requestDraw(); requestAnimationFrame(() => requestAnimationFrame(() => { const image = document.createElement('canvas'); image.width = scene.width; image.height = scene.height; const painter = image.getContext('2d'); painter.drawImage(ground, 0, 0); painter.drawImage(scene, 0, 0); if ($('fallback-surface')) painter.drawImage($('fallback-surface'), 0, 0); painter.drawImage(overlay, 0, 0); image.toBlob(blob => { if (!blob) return; const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = Engine.baseName(model?.fileName || 'program') + '-isometric.png'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }); }));
  }
  function updateMarquee() {
    const p = drag.pointer, r = { x: Math.min(p.x, drag.start.x), y: Math.min(p.y, drag.start.y), w: Math.abs(p.x - drag.start.x), h: Math.abs(p.y - drag.start.y) }, ids = new Set(drag.base);
    for (const s of live()) { const b = projected.get(s.id); if (b && b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y) Engine.expandToGroups(model, [s.id]).forEach(id => ids.add(id)); } selected = ids;
  }
  function distanceToSegment(p, a, b) { const dx = b.x - a.x, dy = b.y - a.y, t = Geo.clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1); return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); }
  function gizmoHit(p) {
    if (!gizmo) return null; const g = gizmo;
    if (p.x >= g.label.x && p.x <= g.label.x + g.label.w && p.y >= g.label.y && p.y <= g.label.y + g.label.h) return 'number';
    if (distanceToSegment(p, g.anchor, g.top) < 9 && Math.hypot(p.x - g.anchor.x, p.y - g.anchor.y) > 7) return 'z';
    if (!topMode && distanceToSegment(p, g.origin, g.x) < 8) return 'x';
    if (!topMode && distanceToSegment(p, g.origin, g.y) < 8) return 'y';
    return null;
  }
  function digNext() { if (lastHits.length < 2) return; digIndex = (digIndex + 1) % lastHits.length; setSelection([lastHits[digIndex].sticky.id]); toast(`Layer ${digIndex + 1} of ${lastHits.length}: ${Engine.nameOf(model, lastHits[digIndex].sticky)}`); }
  function beginPointer(e) {
    if (turn) return; const p = { x: e.clientX, y: e.clientY }; lastPointer = p; modifiers = e;
    if (e.button === 2 || e.button === 1 || e.button === 0 && spaceHeld) { drag = { kind: e.button === 2 ? 'right' : 'pan', start: p, pointer: p, camera: { ...camera }, moved: false }; capturePointer(e); e.preventDefault(); return; }
    if (e.button !== 0) return; window.ProgramIsoUI?.close();
    const axis = gizmoHit(p), handle = hitRoofHandle(p);
    if (axis === 'number') { window.dispatchEvent(new CustomEvent('program-iso-menu', { detail: { ...p, geometry:true } })); setTimeout(() => { const input = $(topMode ? 'cell-height' : 'cell-z'); input.focus(); input.select(); }, 0); return; }
    if (axis && selection().length && !selection().some(Physics.locked)) {
      const cells = selection().map(s => ({ s, x: s.x, y: s.y, z: elevation(s), height: thickness(s) }));
      drag = { kind: axis === 'z' ? 'vertical' : 'move', axis, start: p, pointer: p, before: snapshot(), stackBefore: stackState(), face: topMode, cells, plane: onPlane(p.x, p.y, 0), planeZ: 0, moved: false, mode: dragMode(e) }; if (axis !== 'z') drag.physics = Physics.session(live(), selected, physicsOptions(drag.mode)); capturePointer(e); e.preventDefault(); return;
    }
    if (handle) { const s = handle.s; drag = { ...handle, start: p, pointer: p, before: snapshot(), stackBefore: stackState(), origin: { x: s.x, y: s.y, w: s.w, h: s.h, tw: s.tw, th: s.th }, radius: s.radius || 0, plane: onPlane(p.x, p.y, elevation(s) + thickness(s)), moved: false }; capturePointer(e); e.preventDefault(); return; }
    const hits = hitsAt(p.x, p.y); lastHits = hits; digIndex = 0;
    if (!hits.length) { const base = e.shiftKey ? [...selected] : []; if (!e.shiftKey) selected.clear(); drag = { kind: 'marquee', start: p, pointer: p, base, moved: false }; sync(); requestDraw(); capturePointer(e); e.preventDefault(); return; }
    const hit = hits[0], own = Engine.expandToGroups(model, [hit.sticky.id]), previous = [...selected], had = selected.has(hit.sticky.id);
    if (topMode && !hit.top) { toast('Click a top surface, or switch to Object to move the cell.'); return; }
    if (!had) selected = new Set(own); sync(); requestDraw();
    if (topMode || Physics.locked(hit.sticky)) { if (e.shiftKey) { selected = new Set(previous); own.forEach(id => had ? selected.delete(id) : selected.add(id)); sync(); } return; }
    const planeZ = hit.point[2];
    drag = { kind: 'move', axis: null, start: p, pointer: p, before: snapshot(), stackBefore: stackState(), cells: selection().map(s => ({ s, x: s.x, y: s.y, z: elevation(s), height: thickness(s) })), plane: onPlane(p.x, p.y, planeZ), planeZ, moved: false, mode: dragMode(e), duplicate: !!e.altKey, toggle: e.shiftKey ? { previous, own, had } : null, collapse: had && previous.length > own.length ? own : null };
    drag.physics = Physics.session(live(), selected, physicsOptions(drag.mode)); capturePointer(e); e.preventDefault();
  }
  function movePointer(e) {
    const p = { x: e.clientX, y: e.clientY }; lastPointer = p; modifiers = e;
    if (!drag) { const old = hover; hover = hitsAt(p.x, p.y)[0]?.sticky || null; const handle = gizmoHit(p), roof = hitRoofHandle(p); scene.style.cursor = handle === 'z' ? 'ns-resize' : handle || roof ? 'pointer' : hover ? (topMode ? 'crosshair' : Physics.locked(hover) ? 'default' : 'grab') : spaceHeld ? 'grab' : 'default'; if (old !== hover) requestDraw(); return; }
    drag.pointer = p; const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) { if (drag.kind === 'move') drag.duplicate = !!e.altKey; return; }
    if (!drag.moved) {
      drag.moved = true;
      if (drag.kind === 'move' && drag.duplicate) {
        drag.physics?.release(); const originals = drag.cells.map(c => c.s.id), copies = Engine.duplicateStickies(model, originals);
        if (copies) { selected = new Set(copies.map(s => s.id)); drag.cells = copies.map(s => ({ s, x: s.x, y: s.y, z: elevation(s), height: thickness(s) })); drag.physics = Physics.session(live(), selected, physicsOptions(drag.mode)); drag.physicsOriginals = new Set(originals); }
      }
    }
    if (drag.kind === 'right') drag.kind = 'pan';
    if (drag.kind === 'pan') {
      const b = basis(); camera.x = drag.camera.x - b.right[0] * dx / camera.scale + b.up[0] * dy / camera.scale; camera.y = drag.camera.y - b.right[1] * dx / camera.scale + b.up[1] * dy / camera.scale; camera.z = drag.camera.z + b.up[2] * dy / camera.scale;
    } else if (drag.kind === 'marquee') updateMarquee();
    else if (drag.kind === 'resize') {
      const s = drag.s, p3 = onPlane(p.x, p.y, elevation(s) + thickness(s)), target = Engine.stretchBox(drag.origin, drag.edge, p3[0], p3[1], { step: view.grid ? Number(view.gridStep) || 10 : 0, wall: model.frame ? { x0: model.frame.x, y0: model.frame.y, x1: model.frame.x + model.frame.w, y1: model.frame.y + model.frame.h } : null });
      const old = { x: s.x, y: s.y, w: s.w, h: s.h, tw: s.tw, th: s.th }; Object.assign(s, target);
      if (live().some(q => q.id !== s.id && Physics.intersects(s, q))) Object.assign(s, old);
    } else if (drag.kind === 'fillet') { const p3 = onPlane(p.x, p.y, elevation(drag.s) + thickness(drag.s)); drag.s.radius = Geo.clamp(drag.radius + p3[0] - drag.plane[0], 0, Math.min(drag.s.w, drag.s.h, thickness(drag.s)) / 2);
    } else if (drag.kind === 'vertical') {
      let delta = -dy / (camera.scale * Math.sqrt(2 / 3)); if (e.shiftKey) delta = Math.round(delta / (Number(view.gridStep) || 1)) * (Number(view.gridStep) || 1);
      const lower = drag.face ? Math.max(...drag.cells.map(c => 0.1 - c.height)) : Math.max(...drag.cells.map(c => -c.z)); delta = Math.max(lower, delta);
      if (!drag.face) { const first = drag.cells[0]; Physics.verticalMove(live(), selected, first.z + delta - elevation(first.s)); }
      else applyVertical(drag.stackBefore, new Map(drag.cells.map(c => [c.s.id, Geo.clamp(c.height + delta, 0.1, 10000)])), 'height');
    } else {
      const current = onPlane(p.x, p.y, drag.planeZ || 0); let mx = current[0] - drag.plane[0], my = current[1] - drag.plane[1];
      drag.mode = dragMode(e); drag.physics.setMode(drag.mode);
      if (e.shiftKey && drag.mode === 'normal') { if (!drag.axis) drag.axis = Math.abs(mx) >= Math.abs(my) ? 'x' : 'y'; } else if (!gizmoHit(drag.start)) drag.axis = null;
      if (drag.axis === 'x') my = 0; if (drag.axis === 'y') mx = 0;
      const target = snapTarget(mx, my); drag.physics.setTarget(target.dx, target.dy);
      scene.style.cursor = drag.duplicate ? 'copy' : drag.mode === 'isolate' ? 'move' : drag.axis ? drag.axis === 'x' ? 'ew-resize' : 'ns-resize' : 'grabbing';
    }
    sync(); requestDraw();
  }
  function endPointer(e) {
    if (!drag) return; const completed = drag; drag = null;
    completed.physics?.release(); guides = [];
    if (completed.kind === 'right' && !completed.moved) { const hits = hitsAt(e.clientX, e.clientY); lastHits = hits; if (hits[0] && !selected.has(hits[0].sticky.id)) selected = new Set(Engine.expandToGroups(model, [hits[0].sticky.id])); sync(); window.dispatchEvent(new CustomEvent('program-iso-menu', { detail: { x: e.clientX, y: e.clientY } })); }
    else if (completed.kind === 'pan') persistSoon();
    else if (completed.kind === 'marquee') { sync(); }
    else if (completed.moved) {
      live().forEach(s => { s.passId = null; });
      if ((completed.mode === 'ghost' || completed.duplicate) && !Physics.separate(live(), selected, physicsOptions())) { restore(completed.before); toast('There is no room for that placement.'); return; }
      gravityActive = true; velocities.clear();
      remember(completed.before); changed();
    } else if (completed.toggle) { selected = new Set(completed.toggle.previous); completed.toggle.own.forEach(id => completed.toggle.had ? selected.delete(id) : selected.add(id)); sync(); }
    else if (completed.collapse) { selected = new Set(completed.collapse); sync();
    }
    scene.style.cursor = 'default'; requestDraw();
  }
  async function openFile(file) {
    if (!file || fileBusy) return; fileBusy = true;
    try {
      if (await flushEdits() === false || dataDashboard?.close() === false) throw new Error('Correct the highlighted table value before opening another program.');
      const before = snapshot(); let opened, isoCamera = null;
      if (/\.zip$/i.test(file.name)) {
        const parts = await Engine.readSaveZip(await file.arrayBuffer()); opened = Engine.openSave(parts);
        const layout = typeof parts.layout === 'string' ? JSON.parse(parts.layout) : parts.layout; isoCamera = layout?.view?.isoCamera;
      } else if (/\.json$/i.test(file.name)) {
        const layout = JSON.parse(await file.text()); opened = Engine.openSave({ layout }); isoCamera = layout?.view?.isoCamera;
      } else if (/\.xlsx$|\.xlsm$/i.test(file.name)) opened = Engine.openSave({ matrix: await Engine.xlsxToMatrix(await file.arrayBuffer()), csvName: file.name });
      else opened = Engine.openSave({ csvText: await file.text(), csvName: file.name });
      model = opened.model; shared.camera = opened.camera || null; view = { ...view, ...(opened.view || {}) }; selected.clear(); lastHits = []; remember(before); changed();
      if (isoCamera && validCamera(isoCamera)) { camera = { ...isoCamera }; angle = ANGLES[DIRECTIONS.indexOf(camera.direction)]; sync(); requestDraw(); } else fit();
      toast('Opened ' + live().length + ' cells.');
    } catch (err) { toast(err.message || 'Could not open that file.'); }
    finally { fileBusy = false; $('file').value = ''; }
  }
  async function save() {
    try {
      if (await flushEdits() === false) throw new Error('Correct the highlighted table value before saving.');
      if (!model || !model.rows.length) return;
      view.isoDirection = camera.direction; view.isoCamera = { ...camera };
      const saved = await Engine.buildSave(model, view, shared.camera || null, { app: 'Program board · Isometric' });
      const url = URL.createObjectURL(new Blob([saved.bytes], { type: 'application/zip' })), a = document.createElement('a'); a.href = url; a.download = saved.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); persist(); toast('Saved spreadsheet, layout and 3D properties.');
    } catch (err) { toast(err.message || 'Could not save.'); }
  }
  function validCamera(value) { return value && ['x', 'y', 'z', 'scale'].every(k => Number.isFinite(value[k])) && value.scale >= 0.025 && value.scale <= 40 && DIRECTIONS.includes(value.direction); }
  function load() {
    const incoming = window.ProgramModeState && window.ProgramModeState.read();
    if (incoming?.board) { shared = incoming; view = { ...(incoming.view || {}) }; model = Engine.restore(incoming.board); }
    if (!PARAMS.has('fresh')) {
      try { const saved = incoming || JSON.parse(localStorage.getItem(KEY) || 'null'); if (saved?.board && Array.isArray(saved.board.stickies) && Array.isArray(saved.board.rows)) { shared = saved; view = { ...(saved.view || {}) }; model = Engine.restore(saved.board); } } catch (err) { /* an invalid saved layout opens empty */ }
      try { const own = JSON.parse(localStorage.getItem(ISO_KEY) || 'null'), cam = view.isoCamera || own?.camera; if (validCamera(cam)) { camera = { ...cam }; angle = ANGLES[DIRECTIONS.indexOf(camera.direction)]; } if (own) { $('auto-stack').checked = own.autoStack !== false; $('labels-on').checked = own.labels !== false; } } catch (err) { /* use defaults */ }
    }
    if (incoming && validCamera(view.isoCamera)) { camera = { ...view.isoCamera }; angle = ANGLES[DIRECTIONS.indexOf(camera.direction)]; }
    if (!model && !PARAMS.has('fresh') && window.ProgramBoardSeed?.csv) { model = Engine.modelFromCsv(window.ProgramBoardSeed.csv, window.ProgramBoardSeed.name || 'program.csv'); Engine.pack(model); shared = { board: Engine.capture(model), view: { ...view }, camera: null }; }
    if (!EPHEMERAL && window.ProgramModeState?.subscribe) window.ProgramModeState.subscribe(applyShared);
    initRenderer(); resize(); sync();
    if (model && !(view.isoCamera && validCamera(view.isoCamera))) fit();
    window.__iso = { get model() { return model; }, get camera() { return camera; }, get view() { return view; }, get dataDashboard() { return dataDashboard; }, get modeState() { return model ? { board: Engine.capture(model), view: { ...view, isoDirection: camera.direction, isoCamera: { ...camera } }, camera: shared.camera || null } : null; }, get selected() { return [...selected]; }, get topMode() { return topMode; }, get settled() { return !drag && !turn && !gravityActive; }, get renderer() { return renderer?.mode || 'software'; }, get interaction() { return drag ? { kind: drag.kind, mode: drag.mode, axis: drag.axis, moved: drag.moved, pressure: drag.pressure || null, hop: drag.hop || null, carried: [...(drag.carried || [])], handles: roofHandles().map(h => ({ kind: h.kind, edge: h.edge, x: h.x, y: h.y })) } : { kind: null, handles: roofHandles().map(h => ({ kind: h.kind, edge: h.edge, x: h.x, y: h.y })) }; }, project, hitsAt, select: setSelection, fit, rotate, stack: stackSelected, setTopMode, newCell, undo, redo, persist, refresh: changed, geometry: Geo, physics: Physics, pointerDown: beginPointer, pointerMove: movePointer, pointerUp: endPointer, editVertical, editMetadata, install(next, nextView) { model = next; view = { ...view, ...(nextView || {}) }; selected.clear(); gravityActive = false; sync(); fit(); } };
  }
  window.addEventListener('focus', () => { if (!EPHEMERAL) { const latest = window.ProgramModeState?.latest(); if (latest && JSON.stringify(latest.board) !== JSON.stringify(shared.board)) applyShared(latest); } });
  $('src-open').addEventListener('click', () => $('file').click()); $('empty-open').addEventListener('click', () => $('file').click()); $('file').addEventListener('change', () => openFile($('file').files[0]));
  $('new-cell').addEventListener('click', () => newCell()); $('empty-new').addEventListener('click', () => newCell()); $('fit').addEventListener('click', fit); $('save').addEventListener('click', save);
  $('zoom-in').addEventListener('click', () => zoom(1.2)); $('zoom-out').addEventListener('click', () => zoom(1 / 1.2)); $('undo').addEventListener('click', undo); $('redo').addEventListener('click', redo);
  $('tool-object').addEventListener('click', () => setTopMode(false)); $('tool-face').addEventListener('click', () => setTopMode(true)); $('stack').addEventListener('click', stackSelected); $('ground-selected').addEventListener('click', () => mutate(() => editVertical('z', 0))); $('duplicate').addEventListener('click', duplicate); $('dig-next').addEventListener('click', digNext);
  document.querySelectorAll('[data-direction]').forEach(button => button.addEventListener('click', () => rotate(button.dataset.direction))); $('rotate-left').addEventListener('click', () => rotateStep(-1)); $('rotate-right').addEventListener('click', () => rotateStep(1));
  $('cell-name').addEventListener('change', () => { const s = selection()[0]; if (s) mutate(() => Engine.setName(model, [s.id], $('cell-name').value)); });
  $('cell-area')?.addEventListener('change', () => editField(model.areaKey, $('cell-area').value));
  $('cell-locked')?.addEventListener('change', () => mutate(() => selection().forEach(s => { s.locked = $('cell-locked').checked; })));
  $('group-selected')?.addEventListener('click', () => groupSelection()); $('ungroup-selected')?.addEventListener('click', () => groupSelection(true)); $('delete-selected')?.addEventListener('click', removeSelected);
  $('grid')?.addEventListener('click', () => { view.grid = !view.grid; changed(); }); $('exportpng')?.addEventListener('click', exportPng);
  [['cell-height', 'height', 0.1, 10000], ['cell-z', 'z', 0, 100000], ['cell-radius', 'radius', 0, 10000]].forEach(([id, key, min, max]) => $(id).addEventListener('change', () => { const value = Number($(id).value); if (!Number.isFinite(value) || !$(id).value) { sync(); return; } const upper = key === 'radius' ? Number($('cell-radius').max) : max, next = Geo.clamp(value, min, upper); mutate(() => { if (key === 'radius') selection().forEach(s => { s.radius = next; }); else editVertical(key, next); }); }));
  $('radius-slider').addEventListener('pointerdown', () => { rangeBefore = snapshot(); }); $('radius-slider').addEventListener('input', () => { if (!rangeBefore) rangeBefore = snapshot(); selection().forEach(s => { s.radius = Number($('radius-slider').value); }); $('cell-radius').value = $('radius-slider').value; requestDraw(); }); $('radius-slider').addEventListener('change', () => { if (rangeBefore) { remember(rangeBefore); rangeBefore = null; changed(); } });
  document.querySelectorAll('[data-material]').forEach(button => button.addEventListener('click', () => { defaultMaterial = button.dataset.material; if (selection().length) mutate(() => selection().forEach(s => { s.material = defaultMaterial; })); else sync(); }));
  function setColor(value) { if (!selection().length) return; mutate(() => { if (Appearance) Appearance.clearGradient(model, selection()); selection().forEach(s => { s.color = value; }); }); }
  $('cell-color').addEventListener('change', () => setColor($('cell-color').value));
  ['#d7a38a', '#dba3b4', '#b9b4d2', '#95bfb6', '#abc7d6', '#d8cfaa', '#d2d4d2'].forEach(value => { const button = document.createElement('button'); button.style.background = value; button.title = 'Set cell color ' + value; button.setAttribute('aria-label', button.title); button.addEventListener('click', () => setColor(value)); $('swatches').append(button); });
  function applyGradient() { if (!Appearance || !selection().length) return; mutate(() => { if ($('gradient-on').checked) Appearance.setGradient(model, selection(), $('gradient-start').value, $('gradient-end').value); else Appearance.clearGradient(model, selection()); }); }
  $('gradient-on').addEventListener('change', applyGradient); $('gradient-start').addEventListener('change', () => { $('gradient-on').checked = true; applyGradient(); }); $('gradient-end').addEventListener('change', () => { $('gradient-on').checked = true; applyGradient(); });
  $('leaders').addEventListener('input', () => { view.leaderThreshold = Number($('leaders').value); $('leaders-value').textContent = view.leaderThreshold ? `< ${view.leaderThreshold}px` : 'Off'; persistSoon(); requestDraw(); }); $('labels-on').addEventListener('change', () => { persistSoon(); requestDraw(); }); $('auto-stack').addEventListener('change', persistSoon);
  scene.addEventListener('pointerdown', beginPointer); scene.addEventListener('pointermove', movePointer); scene.addEventListener('pointerup', endPointer); scene.addEventListener('pointercancel', () => { if (drag?.before) restore(drag.before); drag?.physics?.release(); drag = null; requestDraw(); }); scene.addEventListener('pointerleave', () => { if (!drag) { hover = null; requestDraw(); } }); scene.addEventListener('dblclick', e => { const hit = hitsAt(e.clientX, e.clientY)[0]; if (hit) { setSelection([hit.sticky.id]); editMetadata(e.shiftKey || e.altKey ? 'area' : 'name', hit.sticky); } }); scene.addEventListener('wheel', e => { e.preventDefault(); if (!turn) zoom(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });
  // The custom menu opens under the pointer before contextmenu may fire.
  // Capture across the page so neither it nor the canvas opens the host menu.
  const editorTarget = event => !!event.target?.closest?.('.board-data-dashboard,.board-data-tags-menu');
  window.addEventListener('contextmenu', e => { if (editorTarget(e)) return; e.preventDefault(); e.stopPropagation(); }, true);
  window.addEventListener('resize', resize); window.addEventListener('beforeunload', flushEdits);
  window.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 's') return;
    event.preventDefault(); event.stopPropagation(); save();
  }, true);
  window.addEventListener('keydown', e => {
    if (editorTarget(e)) return;
    if (e.target.closest('input,textarea,select,[contenteditable]')) return;
    if (e.code === 'Space') { spaceHeld = true; scene.style.cursor = 'grab'; e.preventDefault(); return; }
    const command = e.ctrlKey || e.metaKey;
    if (drag?.kind === 'move' && ['Shift', 'Control', 'Meta', 'Alt'].includes(e.key)) { movePointer({ ...modifiers, clientX: drag.pointer.x, clientY: drag.pointer.y, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey }); e.preventDefault(); return; }
    if (command && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (command && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    else if (command && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); }
    else if (command && e.key.toLowerCase() === 'a') { e.preventDefault(); setSelection(live().map(s => s.id)); }
    else if (command && e.key.toLowerCase() === 'g') { e.preventDefault(); groupSelection(e.shiftKey); }
    else if (command && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); }
    else if (e.key === 'Escape') { if (drag?.before) restore(drag.before); drag?.physics?.release(); drag = null; window.ProgramIsoUI?.close(); selected.clear(); setTopMode(false); }
    else if (e.key === 'Enter') { e.preventDefault(); const first = selection()[0], p = first ? project([first.x + first.w / 2, first.y + first.h / 2, elevation(first) + thickness(first)]) : lastPointer || { x: width / 2, y: height / 2 }; window.dispatchEvent(new CustomEvent('program-iso-menu', { detail: { ...p, metadata: true } })); }
    else if (e.key.toLowerCase() === 'g') { e.preventDefault(); view.grid = !view.grid; changed(); }
    else if (e.key.toLowerCase() === 'v') setTopMode(false);
    else if (e.key.startsWith('Arrow') && selection().length) { e.preventDefault(); const step = (view.grid ? Number(view.gridStep) || 10 : 1) * (e.shiftKey ? 10 : 1), dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0; mutate(() => Physics.move(live(), selected, dx, dy, physicsOptions())); gravityActive = true; }
    else if (e.key.toLowerCase() === 'f') fit(); else if (e.key.toLowerCase() === 'n') newCell(); else if (e.key === '[') rotateStep(-1); else if (e.key === ']') rotateStep(1);
  });
  window.addEventListener('keyup', e => { if (editorTarget(e)) return; if (e.code === 'Space') { spaceHeld = false; scene.style.cursor = 'default'; } if (drag?.kind === 'move' && ['Shift', 'Control', 'Meta', 'Alt'].includes(e.key)) movePointer({ clientX: drag.pointer.x, clientY: drag.pointer.y, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey }); }); window.addEventListener('blur', () => { spaceHeld = false; drag?.physics?.release(); if (drag?.before) { remember(drag.before); gravityActive = true; } drag = null; requestDraw(); });
  document.addEventListener('dragenter', e => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); dropDepth++; $('drop').hidden = false; } }); document.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }); document.addEventListener('dragleave', e => { if (e.dataTransfer?.types.includes('Files')) { dropDepth = Math.max(0, dropDepth - 1); if (!dropDepth) $('drop').hidden = true; } }); document.addEventListener('drop', e => { e.preventDefault(); dropDepth = 0; $('drop').hidden = true; openFile(e.dataTransfer?.files[0]); });
  dataDashboard = window.ProgramDataDashboard.create({
    button: $('src-data'), getModel: () => model, engine: Engine,
    onEdit: ({ rowIndex, key, value }) => editDashboard(target => Engine.editRowField(target, rowIndex, key, value)),
    onRoles: roles => editDashboard(target => Engine.setColumnRoles(target, roles)),
    onAddColumn: name => editDashboard(target => Engine.ensureColumn(target, name)),
    onCommit: flushEdits,
    onOpen: () => { finishMotion(); window.ProgramIsoUI?.close(); },
    onClose: () => { if (pendingShared) applyShared(pendingShared); persist(); },
  });
  $('src-data').addEventListener('click', () => {
    if (!dataDashboard.isOpen()) { flushEdits(); window.ProgramIsoUI?.close(); $('views').hidden = $('iso-export').hidden = true; }
  }, true);
  $('tb-display').addEventListener('click', event => {
    if (dataDashboard.commitActive() === false) { event.preventDefault(); event.stopImmediatePropagation(); toast('Correct the highlighted table value before switching views.'); }
  }, true);
  document.addEventListener('click', event => {
    if (!event.target.closest?.('#display-mode-menu a')) return;
    if (flushEdits() === false) { event.preventDefault(); event.stopImmediatePropagation(); toast('Correct the highlighted table value before switching views.'); }
  }, true);
  load();
  window.__iso.flushEdits = flushEdits;
  sync();
})();
