import * as T from "./vendor/three.module.min.js";
import { vec, arr, toWorld, toLocal, worldObjects, topology } from "./model.js";
export function coordinates(text, f, previous) {
  const s = text.trim(),
    world = /^w/i.test(s),
    relative = s.startsWith("@"),
    parts = s
      .replace(/^[w@]/i, "")
      .split(",")
      .map((x) => x.trim());
  if (
    parts.length < 2 ||
    parts.length > 3 ||
    parts.some((x) => !x || !Number.isFinite(Number(x)))
  )
    throw Error("Use x,y,z; wx,y,z; or @dx,dy,dz");
  const p = parts.map(Number);
  while (p.length < 3) p.push(0);
  if (p.some((x) => Math.abs(x) > 1e9))
    throw Error("Coordinates exceed document range");
  if (relative) {
    if (!previous) throw Error("Relative input needs a previous point");
    return previous.clone().add(toWorld(p, { ...f, origin: new T.Vector3() }));
  }
  return world ? vec(p) : toWorld(p, f);
}
export function segmentDistance(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    den = dx * dx + dy * dy,
    t = den
      ? T.MathUtils.clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / den, 0, 1)
      : 0;
  return { distance: Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy), t };
}
export function intersection3D(a, b, c, d) {
  const u = b.clone().sub(a),
    v = d.clone().sub(c),
    w = a.clone().sub(c),
    aa = u.dot(u),
    bb = u.dot(v),
    cc = v.dot(v),
    dd = u.dot(w),
    ee = v.dot(w),
    den = aa * cc - bb * bb;
  if (Math.abs(den) < aa * cc * 1e-12) return null;
  const s = (bb * ee - cc * dd) / den,
    t = (aa * ee - bb * dd) / den;
  if (s < 0 || s > 1 || t < 0 || t > 1) return null;
  const p = a.clone().addScaledVector(u, s),
    q = c.clone().addScaledVector(v, t),
    tol = Math.max(1e-9, Math.sqrt(Math.max(aa, cc)) * 1e-9);
  return p.distanceTo(q) <= tol ? p : null;
}
export function eligible(o, filter) {
  return (
    !!o &&
    o.visible &&
    !o.locked &&
    (filter === "all" ||
      filter === "components" ||
      (filter === "curves"
        ? ["line", "polyline"].includes(o.kind)
        : !["line", "polyline"].includes(o.kind)))
  );
}
export function snap(doc, view, p, f, settings, raw, previous) {
  if (!settings.snap) return null;
  const candidates = [],
    nearEdges = [];
  const add = (point, label, rank) => {
    const q = view.project(point),
      distance = Math.hypot(q.x - p.x, q.y - p.y);
    if (q.z >= -1 && q.z <= 1 && distance <= settings.snapRadius)
      candidates.push({ point, label, rank, distance });
  };
  for (const o of worldObjects(doc)) {
    if (!eligible(o, settings.filter)) continue;
    const ps = o.points.map(vec),
      t = topology(o);
    ps.forEach((v) => add(v, "End", 0));
    add(
      ps.reduce((a, b) => a.add(b), new T.Vector3()).divideScalar(ps.length),
      "Center",
      2,
    );
    for (const [i, j] of t.edges) {
      const a = ps[i],
        b = ps[j];
      add(a.clone().add(b).multiplyScalar(0.5), "Mid", 3);
      const hit = segmentDistance(p, view.project(a), view.project(b));
      if (hit.distance <= settings.snapRadius) nearEdges.push([a, b]);
    }
  }
  // Only compare nearby screen candidates, then prove coincidence in XYZ.
  for (let i = 0; i < nearEdges.length; i++)
    for (let j = i + 1; j < nearEdges.length; j++) {
      const q = intersection3D(...nearEdges[i], ...nearEdges[j]);
      if (q) add(q, "Intersection", 1);
    }
  candidates.sort((a, b) => a.rank - b.rank || a.distance - b.distance);
  const result = candidates[0];
  if (result && settings.project) {
    const l = toLocal(result.point, f);
    result.source = result.point.clone();
    result.point = toWorld([l[0], l[1], 0], f);
    result.label = "Projected " + result.label;
  }
  return result || null;
}
export function constrained(point, anchor, f, { lock, ortho, angle = 45 }) {
  if (!anchor) return point;
  const delta = point.clone().sub(anchor);
  if (lock) return anchor.clone().addScaledVector(lock, delta.dot(lock));
  if (!ortho) return point;
  const x = delta.dot(f.u),
    y = delta.dot(f.v),
    a =
      (Math.round(Math.atan2(y, x) / ((angle * Math.PI) / 180)) *
        angle *
        Math.PI) /
      180,
    dir = f.u
      .clone()
      .multiplyScalar(Math.cos(a))
      .addScaledVector(f.v, Math.sin(a));
  return anchor
    .clone()
    .addScaledVector(dir, delta.dot(dir))
    .addScaledVector(f.n, delta.dot(f.n));
}
export function elevatorPoint(view, p, base, f) {
  const ray = view.ray(p),
    w = ray.origin.clone().sub(base),
    v = ray.direction,
    b = v.dot(f.n),
    den = 1 - b * b;
  if (den < 1e-8) return base.clone();
  const height = (f.n.dot(w) - b * v.dot(w)) / den;
  return base.clone().addScaledVector(f.n, height);
}
export function inside(p, polygon) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      hit = !hit;
  }
  return hit;
}
const inRect = (p, r) =>
  p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;
function touches(a, b, r) {
  let t0 = 0,
    t1 = 1;
  const dx = b.x - a.x,
    dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x - r.minX],
    [dx, r.maxX - a.x],
    [-dy, a.y - r.minY],
    [dy, r.maxY - a.y],
  ]) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}
export function marquee(
  doc,
  view,
  a,
  b,
  components,
  filter = "all",
  componentType = "edge",
) {
  const r = {
      minX: Math.min(a.x, b.x),
      minY: Math.min(a.y, b.y),
      maxX: Math.max(a.x, b.x),
      maxY: Math.max(a.y, b.y),
    },
    crossing = b.x < a.x,
    result = [];
  for (const o of worldObjects(doc)) {
    if (
      !eligible(o, filter) ||
      (components &&
        doc.objects.find((x) => x.id === o.id)?.kind === "instance")
    )
      continue;
    const ps = o.points.map((v) => view.project(vec(v))),
      t = topology(o);
    if (ps.every((p) => p.z < -1 || p.z > 1)) continue;
    const test = (indices) => {
      const poly = indices.map((i) => ps[i]);
      if (!crossing)
        return poly.every((p) => p.z >= -1 && p.z <= 1 && inRect(p, r));
      if (poly.some((p) => inRect(p, r))) return true;
      for (let i = 0; i < poly.length - 1; i++)
        if (touches(poly[i], poly[i + 1], r)) return true;
      if (poly.length > 2) {
        if (touches(poly.at(-1), poly[0], r)) return true;
        return inside({ x: r.minX, y: r.minY }, poly);
      }
      return false;
    };
    if (components) {
      const sets =
        componentType === "vertex"
          ? ps.map((_, i) => [i])
          : componentType === "face"
            ? t.faces
            : t.edges;
      sets.forEach((indices, i) => {
        if (test(indices))
          result.push({ id: o.id, type: componentType, index: i });
      });
    } else {
      const hit = !crossing
        ? test(ps.map((_, i) => i))
        : t.edges.some((e) => test(e)) || t.faces.some((face) => test(face));
      if (hit) result.push({ id: o.id, type: "object" });
    }
  }
  return [...new Map(result.map((s) => [JSON.stringify(s), s])).values()];
}
