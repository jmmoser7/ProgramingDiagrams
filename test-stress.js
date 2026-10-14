'use strict';

// Collision stress repro, shared by test.js. Everything here drives the
// engine the way app.js does: pointer frames through engine.step, a release
// that holds what was placed, then a settle to rest. `settle(model, held,
// kind)` is the caller's rest loop; it returns { jam } when it gives up.
//
// Two measurements:
//   rest   - after every settle, the closest pair of bodies (not grouped
//            together) and whether a pair sits inside the buffer without
//            a jam being reported;
//   sides  - every sticky's side of every line, checked after every single
//            step. Lines run wall to wall, so there is no way around them:
//            any change of side is a crossing. Only a ghost (Ctrl+Shift)
//            drag may carry a sticky across; its sides are re-read after
//            the drop.

const TOL = 0.05;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Signed side of a sticky's centre for a one-segment line.
function sideOf(s, l) {
  const a = l.points[0];
  const b = l.points[l.points.length - 1];
  const cx = s.x + s.w * 0.5;
  const cy = s.y + s.h * 0.5;
  return (b[0] - a[0]) * (cy - a[1]) - (b[1] - a[1]) * (cx - a[0]) >= 0 ? 1 : -1;
}

// Whether the box touches the segment itself (the line's core).
function coreHit(s, l) {
  const a = l.points[0];
  const b = l.points[l.points.length - 1];
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const clip = (p, q) => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, a[0] - s.x) && clip(dx, s.x + s.w - a[0]) && clip(-dy, a[1] - s.y) && clip(dy, s.y + s.h - a[1]) && t0 <= t1;
}

// Closest box-to-box separation between different bodies (grouped members
// are one rigid body and never compared), plus pairs inside the buffer.
function restGaps(engine, m) {
  const list = engine.alive(m);
  const gap = m.gap;
  let min = Infinity;
  let groupMin = Infinity;
  let inside = 0;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (a.group && a.group === b.group) continue;
      const sx = Math.abs(a.x + a.w * 0.5 - b.x - b.w * 0.5) - (a.w + b.w) * 0.5;
      const sy = Math.abs(a.y + a.h * 0.5 - b.y - b.h * 0.5) - (a.h + b.h) * 0.5;
      const sep = Math.max(sx, sy);
      if (sep < min) min = sep;
      if ((a.group || b.group) && sep < groupMin) groupMin = sep;
      if (sep < gap - TOL) inside += 1;
    }
  }
  return { min: min, groupMin: groupMin, inside: inside };
}

function makeTracker(engine, m) {
  const t = { base: new Map(), crossings: 0, coreHits: 0, worst: [], op: '', byOp: {} };
  t.read = (list) => {
    (list || engine.alive(m)).forEach((s) => t.base.set(s.id, m.lines.map((l) => sideOf(s, l))));
  };
  t.check = (skip) => {
    const list = engine.alive(m);
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (skip && skip.has(s.id)) continue;
      const was = t.base.get(s.id);
      if (!was) continue;
      for (let k = 0; k < m.lines.length; k++) {
        if (coreHit(s, m.lines[k])) {
          t.coreHits += 1;
          continue;
        }
        const now = sideOf(s, m.lines[k]);
        if (now !== was[k]) {
          t.crossings += 1;
          t.byOp[t.op] = (t.byOp[t.op] || 0) + 1;
          if (t.worst.length < 5) t.worst.push(s.id + ' x ' + m.lines[k].id + ' in ' + t.op);
          was[k] = now;
        }
      }
    }
  };
  return t;
}

function dragOpts(mode, push) {
  return { iters: 6, contactEase: 1, maxPush: Math.max(push, 3), drag: true, isolate: mode === 'isolate', ghost: mode === 'ghost' };
}

// Pointer frames for a sticky selection (and optional lines), then the
// release: one last solve, the placed stickies held, and a settle.
function drag(engine, m, tr, settle, items, lines, dx, dy, frames, mode) {
  const at = items.map((s) => ({ s: s, x: s.x, y: s.y }));
  const lat = lines.map((l) => ({ l: l, x: l.points[0][0], y: l.points[0][1] }));
  lines.forEach((l) => { l.dragging = true; });
  if (lines.length) m.lineGen += 1;
  const ghosts = mode === 'ghost' ? new Set(items.map((s) => s.id)) : null;
  const push = Math.hypot(dx, dy) / frames;
  const run = (f) => {
    at.forEach((it) => {
      it.s.dragging = true;
      it.s.dragTarget = { x: it.x + dx * f / frames, y: it.y + dy * f / frames };
    });
    lat.forEach((it) => { it.l.dragTarget = { x: it.x + dx * f / frames, y: it.y + dy * f / frames }; });
    engine.step(m, dragOpts(mode, push));
    tr.check(ghosts);
  };
  for (let f = 1; f <= frames; f++) run(f);
  run(frames);
  lines.forEach((l) => {
    l.dragging = false;
    l.dragTarget = null;
  });
  if (lines.length) m.lineGen += 1;
  return settle(m, items, mode === 'ghost' ? 'ghost' : items.length ? 'drop' : 'lines', ghosts);
}

function nearby(engine, m, r, s, radius, count) {
  const list = engine.alive(m).filter((t) => t !== s && Math.hypot(t.x - s.x, t.y - s.y) < radius);
  const out = [];
  while (out.length < count && list.length) out.push(list.splice(Math.floor(r() * list.length), 1)[0]);
  return out;
}

function withGroups(engine, m, list) {
  const want = new Set(engine.expandToGroups(m, list.map((s) => s.id)));
  return engine.alive(m).filter((s) => want.has(s.id));
}

// The board the stress runs on: `count` stickies packed and spread inside
// a roomy frame, cut by three wall-to-wall lines (one thick).
function board(engine, model, opts) {
  const m = model;
  engine.pack(m);
  const list = engine.alive(m);
  const b0 = engine.boundsOf(list);
  const cx = b0.x + b0.w * 0.5;
  const cy = b0.y + b0.h * 0.5;
  list.forEach((s) => {
    s.x = cx + (s.x + s.w * 0.5 - cx) * 1.5 - s.w * 0.5;
    s.y = cy + (s.y + s.h * 0.5 - cy) * 1.5 - s.h * 0.5;
  });
  engine.frameAround(m);
  const f = m.frame;
  f.x -= f.w * 0.05;
  f.y -= f.h * 0.05;
  f.w *= 1.1;
  f.h *= 1.1;
  const grid = opts.grid || 4;
  engine.setParams(m, opts.gap || 4, opts.fudge ? grid : 0, grid);
  m.lines.push({ id: 'v', points: [[f.x + f.w * 0.38, f.y - 30], [f.x + f.w * 0.42, f.y + f.h + 30]], width: 2 });
  m.lines.push({ id: 'h', points: [[f.x - 30, f.y + f.h * 0.56], [f.x + f.w + 30, f.y + f.h * 0.5]], width: 3 });
  m.lines.push({ id: 'd', points: [[f.x - 30, f.y + f.h * 0.1], [f.x + f.w + 30, f.y + f.h * 0.95]], width: 1 });
  m.lineGen += 1;
  return m;
}

function run(engine, model, settle, opts) {
  const o = opts || {};
  const r = rng(o.seed || 7);
  const m = board(engine, model, o);
  const out = { ops: {}, settles: 0, jams: 0, jamList: [], silent: 0, minGap: Infinity, groupMinGap: Infinity, crossings: 0, coreHits: 0, worst: [] };
  const tr = makeTracker(engine, m);
  const note = (res, skip) => {
    out.settles += 1;
    tr.op += ':rest';
    if (skip) tr.read(engine.alive(m).filter((s) => skip.has(s.id)));
    const g = restGaps(engine, m);
    if (res && res.jam) {
      out.jams += 1;
      if (out.jamList.length < 4) out.jamList.push(Object.assign({ op: out.lastOp }, res.jam, { ids: (res.jam.ids || []).length }));
    } else if (g.inside) {
      out.silent += 1;
      if (out.worst.length < 6) out.worst.push(out.lastOp + ' min ' + g.min.toFixed(3));
    }
    if (!(res && res.jam)) {
      out.minGap = Math.min(out.minGap, g.min);
      out.groupMinGap = Math.min(out.groupMinGap, g.groupMin);
    }
    tr.check();
  };
  // The lines were drawn across the packed board: those stickies step off.
  note(settle(m, [], 'lines'));
  tr.read();
  tr.crossings = 0;
  tr.coreHits = 0;
  const ops = o.ops || 60;
  out.slowest = { op: '', ms: 0 };
  for (let n = 0; n < ops; n++) {
    const opStart = Date.now();
    const list = engine.alive(m);
    const pick = () => list[Math.floor(r() * list.length)];
    const p = r();
    let op;
    tr.op = 'op' + n;
    if (p < 0.34) {
      op = 'drag';
      const s = pick();
      let sel = [s];
      if (r() < 0.35) sel = sel.concat(nearby(engine, m, r, s, 160, 1 + Math.floor(r() * 6)));
      sel = withGroups(engine, m, sel);
      const q = r();
      const mode = q < 0.15 ? 'isolate' : q < 0.3 ? 'ghost' : 'normal';
      if (mode !== 'normal') op += '-' + mode;
      const ang = r() * Math.PI * 2;
      const len = 40 + r() * 360;
      out.lastOp = tr.op = op;
      const res = drag(engine, m, tr, settle, sel, [], Math.cos(ang) * len, Math.sin(ang) * len, 6 + Math.floor(r() * 20), mode);
      note(res, mode === 'ghost' ? new Set(sel.map((s) => s.id)) : null);
    } else if (p < 0.5) {
      op = 'throw';
      const s = pick();
      const sel = withGroups(engine, m, [s]);
      const t = pick();
      out.lastOp = tr.op = op;
      note(drag(engine, m, tr, settle, sel, [], t.x - s.x, t.y - s.y, 1 + Math.floor(r() * 3), 'normal'));
    } else if (p < 0.6) {
      op = 'line';
      const l = m.lines[Math.floor(r() * m.lines.length)];
      const a = l.points[0];
      const b = l.points[l.points.length - 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const k = (r() < 0.5 ? -1 : 1) * (30 + r() * 160) / len;
      out.lastOp = tr.op = op;
      note(drag(engine, m, tr, settle, [], [l], -(b[1] - a[1]) * k, (b[0] - a[0]) * k, 8 + Math.floor(r() * 12), r() < 0.2 ? 'isolate' : 'normal'));
    } else if (p < 0.7) {
      op = 'bundle';
      const ids = r() < 0.3 ? [] : withGroups(engine, m, nearby(engine, m, r, pick(), 400, 8 + Math.floor(r() * 30))).map((s) => s.id);
      out.lastOp = tr.op = op;
      engine.alive(m).forEach((s) => { s.dragging = false; s.dragTarget = null; });
      for (let f = 0; f < 420; f++) {
        const ease = Math.min(1, (f + 1) / 18);
        const moved = engine.bundleStep(m, ids, { pull: 0.1 * ease, maxPush: 9 * ease });
        tr.check();
        if (f > 18 && moved < 0.05) break;
      }
      note(settle(m, [], 'bundle'));
    } else if (p < 0.8) {
      op = 'align';
      const modes = ['left', 'hcenter', 'right', 'top', 'vmiddle', 'bottom', 'hdist', 'vdist'];
      const sel = withGroups(engine, m, [pick()].concat(nearby(engine, m, r, pick(), 250, 2 + Math.floor(r() * 5))));
      out.lastOp = tr.op = op;
      engine.alignSelection(m, sel.map((s) => s.id), modes[Math.floor(r() * modes.length)]);
      tr.check();
      note(settle(m, sel, 'drop'));
    } else if (p < 0.9) {
      op = 'group';
      const s = pick();
      engine.groupStickies(m, [s].concat(nearby(engine, m, r, s, 70, 1 + Math.floor(r() * 3))).map((t) => t.id));
      out.lastOp = tr.op = op;
    } else if (p < 0.95) {
      op = 'ungroup';
      engine.ungroupStickies(m, [pick().id]);
    } else {
      op = 'shrink';
      const axis = r() < 0.5 ? 'w' : 'h';
      out.lastOp = tr.op = op;
      engine.resizeFrame(m, axis, m.frame[axis] * 0.94);
      tr.check();
      note(settle(m, [], 'contain'));
    }
    out.ops[op] = (out.ops[op] || 0) + 1;
    const took = Date.now() - opStart;
    if (took > out.slowest.ms) out.slowest = { op: 'op' + n + ' ' + op, ms: took };
  }
  out.crossings = tr.crossings;
  out.coreHits = tr.coreHits;
  out.sideWorst = tr.worst;
  out.crossingsByOp = tr.byOp;
  out.minGap = +out.minGap.toFixed(4);
  out.groupMinGap = +out.groupMinGap.toFixed(4);
  out.gap = m.gap;
  delete out.lastOp;
  return out;
}

// A bare model: rects [x, y, w, h], one frame, wall-to-wall lines.
// modelFromMatrix sizes stickies from their area; they are placed exactly.
function tiny(engine, rects, frame, lines, gap) {
  const fresh = engine.modelFromMatrix([['Space', 'SubTotal']].concat(rects.map((r, i) => ['S' + i, String(r[2] * r[3])])), 'tiny.csv');
  engine.alive(fresh).forEach((s, i) => {
    s.x = rects[i][0];
    s.y = rects[i][1];
    s.w = s.tw = rects[i][2];
    s.h = s.th = rects[i][3];
  });
  fresh.frame = frame ? { x: frame[0], y: frame[1], w: frame[2], h: frame[3], title: 'T', color: null } : null;
  (lines || []).forEach((pts, i) => fresh.lines.push({ id: 'L' + i, points: pts.map((p) => [p[0], p[1]]), width: 2 }));
  fresh.lineGen += 1;
  engine.setParams(fresh, gap == null ? 4 : gap, 0, 8);
  return fresh;
}

function measure(engine, m, tr, res) {
  tr.check();
  const g = restGaps(engine, m);
  return { crossings: tr.crossings, coreHits: tr.coreHits, minGap: +g.min.toFixed(4), inside: g.inside, jam: !!(res && res.jam), outside: engine.outsideFrame(m).length };
}

// The five line cases: sides must survive every one of them.
function lineCases(engine, settle) {
  const out = {};
  const start = (m) => {
    const tr = makeTracker(engine, m);
    tr.read();
    return tr;
  };
  // 1. A hard, fast shove of a chain into a line: a big sticky rammed
  // 600 ft in two frames into a row of small ones waiting at the line, and
  // the same with a three-sticky selection doing the ramming.
  {
    const row = [[236, 150, 10, 10], [250, 150, 10, 10], [264, 150, 10, 10], [278, 150, 8, 30]];
    const m = tiny(engine, [[20, 120, 60, 60]].concat(row), [0, 0, 800, 300], [[[300, -40], [300, 340]]]);
    const tr = start(m);
    const res = drag(engine, m, tr, settle, [engine.alive(m)[0]], [], 600, 0, 2, 'normal');
    out.chainShove = measure(engine, m, tr, res);
    const m2 = tiny(engine, [[10, 110, 40, 40], [10, 154, 40, 40], [54, 130, 40, 40]].concat(row), [0, 0, 800, 300], [[[300, -40], [300, 340]]]);
    const tr2 = start(m2);
    const res2 = drag(engine, m2, tr2, settle, engine.alive(m2).slice(0, 3), [], 600, 0, 2, 'normal');
    out.selectionShove = measure(engine, m2, tr2, res2);
  }
  // 2. A 1000 ft jump in one frame by a thin sticky, and by a big one
  // ramming a thin neighbour: both stop at the line.
  {
    const m = tiny(engine, [[100, 120, 6, 40]], [0, 0, 1400, 300], [[[300, -40], [300, 340]]]);
    const tr = start(m);
    const res = drag(engine, m, tr, settle, [engine.alive(m)[0]], [], 1000, 0, 1, 'normal');
    out.jump1000 = measure(engine, m, tr, res);
    const m2 = tiny(engine, [[100, 120, 40, 40], [288, 130, 6, 20]], [0, 0, 1400, 300], [[[300, -40], [300, 340]]]);
    const tr2 = start(m2);
    const res2 = drag(engine, m2, tr2, settle, [engine.alive(m2)[0]], [], 1000, 0, 1, 'normal');
    out.jumpRam = measure(engine, m2, tr2, res2);
  }
  // 3. A bundle of mixed stickies on both sides of a line near their
  // centroid (a scene the old yield logic carried across).
  {
    const rects = [[480, 110, 37, 21], [354, 123, 46, 17], [59, 211, 9, 34], [29, 131, 40, 10], [350, 111, 28, 43], [144, 45, 23, 31], [556, 122, 49, 22], [414, 75, 40, 43], [476, 101, 11, 21], [579, 70, 8, 28], [469, 56, 49, 9]];
    const m = tiny(engine, rects, [0, 0, 640, 300], [[[320, -40], [330, 340]]]);
    for (let f = 0; f < 200; f++) if (engine.step(m, { iters: 3, contactEase: 0.55, maxPush: 18 }) < 0.05) break;
    const tr = start(m);
    for (let f = 0; f < 420; f++) {
      const ease = Math.min(1, (f + 1) / 18);
      const moved = engine.bundleStep(m, [], { pull: 0.1 * ease, maxPush: 30 * ease });
      tr.check();
      if (f > 18 && moved < 0.05) break;
    }
    out.bundleAcross = measure(engine, m, tr, settle(m, [], 'bundle'));
  }
  // 4. A frame shrink (it shrinks about its centre) with a line inside:
  // the right-hand stickies glide in as far as the line and no further,
  // restacking in the room left. Shrunk too far, that room is narrower than
  // a sticky: sides still hold, and the jam is reported, never silent.
  {
    const shrink = (w) => {
      const m = tiny(engine, [[60, 60, 40, 40], [60, 160, 40, 40], [300, 100, 40, 40], [600, 60, 30, 30], [700, 160, 30, 30], [740, 60, 30, 30]], [0, 0, 800, 260], [[[560, -40], [560, 300]]]);
      const tr = start(m);
      engine.resizeFrame(m, 'w', w);
      tr.check();
      const res = measure(engine, m, tr, settle(m, [], 'contain'));
      res.frameW = m.frame.w;
      return res;
    };
    out.frameShrink = shrink(450);
    out.frameTooSmall = shrink(360);
  }
  // 5. A line jumped 1000 ft in one frame into a thin sticky pinned against
  // the wall, and dragged into a row of two pinned there: the line stops;
  // it never passes over them.
  {
    const m = tiny(engine, [[590, 100, 6, 40]], [0, 0, 600, 260], [[[450, -40], [450, 300]]]);
    const tr = start(m);
    const res = drag(engine, m, tr, settle, [], [m.lines[0]], 1000, 0, 1, 'normal');
    out.linePinned = measure(engine, m, tr, res);
    out.linePinned.lineX = +m.lines[0].points[0][0].toFixed(3);
    const m2 = tiny(engine, [[532, 100, 30, 30], [566, 100, 30, 30]], [0, 0, 600, 260], [[[450, -40], [450, 300]]]);
    const tr2 = start(m2);
    const res2 = drag(engine, m2, tr2, settle, [], [m2.lines[0]], 400, 0, 3, 'normal');
    out.lineChain = measure(engine, m2, tr2, res2);
    out.lineChain.lineX = +m2.lines[0].points[0][0].toFixed(3);
    // Stopped short: the row still stands in line against the wall, one
    // buffer apart, and the line one reach before it.
    const a = engine.alive(m2)[0];
    out.lineChain.stoppedShort = a.y === 100 && m2.lines[0].points[0][0] <= a.x - m2.gap + TOL;
  }
  // 6. An endpoint drag swinging the line's free end across a sticky: a
  // free one is herded ahead of it; one pinned against the wall stops the
  // end one reach short.
  {
    const swing = (frameW) => {
      const m = tiny(engine, [[40, 160, 20, 20]], [-100, -100, frameW, 400], [[[20, -60], [20, 240]]]);
      const tr = start(m);
      const l = m.lines[0];
      for (let f = 1; f <= 12; f++) {
        engine.gripLine(m, l, 1, 20 + f * 25, 240);
        m.lineGen += 1;
        engine.step(m, { iters: 6, contactEase: 1, maxPush: 3, drag: false });
        tr.check();
      }
      const res = measure(engine, m, tr, settle(m, [], 'lines'));
      res.endX = +l.points[1][0].toFixed(3);
      return res;
    };
    out.gripHerd = swing(500);
    out.gripPinned = swing(165);
  }
  return out;
}

// The engine's own rest loop, as the app drives it: a drop holds what was
// placed, a frame shrink contains.
function engineSettle(engine) {
  return (m, held, kind) => engine.settleNow(m, kind === 'drop' || kind === 'ghost' ? held : [], { contain: kind === 'contain' });
}

// Separation of two boxes: the larger axis gap, negative when they overlap.
function sep(a, b) {
  const sx = Math.abs(a.x + a.w / 2 - b.x - b.w / 2) - (a.w + b.w) / 2;
  const sy = Math.abs(a.y + a.h / 2 - b.y - b.h / 2) - (a.h + b.h) / 2;
  return Math.max(sx, sy);
}

// A hand: steady motion plus a slow wobble across it.
function hand(n, vx, vy) {
  return Array.from({ length: n }, (_, f) => [vx * (f + 1), vy * (f + 1) + (vx && vy ? 0.4 : 0.6) * Math.sin(f / 5)]);
}

// Drags `a` along per-frame pointer offsets. `watch` are the stickies it
// should carry (nearest first): the far one's motion along x per foot of
// the cursor's, over frames `a` touches the first, is the tracking ratio;
// a frame it moves under a tenth of the cursor is a stall. Also records the
// closest pair of bodies at every step and every line crossing.
function push(engine, m, a, deltas, watch, settle) {
  const tr = makeTracker(engine, m);
  tr.read();
  const list = engine.alive(m);
  const x0 = a.x;
  const y0 = a.y;
  const w0 = watch.map((s) => [s.x, s.y]);
  const others = list.filter((s) => s !== a && watch.indexOf(s) < 0);
  const o0 = others.map((s) => s.x);
  let prev = [0, 0];
  let stalls = 0;
  let cursor = 0;
  let moved = 0;
  let minSep = Infinity;
  let aStalls = 0;
  let lastA = [a.x, a.y];
  for (let f = 0; f < deltas.length; f++) {
    const [dx, dy] = deltas[f];
    a.dragging = true;
    a.dragTarget = { x: x0 + dx, y: y0 + dy };
    const far = watch.length ? watch[watch.length - 1] : null;
    const fx = far ? far.x : 0;
    engine.step(m, { iters: 6, contactEase: 1, maxPush: Math.max(3, Math.hypot(dx - prev[0], dy - prev[1])), drag: true });
    tr.check();
    const cx = dx - prev[0];
    const cy = dy - prev[1];
    const cl = Math.hypot(cx, cy);
    if (cl > 1e-9 && ((a.x - lastA[0]) * cx + (a.y - lastA[1]) * cy) / cl < 0.1 * cl) aStalls += 1;
    if (far && sep(a, watch[0]) <= m.gap + TOL && Math.abs(cx) > 1e-9) {
      cursor += Math.abs(cx);
      moved += Math.abs(far.x - fx);
      if (Math.abs(far.x - fx) < 0.1 * Math.abs(cx)) stalls += 1;
    }
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) minSep = Math.min(minSep, sep(list[i], list[j]));
    lastA = [a.x, a.y];
    prev = [dx, dy];
  }
  const out = {
    frames: deltas.length,
    ratio: cursor ? +(moved / cursor).toFixed(3) : 0,
    stalls,
    dragStalls: aStalls,
    dragErr: +Math.hypot(a.x - x0 - prev[0], a.y - y0 - prev[1]).toFixed(2),
    moved: watch.map((s, i) => +(s.x - w0[i][0]).toFixed(2)),
    rose: watch.map((s, i) => +(s.y - w0[i][1]).toFixed(2)),
    gaps: watch.map((s, i) => +sep(i ? watch[i - 1] : a, s).toFixed(3)),
    carried: +others.reduce((mx, s, i) => Math.max(mx, Math.abs(s.x - o0[i])), 0).toFixed(2),
    minSep: +minSep.toFixed(3),
    ax: +a.x.toFixed(2),
  };
  a.dragging = false;
  a.dragTarget = null;
  Object.assign(out, measure(engine, m, tr, settle(m, [a], 'drop')));
  return out;
}

// Frictionless contacts and pushes that travel: a sideways glide along a
// row, a push through a cluster, a pushed sticky sliding along the one it
// rests on, a five-sticky chain carried along a surface, and that chain
// packed against the wall and a line.
function contactCases(engine, settle) {
  const g = 4;
  const out = {};
  {
    const row = Array.from({ length: 8 }, (_, i) => [i * 24, 100, 20, 20]);
    const m = tiny(engine, [[-40, 76, 20, 20]].concat(row), [-200, -100, 600, 400], [], g);
    out.glideRow = push(engine, m, engine.alive(m)[0], hand(110, 2, 0).map(([x, y], f) => [x, y + Math.min(f, 10) * 0.15]), [], settle);
  }
  {
    const pack = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) pack.push([100 + c * 24, 100 + r * 24, 20, 20]);
    const m = tiny(engine, [[40, 40, 24, 24]].concat(pack), [-100, -100, 800, 600], [], g);
    out.pushCluster = push(engine, m, engine.alive(m)[0], hand(60, 2.4, 2), [], settle);
  }
  const scene = (floor) => {
    const m = tiny(engine, [[75, 6, 37, 54], [21, 10, 50, 50], [0, 64, 117, 56]], [-300, -200, 700, 500], floor ? [[[-300, 124], [400, 124]]] : [], g);
    const L = engine.alive(m);
    return push(engine, m, L[0], hand(70, -1.4, 0.8), [L[1]], settle);
  };
  out.slideOnSurface = scene(false);
  out.slideOnFloor = scene(true);
  const chain = (press, frame, lines) => {
    const rects = [[220, 72, 24, 24]];
    for (let i = 4; i >= 0; i--) rects.push([100 + i * 24, 76, 20, 20]);
    rects.push([44, 100, 400, 30]);
    const m = tiny(engine, rects, frame, lines, g);
    const L = engine.alive(m);
    return push(engine, m, L[0], hand(80, -1.5, press), L.slice(1, 6), settle);
  };
  out.chainAlong = chain(0, [-300, -100, 800, 400], []);
  out.chainAlongPressed = chain(0.5, [-300, -100, 800, 400], []);
  out.chainIntoWall = chain(0, [40, -100, 600, 400], []);
  out.chainIntoLine = chain(0, [-300, -100, 800, 400], [[[70, -100], [70, 99]]]);
  return out;
}

// What contactCases must show; an empty list passes.
function contactFailures(c, gap) {
  const bad = [];
  const want = (ok, msg) => {
    if (!ok) bad.push(msg);
  };
  const g = gap == null ? 4 : gap;
  want(c.glideRow.dragStalls === 0 && c.glideRow.carried < 0.5, 'glideRow: a sideways glide stalled ' + c.glideRow.dragStalls + ' frames or carried the row ' + c.glideRow.carried + ' ft');
  want(c.pushCluster.dragStalls === 0 && c.pushCluster.dragErr < 0.5 && c.pushCluster.minSep > 0, 'pushCluster: the push through a free cluster stalled or interpenetrated ' + JSON.stringify(c.pushCluster));
  for (const k of ['slideOnSurface', 'slideOnFloor', 'chainAlong', 'chainAlongPressed']) {
    const r = c[k];
    want(r.ratio > 0.9 && r.stalls === 0, k + ': the pushed sticky tracked ' + r.ratio + ' of the drag with ' + r.stalls + ' stalls');
    want(r.rose.every((v) => Math.abs(v) < 0.1), k + ': a pushed sticky left the surface it slid on ' + JSON.stringify(r.rose));
    want(r.minSep > 0, k + ': bodies interpenetrated (' + r.minSep + ')');
  }
  for (const k of ['chainAlong', 'chainAlongPressed']) {
    const r = c[k];
    const spread = r.moved.reduce((mx, v) => Math.max(mx, Math.abs(v - r.moved[0])), 0);
    want(spread < 0.5 && r.gaps.slice(1).every((v) => Math.abs(v - g) <= TOL), k + ': the chain did not translate whole at the buffer ' + JSON.stringify({ moved: r.moved, gaps: r.gaps }));
  }
  for (const k of ['chainIntoWall', 'chainIntoLine']) {
    const r = c[k];
    want(r.minSep > -TOL && !r.crossings && !r.coreHits, k + ': bodies interpenetrated (' + r.minSep + ') or crossed the line');
    want(r.rose.every((v) => Math.abs(v) < 0.1), k + ': the packed chain buckled ' + JSON.stringify(r.rose));
    want(r.dragErr > 10, k + ': the dragged sticky did not stop at the packed chain');
    want(!r.jam && r.minGap >= g - TOL, k + ': did not rest (min gap ' + r.minGap + ', jam ' + r.jam + ')');
  }
  for (const k in c) want(!c[k].crossings && !c[k].outside, k + ': ' + c[k].crossings + ' crossings, ' + c[k].outside + ' outside the frame');
  return bad;
}

module.exports = { run: run, lineCases: lineCases, contactCases: contactCases, contactFailures: contactFailures, engineSettle: engineSettle, sideOf: sideOf, coreHit: coreHit, restGaps: restGaps, TOL: TOL };

// node test-stress.js [engine.js]: the line and contact cases on their own.
if (require.main === module) {
  const engine = require(require('path').resolve(process.argv[2] || __dirname + '/engine.js'));
  const settle = engineSettle(engine);
  const lines = lineCases(engine, settle);
  const contacts = contactCases(engine, settle);
  const bad = contactFailures(contacts);
  for (const k in lines) if (lines[k].crossings || lines[k].coreHits) bad.push(k + ': ' + lines[k].crossings + ' line crossings, ' + lines[k].coreHits + ' core hits');
  console.log(JSON.stringify({ lines, contacts, errors: bad }, null, 1));
  if (bad.length) {
    console.error(bad.join('\n'));
    process.exit(1);
  }
  console.log('stress ok');
}
