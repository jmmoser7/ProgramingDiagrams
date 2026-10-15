'use strict';
(() => {
  const P = window.DragFeelPhysics, Grip = window.DragFeelGrip;
  const $ = id => document.getElementById(id);
  const canvas = $('scene'), ctx = canvas.getContext('2d');
  const STORAGE = 'program-board-drag-feel-v1';
  const frame = { x: 0, y: 0, w: 160, h: 120 };
  const clone = value => JSON.parse(JSON.stringify(value));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const recipes = [
    ['Choose your grip.', 'Hover a corner or edge midpoint for a precise grip, or grab anywhere. Features near your grip catch more strongly, including on the block underneath.'],
    ['Make contact.', 'Push one colored block into another. Try a quick tap, then a slow shove. Tune the buffer and the firmness of contact.'],
    ['Find the give point.', 'Pull toward the gray step’s center to build pressure. Stay above the minimum to climb; pull deeper to give way faster. Keep holding and drag off to drop back down.']
  ];
  function seed() {
    return [
      { id: 'a', name: 'DRAG ME', x: 30, y: 68, z: 0, w: 22, h: 22, height: 9, color: '#6d9c89' },
      { id: 'b', name: 'PUSH ME', x: 66, y: 68, z: 0, w: 24, h: 22, height: 9, color: '#d4977e' },
      { id: 'c', name: 'LINE ME UP', x: 43, y: 30, z: 0, w: 22, h: 22, height: 9, color: '#c4b16e' },
      { id: 'step', name: 'FIXED STEP', x: 106, y: 49, z: 0, w: 32, h: 42, height: 12, color: '#a2afa0', locked: true }
    ];
  }
  function settingsFrom(raw) {
    const clean = { ...P.defaults };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Missing feel settings.');
    for (const control of P.controls) {
      if (!(control.key in raw)) continue;
      if (control.type === 'boolean') {
        if (typeof raw[control.key] !== 'boolean') throw new Error('Invalid setting: ' + control.label);
        clean[control.key] = raw[control.key];
      } else {
        const value = raw[control.key];
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid setting: ' + control.label);
        clean[control.key] = clamp(value, control.min, control.max);
      }
    }
    return clean;
  }
  let settingsB = { ...P.defaults, ...P.presets.crisp }, referenceA = { ...settingsB };
  let storageAvailable = true, activeSlot = 'b', view = 'iso', showGuides = true, sound = false;
  try {
    const saved = localStorage.getItem(STORAGE);
    if (saved) { const data = JSON.parse(saved); settingsB = settingsFrom(data.settings); referenceA = settingsFrom(data.reference || data.settings); }
  } catch (error) { storageAvailable = false; }
  let blocks = seed(), controller;
  let width = 0, height = 0, ratio = 1, scale = 1, origin = { x: 0, y: 0 };
  let fitScale = 1, zoom = 1, pan = { x: 0, y: 0 }, panGesture = null, spaceHeld = false, ctrlHeld = false;
  let selectedId = 'a', hoverId = null, hoverPoint = null, hoverFeature = null, hoverFree = false, pointer = null, pointerId = null, grip = null;
  let lastTime = 0, lastReadout = 0, effectTime = 0, toastTimer = 0, audioContext = null;
  let polygons = [], pulses = [], lastEvent = null;
  let keyboardTarget = null;
  const keys = new Set();
  const controls = new Map();
  const current = () => activeSlot === 'a' ? referenceA : settingsB;
  function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3000); }
  function persist() {
    try { localStorage.setItem(STORAGE, JSON.stringify({ version: 1, settings: settingsB, reference: referenceA })); storageAvailable = true; }
    catch (error) { storageAvailable = false; }
    const status = $('storage-status');
    status.textContent = storageAvailable ? '● Saved locally · program data stays separate' : 'Storage unavailable · export to keep this feel';
  }
  function tone(event) {
    if (!sound || !audioContext || audioContext.state !== 'running') return;
    if ((event.strength ?? .5) <= 0) return;
    const time = audioContext.currentTime, oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    const frequency = { snap: 740, collision: 160, climb: 440, land: 115 }[event.type] || 210;
    oscillator.type = event.type === 'snap' ? 'sine' : 'triangle';
    oscillator.frequency.setValueAtTime(frequency, time);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * .55, time + .045);
    gain.gain.setValueAtTime(.035 * clamp(event.strength ?? .5, 0, 1), time);
    gain.gain.exponentialRampToValueAtTime(.0001, time + .065);
    oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.start(time); oscillator.stop(time + .075);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  function onEvent(event) {
    lastEvent = { ...event, time: effectTime };
    if ((event.strength ?? .5) > 0) pulses.push({ ...event, id: event.id || controller?.activeId || selectedId, time: effectTime });
    if (pulses.length > 16) pulses.shift();
    tone(event);
  }
  function freshController() { controller = P.create(blocks, current(), { frame, onEvent }); }
  freshController();
  function setNeighborLock(enabled) {
    ctrlHeld = !!enabled; controller.setIsolated(ctrlHeld); $('neighbors-lock').hidden = !ctrlHeld;
    if (!panGesture) canvas.style.cursor = pointer ? ctrlHeld ? 'move' : 'grabbing' : spaceHeld ? 'grab' : hoverFeature ? 'crosshair' : hoverId && !blocks.find(s => s.id === hoverId)?.locked ? ctrlHeld ? 'move' : 'grab' : 'default';
  }
  function format(value, control) {
    const decimals = control.step < 1 ? Math.min(3, (String(control.step).split('.')[1] || '').length) : 0;
    return Number(value).toFixed(decimals).replace(/\.0+$/, '');
  }
  function updateControls() {
    for (const control of P.controls) {
      const row = controls.get(control.key), value = current()[control.key];
      if (control.type === 'boolean') row.input.checked = value;
      else {
        row.input.value = value;
        if (document.activeElement !== row.number) row.number.value = format(value, control);
        row.input.style.setProperty('--fill', (100 * (value - control.min) / (control.max - control.min)) + '%');
      }
    }
    document.querySelectorAll('[data-preset]').forEach(button => {
      const preset = { ...P.defaults, ...P.presets[button.dataset.preset] };
      button.classList.toggle('active', P.controls.every(control => preset[control.key] === current()[control.key]));
    });
    $('custom-label').hidden = !!document.querySelector('[data-preset].active');
    for (const slot of ['a', 'b']) { $('compare-' + slot).classList.toggle('active', activeSlot === slot); $('compare-' + slot).setAttribute('aria-pressed', activeSlot === slot); }
    const differences = P.controls.filter(control => settingsB[control.key] !== referenceA[control.key]).length;
    $('compare-status').textContent = differences ? differences + ' changed ' + (differences === 1 ? 'control' : 'controls') : 'Same starting feel';
    $('save-reference').disabled = activeSlot === 'a';
    $('save-status').textContent = activeSlot === 'a' ? 'Testing your saved reference. Adjust a control to return to B.' : 'Tuning saves on this device. A keeps your reference feel.';
  }
  function setSetting(control, value) {
    if (activeSlot === 'a') { settingsB = { ...referenceA }; activeSlot = 'b'; }
    settingsB[control.key] = control.type === 'boolean' ? value : clamp(value, control.min, control.max);
    controller.configure(settingsB); updateControls(); persist();
  }
  function buildControls() {
    const sections = new Map();
    const notes = {
      Motion: 'Mouse grips are firm. Response and damping tune arrow-key motion; friction and inertia tune the release.',
      Magnetism: 'Hover a vertex or midpoint to choose a precise grip. Grab-side bias favors nearby features; support tops also attract. Breakaway sets how far you pull to release.',
      Contact: 'Contact feedback is a visual tap, with optional sound. Solids stay solid.',
      'Level change': 'Reach the minimum pressure to climb. Pull farther toward the next block’s center to build pressure faster; ease off to drain it.'
    };
    for (const control of P.controls) {
      const sectionName = control.section || 'Tuning';
      if (!sections.has(sectionName)) {
        const section = document.createElement('section'); section.className = 'control-section';
        const title = document.createElement('div'); title.className = 'section-title';
        const heading = document.createElement('h3'); heading.textContent = sectionName;
        const index = document.createElement('span'); index.textContent = String(sections.size + 1).padStart(2, '0');
        title.append(heading, index); section.append(title); $('controls').append(section); sections.set(sectionName, section);
      }
      const section = sections.get(sectionName), row = document.createElement('div'); row.className = 'control-row';
      const label = document.createElement('label'); label.htmlFor = 'tune-' + control.key; label.textContent = control.label; label.title = control.description || '';
      const input = document.createElement('input'); input.id = 'tune-' + control.key;
      if (control.type === 'boolean') {
        row.classList.add('boolean'); input.type = 'checkbox'; input.className = 'toggle'; input.addEventListener('change', () => setSetting(control, input.checked)); row.append(label, input); controls.set(control.key, { input });
      } else {
        const labelRow = document.createElement('div'); labelRow.className = 'control-label';
        const value = document.createElement('div'); value.className = 'control-number';
        const number = document.createElement('input'); number.type = 'number'; number.min = control.min; number.max = control.max; number.step = control.step; number.setAttribute('aria-label', control.label + ' value');
        const unit = document.createElement('span'); unit.textContent = control.unit || ''; value.append(number, unit); labelRow.append(label, value);
        const range = document.createElement('div'); range.className = 'range-line'; input.type = 'range'; input.min = control.min; input.max = control.max; input.step = control.step; input.title = control.description || '';
        const reset = document.createElement('button'); reset.className = 'knob-reset'; reset.textContent = '↺'; reset.title = 'Reset ' + control.label; reset.setAttribute('aria-label', 'Reset ' + control.label);
        input.addEventListener('input', () => setSetting(control, Number(input.value)));
        number.addEventListener('input', () => { if (number.value.trim() && Number.isFinite(number.valueAsNumber)) setSetting(control, number.valueAsNumber); });
        number.addEventListener('change', () => { if (number.value.trim() && Number.isFinite(number.valueAsNumber)) setSetting(control, number.valueAsNumber); number.value = format(current()[control.key], control); });
        number.addEventListener('blur', () => { number.value = format(current()[control.key], control); });
        reset.addEventListener('click', () => setSetting(control, P.defaults[control.key]));
        range.append(input, reset); row.append(labelRow, range); controls.set(control.key, { input, number });
      }
      section.append(row);
    }
    for (const [name, section] of sections) {
      const text = Object.entries(notes).find(([key]) => name.toLowerCase().includes(key.toLowerCase()))?.[1];
      if (text) { const note = document.createElement('p'); note.className = 'section-note'; note.textContent = text; section.append(note); }
    }
  }
  buildControls(); updateControls(); persist();
  function releaseCapture() {
    const captured = pointerId;
    pointerId = null; pointer = null; grip = null; clearHover(); document.body.classList.remove('grip-active');
    if (captured !== null && canvas.hasPointerCapture(captured)) canvas.releasePointerCapture(captured);
  }
  function cancelDrag() {
    if (panGesture) { pan = { ...panGesture.pan }; panGesture = null; resize(); }
    else controller.cancel();
    keys.clear(); keyboardTarget = null; spaceHeld = false; setNeighborLock(false); releaseCapture(); $('viewport').classList.remove('is-panning'); canvas.style.cursor = 'grab';
  }
  function resetScene() { cancelDrag(); blocks = seed(); freshController(); pulses = []; selectedId = 'a'; toast('Blocks reset. Your tuning stays.'); }
  function setView(next) {
    if (view === next) return;
    cancelDrag(); view = next; zoom = 1; pan = { x: 0, y: 0 };
    for (const mode of ['iso', 'top']) { $('view-' + mode).classList.toggle('active', mode === view); $('view-' + mode).setAttribute('aria-pressed', mode === view); }
    resize();
  }
  function resize() {
    const rect = canvas.getBoundingClientRect(); width = rect.width; height = rect.height; ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    fitScale = Math.max(.5, view === 'iso' ? Math.min((width - 70) / ((frame.w + frame.h) * .866), (height - 100) / ((frame.w + frame.h) * .5 + 16)) : Math.min((width - 85) / frame.w, (height - 100) / frame.h));
    updateCamera();
  }
  function centeredOrigin() { return view === 'iso' ? { x: width / 2 - (frame.w - frame.h) * .866 * scale / 2, y: height / 2 - (frame.w + frame.h) * .5 * scale / 2 + 12 } : { x: (width - frame.w * scale) / 2, y: (height - frame.h * scale) / 2 + 6 }; }
  function updateCamera() {
    scale = fitScale * zoom; const center = centeredOrigin(); origin = { x: center.x + pan.x, y: center.y + pan.y };
    $('zoom-value').value = Math.round(zoom * 100) + '%';
    $('zoom-out').disabled = zoom <= .5; $('zoom-in').disabled = zoom >= 6;
  }
  function zoomAt(next, point = { x: width / 2, y: height / 2 }) {
    const nextZoom = clamp(next, .5, 6); if (nextZoom === zoom) return;
    // Zoom around the visible grip, independently of hidden hand pressure.
    const held = grip && blocks.find(s => s.id === grip.id);
    if (held) point = Grip.screenPoint(held, grip, camera());
    const underPointer = held || hit(point);
    const plane = held ? held.z + grip.local.z : underPointer ? underPointer.z + underPointer.height : 0, anchor = unproject(point, plane);
    zoom = nextZoom; scale = fitScale * zoom;
    const projected = project(anchor.x, anchor.y, plane), center = centeredOrigin();
    pan = { x: origin.x + point.x - projected.x - center.x, y: origin.y + point.y - projected.y - center.y };
    updateCamera();
    if (panGesture) { panGesture.start = { ...point }; panGesture.pan = { ...pan }; }
  }
  function fitView() { zoom = 1; pan = { x: 0, y: 0 }; updateCamera(); }
  new ResizeObserver(resize).observe($('viewport')); resize();
  function camera() { return { view, scale, origin }; }
  function project(x, y, z = 0) { return Grip.project(x, y, z, camera()); }
  function unproject(p, z = 0) { return Grip.unproject(p, z, camera()); }
  function advanceGrip(event) {
    if (!grip || !pointer) return;
    const p = { x: event.clientX, y: event.clientY };
    const motion = Grip.delta(p.x - pointer.x, p.y - pointer.y, camera());
    controller.advance(motion.x, motion.y); pointer = p;
  }
  function keepGripVisible() {
    const block = grip && blocks.find(s => s.id === grip.id); if (!block) return;
    const point = Grip.screenPoint(block, grip, camera()), inset = 18;
    const dx = clamp(point.x, inset, width - inset) - point.x, dy = clamp(point.y, inset, height - inset) - point.y;
    if (dx || dy) { pan.x += dx; pan.y += dy; updateCamera(); }
  }
  function drawGrip() {
    const block = grip && blocks.find(s => s.id === grip.id); if (!block) return;
    const point = Grip.screenPoint(block, grip, camera());
    ctx.save();
    if (grip.featureType) featureMarker(point, grip.featureType, 5, true);
    else { ctx.beginPath(); ctx.arc(point.x, point.y, 3, 0, Math.PI * 2); ctx.fillStyle = '#fffef6'; ctx.fill(); ctx.strokeStyle = '#244a36'; ctx.lineWidth = 1.4; ctx.stroke(); }
    if (grip.pointerType !== 'touch') {
      const shape = [[0, 0], [0, 16], [4.7, 12.1], [8.2, 19.3], [11.3, 17.8], [7.8, 10.6], [14, 10.6]];
      polygon(shape.map(([x, y]) => ({ x: point.x + x, y: point.y + y })), '#fffef9', '#243f30', 1.4);
    }
    ctx.restore();
  }
  function polygon(points, fill, stroke, lineWidth = 1) {
    ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.lineJoin = 'round'; ctx.stroke(); }
  }
  function footprint(s, z = 0, pad = 0) { return [project(s.x - pad, s.y - pad, z), project(s.x + s.w + pad, s.y - pad, z), project(s.x + s.w + pad, s.y + s.h + pad, z), project(s.x - pad, s.y + s.h + pad, z)]; }
  function line(a, b, color, weight = 1) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.strokeStyle = color; ctx.lineWidth = weight; ctx.stroke(); }
  function shade(hex, factor) { return '#' + [1, 3, 5].map(i => clamp(Math.round(parseInt(hex.slice(i, i + 2), 16) * factor), 0, 255).toString(16).padStart(2, '0')).join(''); }
  function hit(p) { return polygons.slice().reverse().find(q => Grip.pick(q.block, p, camera()))?.block || null; }
  function clearHover() {
    hoverId = null; hoverPoint = null; hoverFeature = null; hoverFree = false; $('feature-cue').hidden = true;
  }
  function featureAt(p, previous = hoverFeature) {
    if (!current().featureGrabEnabled) return null;
    const body = hit(p), candidates = body ? [body] : polygons.slice().reverse().map(q => q.block);
    let best = null, retained = null;
    for (const s of candidates) {
      if (s.locked) continue;
      const feature = Grip.pickFeature(s, p, camera(), {
        radius: current().featureGrabRadius,
        previous: previous?.blockId === s.id ? previous : null,
        isVisible: f => hit(f.screen)?.id === s.id
      });
      if (feature?.id === previous?.id) retained = feature;
      if (feature && (!best || feature.distance < best.distance)) best = feature;
    }
    return retained && (!best || best.distance + 3 >= retained.distance) ? retained : best;
  }
  function updateHover(p, freeGrab = hoverFree) {
    hoverPoint = p; hoverFree = freeGrab; hoverFeature = freeGrab ? null : featureAt(p); hoverId = hoverFeature?.blockId || hit(p)?.id || null;
    const s = blocks.find(q => q.id === hoverId);
    canvas.style.cursor = spaceHeld ? 'grab' : hoverFeature ? 'crosshair' : s?.locked ? 'default' : s ? ctrlHeld ? 'move' : 'grab' : 'default';
    const cue = $('feature-cue'); cue.hidden = !hoverFeature || spaceHeld;
    if (!cue.hidden) {
      const text = s.id.toUpperCase() + ' · ' + (hoverFeature.type === 'vertex' ? 'Vertex' : 'Midpoint');
      if (cue.textContent !== text) cue.textContent = text;
      cue.style.left = clamp(hoverFeature.screen.x + 15, 8, Math.max(8, width - 114)) + 'px';
      cue.style.top = clamp(hoverFeature.screen.y - 31, 8, height - 28) + 'px';
    }
  }
  function featureMarker(point, type, size = 4, active = false) {
    ctx.save();
    if (active) { ctx.beginPath(); ctx.arc(point.x, point.y, size + 5, 0, Math.PI * 2); ctx.fillStyle = '#00ffee33'; ctx.fill(); }
    if (type === 'midpoint') polygon([{ x: point.x, y: point.y - size }, { x: point.x + size, y: point.y + size }, { x: point.x - size, y: point.y + size }], active ? '#00ffee' : '#fffef9', '#25594f', 1.3);
    else polygon([{ x: point.x - size, y: point.y - size }, { x: point.x + size, y: point.y - size }, { x: point.x + size, y: point.y + size }, { x: point.x - size, y: point.y + size }], active ? '#00ffee' : '#fffef9', '#25594f', 1.3);
    ctx.restore();
  }
  function drawFeatures() {
    if (pointerId === null && hoverPoint && !spaceHeld) {
      updateHover(hoverPoint);
      const s = blocks.find(q => q.id === hoverId && !q.locked);
      if (s && current().featureGrabEnabled && !hoverFree) {
        for (const f of Grip.features(s, camera())) if (hit(f.screen)?.id === s.id) {
          ctx.save(); ctx.globalAlpha = hoverFeature?.id === f.id ? 1 : .55; featureMarker(f.screen, f.type, hoverFeature?.id === f.id ? 5 : 2.5, hoverFeature?.id === f.id); ctx.restore();
        }
        if (hoverFeature && Math.hypot(hoverPoint.x - hoverFeature.screen.x, hoverPoint.y - hoverFeature.screen.y) > 4) {
          ctx.save(); ctx.setLineDash([2, 3]); line(hoverPoint, hoverFeature.screen, '#25594f90', .8); ctx.restore();
        }
      }
    }
    if (showGuides) {
      const seen = new Set();
      for (const guide of controller.guides || []) {
        if (guide.kind !== 'edge' || !guide.source || !guide.target) continue;
        const source = project(guide.source.x, guide.source.y, guide.source.z), target = project(guide.target.x, guide.target.y, guide.target.z);
        const key = [source.x, source.y, target.x, target.y].join(','); if (seen.has(key)) continue; seen.add(key);
        ctx.save(); ctx.setLineDash([3, 3]); line(source, target, '#258572a0', 1); ctx.restore();
        featureMarker(target, guide.target.feature, 4, true); featureMarker(source, guide.source.feature, 3, false);
      }
    }
  }
  function render() {
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
    const ground = footprint({ x: 0, y: 0, w: frame.w, h: frame.h });
    ctx.save(); ctx.shadowColor = '#31473012'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 12; polygon(ground, '#f1f5eac7'); ctx.restore();
    if (current().gridEnabled) {
      ctx.save(); polygon(ground); ctx.clip();
      const gap = current().gridSize;
      for (let x = 0; x <= frame.w; x += gap) line(project(x, 0), project(x, frame.h), '#ccd8c378', .65);
      for (let y = 0; y <= frame.h; y += gap) line(project(0, y), project(frame.w, y), '#ccd8c378', .65);
      ctx.restore();
    }
    polygon(ground, null, '#bccdb1', 1);
    const marker = project(frame.w, frame.h);
    ctx.font = '8px "Segoe UI",sans-serif'; ctx.fillStyle = '#98a88e'; ctx.textAlign = 'center'; ctx.fillText('160 × 120', marker.x, marker.y + 16);
    if (showGuides) {
      ctx.save(); ctx.setLineDash([3, 5]);
      blocks.forEach(s => { if (!s.locked) polygon(footprint(s, s.z, current().buffer / 2), null, '#849b7470', .8); }); ctx.restore();
      for (const guide of controller.guides || []) {
        ctx.save(); ctx.setLineDash(guide.kind === 'edge' ? [] : [4, 4]);
        const z = blocks.find(s => s.id === controller.activeId)?.z || 0;
        line(guide.axis === 'x' ? project(guide.value, 0, z) : project(0, guide.value, z), guide.axis === 'x' ? project(guide.value, frame.h, z) : project(frame.w, guide.value, z), guide.kind === 'edge' ? '#329881b0' : '#32988175', 1); ctx.restore();
      }
    }
    blocks.forEach(s => {
      const shadow = footprint(s, 0); ctx.save(); ctx.shadowColor = '#35463226'; ctx.shadowBlur = (8 + s.z * .7) * scale / 2; ctx.shadowOffsetY = 4; polygon(shadow, '#47583a15'); ctx.restore();
    });
    polygons = [];
    const remaining = blocks.slice().sort((a, b) => view === 'top' && a.z !== b.z ? a.z - b.z : (a.x + a.y + a.w / 2 + a.h / 2) - (b.x + b.y + b.w / 2 + b.h / 2));
    const ordered = [];
    // A raised body paints after every solid underneath it, also in plan.
    // Hit testing uses this same order so a support cannot hide its passenger.
    while (remaining.length) {
      const next = remaining.findIndex(a => !remaining.some(b => b !== a && a.z >= b.z + b.height - .001 && window.ProgramIsoPhysics.xyOverlap(a, b)));
      ordered.push(remaining.splice(next < 0 ? 0 : next, 1)[0]);
    }
    for (const s of ordered) {
      const top = footprint(s, s.z + s.height), bottom = footprint(s, s.z);
      const left = [top[3], top[2], bottom[2], bottom[3]], right = [top[1], top[2], bottom[2], bottom[1]];
      const faces = view === 'iso' ? [left, right, top] : [top];
      const selected = s.id === selectedId, held = s.id === controller.activeId;
      const pulse = pulses.filter(p => p.id === s.id && ['collision', 'land', 'snap'].includes(p.type)).at(-1);
      const t = pulse ? clamp((effectTime - pulse.time) / .24, 0, 1) : 1;
      ctx.save();
      if (view === 'iso') { polygon(left, shade(s.color, .83), shade(s.color, .72), .8); polygon(right, shade(s.color, .72), shade(s.color, .65), .8); }
      const gradient = ctx.createLinearGradient(top[0].x, top[0].y, top[2].x, top[2].y); gradient.addColorStop(0, shade(s.color, 1.13)); gradient.addColorStop(1, s.color);
      polygon(top, gradient, selected ? '#365f4c' : shade(s.color, .86), selected ? 1.6 : .8);
      line(top[0], top[1], '#ffffff70', 1); line(top[0], top[3], '#ffffff55', 1);
      if (s.id === hoverId && !s.locked) polygon(top, '#ffffff14', '#45775e', 1.2);
      const label = project(s.x + s.w / 2, s.y + s.h / 2, s.z + s.height);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#253e33';
      const fontSize = clamp(scale * 3.1, 8, 26); ctx.font = '600 ' + fontSize + 'px "Segoe UI",sans-serif';
      ctx.fillText(s.locked ? '▧' : s.id.toUpperCase(), label.x, label.y - fontSize * .5);
      ctx.font = '500 ' + clamp(scale * 2, 6, 18) + 'px "Segoe UI",sans-serif'; ctx.fillStyle = s.locked ? '#53674f' : '#345040'; ctx.fillText(s.name, label.x, label.y + fontSize * .65);
      if (s.z > .1) { const base = project(s.x + s.w / 2, s.y + s.h, s.z); ctx.font = '8px "Segoe UI",sans-serif'; ctx.fillStyle = '#536e48'; ctx.fillText('LEVEL ' + (1 + Math.round(s.z / 12)), base.x, base.y + 10); }
      const pressure = held ? Math.max(controller.telemetry?.force || 0, controller.telemetry?.state === 'climbing' ? 1 : 0) : 0;
      if (pressure > .01) { ctx.save(); ctx.globalAlpha = .3 + pressure * .7; polygon(top, null, '#f6e9a8', 2 + pressure * 2); ctx.restore(); }
      ctx.restore(); polygons.push({ block: s, faces });
      if (pulse && t < 1) { ctx.save(); ctx.globalAlpha = (1 - t) * (pulse.strength ?? .5) * .5; polygon(footprint(s, s.z + s.height, reducedMotion ? 0 : t * 3), null, pulse.type === 'snap' ? '#318c76' : '#f5e9bf', 1.5); ctx.restore(); }
    }
    drawFeatures(); drawGrip();
    pulses = pulses.filter(p => effectTime - p.time < .6);
  }
  function updateReadout() {
    const telemetry = controller.telemetry || {};
    $('speed-value').replaceChildren(document.createTextNode(Math.round(telemetry.speed || 0) + ' '));
    const unit = document.createElement('small'); unit.textContent = 'u/s'; $('speed-value').append(unit);
    $('snap-value').textContent = telemetry.snap && telemetry.snap !== 'none' ? telemetry.snap : 'Free';
    const pressure = clamp(telemetry.force || 0, 0, 1), progress = clamp(telemetry.pressure || 0, 0, 1);
    const minimum = clamp(telemetry.minPressure ?? current().climbMinPressure / 100, 0, 1);
    const ready = pressure + 1e-9 >= minimum;
    const pressurePercent = Math.floor(pressure * 100 + 1e-6), minimumPercent = Math.round(minimum * 100), progressPercent = Math.round(progress * 100);
    $('contact-value').textContent = telemetry.state === 'pressing' ? ready ? 'Resisting' : 'Easing off' : telemetry.state === 'contact' ? 'Blocked' : telemetry.contact > .01 ? 'Firm contact' : lastEvent && effectTime - lastEvent.time < .3 && lastEvent.type === 'collision' ? 'Tap' : 'Clear';
    $('pressure-value').textContent = pressurePercent + '%'; $('pressure-fill').style.width = (pressure * 100) + '%';
    $('pressure-threshold').style.left = (minimum * 100) + '%'; $('pressure-threshold').title = 'Minimum climb pressure: ' + minimumPercent + '%';
    $('pressure-minimum').textContent = 'MIN ' + minimumPercent + '%'; $('climb-progress').textContent = 'Give ' + progressPercent + '%';
    $('pressure-track').classList.toggle('below-minimum', !ready); $('pressure-track').classList.toggle('ready', ready);
    $('pressure-track').setAttribute('aria-label', 'Push pressure ' + pressurePercent + '%; minimum climb pressure ' + minimumPercent + '%; give progress ' + progressPercent + '%');
    const states = { idle: 'READY TO DRAG', dragging: 'FOLLOWING YOUR HAND', magnetic: 'MAGNETIC DETENT', contact: 'SOLID CONTACT', pressing: ready ? 'BUILDING PRESSURE' : 'RELEASING PRESSURE', climbing: 'GIVING WAY · CLIMBING', coasting: 'SETTLING INTO PLACE' };
    $('scene-state').textContent = states[telemetry.state] || String(telemetry.state || 'READY TO DRAG').toUpperCase();
    $('stage-hint').textContent = telemetry.state === 'climbing' ? 'Give point reached. Moving up a level.' : pressure > .01 && !ready ? 'Below ' + minimumPercent + '% minimum · pull farther toward the center' : ready ? 'Pressure threshold reached · hold steady or pull deeper' : progress > .01 ? 'Pressure released · give progress is easing back' : ctrlHeld ? 'Ctrl · neighbors stay fixed. Release Ctrl to push them again.' : grip ? (grip.featureType ? (grip.featureType === 'vertex' ? 'Vertex' : 'Midpoint') + ' grip · ' : '') + 'Nearby features catch more strongly. Pull through to break free.' : controller.activeId ? 'Feel the contact. Pull through a magnetic detent to break free.' : '↗ Hover a vertex or midpoint for a precise grip. Grab anywhere to drag.';
  }
  function tick(time) {
    const dt = lastTime ? Math.min(.04, (time - lastTime) / 1000) : 1 / 60; lastTime = time; effectTime += dt;
    if (keyboardTarget && keys.size) { const step = 38 * dt; keyboardTarget.x += ((keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0)) * step; keyboardTarget.y += ((keys.has('ArrowDown') ? 1 : 0) - (keys.has('ArrowUp') ? 1 : 0)) * step; controller.target(keyboardTarget); }
    controller.step(dt); keepGripVisible(); render();
    if (time - lastReadout > 80) { updateReadout(); lastReadout = time; }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  document.addEventListener('visibilitychange', () => { lastTime = 0; if (document.hidden && (pointerId !== null || keyboardTarget)) cancelDrag(); });
  const localPoint = event => { const r = canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; };
  canvas.addEventListener('pointerdown', event => {
    if (pointerId !== null || ![0, 1, 2].includes(event.button)) return;
    setNeighborLock(event.ctrlKey || event.metaKey);
    const p = localPoint(event);
    if (event.button !== 0 || spaceHeld) {
      clearHover(); canvas.focus({ preventScroll: true }); panGesture = { start: p, pan: { ...pan } }; pointerId = event.pointerId; canvas.setPointerCapture(pointerId); $('viewport').classList.add('is-panning'); event.preventDefault(); return;
    }
    const feature = event.altKey ? null : featureAt(p), s = feature ? blocks.find(q => q.id === feature.blockId) : hit(p); if (!s) return;
    canvas.focus({ preventScroll: true });
    if (s.locked) { toast('The step stays fixed. Push a colored block into it to climb.'); return; }
    const anchor = feature || Grip.pick(s, p, camera()); if (!anchor) return;
    keys.clear(); keyboardTarget = null; selectedId = s.id;
    if (!controller.begin(s.id, { x: s.x + anchor.local.x, y: s.y + anchor.local.y }, { firm: true, grip: anchor.local })) return;
    grip = { ...anchor, id: s.id, featureId: feature?.id || null, featureType: feature?.type || null, pointerType: event.pointerType }; clearHover(); pointer = { x: event.clientX, y: event.clientY }; pointerId = event.pointerId;
    document.body.classList.add('grip-active'); canvas.setPointerCapture(event.pointerId); event.preventDefault();
  });
  canvas.addEventListener('pointermove', event => {
    setNeighborLock(event.ctrlKey || event.metaKey);
    const p = localPoint(event);
    if (pointerId !== null && event.pointerId === pointerId) {
      if (panGesture) { pan = { x: panGesture.pan.x + p.x - panGesture.start.x, y: panGesture.pan.y + p.y - panGesture.start.y }; updateCamera(); }
      else advanceGrip(event);
      event.preventDefault();
    } else updateHover(p, event.altKey);
  });
  function finishPointer(event) {
    if (event.pointerId !== pointerId) return;
    if (panGesture) { panGesture = null; $('viewport').classList.remove('is-panning'); }
    else { setNeighborLock(event.ctrlKey || event.metaKey); advanceGrip(event); controller.release(); }
    releaseCapture(); canvas.style.cursor = 'grab';
  }
  canvas.addEventListener('pointerup', finishPointer);
  canvas.addEventListener('pointercancel', event => { if (event.pointerId === pointerId) cancelDrag(); });
  canvas.addEventListener('lostpointercapture', event => { if (event.pointerId === pointerId) cancelDrag(); });
  canvas.addEventListener('pointerleave', () => { if (pointerId === null) clearHover(); });
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
    zoomAt(zoom * Math.exp(-clamp(delta, -250, 250) * .0025), localPoint(event));
  }, { passive: false });
  canvas.addEventListener('keydown', event => {
    if (event.key === 'Escape') { cancelDrag(); event.preventDefault(); return; }
    if (event.code === 'Space') { spaceHeld = true; clearHover(); canvas.style.cursor = 'grab'; event.preventDefault(); return; }
    if (['+', '=', '-', '_', '0'].includes(event.key)) { if (event.key === '0') fitView(); else zoomAt(zoom * (event.key === '-' || event.key === '_' ? 1 / 1.25 : 1.25)); event.preventDefault(); return; }
    if (!event.key.startsWith('Arrow') || pointerId !== null) return;
    const s = blocks.find(q => q.id === selectedId && !q.locked); if (!s) return;
    if (!keyboardTarget) { keyboardTarget = { x: s.x + s.w / 2, y: s.y + s.h / 2 }; controller.begin(s.id, keyboardTarget); }
    keys.add(event.key); event.preventDefault();
  });
  canvas.addEventListener('keyup', event => { if (event.code === 'Space') { spaceHeld = false; event.preventDefault(); } if (!keys.has(event.key)) return; keys.delete(event.key); if (!keys.size && keyboardTarget) { controller.release(); keyboardTarget = null; } event.preventDefault(); });
  canvas.addEventListener('blur', () => { spaceHeld = false; if (grip) cancelDrag(); else if (keyboardTarget) { controller.release(); keys.clear(); keyboardTarget = null; } });
  window.addEventListener('keydown', event => { if (pointerId === null && hoverPoint) updateHover(hoverPoint, event.altKey); setNeighborLock(event.ctrlKey || event.metaKey); });
  window.addEventListener('keyup', event => { if (pointerId === null && hoverPoint) updateHover(hoverPoint, event.altKey); setNeighborLock(event.ctrlKey || event.metaKey); if (event.code === 'Space') spaceHeld = false; });
  window.addEventListener('blur', () => { spaceHeld = false; if (pointerId !== null || keyboardTarget) cancelDrag(); else setNeighborLock(false); });
  $('zoom-in').addEventListener('click', () => zoomAt(zoom * 1.25));
  $('zoom-out').addEventListener('click', () => zoomAt(zoom / 1.25));
  $('zoom-fit').addEventListener('click', fitView);
  $('reset-scene').addEventListener('click', resetScene);
  $('view-iso').addEventListener('click', () => setView('iso')); $('view-top').addEventListener('click', () => setView('top'));
  $('show-guides').addEventListener('click', () => { showGuides = !showGuides; $('show-guides').classList.toggle('active', showGuides); $('show-guides').setAttribute('aria-pressed', showGuides); });
  $('sound').addEventListener('click', async () => {
    try {
      if (!sound) { const Audio = window.AudioContext || window.webkitAudioContext; if (!Audio) throw new Error('Audio unavailable'); audioContext ||= new Audio(); await audioContext.resume(); }
      sound = !sound; $('sound').textContent = sound ? 'Sound on' : 'Sound off'; $('sound').classList.toggle('active', sound); $('sound').setAttribute('aria-pressed', sound);
    } catch (error) { toast('Sound is unavailable in this browser. Visual contact feedback is active.'); }
  });
  document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => { activeSlot = 'b'; settingsB = { ...P.defaults, ...P.presets[button.dataset.preset] }; controller.configure(settingsB); updateControls(); persist(); toast(button.textContent.replace('↗', '').trim() + ' feel loaded.'); }));
  document.querySelectorAll('[data-recipe]').forEach(button => button.addEventListener('click', () => {
    const index = Number(button.dataset.recipe); $('recipe-title').textContent = recipes[index][0]; $('recipe-description').textContent = recipes[index][1]; $('recipe-number').textContent = String(index + 1).padStart(2, '0') + ' — 03';
    document.querySelectorAll('[data-recipe]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', b === button); });
  }));
  ['a', 'b'].forEach(slot => $('compare-' + slot).addEventListener('click', () => { activeSlot = slot; controller.configure(current()); updateControls(); toast(slot === 'a' ? 'A · saved reference' : 'B · live tuning'); }));
  $('save-reference').addEventListener('click', () => { referenceA = { ...settingsB }; updateControls(); persist(); toast('This feel is now your A reference. Keep tuning B to compare.'); });
  $('reset-tuning').addEventListener('click', () => { activeSlot = 'b'; settingsB = { ...P.defaults, ...P.presets.crisp }; controller.configure(settingsB); updateControls(); persist(); toast('Crisp tuning restored. Your A reference stays.'); });
  $('export').addEventListener('click', () => {
    const data = { type: 'program-board-drag-feel', version: 1, settings: { ...settingsB }, reference: referenceA };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'drag-feel.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Feel exported.');
  });
  $('import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    try {
      if (file.size > 100000) throw new Error('Choose a drag-feel JSON file under 100 KB.');
      const data = JSON.parse(await file.text());
      if (data.type !== 'program-board-drag-feel' || data.version !== 1) throw new Error('Choose an exported Drag feel file (version 1).');
      const nextB = settingsFrom(data.settings), nextA = settingsFrom(data.reference || data.settings);
      cancelDrag(); settingsB = nextB; referenceA = nextA; activeSlot = 'b'; controller.configure(current()); updateControls(); persist(); toast('Feel imported.');
    } catch (error) { toast(error.message || 'That feel file could not be read.'); }
  });
  // A read-only snapshot helps deterministic browser QA without exposing program data.
  window.DragFeelBench = Object.freeze({ snapshot: () => clone({ blocks, settings: current(), telemetry: controller.telemetry, activeSlot, reference: referenceA, view, grip, camera: { zoom, pan, scale, origin } }) });
})();
