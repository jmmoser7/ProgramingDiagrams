'use strict';

// The laboratory keeps input dynamics separate from the production solid solver.
// Every translation, including inertia and magnetic attraction, still passes
// through the same swept collisions used by the isometric board.
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('../iso-physics.js') : root.ProgramIsoPhysics);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DragFeelPhysics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (P) {
  const defaults = Object.freeze({
    buffer: 2, follow: 26, damping: 0.9, friction: 7, inertia: 0.18, maxSpeed: 210,
    gridEnabled: true, gridSize: 10, edgeEnabled: true, snapRadius: 1.8,
    snapRelease: 4, snapStrength: 1, edgeRange: 28, featureBias: 0.7,
    featureGrabEnabled: true, featureGrabRadius: 10,
    collisionFeedback: 0.65, collisionDamping: 0.9,
    climbEnabled: true, climbPressure: 8, climbMinPressure: 30, climbHold: 360, climbRelease: 100,
    climbResistance: 0.6, climbDuration: 220, maxClimb: 16
  });
  const controls = [
    ['Space', 'buffer', 'Block buffer', 0, 10, 0.25, 'u', 'Clear space between solid blocks and the boundary.'],
    ['Motion', 'follow', 'Keyboard response', 4, 55, 1, '/s', 'Response of arrow-key movement. Held mouse grips follow directly.'],
    ['Motion', 'damping', 'Keyboard damping', 0.25, 2, 0.05, '', 'Settling of arrow-key movement. Held mouse grips do not stretch.'],
    ['Motion', 'friction', 'Release friction', 0, 30, 0.5, '/s', 'Resistance in release inertia and keyboard motion; held mouse movement stays direct.'],
    ['Motion', 'inertia', 'Release inertia', 0, 1, 0.01, '', 'How much velocity survives letting go. Zero stops immediately.'],
    ['Motion', 'maxSpeed', 'Release speed limit', 30, 450, 5, 'u/s', 'Caps release inertia and arrow-key motion. Held mouse grips follow directly through solid contact.'],
    ['Magnetism', 'gridEnabled', 'Grid magnets', null, null, null, '', 'Attract block edges to grid lines.'],
    ['Magnetism', 'gridSize', 'Grid spacing', 2, 30, 1, 'u', 'Distance between grid lines.'],
    ['Magnetism', 'edgeEnabled', 'Neighbor magnets', null, null, null, '', 'Attract to nearby edges, support-roof corners and midpoints, and legal buffer clearances.'],
    ['Magnetism', 'snapRadius', 'Magnetic reach', 0.1, 8, 0.1, 'u', 'How close you must get before a magnet catches.'],
    ['Magnetism', 'snapRelease', 'Magnetic breakaway', 0.2, 14, 0.2, 'u', 'How far you pull away before a captured magnet lets go.'],
    ['Magnetism', 'snapStrength', 'Magnetic click', 0, 1, 0.05, '', 'Blends attraction from a subtle nudge to an exact click.'],
    ['Magnetism', 'edgeRange', 'Neighbor search', 4, 60, 1, 'u', 'Only nearby blocks can attract your block.'],
    ['Magnetism', 'featureBias', 'Grab-side bias', 0, 1, 0.05, '', 'Makes corners and edge midpoints near the chosen grip stronger than features on the far side.'],
    ['Magnetism', 'featureGrabEnabled', 'Feature grips', null, null, null, '', 'Capture the surface grip at a nearby corner or edge midpoint. Independent of neighbor magnets.'],
    ['Magnetism', 'featureGrabRadius', 'Grip capture radius', 4, 24, 1, 'px', 'Screen distance within which a corner or edge midpoint captures the initial grip.'],
    ['Contact', 'collisionFeedback', 'Contact click', 0, 1, 0.05, '', 'Strength of the visual and optional sound impulse on first contact.'],
    ['Contact', 'collisionDamping', 'Contact damping', 0, 1, 0.05, '', 'Velocity absorbed by contact during release or arrow-key motion. Held mouse contact stays firm.'],
    ['Level change', 'climbEnabled', 'Pressure to climb', null, null, null, '', 'Keep pushing against a block to rise onto its top.'],
    ['Level change', 'climbPressure', 'Pressure dead travel', 1, 24, 0.5, 'u', 'Initial push into the contact face before pressure starts rising; capped below center alignment for small blocks.'],
    ['Level change', 'climbMinPressure', 'Minimum climb pressure', 5, 100, 5, '%', 'Pressure must reach this threshold before a held push can climb.'],
    ['Level change', 'climbHold', 'Give time at full pressure', 80, 1200, 20, 'ms', 'Time to give way at full pressure, adjusted by resistance. Lighter qualifying pressure takes longer.'],
    ['Level change', 'climbRelease', 'Pressure release', 0, 500, 10, 'ms', 'How quickly accumulated pressure drains when you ease off.'],
    ['Level change', 'climbResistance', 'Level resistance', 0, 1, 0.05, '', 'Higher resistance needs a longer, firmer push before giving way.'],
    ['Level change', 'climbDuration', 'Climb duration', 80, 700, 10, 'ms', 'Duration of the upward movement after the threshold releases.'],
    ['Level change', 'maxClimb', 'Maximum step', 2, 40, 1, 'u', 'Highest obstacle that pressure is allowed to climb.']
  ].map(([section, key, label, min, max, step, unit, description]) => Object.freeze({ section, key, label, type: min === null ? 'boolean' : 'range', min, max, step, unit, description }));
  const presets = Object.freeze({
    crisp: Object.freeze({ ...defaults }),
    soft: Object.freeze({ ...defaults, follow: 14, damping: 0.75, friction: 4, inertia: 0.35, snapStrength: 0.7, collisionFeedback: 0.35, climbResistance: 0.3, climbHold: 240 }),
    heavy: Object.freeze({ ...defaults, follow: 11, damping: 1.3, friction: 11, inertia: 0.08, maxSpeed: 115, collisionFeedback: 0.85, climbResistance: 0.9, climbHold: 620, climbDuration: 360 })
  });
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
  const distance1 = (a, an, b, bn) => Math.max(0, b - a - an, a - b - bn);

  function cleanSettings(value, base = defaults) {
    const result = { ...base };
    for (const control of controls) {
      if (!Object.prototype.hasOwnProperty.call(value || {}, control.key)) continue;
      if (control.type === 'boolean') result[control.key] = !!value[control.key];
      else if (Number.isFinite(Number(value[control.key]))) result[control.key] = clamp(Number(value[control.key]), control.min, control.max);
    }
    return result;
  }

  function create(initialBlocks, initialSettings = {}, options = {}) {
    if (!P) throw new Error('Load iso-physics.js before drag-feel/physics.js.');
    let blocks = initialBlocks, settings = cleanSettings(initialSettings), id = null;
    let held = false, coasting = false, velocity = { x: 0, y: 0 }, raw = null, offset = null;
    let runtimeIsolated = false, coastIsolated = false;
    let firmGrip = false, firmPending = false, firmFrameDt = 1 / 60, firmBlockedAxes = new Set(), localGrip = null;
    let before = null, pressure = 0, force = 0, overtravel = 0, pressureId = null, hop = null, gravityActive = false;
    let locks = { x: null, y: null }, guides = [], contactIds = new Set(), contact = 0, snapText = '';
    let state = 'idle', gravityVelocities = new Map(), lastMoved = 0;
    const lookup = () => blocks.find(block => block.id === id);
    const selected = () => id == null ? new Set() : P.groupBody(blocks, id);
    const isolated = () => options.push === false || runtimeIsolated || coasting && coastIsolated;
    const physicsOptions = () => ({ gap: settings.buffer, frame: options.frame || null, mode: isolated() ? 'isolate' : 'normal' });
    function emit(type, extra = {}) { if (typeof options.onEvent === 'function') options.onEvent({ type, ...extra }); }
    function clearMotion(preserveIsolation = false) {
      held = false; coasting = false; id = null; raw = null; offset = null;
      if (!preserveIsolation) runtimeIsolated = false;
      coastIsolated = false;
      firmGrip = false; firmPending = false; firmFrameDt = 1 / 60; firmBlockedAxes.clear();
      localGrip = null;
      velocity = { x: 0, y: 0 }; pressure = 0; force = 0; overtravel = 0; pressureId = null; hop = null;
      locks = { x: null, y: null }; guides = []; snapText = ''; contact = 0; state = 'idle';
    }

    // A larger buffer must make room immediately; it must never manufacture
    // body overlap or move a locked fixture. Choose the shortest legal axis.
    function settleBuffer() {
      const op = physicsOptions(), frame = op.frame;
      if (frame) for (const block of blocks) if (!P.locked(block)) {
        const x = clamp(block.x, frame.x + settings.buffer, Math.max(frame.x + settings.buffer, frame.x + frame.w - settings.buffer - block.w));
        const y = clamp(block.y, frame.y + settings.buffer, Math.max(frame.y + settings.buffer, frame.y + frame.h - settings.buffer - block.h));
        P.move(blocks, P.groupBody(blocks, block.id), x - block.x, y - block.y, { ...op, mode: 'ghost' });
      }
      P.separate(blocks, new Set(), op);
      for (let pass = 0; pass < 35; pass++) {
        let changed = false;
        for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
          const a = blocks[i], b = blocks[j];
          if (a.group && a.group === b.group || !P.zOverlap(a, b) || !P.xyOverlap(a, b, Math.max(0, settings.buffer - 0.001))) continue;
          const moves = [
            { who: a, dx: b.x - a.w - settings.buffer - a.x, dy: 0 },
            { who: a, dx: b.x + b.w + settings.buffer - a.x, dy: 0 },
            { who: a, dx: 0, dy: b.y - a.h - settings.buffer - a.y },
            { who: a, dx: 0, dy: b.y + b.h + settings.buffer - a.y },
            { who: b, dx: a.x - b.w - settings.buffer - b.x, dy: 0 },
            { who: b, dx: a.x + a.w + settings.buffer - b.x, dy: 0 },
            { who: b, dx: 0, dy: a.y - b.h - settings.buffer - b.y },
            { who: b, dx: 0, dy: a.y + a.h + settings.buffer - b.y }
          ].filter(move => !P.locked(move.who)).sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy));
          for (const move of moves) {
            const original = P.state(blocks), ids = P.groupBody(blocks, move.who.id);
            const restore = () => original.forEach(old => { const item = blocks.find(block => block.id === old.id); item.x = old.x; item.y = old.y; item.z = old.z; });
            P.move(blocks, ids, move.dx, move.dy, op);
            if (!P.xyOverlap(a, b, Math.max(0, settings.buffer - 0.001))) { changed = true; break; }
            restore();
            // If the enlarged envelopes already overlap, the swept solver
            // cannot move transversely out of them. Try an explicit repair,
            // accepting it only when every physical volume remains legal.
            P.move(blocks, ids, move.dx, move.dy, { ...op, mode: 'ghost' });
            const legal = !P.xyOverlap(a, b, Math.max(0, settings.buffer - 0.001)) && blocks.every((item, index) => blocks.slice(index + 1).every(other => !P.intersects(item, other)));
            if (legal) { changed = true; break; }
            restore();
          }
        }
        if (!changed) break;
      }
      gravityActive = true;
    }

    function features(block, plane = P.h(block)) {
      return [['nw', 0, 0], ['n', block.w / 2, 0], ['ne', block.w, 0], ['e', block.w, block.h / 2], ['se', block.w, block.h], ['s', block.w / 2, block.h], ['sw', 0, block.h], ['w', 0, block.h / 2]]
        .map(([id, x, y]) => ({ id, feature: id.length === 1 ? 'midpoint' : 'corner', x, y, z: plane }));
    }
    function featureWeight(block, feature) {
      if (!localGrip) return 1;
      const distance = Math.hypot(feature.x - localGrip.x, feature.y - localGrip.y, feature.z - localGrip.z);
      return 1 - settings.featureBias * 0.8 * Math.min(1, distance / Math.max(1, Math.hypot(block.w, block.h, P.h(block))));
    }
    function closestFeature(list, block, axis, coordinate, reference) {
      const orth = axis === 'x' ? 'y' : 'x';
      return list.filter(feature => Math.abs(feature[axis] - coordinate) < P.EPS).sort((a, b) => reference == null ? featureWeight(block, b) - featureWeight(block, a) : Math.abs(a[orth] - reference) - Math.abs(b[orth] - reference))[0];
    }
    function feasiblePair(block, position, own) {
      const dx = position.x - block.x, dy = position.y - block.y, frame = options.frame;
      return blocks.filter(item => own.has(item.id)).every(item => {
        const proposal = { ...item, x: item.x + dx, y: item.y + dy };
        if (frame && (proposal.x < frame.x + settings.buffer - P.EPS || proposal.y < frame.y + settings.buffer - P.EPS || proposal.x + proposal.w > frame.x + frame.w - settings.buffer + P.EPS || proposal.y + proposal.h > frame.y + frame.h - settings.buffer + P.EPS)) return false;
        return blocks.every(other => own.has(other.id) || !P.intersects(proposal, other, Math.max(0, settings.buffer - P.EPS)));
      });
    }
    function candidates(block) {
      const result = { x: [], y: [] }, own = selected(), roofFeatures = features(block);
      for (const axis of ['x', 'y']) if (settings.gridEnabled) {
        const size = axis === 'x' ? 'w' : 'h';
        for (const offset of [0, block[size]]) {
          const sourceLocal = closestFeature(roofFeatures, block, axis, offset), line = Math.round((raw[axis] + offset) / settings.gridSize) * settings.gridSize;
          result[axis].push({ axis, kind: 'grid', role: 'grid', key: 'grid:' + line + ':' + sourceLocal.id, position: line - offset, value: line, sourceLocal, targetId: null, weight: featureWeight(block, sourceLocal), distance: Math.abs(raw[axis] + offset - line), priority: 2 });
        }
      }
      if (!settings.edgeEnabled) return result;
      for (const other of blocks) {
        if (own.has(other.id)) continue;
        const support = Math.abs(P.z(block) - P.z(other) - P.h(other)) < 0.08;
        if (!support && Math.abs(P.z(block) - P.z(other)) >= 0.1) continue;
        if (distance1(raw.x, block.w, other.x, other.w) > settings.edgeRange || distance1(raw.y, block.h, other.y, other.h) > settings.edgeRange) continue;
        const role = support ? 'support' : 'neighbor', sourceFeatures = support ? features(block, 0) : roofFeatures, targetFeatures = features(other);
        // A true feature pair acquires in both axes, so a corner or midpoint
        // really meets its target. On a support, source base meets target roof.
        for (const sourceLocal of sourceFeatures) for (const targetLocal of targetFeatures) {
          const position = { x: other.x + targetLocal.x - sourceLocal.x, y: other.y + targetLocal.y - sourceLocal.y };
          const matchesPlane = support || Math.abs(P.z(block) + sourceLocal.z - P.z(other) - targetLocal.z) < 0.08;
          const restsOnRoof = !support || P.xyOverlap({ ...block, ...position }, other);
          if (!matchesPlane || !restsOnRoof || !feasiblePair(block, position, own)) continue;
          const distance = Math.hypot(raw.x - position.x, raw.y - position.y), weight = featureWeight(block, sourceLocal);
          for (const axis of ['x', 'y']) result[axis].push({ axis, kind: 'edge', role, key: role + ':' + other.id + ':' + sourceLocal.id + ':' + targetLocal.id, position: position[axis], pairPosition: position, value: other[axis] + targetLocal[axis], sourceLocal, targetLocal, targetId: other.id, featurePair: true, weight, distance, priority: 0 });
        }
        if (support) continue;
        // Preserve axis alignment and buffered side contacts for neighboring
        // solids; their guide points identify actual source and target features.
        for (const axis of ['x', 'y']) {
          const size = axis === 'x' ? 'w' : 'h', orth = axis === 'x' ? 'y' : 'x';
          function add(sourceCoordinate, targetCoordinate, bufferShift = 0) {
            const sourceLocal = closestFeature(sourceFeatures, block, axis, sourceCoordinate);
            const targetLocal = closestFeature(targetFeatures, other, axis, targetCoordinate, raw[orth] + sourceLocal[orth] - other[orth]);
            const line = other[axis] + targetLocal[axis] + bufferShift, position = line - sourceLocal[axis];
            result[axis].push({ axis, kind: 'edge', role, key: 'axis:' + other.id + ':' + sourceLocal.id + ':' + targetLocal.id + ':' + bufferShift, position, value: line, sourceLocal, targetLocal, targetId: other.id, bufferShift, weight: featureWeight(block, sourceLocal), distance: Math.abs(raw[axis] - position), priority: 1 });
          }
          for (const targetEdge of [0, other[size]]) for (const sourceEdge of [0, block[size]]) add(sourceEdge, targetEdge);
          // Midline alignment is retained as the legacy one-axis behavior.
          add(block[size] / 2, other[size] / 2);
          add(block[size], 0, -settings.buffer); add(0, other[size], settings.buffer);
        }
      }
      return result;
    }
    function acquire(axis, block, available) {
      const previous = locks[axis], release = Math.max(settings.snapRadius, settings.snapRelease);
      const eligible = available.filter(candidate => candidate.distance <= settings.snapRadius * candidate.weight + P.EPS)
        .sort((a, b) => a.priority - b.priority || a.distance / a.weight - b.distance / b.weight || b.weight - a.weight);
      let best = eligible[0] || null, refreshed = previous && available.find(candidate => candidate.key === previous.key);
      // Grid locks retain their original line through breakaway, even when
      // the nearest grid line changes; object locks regenerate from live data.
      if (!refreshed && previous?.kind === 'grid' && settings.gridEnabled) refreshed = { ...previous, position: previous.value - previous.sourceLocal[axis], distance: Math.abs(raw[axis] - (previous.value - previous.sourceLocal[axis])) };
      if (refreshed && refreshed.distance <= release && !(best && best.priority < refreshed.priority)) best = refreshed;
      if (best && (!previous || previous.key !== best.key)) emit('snap', { axis, kind: best.kind, value: best.value, strength: settings.snapStrength });
      return best;
    }

    function guideFor(lock, block) {
      const local = lock.sourceLocal, other = blocks.find(item => item.id === lock.targetId);
      const source = { x: block.x + local.x, y: block.y + local.y, z: P.z(block) + local.z, feature: local.feature, featureId: local.id, blockId: block.id };
      const target = other ? { x: other.x + lock.targetLocal.x, y: other.y + lock.targetLocal.y, z: P.z(other) + lock.targetLocal.z, feature: lock.targetLocal.feature, featureId: lock.targetLocal.id, blockId: other.id } : { ...source, [lock.axis]: lock.value, feature: 'grid', featureId: lock.axis, blockId: null };
      return { axis: lock.axis, value: other ? target[lock.axis] + (lock.bufferShift || 0) : lock.value, kind: lock.kind, role: lock.role, featurePair: !!lock.featurePair, sourceId: block.id, targetId: other?.id || null, source, target, sourceLocal: { ...local }, targetLocal: lock.targetLocal && { ...lock.targetLocal } };
    }

    function magneticTarget(block) {
      if (!raw || settings.snapStrength <= 0) { locks = { x: null, y: null }; guides = []; snapText = ''; return raw; }
      const target = { ...raw }, available = candidates(block);
      const pairs = available.x.filter(candidate => candidate.featurePair), release = Math.max(settings.snapRadius, settings.snapRelease);
      const oldPair = locks.x?.featurePair && locks.y?.key === locks.x.key && pairs.find(candidate => candidate.key === locks.x.key && candidate.distance <= release);
      const pair = oldPair || pairs.filter(candidate => candidate.distance <= settings.snapRadius * candidate.weight + P.EPS)
        .sort((a, b) => a.distance / a.weight - b.distance / b.weight || b.weight - a.weight)[0];
      for (const axis of ['x', 'y']) {
        if (pair) {
          if (locks[axis]?.key !== pair.key) emit('snap', { axis, kind: pair.kind, value: pair.value, strength: settings.snapStrength });
          locks[axis] = available[axis].find(candidate => candidate.key === pair.key);
        } else locks[axis] = acquire(axis, block, available[axis].filter(candidate => !candidate.featurePair));
        if (locks[axis]) target[axis] += (locks[axis].position - raw[axis]) * settings.snapStrength;
      }
      guides = ['x', 'y'].filter(axis => locks[axis]).map(axis => guideFor(locks[axis], block));
      snapText = pair ? (pair.role === 'support' ? 'Support ' : '') + (pair.targetLocal.feature === 'midpoint' ? 'Midpoint' : 'Vertex') : guides.map(guide => (guide.kind === 'grid' ? 'Grid ' : guide.source.feature === 'midpoint' ? 'Midpoint ' : 'Vertex ') + guide.axis.toUpperCase()).join(' · ');
      return target;
    }

    function updateContacts(block, result, attemptedSpeed, dt) {
      const own = selected(), touching = new Set();
      for (const other of blocks) if (!own.has(other.id) && P.zOverlap(block, other) && P.xyOverlap(block, other, settings.buffer + 0.02)) touching.add(other.id);
      for (const blocker of result.blockers) if (blocker.wall) touching.add('boundary');
      for (const other of touching) if (!contactIds.has(other) && attemptedSpeed > 0.2) {
        const strength = clamp(attemptedSpeed / 80, 0.08, 1) * settings.collisionFeedback;
        contact = Math.max(contact, strength); emit('collision', { id: block.id, other, strength });
      }
      contactIds = touching; contact *= Math.exp(-dt * 10);
      if (result.blocked) for (const axis of ['x', 'y']) {
        const wanted = velocity[axis] * dt, actual = result[axis === 'x' ? 'dx' : 'dy'];
        if (Math.abs(wanted - actual) > 0.0001) velocity[axis] *= 1 - settings.collisionDamping;
      }
    }

    function drainPressure(dt) {
      pressure = settings.climbRelease > 0 ? Math.max(0, pressure - dt * 1000 / settings.climbRelease) : 0;
      if (pressure === 0) pressureId = null;
    }

    function measureForce(block, obstruction) {
      const size = obstruction.axis === 'x' ? 'w' : 'h';
      const centerDistance = (block[size] + obstruction.sticky[size]) / 2 + settings.buffer;
      const configuredDeadTravel = settings.climbPressure * (0.55 + 0.9 * settings.climbResistance);
      // Even a small obstacle must reach full force at center alignment.
      // Keep a positive pressure ramp when dead travel exceeds its size.
      const deadTravel = Math.min(configuredDeadTravel, Math.max(0, centerDistance - Math.min(1, centerDistance)));
      overtravel = Math.max(0, obstruction.sign * (raw[obstruction.axis] - block[obstruction.axis]));
      force = clamp((overtravel - deadTravel) / Math.max(P.EPS, centerDistance - deadTravel), 0, 1);
    }

    function pressureStep(block, result, dt) {
      force = 0; overtravel = 0;
      if (!settings.climbEnabled || !held || !raw) { drainPressure(dt); return; }
      if (hop) {
        const obstacle = blocks.find(item => item.id === hop.obstacle);
        if (obstacle) measureForce(block, { sticky: obstacle, axis: hop.axis, sign: hop.sign });
        return;
      }
      // Only pushing into the actual contact face builds climb pressure.
      // Spring lag along a tangent can be large while a block slides past a
      // surface; that lag must never make an ordinary sideways drag climb.
      const obstruction = result.blockers.filter(item => !item.wall && item.sticky && !selected().has(item.sticky.id) && P.zOverlap(block, item.sticky) && P.xyOverlap(block, item.sticky, settings.buffer + 0.02) && item.sign * (raw[item.axis] - block[item.axis]) > 0)
        .sort((a, b) => b.sign * (raw[b.axis] - block[b.axis]) - a.sign * (raw[a.axis] - block[a.axis]))[0];
      if (!obstruction || !result.blocked) { drainPressure(dt); return; }
      measureForce(block, obstruction);
      const minimum = settings.climbMinPressure / 100;
      if (force + 1e-9 < minimum) { drainPressure(dt); return; }
      const other = obstruction.sticky, top = P.z(other) + P.h(other), lift = top - P.z(block);
      if (lift <= P.EPS || lift > settings.maxClimb) { drainPressure(dt); return; }
      if (pressureId !== other.id) pressure = 0;
      pressureId = other.id;
      const resistance = 0.6 + 0.8 * settings.climbResistance;
      pressure = Math.min(1, pressure + dt * 1000 * force / (settings.climbHold * resistance));
      if (pressure >= 1 && force + 1e-9 >= minimum) {
        hop = { from: P.z(block), to: top, elapsed: 0, obstacle: other.id, axis: obstruction.axis, sign: obstruction.sign, lifted: false, stalled: 0 };
        velocity = { x: 0, y: 0 };
        emit('climb', { id: block.id, obstacle: other.id, height: lift, strength: 1 });
      }
    }

    function moveFirm(block) {
      const target = magneticTarget(block), dx = target.x - block.x, dy = target.y - block.y;
      const result = P.move(blocks, selected(), dx, dy, physicsOptions());
      for (const axis of ['x', 'y']) {
        const intended = axis === 'x' ? dx : dy, actual = axis === 'x' ? result.dx : result.dy;
        if (Math.abs(intended - actual) <= P.EPS) continue;
        firmBlockedAxes.add(axis);
        const sign = Math.sign(intended), size = axis === 'x' ? 'w' : 'h';
        const blockers = result.blockers.filter(item => item.axis === axis && item.sign === sign);
        const blocker = blockers.find(item => !item.wall && item.sticky && Math.abs(sign > 0 ? item.sticky[axis] - block[axis] - block[size] - settings.buffer : block[axis] - item.sticky[axis] - item.sticky[size] - settings.buffer) < 0.02)
          || blockers.find(item => item.wall && (!item.sticky || selected().has(item.sticky.id)));
        const reach = blocker && !blocker.wall ? (block[size] + blocker.sticky[size]) / 2 + settings.buffer : Math.max(1, settings.buffer, block[size] * 0.25);
        // Blocked hand travel is pressure, not a bank of future motion.
        // At most one neighboring-center distance survives a collision.
        if (sign * (raw[axis] - block[axis]) > reach) raw[axis] = block[axis] + sign * reach;
      }
      return { result, distance: Math.hypot(dx, dy) };
    }

    function substep(dt) {
      let block = lookup(), result = null;
      if (block && (held || coasting)) {
        if (hop) {
          hop.elapsed += dt;
          const t = Math.min(1, hop.elapsed * 1000 / settings.climbDuration), eased = 1 - Math.pow(1 - t, 3);
          const desired = hop.from + (hop.to - hop.from) * eased;
          const actual = P.verticalMove(blocks, selected(), desired - P.z(block));
          if (Math.abs(P.z(block) - desired) > 0.001 && Math.abs(actual) < 0.0001) {
            hop = null; pressure = 0; force = 0; overtravel = 0; pressureId = null;
          } else if (t >= 1) hop.lifted = true;
        }
        let speed;
        if (held && firmGrip) {
          const move = moveFirm(block); result = move.result; speed = move.distance / dt;
        } else if (held) {
          const target = magneticTarget(block), k = settings.follow * settings.follow;
          const resistance = 2 * settings.damping * settings.follow + settings.friction;
          velocity.x += ((target.x - block.x) * k - resistance * velocity.x) * dt;
          velocity.y += ((target.y - block.y) * k - resistance * velocity.y) * dt;
        } else {
          const decay = Math.exp(-Math.max(0.6, settings.friction) * dt);
          velocity.x *= decay; velocity.y *= decay;
        }
        if (!result) {
          speed = Math.hypot(velocity.x, velocity.y);
          if (speed > settings.maxSpeed) { const scale = settings.maxSpeed / speed; velocity.x *= scale; velocity.y *= scale; speed = settings.maxSpeed; }
          result = P.move(blocks, selected(), velocity.x * dt, velocity.y * dt, physicsOptions());
        }
        lastMoved = Math.hypot(result.dx, result.dy) / dt;
        updateContacts(block, result, speed, dt);
        pressureStep(block, result, dt);
        if (hop) {
          const obstacle = blocks.find(item => item.id === hop.obstacle), size = hop.axis === 'x' ? 'w' : 'h';
          const orth = hop.axis === 'x' ? 'y' : 'x', orthSize = orth === 'x' ? 'w' : 'h';
          const entry = obstacle && (hop.sign > 0 ? obstacle[hop.axis] - block[size] : obstacle[hop.axis] + obstacle[size]);
          const entering = obstacle && raw && hop.sign * (raw[hop.axis] - entry) > P.EPS && block[orth] < obstacle[orth] + obstacle[orthSize] - P.EPS && obstacle[orth] < block[orth] + block[orthSize] - P.EPS;
          const supported = hop.lifted && Math.abs(P.z(block) - P.restingHeight(blocks, block)) < 0.001;
          const passed = hop.lifted && obstacle && (hop.sign > 0 ? block[hop.axis] >= obstacle[hop.axis] + obstacle[size] - P.EPS : block[hop.axis] + block[size] <= obstacle[hop.axis] + P.EPS);
          if (hop.lifted) hop.stalled = Math.abs(result[hop.axis === 'x' ? 'dx' : 'dy']) < 0.00001 ? hop.stalled + dt : 0;
          if (supported || passed || !entering || hop.stalled > 0.25) {
            if (supported) emit('land', { id: block.id, kind: 'climb', strength: 0.45 });
            hop = null; pressure = 0; force = 0; overtravel = 0; pressureId = null;
          }
        }
        if (!held && Math.hypot(velocity.x, velocity.y) < 0.15) { coasting = false; id = null; velocity = { x: 0, y: 0 }; }
      } else contact *= Math.exp(-dt * 10);
      // Holding controls XY, not elevation. An unsupported held body and its
      // passengers fall together; only a genuine climb temporarily lifts it.
      const heldIds = hop ? selected() : new Set(), elevations = blocks.map(item => P.z(item));
      gravityActive = P.gravity(blocks, dt, heldIds, gravityVelocities);
      blocks.forEach((item, index) => {
        if (elevations[index] - P.z(item) > 0.0001 && Math.abs(P.z(item) - P.restingHeight(blocks, item)) < 0.001) emit('land', { id: item.id, kind: 'gravity', strength: 0.4 });
      });
      block = lookup();
      state = held ? hop ? 'climbing' : pressure > 0 ? 'pressing' : result && result.blocked ? 'contact' : guides.length ? 'magnetic' : 'dragging' : coasting ? 'coasting' : gravityActive ? 'settling' : 'idle';
      if (!block && !coasting) lastMoved = 0;
    }

    const controller = {
      begin(nextId, point, grip = {}) {
        const block = blocks.find(item => item.id === nextId);
        if (!block || P.locked(block) || !finitePoint(point)) return false;
        clearMotion(true); id = nextId; held = true; state = 'dragging';
        firmGrip = !!grip.firm;
        offset = { x: point.x - block.x, y: point.y - block.y };
        localGrip = { x: clamp(number(grip.grip?.x, offset.x), 0, block.w), y: clamp(number(grip.grip?.y, offset.y), 0, block.h), z: clamp(number(grip.grip?.z, P.h(block)), 0, P.h(block)) };
        raw = { x: block.x, y: block.y }; before = P.state(blocks);
        contactIds = new Set(); gravityVelocities.clear(); return true;
      },
      target(point) {
        if (!held || !finitePoint(point)) return;
        const next = { x: point.x - offset.x, y: point.y - offset.y };
        if (firmGrip && (Math.abs(next.x - raw.x) > P.EPS || Math.abs(next.y - raw.y) > P.EPS)) firmPending = true;
        raw = next;
      },
      advance(dx, dy) { if (!held || !raw || !Number.isFinite(dx) || !Number.isFinite(dy)) return false; if (firmGrip && (Math.abs(dx) > P.EPS || Math.abs(dy) > P.EPS)) firmPending = true; raw.x += dx; raw.y += dy; return true; },
      setIsolated(value) { runtimeIsolated = !!value; return isolated(); },
      release() {
        if (!held) return;
        const releasedIsolated = isolated();
        const block = lookup(), reach = Math.max(settings.snapRadius, settings.snapRelease), captured = new Set();
        if (firmGrip && firmPending && block) {
          firmBlockedAxes.clear();
          const start = { x: block.x, y: block.y }, move = moveFirm(block);
          updateContacts(block, move.result, move.distance / firmFrameDt, 0);
          velocity.x = firmBlockedAxes.has('x') ? 0 : (block.x - start.x) / firmFrameDt;
          velocity.y = firmBlockedAxes.has('y') ? 0 : (block.y - start.y) / firmFrameDt;
          lastMoved = Math.hypot(block.x - start.x, block.y - start.y) / firmFrameDt;
          firmPending = false;
        }
        const correction = { x: 0, y: 0 };
        if (block) for (const axis of ['x', 'y']) {
          const lock = locks[axis];
          if (!lock || !raw || Math.abs(raw[axis] - lock.position) > reach || Math.abs(block[axis] - lock.position) > reach) continue;
          // Finish only a nearby, already captured detent. The swept move
          // may stop short of an illegal target, preserving solid contact.
          correction[axis] = lock.position - block[axis]; captured.add(axis);
        }
        if (block && captured.size) P.move(blocks, selected(), correction.x, correction.y, physicsOptions());
        held = false; hop = null; pressure = 0; force = 0; overtravel = 0; pressureId = null;
        locks = { x: null, y: null }; guides = []; snapText = '';
        if (firmGrip) {
          const speed = Math.hypot(velocity.x, velocity.y);
          if (speed > settings.maxSpeed) { velocity.x *= settings.maxSpeed / speed; velocity.y *= settings.maxSpeed / speed; }
        }
        velocity.x = captured.has('x') ? 0 : velocity.x * settings.inertia;
        velocity.y = captured.has('y') ? 0 : velocity.y * settings.inertia;
        coasting = Math.hypot(velocity.x, velocity.y) >= 0.15;
        coastIsolated = releasedIsolated; runtimeIsolated = false;
        if (!coasting) { id = null; velocity = { x: 0, y: 0 }; }
        gravityActive = true; state = coasting ? 'coasting' : 'idle'; before = null;
      },
      cancel() {
        if (before) for (const old of before) { const block = blocks.find(item => item.id === old.id); if (block) { block.x = old.x; block.y = old.y; block.z = old.z; } }
        before = null; clearMotion(); contactIds.clear(); gravityVelocities.clear(); gravityActive = true;
      },
      step(dt = 1 / 60) {
        const elapsed = clamp(number(dt, 1 / 60), 0, 0.2);
        const firmBlock = held && firmGrip ? lookup() : null, firmStart = firmBlock && { x: firmBlock.x, y: firmBlock.y };
        firmBlockedAxes.clear();
        const count = Math.max(1, Math.ceil(elapsed / (1 / 180))), step = elapsed / count;
        if (step > 0) for (let i = 0; i < count; i++) substep(step);
        if (firmStart && elapsed > 0) {
          // Throw follows recent actual travel, never raw blocked pressure.
          // Measure across the caller's frame, not the collision substeps.
          velocity.x = firmBlockedAxes.has('x') ? 0 : (firmBlock.x - firmStart.x) / elapsed;
          velocity.y = firmBlockedAxes.has('y') ? 0 : (firmBlock.y - firmStart.y) / elapsed;
          lastMoved = Math.hypot(firmBlock.x - firmStart.x, firmBlock.y - firmStart.y) / elapsed;
          firmFrameDt = elapsed; firmPending = false;
        }
        return controller.telemetry;
      },
      configure(patch) {
        const previous = settings; settings = cleanSettings(patch, settings);
        locks = { x: null, y: null }; guides = []; snapText = '';
        if (settings.buffer !== previous.buffer) { settleBuffer(); if (held) before = P.state(blocks); }
        if (!settings.climbEnabled) { pressure = 0; force = 0; overtravel = 0; pressureId = null; hop = null; }
        return { ...settings };
      },
      reset(nextBlocks) { clearMotion(); before = null; contactIds.clear(); gravityVelocities.clear(); if (nextBlocks) blocks = nextBlocks; settleBuffer(); },
      get settings() { return { ...settings }; },
      get telemetry() { return { speed: held || coasting ? lastMoved : 0, pressure, force, minPressure: settings.climbMinPressure / 100, overtravel, state, snap: snapText, contact }; },
      get guides() { const block = lookup(); return block ? ['x', 'y'].filter(axis => locks[axis]).map(axis => guideFor(locks[axis], block)) : []; },
      get activeId() { return id; },
      get isIsolated() { return isolated(); },
      get isActive() { return held || coasting || !!hop || gravityActive || contact > 0.002; }
    };
    settleBuffer();
    return controller;
  }
  return { defaults, controls, presets, create };
});
