'use strict';

// Category blob geometry: the shrink-wrap around a set of rects, built
// exactly, as a list of straight lines and circular arcs.
//
//   ProgramBoardBlob.wrap(rects, offset, smooth) -> { loops, stats } | null
//
// rects are [{ x, y, w, h, radius? }] in feet, y down. The blob is
//
//   1. the members, plus a bridge across every gap between two members
//      whose facing edges overlap and are closer than 2 (offset + smooth),
//      so aligned edges run dead straight across the gap;
//   2. grown by R = offset + smooth: the union of rounded rects, traced
//      from the arrangement of their lines and arcs;
//   3. shrunk by smooth (a morphological closing): every straight run sits
//      exactly `offset` off a member edge, every convex corner is an arc of
//      radius offset (+ the sticky's own fillet), and every concave junction
//      is a tangent arc of radius smooth;
//   4. where two members only face corner to corner, the bridge is a
//      segment between the corners, so a neck is never thinner than
//      2 * offset: far-apart members part cleanly, never by a sliver.
//
// Each grow or shrink is an exact offset: every line and arc moves along
// its normal, joints get round joins, and the raw curve is trimmed where
// it comes closer than the distance to the curve it came from.
//
// A loop is { segs, points, hole, area }. segs are closed, in order:
//   { k: 0, x0, y0, x1, y1 }                 a line
//   { k: 1, x0, y0, x1, y1, cx, cy, r, a0, da } an arc from angle a0 through
//                                            da radians (canvas angles: y
//                                            down, positive is clockwise)
// points samples the same outline densely, for hit tests and labels.
// Outer loops run clockwise on screen, holes counterclockwise.
// Renderer-free: no DOM, no canvas (tests run it under Node).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProgramBoardBlob = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const PI = Math.PI;
  const TAU = PI * 2;
  // Arc sampling for `points`: at most this many radians per step, and at
  // most this chord error (ft).
  const SAMPLE_STEP = PI / 36;
  const SAMPLE_ERR = 0.02;

  // ---------------------------------------------------------------- pieces

  function line(x0, y0, x1, y1) {
    return { k: 0, x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  function arc(cx, cy, r, a0, da) {
    const a1 = a0 + da;
    return { k: 1, cx: cx, cy: cy, r: r, a0: a0, da: da, x0: cx + r * Math.cos(a0), y0: cy + r * Math.sin(a0), x1: cx + r * Math.cos(a1), y1: cy + r * Math.sin(a1) };
  }

  function wrapAngle(a) {
    a %= TAU;
    if (a <= -PI) a += TAU;
    else if (a > PI) a -= TAU;
    return a;
  }

  // Where angle `a` falls along an arc: 0 at its start, 1 at its end.
  function arcParam(p, a) {
    return 0.5 + wrapAngle(a - (p.a0 + p.da * 0.5)) / p.da;
  }

  function pointAt(p, t) {
    if (p.k === 0) return [p.x0 + (p.x1 - p.x0) * t, p.y0 + (p.y1 - p.y0) * t];
    const a = p.a0 + p.da * t;
    return [p.cx + p.r * Math.cos(a), p.cy + p.r * Math.sin(a)];
  }

  // Unit tangent along the direction of travel.
  function tangentAt(p, t) {
    if (p.k === 0) {
      const dx = p.x1 - p.x0;
      const dy = p.y1 - p.y0;
      const l = Math.hypot(dx, dy) || 1;
      return [dx / l, dy / l];
    }
    const a = p.a0 + p.da * t;
    const s = p.da < 0 ? -1 : 1;
    return [-Math.sin(a) * s, Math.cos(a) * s];
  }

  // The outward normal: the filled side is always on the right of travel
  // on screen, so outward is the tangent turned a quarter counterclockwise.
  function normalAt(p, t) {
    const d = tangentAt(p, t);
    return [d[1], -d[0]];
  }

  function lengthOf(p) {
    return p.k === 0 ? Math.hypot(p.x1 - p.x0, p.y1 - p.y0) : p.r * Math.abs(p.da);
  }

  function subPiece(p, ta, tb) {
    if (p.k === 1) return arc(p.cx, p.cy, p.r, p.a0 + p.da * ta, p.da * (tb - ta));
    const a = ta === 0 ? [p.x0, p.y0] : pointAt(p, ta);
    const b = tb === 1 ? [p.x1, p.y1] : pointAt(p, tb);
    return line(a[0], a[1], b[0], b[1]);
  }

  function boxOf(p) {
    let x0 = Math.min(p.x0, p.x1);
    let y0 = Math.min(p.y0, p.y1);
    let x1 = Math.max(p.x0, p.x1);
    let y1 = Math.max(p.y0, p.y1);
    if (p.k === 1) {
      for (let q = 0; q < 4; q++) {
        const a = (q * PI) / 2;
        const t = arcParam(p, a);
        if (t > 0 && t < 1) {
          const x = p.cx + p.r * Math.cos(a);
          const y = p.cy + p.r * Math.sin(a);
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    p.bx0 = x0;
    p.by0 = y0;
    p.bx1 = x1;
    p.by1 = y1;
    return p;
  }

  function distTo(p, x, y) {
    if (p.k === 0) {
      const dx = p.x1 - p.x0;
      const dy = p.y1 - p.y0;
      const l2 = dx * dx + dy * dy;
      let t = l2 > 0 ? ((x - p.x0) * dx + (y - p.y0) * dy) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      return Math.hypot(x - p.x0 - dx * t, y - p.y0 - dy * t);
    }
    const t = arcParam(p, Math.atan2(y - p.cy, x - p.cx));
    if (t >= 0 && t <= 1) return Math.abs(Math.hypot(x - p.cx, y - p.cy) - p.r);
    return Math.min(Math.hypot(x - p.x0, y - p.y0), Math.hypot(x - p.x1, y - p.y1));
  }

  // The same piece moved `d` along its outward normal. An arc that shrinks
  // past its centre turns inside out (it will be trimmed); one that shrinks
  // to its centre is a point, returned as null.
  function offsetPiece(p, d, tol) {
    if (p.k === 0) {
      const n = normalAt(p, 0);
      return line(p.x0 + n[0] * d, p.y0 + n[1] * d, p.x1 + n[0] * d, p.y1 + n[1] * d);
    }
    const rr = p.r + (p.da > 0 ? d : -d);
    if (Math.abs(rr) <= tol) return null;
    return rr > 0 ? arc(p.cx, p.cy, rr, p.a0, p.da) : arc(p.cx, p.cy, -rr, p.a0 + PI, p.da);
  }

  // ---------------------------------------------------------- intersection

  // Crossings of two pieces as [tp, tq] pairs appended to `out`. Pieces
  // that lie along each other report each other's ends instead.
  function intersect(p, q, tol, out) {
    if (p.k === 0 && q.k === 0) return lineLine(p, q, tol, out);
    if (p.k === 0) return lineArc(p, q, tol, out, false);
    if (q.k === 0) return lineArc(q, p, tol, out, true);
    return arcArc(p, q, tol, out);
  }

  function lineLine(p, q, tol, out) {
    const dx1 = p.x1 - p.x0;
    const dy1 = p.y1 - p.y0;
    const dx2 = q.x1 - q.x0;
    const dy2 = q.y1 - q.y0;
    const l1 = Math.hypot(dx1, dy1);
    const l2 = Math.hypot(dx2, dy2);
    if (l1 <= 0 || l2 <= 0) return;
    const den = dx1 * dy2 - dy1 * dx2;
    const ex = q.x0 - p.x0;
    const ey = q.y0 - p.y0;
    if (Math.abs(den) <= 1e-12 * l1 * l2) {
      if (Math.abs(ex * dy1 - ey * dx1) / l1 > tol) return;
      const onP = (x, y) => ((x - p.x0) * dx1 + (y - p.y0) * dy1) / (l1 * l1);
      const onQ = (x, y) => ((x - q.x0) * dx2 + (y - q.y0) * dy2) / (l2 * l2);
      for (const [t, u] of [[onP(q.x0, q.y0), 0], [onP(q.x1, q.y1), 1]]) if (t > 0 && t < 1) out.push([t, u]);
      for (const [u, t] of [[onQ(p.x0, p.y0), 0], [onQ(p.x1, p.y1), 1]]) if (u > 0 && u < 1) out.push([t, u]);
      return;
    }
    const t = (ex * dy2 - ey * dx2) / den;
    const u = (ex * dy1 - ey * dx1) / den;
    const tt = tol / l1;
    const tu = tol / l2;
    if (t < -tt || t > 1 + tt || u < -tu || u > 1 + tu) return;
    out.push([clamp01(t), clamp01(u)]);
  }

  function lineArc(p, q, tol, out, swap) {
    const dx = p.x1 - p.x0;
    const dy = p.y1 - p.y0;
    const l = Math.hypot(dx, dy);
    if (l <= 0) return;
    const fx = q.cx - p.x0;
    const fy = q.cy - p.y0;
    const foot = (fx * dx + fy * dy) / (l * l);
    const off = (fx * dy - fy * dx) / l;
    const away = Math.abs(off);
    if (away > q.r + tol) return;
    const h = Math.sqrt(Math.max(0, q.r * q.r - away * away));
    const roots = h <= tol ? [foot] : [foot - h / l, foot + h / l];
    const tt = tol / l;
    const ta = tol / (q.r * Math.abs(q.da));
    for (let i = 0; i < roots.length; i++) {
      const t = roots[i];
      if (t < -tt || t > 1 + tt) continue;
      const x = p.x0 + dx * t;
      const y = p.y0 + dy * t;
      const u = arcParam(q, Math.atan2(y - q.cy, x - q.cx));
      if (u < -ta || u > 1 + ta) continue;
      out.push(swap ? [clamp01(u), clamp01(t)] : [clamp01(t), clamp01(u)]);
    }
  }

  function arcArc(p, q, tol, out) {
    const dx = q.cx - p.cx;
    const dy = q.cy - p.cy;
    const d = Math.hypot(dx, dy);
    const tp = tol / (p.r * Math.abs(p.da));
    const tq = tol / (q.r * Math.abs(q.da));
    if (d <= tol) {
      if (Math.abs(p.r - q.r) > tol) return;
      // One circle: each arc splits at the other's ends.
      const pa = (a) => arcParam(p, a);
      const qa = (a) => arcParam(q, a);
      for (const [a, u] of [[q.a0, 0], [q.a0 + q.da, 1]]) {
        const t = pa(a);
        if (t > tp && t < 1 - tp) out.push([t, u]);
      }
      for (const [a, t] of [[p.a0, 0], [p.a0 + p.da, 1]]) {
        const u = qa(a);
        if (u > tq && u < 1 - tq) out.push([t, u]);
      }
      return;
    }
    if (d > p.r + q.r + tol || d < Math.abs(p.r - q.r) - tol) return;
    const a = (p.r * p.r - q.r * q.r + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, p.r * p.r - a * a));
    const mx = p.cx + (dx * a) / d;
    const my = p.cy + (dy * a) / d;
    const pts = h <= tol ? [[mx, my]] : [[mx - (dy * h) / d, my + (dx * h) / d], [mx + (dy * h) / d, my - (dx * h) / d]];
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      const t = arcParam(p, Math.atan2(y - p.cy, x - p.cx));
      const u = arcParam(q, Math.atan2(y - q.cy, x - q.cx));
      if (t < -tp || t > 1 + tp || u < -tq || u > 1 + tq) continue;
      out.push([clamp01(t), clamp01(u)]);
    }
  }

  function clamp01(t) {
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }

  // --------------------------------------------------------- spatial index

  // A uniform grid over piece (or box) bounds, for "what is near here".
  function grid(items, cell) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < items.length; i++) {
      const b = items[i];
      if (b.bx0 < x0) x0 = b.bx0;
      if (b.by0 < y0) y0 = b.by0;
      if (b.bx1 > x1) x1 = b.bx1;
      if (b.by1 > y1) y1 = b.by1;
    }
    if (!items.length) x0 = y0 = x1 = y1 = 0;
    let c = Math.max(cell, (x1 - x0) / 256, (y1 - y0) / 256, 1e-6);
    const nx = Math.max(1, Math.ceil((x1 - x0) / c) + 1);
    const ny = Math.max(1, Math.ceil((y1 - y0) / c) + 1);
    const cells = new Array(nx * ny);
    const ix = (x) => Math.min(nx - 1, Math.max(0, Math.floor((x - x0) / c)));
    const iy = (y) => Math.min(ny - 1, Math.max(0, Math.floor((y - y0) / c)));
    for (let i = 0; i < items.length; i++) {
      const b = items[i];
      for (let j = iy(b.by0); j <= iy(b.by1); j++) {
        for (let k = ix(b.bx0); k <= ix(b.bx1); k++) {
          const at = j * nx + k;
          if (cells[at]) cells[at].push(i);
          else cells[at] = [i];
        }
      }
    }
    const stamp = new Int32Array(items.length);
    let gen = 0;
    return {
      // Calls fn(i) once for every item whose cells meet the box.
      query(qx0, qy0, qx1, qy1, fn) {
        gen += 1;
        const j1 = iy(qy1);
        const k1 = ix(qx1);
        for (let j = iy(qy0); j <= j1; j++) {
          for (let k = ix(qx0); k <= k1; k++) {
            const list = cells[j * nx + k];
            if (!list) continue;
            for (let m = 0; m < list.length; m++) {
              const i = list[m];
              if (stamp[i] === gen) continue;
              stamp[i] = gen;
              if (fn(i) === false) return false;
            }
          }
        }
        return true;
      },
    };
  }

  // ------------------------------------------------------------- splitting

  // Every piece cut at every crossing with another. Crossings closer than
  // `merge` along a piece are one cut; keep it far below `tol`, or two
  // distinct crossings merge and move a vertex. `skip(i, j)` excludes
  // pairs that cannot cross (sides of one rounded rect). Returns
  // [{ piece, from }] where `from` is the index of the uncut piece.
  function splitAll(pieces, tol, merge, cell, skip) {
    for (let i = 0; i < pieces.length; i++) boxOf(pieces[i]);
    const cuts = pieces.map(() => []);
    const hits = [];
    const g = grid(pieces, cell);
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      g.query(p.bx0 - tol, p.by0 - tol, p.bx1 + tol, p.by1 + tol, (j) => {
        if (j <= i || (skip && skip(i, j))) return;
        const q = pieces[j];
        if (q.bx0 > p.bx1 + tol || q.bx1 < p.bx0 - tol || q.by0 > p.by1 + tol || q.by1 < p.by0 - tol) return;
        hits.length = 0;
        intersect(p, q, tol, hits);
        for (let h = 0; h < hits.length; h++) {
          cuts[i].push(hits[h][0]);
          cuts[j].push(hits[h][1]);
        }
      });
    }
    const out = [];
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      const len = lengthOf(p);
      if (len <= tol) continue;
      const ts = cuts[i].sort((a, b) => a - b);
      const keep = [0];
      const step = merge / len;
      for (let k = 0; k < ts.length; k++) {
        const t = ts[k];
        if (t - keep[keep.length - 1] > step && 1 - t > step) keep.push(t);
      }
      keep.push(1);
      for (let k = 0; k + 1 < keep.length; k++) {
        out.push({ piece: keep.length === 2 ? p : subPiece(p, keep[k], keep[k + 1]), from: i });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- chains

  // Pieces joined end to start into closed loops, or null when an end has
  // nowhere to go. At a point where several could follow, the loop closes
  // if it can, and otherwise takes the sharpest right turn.
  function chain(pieces, tol) {
    const n = pieces.length;
    if (!n) return [];
    const c = tol * 4;
    const starts = new Map();
    const key = (x, y) => Math.floor(x / c) * 73856093 + Math.floor(y / c) * 19349663;
    for (let i = 0; i < n; i++) {
      const p = pieces[i];
      const k = key(p.x0, p.y0);
      const list = starts.get(k);
      if (list) list.push(i);
      else starts.set(k, [i]);
    }
    const used = new Uint8Array(n);
    const loops = [];
    const tol2 = tol * tol;
    for (let first = 0; first < n; first++) {
      if (used[first]) continue;
      const loop = [pieces[first]];
      used[first] = 1;
      let cur = pieces[first];
      for (let guard = 0; guard <= n; guard++) {
        const ex = cur.x1;
        const ey = cur.y1;
        const head = pieces[first];
        if (loop.length > 1 && (ex - head.x0) ** 2 + (ey - head.y0) ** 2 <= tol2) break;
        let best = -1;
        let bestTurn = Infinity;
        const tin = tangentAt(cur, 1);
        const fx = Math.floor(ex / c);
        const fy = Math.floor(ey / c);
        for (let a = -1; a <= 1; a++) {
          for (let b = -1; b <= 1; b++) {
            const list = starts.get((fx + a) * 73856093 + (fy + b) * 19349663);
            if (!list) continue;
            for (let m = 0; m < list.length; m++) {
              const j = list[m];
              if (used[j]) continue;
              const q = pieces[j];
              if ((q.x0 - ex) ** 2 + (q.y0 - ey) ** 2 > tol2) continue;
              const tout = tangentAt(q, 0);
              // Signed turn, most negative (leftmost) last: prefer right.
              const turn = -Math.atan2(tin[0] * tout[1] - tin[1] * tout[0], tin[0] * tout[0] + tin[1] * tout[1]);
              if (turn < bestTurn) {
                bestTurn = turn;
                best = j;
              }
            }
          }
        }
        if (best < 0) {
          if (loop.length === 1 && (ex - head.x0) ** 2 + (ey - head.y0) ** 2 <= tol2) break;
          if (typeof process !== 'undefined' && process.env && process.env.BLOB_DEBUG) {
            let near = null;
            for (let j = 0; j < n; j++) {
              const d = Math.hypot(pieces[j].x0 - ex, pieces[j].y0 - ey);
              if (!near || d < near.d) near = { j, d, used: used[j] };
            }
            console.log('chain: dangling end', ex, ey, 'after', loop.length, 'nearest start', JSON.stringify(near), 'tol', tol);
          }
          return null;
        }
        used[best] = 1;
        cur = pieces[best];
        loop.push(cur);
      }
      loops.push(loop);
    }
    return loops;
  }

  // Neighbouring lines along one line, and arcs along one circle, become
  // one piece; slivers shorter than `tol` go.
  function tidy(loop, tol) {
    let out = loop.filter((p) => lengthOf(p) > tol);
    if (out.length < 2) return out;
    const same = (p, q) => {
      if (p.k !== q.k) return false;
      if (p.k === 0) {
        const a = tangentAt(p, 0);
        const b = tangentAt(q, 0);
        if (a[0] * b[0] + a[1] * b[1] < 0) return false;
        return distToLine(p, q.x1, q.y1) <= tol * 0.5 && distToLine(p, q.x0, q.y0) <= tol * 0.5;
      }
      return (p.da > 0) === (q.da > 0) && Math.hypot(p.cx - q.cx, p.cy - q.cy) <= tol && Math.abs(p.r - q.r) <= tol && Math.abs(p.da + q.da) < TAU - 1e-9;
    };
    const join = (p, q) => (p.k === 0 ? line(p.x0, p.y0, q.x1, q.y1) : arc(p.cx, p.cy, p.r, p.a0, p.da + q.da));
    let changed = true;
    while (changed && out.length > 1) {
      changed = false;
      const next = [];
      for (let i = 0; i < out.length; i++) {
        const p = next.length ? next[next.length - 1] : null;
        if (p && same(p, out[i])) {
          next[next.length - 1] = join(p, out[i]);
          changed = true;
        } else next.push(out[i]);
      }
      if (next.length > 1 && same(next[next.length - 1], next[0])) {
        next[0] = join(next[next.length - 1], next[0]);
        next.pop();
        changed = true;
      }
      out = next;
    }
    // Close exactly: each line starts where the piece before it ended.
    for (let i = 0; i < out.length; i++) {
      const p = out[i];
      const q = out[(i + 1) % out.length];
      if (q.k === 0) {
        q.x0 = p.x1;
        q.y0 = p.y1;
      } else if (p.k === 0) {
        p.x1 = q.x0;
        p.y1 = q.y0;
      }
    }
    return out;
  }

  function distToLine(p, x, y) {
    const dx = p.x1 - p.x0;
    const dy = p.y1 - p.y0;
    const l = Math.hypot(dx, dy) || 1;
    return Math.abs((x - p.x0) * dy - (y - p.y0) * dx) / l;
  }

  // ------------------------------------------------------ rounded rect union

  // The union of rounded shapes: each is a core grown by its rho. A core is
  // an axis-aligned box { x0, y0, x1, y1 } or, with `seg`, the segment
  // from (x0, y0) to (x1, y1) (a stadium once grown). Pieces of each
  // boundary survive where they lie outside every other; where two
  // boundaries run along each other, the one from the lower index survives
  // if both face the same way, and neither if they face each other.
  function unionRounded(boxes, tol, eps, cell) {
    const pieces = [];
    const owner = [];
    const add = (p, k) => {
      if (lengthOf(p) > tol) {
        pieces.push(p);
        owner.push(k);
      }
    };
    for (let k = 0; k < boxes.length; k++) {
      const b = boxes[k];
      const r = b.rho;
      if (b.seg) {
        const l = Math.hypot(b.x1 - b.x0, b.y1 - b.y0) || 1;
        const nx = (b.y1 - b.y0) / l;
        const ny = -(b.x1 - b.x0) / l;
        const a = Math.atan2(ny, nx);
        add(line(b.x0 + nx * r, b.y0 + ny * r, b.x1 + nx * r, b.y1 + ny * r), k);
        add(arc(b.x1, b.y1, r, a, PI / 2), k);
        add(arc(b.x1, b.y1, r, a + PI / 2, PI / 2), k);
        add(line(b.x1 - nx * r, b.y1 - ny * r, b.x0 - nx * r, b.y0 - ny * r), k);
        add(arc(b.x0, b.y0, r, a + PI, PI / 2), k);
        add(arc(b.x0, b.y0, r, a + PI * 1.5, PI / 2), k);
        b.bx0 = Math.min(b.x0, b.x1) - r;
        b.by0 = Math.min(b.y0, b.y1) - r;
        b.bx1 = Math.max(b.x0, b.x1) + r;
        b.by1 = Math.max(b.y0, b.y1) + r;
        continue;
      }
      add(line(b.x0, b.y0 - r, b.x1, b.y0 - r), k);
      add(arc(b.x1, b.y0, r, -PI / 2, PI / 2), k);
      add(line(b.x1 + r, b.y0, b.x1 + r, b.y1), k);
      add(arc(b.x1, b.y1, r, 0, PI / 2), k);
      add(line(b.x1, b.y1 + r, b.x0, b.y1 + r), k);
      add(arc(b.x0, b.y1, r, PI / 2, PI / 2), k);
      add(line(b.x0 - r, b.y1, b.x0 - r, b.y0), k);
      add(arc(b.x0, b.y0, r, PI, PI / 2), k);
      b.bx0 = b.x0 - r;
      b.by0 = b.y0 - r;
      b.bx1 = b.x1 + r;
      b.by1 = b.y1 + r;
    }
    const subs = splitAll(pieces, tol, eps, cell, (i, j) => owner[i] === owner[j]);
    const bg = grid(boxes, cell);
    // > 0 outside shape j, < 0 inside, with the outward normal there.
    const signed = (b, x, y) => {
      let dx;
      let dy;
      if (b.seg) {
        const sx = b.x1 - b.x0;
        const sy = b.y1 - b.y0;
        const l2 = sx * sx + sy * sy;
        let t = l2 > 0 ? ((x - b.x0) * sx + (y - b.y0) * sy) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        dx = x - b.x0 - sx * t;
        dy = y - b.y0 - sy * t;
      } else {
        dx = x < b.x0 ? x - b.x0 : x > b.x1 ? x - b.x1 : 0;
        dy = y < b.y0 ? y - b.y0 : y > b.y1 ? y - b.y1 : 0;
      }
      const l = Math.hypot(dx, dy);
      if (l > 0) return { d: l - b.rho, nx: dx / l, ny: dy / l };
      // On the core itself: deep inside.
      return { d: -b.rho, nx: 0, ny: 0 };
    };
    const KEEP = 1;
    const INSIDE = 0;
    const TOUCH = 2; // meets another boundary across it, at a point
    const ALONG = 3; // runs along another boundary it yields to
    const keep = [];
    for (let s = 0; s < subs.length; s++) {
      const p = subs[s].piece;
      const k = owner[subs[s].from];
      const verdict = (t) => {
        const [x, y] = pointAt(p, t);
        const n = normalAt(p, t);
        let out = KEEP;
        bg.query(x - tol, y - tol, x + tol, y + tol, (j) => {
          if (j === k) return;
          const b = boxes[j];
          if (x < b.bx0 - tol || x > b.bx1 + tol || y < b.by0 - tol || y > b.by1 + tol) return;
          const e = signed(b, x, y);
          if (e.d < -eps) {
            out = INSIDE;
            return false;
          }
          if (e.d > eps) return;
          const facing = e.nx * n[0] + e.ny * n[1];
          if (facing > 0.5) {
            if (j < k) out = ALONG;
          } else if (facing < -0.5) out = ALONG;
          else if (out === KEEP) out = TOUCH;
        });
        return out;
      };
      let v = verdict(0.5);
      if (v !== KEEP && v !== INSIDE) {
        // On another boundary at the midpoint: the quarter points tell a
        // piece that runs along it from one that only touches it.
        const a = verdict(0.25);
        const b = verdict(0.75);
        if (a === INSIDE || b === INSIDE || a === ALONG || b === ALONG) v = INSIDE;
        else v = KEEP;
      }
      if (v === KEEP && lengthOf(p) > tol) keep.push(p);
    }
    return chain(keep, tol * 50);
  }

  // ---------------------------------------------------------------- offset

  // The loops moved `d` outward (negative: inward), trimmed: the boundary of
  // the region grown (or shrunk) by |d|. Pieces of the loops span at most a
  // quarter turn, and every vertex bends toward the side moved to (true of
  // a union's boundary moved inward): a round join goes at each such
  // vertex, and none at a vertex bending the other way, where the moved
  // region can never touch it. Null on a topology failure.
  function offsetLoops(loops, d, tol, eps, cell) {
    const ad = Math.abs(d);
    const src = [];
    const raw = [];
    // Source pieces each raw piece lies exactly |d| from by construction,
    // left out of its own trim test: a join sits on the shared end of two,
    // and float noise at that end must not decide whether it survives.
    const own = [];
    for (let l = 0; l < loops.length; l++) {
      const loop = loops[l];
      const base = src.length;
      for (let i = 0; i < loop.length; i++) {
        const p = loop[i];
        const q = loop[(i + 1) % loop.length];
        const ip = base + i;
        const iq = base + ((i + 1) % loop.length);
        src.push(boxOf(p));
        const o = offsetPiece(p, d, tol);
        if (o && lengthOf(o) > tol * 0.5) {
          raw.push(o);
          own.push(ip, ip);
        }
        const n1 = normalAt(p, 1);
        const n2 = normalAt(q, 0);
        let turn = Math.atan2(n1[0] * n2[1] - n1[1] * n2[0], n1[0] * n2[0] + n1[1] * n2[1]);
        // A cusp's half turn has a sign that is only noise; it bends the
        // moved way like every other vertex here.
        if (PI - Math.abs(turn) < 1e-6) turn = d < 0 ? -PI : PI;
        if (turn * d > 0 && Math.abs(turn) * ad > tol * 0.5) {
          const s = d < 0 ? -1 : 1;
          raw.push(arc(p.x1, p.y1, ad, Math.atan2(n1[1] * s, n1[0] * s), turn));
          own.push(ip, iq);
        }
      }
    }
    const subs = splitAll(raw, tol, eps, Math.max(cell, ad));
    const sg = grid(src, Math.max(cell, ad));
    const limit = ad - eps;
    const keep = [];
    for (let s = 0; s < subs.length; s++) {
      const p = subs[s].piece;
      const [x, y] = pointAt(p, 0.5);
      const e0 = own[subs[s].from * 2];
      const e1 = own[subs[s].from * 2 + 1];
      let ok = true;
      sg.query(x - ad, y - ad, x + ad, y + ad, (j) => {
        if (j === e0 || j === e1) return;
        if (distTo(src[j], x, y) < limit) {
          ok = false;
          return false;
        }
      });
      if (ok && lengthOf(p) > tol) keep.push(p);
    }
    const out = chain(keep, tol * 50);
    return out && out.map((loop) => tidy(loop, tol)).filter((loop) => loop.length >= 2);
  }

  // Concave fillets (arcs turning left) whose centres sit less than
  // `reach` apart across the inside of the shape: a neck thinner than the
  // opening would keep.
  function hasNeck(loops, reach) {
    const fillets = [];
    loops.forEach((loop) => loop.forEach((p) => {
      if (p.k === 1 && p.da < 0) fillets.push(p);
    }));
    if (fillets.length < 2) return false;
    const pts = loops.map(samplePoints);
    for (let i = 0; i < fillets.length; i++) {
      for (let j = i + 1; j < fillets.length; j++) {
        const a = fillets[i];
        const b = fillets[j];
        const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
        if (d >= reach || d <= 1e-9) continue;
        const mx = (a.cx + b.cx) * 0.5;
        const my = (a.cy + b.cy) * 0.5;
        let inside = false;
        for (let l = 0; l < pts.length; l++) if (pointInPoly(mx, my, pts[l])) inside = !inside;
        if (inside) return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- output

  function samplePoints(loop) {
    const pts = [];
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i];
      pts.push([p.x0, p.y0]);
      if (p.k === 1) {
        const byErr = p.r > SAMPLE_ERR ? 2 * Math.acos(1 - SAMPLE_ERR / p.r) : PI;
        const n = Math.min(90, Math.max(1, Math.ceil(Math.abs(p.da) / Math.min(SAMPLE_STEP, byErr))));
        for (let s = 1; s < n; s++) {
          const a = p.a0 + (p.da * s) / n;
          pts.push([p.cx + p.r * Math.cos(a), p.cy + p.r * Math.sin(a)]);
        }
      }
    }
    return pts;
  }

  function signedArea(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a * 0.5;
  }

  function pointInPoly(x, y, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i];
      const b = pts[j];
      if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }

  function publicSeg(p) {
    return p.k === 0
      ? { k: 0, x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1 }
      : { k: 1, x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1, cx: p.cx, cy: p.cy, r: p.r, a0: p.a0, da: p.da };
  }

  // ------------------------------------------------------------------ wrap

  // Members (and bridges) as cores grown by rho.
  function coreBoxes(rects, grow) {
    const out = [];
    for (let i = 0; i < rects.length; i++) {
      const q = rects[i];
      if (!(q.w > 0 && q.h > 0) || !isFinite(q.x) || !isFinite(q.y)) continue;
      const rs = Math.max(0, Math.min(Number(q.radius) || 0, q.w / 2, q.h / 2));
      out.push({ x0: q.x + rs, y0: q.y + rs, x1: q.x + q.w - rs, y1: q.y + q.h - rs, rho: rs + grow, rs: rs, rx0: q.x, ry0: q.y, rx1: q.x + q.w, ry1: q.y + q.h });
    }
    return out;
  }

  // Bridges join two members no more than `reach` apart. Where their
  // facing edges overlap, a box fills the gap across that overlap and
  // reaches into each member past its corner fillet, so aligned sides
  // continue straight. Where they only face corner to corner, a segment
  // between the corners (a stadium once grown) keeps the neck at least
  // 2 * offset wide; the closing alone would pinch it to nothing just
  // before the two part. The two agree as the overlap shrinks to zero.
  function bridges(boxes, reach, tol, grow, corner) {
    const out = [];
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i];
      for (let j = i + 1; j < boxes.length; j++) {
        const b = boxes[j];
        const gx = Math.max(b.rx0 - a.rx1, a.rx0 - b.rx1);
        const gy = Math.max(b.ry0 - a.ry1, a.ry0 - b.ry1);
        if (gx > 0 && gy < -tol && gx <= reach) {
          const [l, r] = a.rx1 <= b.rx0 ? [a, b] : [b, a];
          const y0 = Math.max(a.ry0, b.ry0);
          const y1 = Math.min(a.ry1, b.ry1);
          out.push({ x0: l.rx1 - l.rs, y0: y0, x1: r.rx0 + r.rs, y1: y1, rho: grow, rs: 0 });
        } else if (gy > 0 && gx < -tol && gy <= reach) {
          const [t, u] = a.ry1 <= b.ry0 ? [a, b] : [b, a];
          const x0 = Math.max(a.rx0, b.rx0);
          const x1 = Math.min(a.rx1, b.rx1);
          out.push({ x0: x0, y0: t.ry1 - t.rs, x1: x1, y1: u.ry0 + u.rs, rho: grow, rs: 0 });
        } else if (corner && gx >= -tol && gy >= -tol && Math.max(gx, gy) > tol
          && Math.hypot(Math.max(0, gx), Math.max(0, gy)) <= reach) {
          const ax = a.rx1 <= b.rx0 ? a.x1 : a.x0;
          const bx = a.rx1 <= b.rx0 ? b.x0 : b.x1;
          const ay = a.ry1 <= b.ry0 ? a.y1 : a.y0;
          const by = a.ry1 <= b.ry0 ? b.y0 : b.y1;
          out.push({ seg: true, x0: ax, y0: ay, x1: bx, y1: by, rho: grow + Math.min(a.rs, b.rs), rs: 0 });
        }
      }
    }
    return out;
  }

  // The outline: { loops: [{ segs, points, hole, area }], stats }, or null
  // when no attempt closes. A degenerate coincidence can defeat one exact
  // build, so a failed one retries with the distances nudged by a few
  // parts per billion (invisible), and last with no smoothing at all (the
  // exact offset union, still lines and arcs).
  function wrap(rects, offset, smooth) {
    const t0 = now();
    const off = Math.max(0, Number(offset) || 0);
    const r = Math.max(0.5, Number(smooth) || 0);
    for (const nudge of [0, 3.1e-9, -4.7e-9]) {
      const built = build(rects, off * (1 + nudge), r * (1 - nudge), true);
      if (built) return finish(built, t0, 0);
    }
    const plain = build(rects, off, 0, false);
    return plain ? finish(plain, t0, 1) : null;
  }

  function finish(built, t0, fallback) {
    const out = built.loops.map((loop) => {
      const points = samplePoints(loop);
      const area = signedArea(points);
      return { segs: loop.map(publicSeg), points: points, hole: area < 0, area: Math.abs(area) };
    }).filter((l) => l.area > built.tol);
    return { loops: out, stats: { ms: now() - t0, members: built.members, bridges: built.bridges, fallback: fallback } };
  }

  // One exact build: grow by off + r (with bridges when `smooth`), union,
  // shrink by r. { loops, tol, members, bridges } or null.
  function build(rects, off, r, smooth) {
    const R = off + r;
    const members = coreBoxes(rects || [], R);
    if (!members.length) return { loops: [], tol: 0, members: 0, bridges: 0 };
    let big = 1;
    let ext = 0;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < members.length; i++) {
      const b = members[i];
      big = Math.max(big, Math.abs(b.rx0), Math.abs(b.rx1), Math.abs(b.ry0), Math.abs(b.ry1));
      x0 = Math.min(x0, b.rx0);
      y0 = Math.min(y0, b.ry0);
      x1 = Math.max(x1, b.rx1);
      y1 = Math.max(y1, b.ry1);
    }
    ext = Math.max(x1 - x0, y1 - y0) + 2 * R;
    // tol: how close two computed points are the same point. eps: how
    // close a point is to lying on a boundary; far tighter, so that only
    // edges that truly coincide (computed bit for bit alike) count as one.
    const tol = 1e-9 * (big + ext + R);
    const eps = tol * 1e-2;
    // Cells about the size of a member neighbourhood.
    const cell = Math.max(R, ext / 64);
    const links = smooth ? bridges(members, 2 * R, tol, R, off > tol * 1e3) : [];
    const boxes = members.concat(links);
    const grown = unionRounded(boxes, tol, eps, cell);
    if (!grown) return null;
    const loops = r > 0 ? offsetLoops(grown, -r, tol, eps, cell) : grown.map((loop) => tidy(loop, tol));
    if (!loops) return null;
    return { loops: loops, tol: tol, members: members.length, bridges: links.length };
  }

  function now() {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  }

  // ------------------------------------------------------------- consumers

  // Replays loops into anything with moveTo / lineTo / arc / closePath
  // (a Path2D or a canvas context). Arcs stay arcs.
  function trace(loops, sink) {
    for (let i = 0; i < loops.length; i++) {
      const l = loops[i];
      if (l.segs && l.segs.length) {
        sink.moveTo(l.segs[0].x0, l.segs[0].y0);
        for (let s = 0; s < l.segs.length; s++) {
          const p = l.segs[s];
          if (p.k === 0) sink.lineTo(p.x1, p.y1);
          else sink.arc(p.cx, p.cy, p.r, p.a0, p.a0 + p.da, p.da < 0);
        }
      } else if (l.points && l.points.length) {
        sink.moveTo(l.points[0][0], l.points[0][1]);
        for (let s = 1; s < l.points.length; s++) sink.lineTo(l.points[s][0], l.points[s][1]);
      }
      sink.closePath();
    }
  }

  // SVG path data with real arcs. `num` formats a coordinate.
  function svgPath(loops, num) {
    const f = num || ((n) => String(Math.round(n * 1000) / 1000));
    let d = '';
    for (let i = 0; i < loops.length; i++) {
      const l = loops[i];
      if (l.segs && l.segs.length) {
        d += 'M' + f(l.segs[0].x0) + ' ' + f(l.segs[0].y0);
        for (let s = 0; s < l.segs.length; s++) {
          const p = l.segs[s];
          if (p.k === 0) {
            d += 'L' + f(p.x1) + ' ' + f(p.y1);
            continue;
          }
          // An SVG arc cannot close on its own start, and a half turn has
          // no unique large-arc flag once rounded; send short pieces.
          const n = Math.ceil(Math.abs(p.da) / (PI * 0.9));
          const r = f(p.r);
          for (let k = 1; k <= n; k++) {
            const a = p.a0 + (p.da * k) / n;
            const x = k === n ? p.x1 : p.cx + p.r * Math.cos(a);
            const y = k === n ? p.y1 : p.cy + p.r * Math.sin(a);
            d += 'A' + r + ' ' + r + ' 0 0 ' + (p.da > 0 ? 1 : 0) + ' ' + f(x) + ' ' + f(y);
          }
        }
      } else if (l.points && l.points.length) {
        d += 'M' + l.points.map((p) => f(p[0]) + ' ' + f(p[1])).join('L');
      }
      d += 'Z';
    }
    return d;
  }

  return {
    wrap: wrap,
    trace: trace,
    svgPath: svgPath,
    internals: {
      line: line,
      arc: arc,
      intersect: intersect,
      distTo: distTo,
      pointAt: pointAt,
      tangentAt: tangentAt,
      normalAt: normalAt,
      samplePoints: samplePoints,
      offsetLoops: offsetLoops,
      unionRounded: unionRounded,
      hasNeck: hasNeck,
      coreBoxes: coreBoxes,
      bridges: bridges,
      chain: chain,
      splitAll: splitAll,
      build: build,
      finish: finish,
    },
  };
});
