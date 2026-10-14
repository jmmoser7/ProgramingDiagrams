'use strict';

// Deterministic, position-based solid motion. There is no throw or bounce:
// contact pushes neighboring bodies, a blocked chain stops, and continued
// pressure may lift the held body onto a cell. Walls never become stairs.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProgramIsoPhysics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const EPS = 0.0001, PRESSURE_TIME = 0.46, HOP_TIME = 0.28;
  const z = s => Math.max(0, Number(s.z) || 0), h = s => Math.max(0.1, Number(s.height) || 8);
  const locked = s => !!(s && (s.locked || s.immovable || s.fixed || s.isWall));
  const overlap1 = (a, an, b, bn, gap = 0) => a < b + bn + gap - EPS && b < a + an + gap - EPS;
  const xyOverlap = (a, b, gap = 0) => overlap1(a.x, a.w, b.x, b.w, gap) && overlap1(a.y, a.h, b.y, b.h, gap);
  const zOverlap = (a, b) => overlap1(z(a), h(a), z(b), h(b));
  const intersects = (a, b, gap = 0) => xyOverlap(a, b, gap) && zOverlap(a, b);
  const state = list => list.map(s => ({ id: s.id, x: s.x, y: s.y, z: z(s), w: s.w, h: s.h, height: h(s) }));
  function supporters(list, selected) {
    const ids = new Set(), queue = [];
    function add(id) { const s = list.find(q => q.id === id), members = s?.group ? list.filter(q => q.group === s.group) : s ? [s] : []; for (const member of members) if (!ids.has(member.id)) { ids.add(member.id); queue.push(member.id); } }
    for (const id of selected) add(id);
    while (queue.length) {
      const id = queue.shift(), base = list.find(s => s.id === id); if (!base) continue;
      for (const upper of list) if (!ids.has(upper.id) && !locked(upper) && !(upper.group && list.some(q => q.group === upper.group && locked(q))) && Math.abs(z(upper) - z(base) - h(base)) < 0.002 && xyOverlap(base, upper)) add(upper.id);
    }
    return ids;
  }
  function groupBody(list, id, carry = true) {
    const s = list.find(q => q.id === id), ids = new Set([id]);
    if (s?.group) for (const q of list) if (q.group === s.group) ids.add(q.id);
    return carry ? supporters(list, ids) : ids;
  }
  function wallBodies(options) {
    const walls = (options.obstacles || []).map((q, i) => ({ z: 0, height: 1e8, isWall: true, ...q, id: q.id || 'wall-' + i }));
    for (const line of options.lines || []) for (let i = 0; i + 1 < line.points.length; i++) {
      const a = line.points[i], b = line.points[i + 1], pad = Math.max(0.25, (line.width || 2) / 2);
      walls.push({ id: line.id + '-' + i, x: Math.min(a[0], b[0]) - pad, y: Math.min(a[1], b[1]) - pad, w: Math.max(pad * 2, Math.abs(a[0] - b[0]) + pad * 2), h: Math.max(pad * 2, Math.abs(a[1] - b[1]) + pad * 2), z: 0, height: 1e8, isWall: true, segment: [a, b], pad });
    }
    return walls;
  }
  function clearanceFor(s, q, axis, sign, gap) {
    const size = axis === 'x' ? 'w' : 'h';
    if (!q.segment) return sign > 0 ? q[axis] - s[axis] - s[size] - gap : s[axis] - q[axis] - q[size] - gap;
    // Clip a diagonal wall to the moving rectangle's transverse slab. Its
    // bounding box alone would incorrectly block the entire empty triangle.
    const a = q.segment[0], b = q.segment[1], i = axis === 'x' ? 0 : 1, j = 1 - i, orth = axis === 'x' ? 'y' : 'x', orthSize = axis === 'x' ? 'h' : 'w', pad = q.pad + gap;
    const lo = s[orth] - pad, hi = s[orth] + s[orthSize] + pad; let t0 = 0, t1 = 1;
    if (Math.abs(b[j] - a[j]) < EPS) { if (a[j] < lo || a[j] > hi) return Infinity; }
    else { const ta = (lo - a[j]) / (b[j] - a[j]), tb = (hi - a[j]) / (b[j] - a[j]); t0 = Math.max(0, Math.min(ta, tb)); t1 = Math.min(1, Math.max(ta, tb)); if (t0 > t1) return Infinity; }
    const p = a[i] + (b[i] - a[i]) * t0, r = a[i] + (b[i] - a[i]) * t1, min = Math.min(p, r) - pad, max = Math.max(p, r) + pad;
    if (sign > 0 && max <= s[axis] + EPS || sign < 0 && min >= s[axis] + s[size] - EPS) return Infinity;
    return sign > 0 ? min - s[axis] - s[size] : s[axis] - max;
  }
  function move(list, ids, dx, dy, options = {}) {
    if (!options.singleStep && Math.abs(dx) > EPS && Math.abs(dy) > EPS && options.mode !== 'ghost') {
      const own = list.filter(s => new Set(ids).has(s.id)), step = Math.max(0.25, Math.min(...own.map(s => Math.min(s.w, s.h))) * 0.2), count = Math.min(2000, Math.max(1, Math.ceil(Math.hypot(dx, dy) / step)));
      let ax = 0, ay = 0, blockers = [], carried = new Set(ids);
      for (let i = 0; i < count; i++) { const result = move(list, ids, dx / count, dy / count, { ...options, singleStep: true }); ax += result.dx; ay += result.dy; blockers.push(...result.blockers); carried = result.carried; }
      return { dx: ax, dy: ay, blocked: Math.hypot(dx - ax, dy - ay) > EPS, blockers, carried };
    }
    const all = list.concat(wallBodies(options)), held = supporters(list, ids), gap = Math.max(0, options.gap || 0), starts = state(list), blockers = [];
    const frame = options.frame, byId = new Map(all.map(s => [s.id, s]));
    if ([...held].some(id => locked(byId.get(id)))) return { dx: 0, dy: 0, blocked: true, blockers: [{ wall: true }], carried: held };
    function reset() { starts.forEach(o => { const s = byId.get(o.id); s.x = o.x; s.y = o.y; s.z = o.z; }); }
    function axisMove(body, axis, amount, path) {
      if (Math.abs(amount) < EPS) return 0;
      const sign = Math.sign(amount), desired = Math.abs(amount), size = axis === 'x' ? 'w' : 'h', orth = axis === 'x' ? 'y' : 'x', orthSize = axis === 'x' ? 'h' : 'w';
      let allowed = desired;
      for (const id of body) {
        const s = byId.get(id); if (!s || s.isWall) continue;
        if (frame) { const edge = sign > 0 ? frame[axis] + frame[size] - gap - s[axis] - s[size] : s[axis] - frame[axis] - gap; if (edge < allowed) { allowed = Math.max(0, edge); blockers.push({ sticky: s, wall: true, axis, sign }); } }
        const candidates = all.filter(q => !body.has(q.id) && !path.has(q.id) && s.passId !== q.id && q.passId !== s.id && zOverlap(s, q) && overlap1(s[orth], s[orthSize], q[orth], q[orthSize], gap)).map(q => {
          const behind = sign > 0 ? q[axis] + q[size] <= s[axis] + EPS : q[axis] >= s[axis] + s[size] - EPS;
          const clearance = clearanceFor(s, q, axis, sign, gap);
          return { q, clearance: Math.max(0, clearance), behind };
        }).filter(q => !q.behind && q.clearance < allowed - EPS).sort((a, b) => a.clearance - b.clearance);
        for (const candidate of candidates) {
          const q = candidate.q, clearance = clearanceFor(s, q, axis, sign, gap);
          if (clearance >= allowed - EPS) continue;
          let pushed = 0;
          const next = groupBody(list, q.id), fixed = options.mode === 'isolate' || q.isWall || [...next].some(id => locked(byId.get(id)) || held.has(id));
          if (!fixed && options.mode !== 'ghost') {
            const visited = new Set([...path, ...body]); pushed = Math.abs(axisMove(next, axis, sign * (allowed - Math.max(0, clearance)), visited));
          }
          const limit = Math.max(0, clearance) + pushed;
          if (limit < allowed - EPS) { allowed = limit; blockers.push({ sticky: q, wall: !!q.isWall, axis, sign }); }
        }
      }
      for (const id of body) { const s = byId.get(id); if (s && !s.isWall) s[axis] += sign * allowed; }
      return sign * allowed;
    }
    if (options.mode === 'ghost') {
      if (frame) for (const s of list) if (held.has(s.id)) { dx = Math.max(frame.x + gap - s.x, Math.min(frame.x + frame.w - gap - s.x - s.w, dx)); dy = Math.max(frame.y + gap - s.y, Math.min(frame.y + frame.h - gap - s.y - s.h, dy)); }
      for (const s of list) if (held.has(s.id)) { s.x += dx; s.y += dy; } return { dx, dy, blocked: false, blockers: [], carried: held };
    }
    // Replaying a constrained step prevents a speculative push of one branch
    // from moving it farther than a second, wall-blocked branch allows.
    let actualX = axisMove(held, 'x', dx, new Set()), actualY = axisMove(held, 'y', dy, new Set());
    if (Math.abs(actualX - dx) > EPS || Math.abs(actualY - dy) > EPS) { reset(); axisMove(held, 'x', actualX, new Set()); axisMove(held, 'y', actualY, new Set()); }
    return { dx: actualX, dy: actualY, blocked: Math.hypot(dx - actualX, dy - actualY) > EPS, blockers, carried: held };
  }
  function verticalMove(list, ids, delta, options = {}) {
    const body = supporters(list, ids), gap = 0; let allowed = Math.abs(delta), sign = Math.sign(delta);
    if (list.some(s => body.has(s.id) && locked(s))) return 0;
    for (const s of list) if (body.has(s.id)) {
      if (sign < 0) allowed = Math.min(allowed, z(s));
      for (const q of list) if (!body.has(q.id) && xyOverlap(s, q, gap)) {
        const clearance = sign > 0 ? z(q) - z(s) - h(s) : z(s) - z(q) - h(q);
        const ahead = sign > 0 ? z(q) >= z(s) + h(s) - EPS : z(q) + h(q) <= z(s) + EPS;
        if (ahead) allowed = Math.min(allowed, Math.max(0, clearance));
      }
    }
    for (const s of list) if (body.has(s.id)) s.z = z(s) + sign * allowed;
    return sign * allowed;
  }
  function restingHeight(list, s) {
    let top = 0;
    for (const q of list) if (q.id !== s.id && xyOverlap(s, q) && z(q) + h(q) <= z(s) + EPS) top = Math.max(top, z(q) + h(q));
    return top;
  }
  function gravity(list, dt, held = new Set(), velocities = new Map()) {
    let active = false; const ordered = list.slice().sort((a, b) => z(a) - z(b)), visited = new Set();
    for (const s of ordered) {
      if (visited.has(s.id)) continue; const ids = groupBody(list, s.id), members = list.filter(q => ids.has(q.id)); members.forEach(q => visited.add(q.id));
      if (members.some(q => held.has(q.id) || locked(q))) { members.forEach(q => velocities.delete(q.id)); continue; }
      let distance = Infinity;
      for (const member of members) { let support = 0; for (const q of list) if (!ids.has(q.id) && xyOverlap(member, q) && z(q) + h(q) <= z(member) + EPS) support = Math.max(support, z(q) + h(q)); distance = Math.min(distance, z(member) - support); }
      if (distance <= EPS) { members.forEach(q => velocities.delete(q.id)); continue; }
      const velocity = Math.min(200, Math.max(...members.map(q => velocities.get(q.id) || 0)) + 110 * dt), fall = Math.min(distance, velocity * dt);
      members.forEach(q => { q.z = Math.max(0, z(q) - fall); velocities.set(q.id, velocity); }); if (distance - fall > EPS) active = true;
    }
    return active;
  }
  function separate(list, held, options = {}) {
    for (let pass = 0; pass < 40; pass++) {
      let pair = null;
      for (let i = 0; i < list.length && !pair; i++) for (let j = i + 1; j < list.length; j++) if (intersects(list[i], list[j])) { pair = [list[i], list[j]]; break; }
      if (!pair) return true;
      let [a, b] = pair; if (held.has(a.id) || locked(a)) [a, b] = [b, a];
      if (locked(a)) return false;
      const gap = Math.max(0, options.gap || 0), choices = [{ dx: b.x + b.w + gap - a.x, dy: 0 }, { dx: b.x - a.w - gap - a.x, dy: 0 }, { dx: 0, dy: b.y + b.h + gap - a.y }, { dx: 0, dy: b.y - a.h - gap - a.y }].sort((p, q) => Math.hypot(p.dx, p.dy) - Math.hypot(q.dx, q.dy));
      let resolved = false;
      for (const step of choices) {
        const original = state(list), result = move(list, groupBody(list, a.id), step.dx, step.dy, { ...options, mode: 'ghost' });
        const inFrame = !options.frame || list.filter(s => result.carried.has(s.id)).every(s => s.x >= options.frame.x + gap - EPS && s.y >= options.frame.y + gap - EPS && s.x + s.w <= options.frame.x + options.frame.w - gap + EPS && s.y + s.h <= options.frame.y + options.frame.h - gap + EPS);
        if (inFrame && !list.some(q => !result.carried.has(q.id) && intersects(a, q))) { resolved = true; break; }
        original.forEach(old => { const s = list.find(q => q.id === old.id); s.x = old.x; s.y = old.y; s.z = old.z; });
      }
      if (!resolved) return false;
    }
    return false;
  }
  function session(list, ids, options = {}) {
    const selected = new Set(ids), initial = state(list), first = list.find(s => selected.has(s.id));
    let target = { dx: 0, dy: 0 }, pressure = { elapsed: 0, id: null, ratio: 0 }, hop = null, last = null, active = true;
    let mode = options.mode || 'normal';
    function step(dt = 1 / 60) {
      if (!active || !first) return { active: false }; dt = Math.min(0.05, Math.max(0, dt));
      const start = initial.find(s => s.id === first.id), dx = target.dx - (first.x - start.x), dy = target.dy - (first.y - start.y), limit = options.maxSpeed === Infinity ? Infinity : (options.maxSpeed || 220) * dt;
      const length = Math.hypot(dx, dy), fraction = length > limit ? limit / length : 1;
      if (hop) {
        hop.elapsed += dt; const t = Math.min(1, hop.elapsed / HOP_TIME), desired = hop.from + (hop.to - hop.from) * (1 - Math.pow(1 - t, 3));
        verticalMove(list, selected, desired - z(first));
        if (t === 1 || Math.abs(z(first) - desired) > 0.01) { hop = null; pressure = { elapsed: 0, id: null, ratio: 0 }; }
      }
      last = move(list, selected, dx * fraction, dy * fraction, { ...options, mode });
      const obstruction = last.blockers.find(b => !b.wall && b.sticky && !selected.has(b.sticky.id));
      if (!hop && options.hopping !== false && mode !== 'ghost' && obstruction && length > Math.max(0.5, Math.min(first.w, first.h) * 0.04) && last.blocked) {
        const id = obstruction.sticky.id; pressure.elapsed = pressure.id === id ? pressure.elapsed + dt : dt; pressure.id = id; pressure.ratio = Math.min(1, pressure.elapsed / PRESSURE_TIME);
        if (pressure.elapsed >= PRESSURE_TIME) {
          const top = z(obstruction.sticky) + h(obstruction.sticky), lift = top - z(first);
          if (lift > EPS && lift <= (options.maxHop || 250)) { hop = { from: z(first), to: top, elapsed: 0, obstacle: id }; pressure.ratio = 1; }
        }
      } else if (!hop) pressure = { elapsed: 0, id: null, ratio: 0 };
      return { active: length > 0.001 || !!hop || pressure.elapsed > 0, moved: Math.hypot(last.dx, last.dy), blocked: last.blocked, pressure: { ...pressure }, hop: hop && { ...hop }, carried: last.carried };
    }
    return { selected, initial, setTarget(dx, dy) { target = { dx, dy }; }, setMode(value) { mode = value; if (mode === 'ghost') { pressure = { elapsed: 0, id: null, ratio: 0 }; hop = null; } }, step, release() { active = false; pressure = { elapsed: 0, id: null, ratio: 0 }; hop = null; }, get pressure() { return pressure; }, get hop() { return hop; }, get last() { return last; }, get carried() { return supporters(list, selected); } };
  }
  return { EPS, PRESSURE_TIME, HOP_TIME, z, h, locked, xyOverlap, zOverlap, intersects, state, supporters, groupBody, move, verticalMove, restingHeight, gravity, separate, session };
});
