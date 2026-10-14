'use strict';

// Shared by the renderer, ray selection and the geometry checks. A rounded
// box is the Minkowski sum of an inset box and a sphere: all twelve edges
// are cylindrical and all eight corners are spherical, including the base.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProgramIsoGeometry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const unit = v => { const len = Math.hypot(...v) || 1; return v.map(n => n / len); };
  function radiusFor(w, d, h, radius) { return clamp(Number(radius) || 0, 0, Math.min(w, d, h) / 2); }
  function axes(angle) {
    const c = Math.cos(angle), s = Math.sin(angle), e = Math.asin(1 / Math.sqrt(3));
    return { right: [c, s, 0], up: [-s * Math.sin(e), c * Math.sin(e), Math.cos(e)], toward: [s * Math.cos(e), -c * Math.cos(e), Math.sin(e)] };
  }
  function mesh(w, d, h, radius, segments) {
    const half = [w / 2, d / 2, h / 2], r = radiusFor(w, d, h, radius), n = segments || 5;
    const coordinates = half.map(v => {
      if (!r) return [-v, v];
      const values = [];
      for (let i = 0; i <= n; i++) values.push(-v + r * i / n);
      for (let i = 0; i <= n; i++) values.push(v - r + r * i / n);
      return values.filter((v, i, a) => !i || Math.abs(v - a[i - 1]) > 1e-9);
    });
    const positions = [], normals = [];
    function point(axis, sign, a, b, u, v) {
      const p = [0, 0, 0]; p[axis] = sign * half[axis]; p[a] = u; p[b] = v;
      if (!r) { const normal = [0, 0, 0]; normal[axis] = sign; return { p, n: normal }; }
      const core = p.map((q, i) => clamp(q, -half[i] + r, half[i] - r));
      const normal = unit(p.map((q, i) => q - core[i]));
      return { p: core.map((q, i) => q + r * normal[i]), n: normal };
    }
    function triangle(a, b, c, axis, sign) {
      const ab = b.p.map((v, i) => v - a.p[i]), ac = c.p.map((v, i) => v - a.p[i]);
      const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      const vertices = cross[axis] * sign >= 0 ? [a, b, c] : [a, c, b];
      vertices.forEach(v => { positions.push(...v.p); normals.push(...v.n); });
    }
    for (let axis = 0; axis < 3; axis++) {
      const a = (axis + 1) % 3, b = (axis + 2) % 3;
      for (const sign of [-1, 1]) {
        const us = coordinates[a], vs = coordinates[b];
        for (let i = 0; i < us.length - 1; i++) for (let j = 0; j < vs.length - 1; j++) {
          const q = [point(axis, sign, a, b, us[i], vs[j]), point(axis, sign, a, b, us[i + 1], vs[j]), point(axis, sign, a, b, us[i + 1], vs[j + 1]), point(axis, sign, a, b, us[i], vs[j + 1])];
          triangle(q[0], q[1], q[2], axis, sign); triangle(q[0], q[2], q[3], axis, sign);
        }
      }
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), count: positions.length / 3, radius: r };
  }
  function distance(point, half, radius) {
    const q = point.map((v, i) => Math.abs(v) - half[i] + radius);
    return Math.hypot(...q.map(v => Math.max(v, 0))) + Math.min(Math.max(...q), 0) - radius;
  }
  // Sphere tracing stays on the same analytic rounded surface as the mesh.
  // Returning every box hit, including occluded boxes, enables dig selection.
  function rayHit(origin, direction, sticky) {
    const h = Math.max(0.1, sticky.height || 8), z = Math.max(0, sticky.z || 0);
    const half = [sticky.w / 2, sticky.h / 2, h / 2];
    const center = [sticky.x + half[0], sticky.y + half[1], z + half[2]];
    const local = origin.map((v, i) => v - center[i]);
    let near = -Infinity, far = Infinity;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(direction[i]) < 1e-12) { if (Math.abs(local[i]) > half[i]) return null; continue; }
      const a = (-half[i] - local[i]) / direction[i], b = (half[i] - local[i]) / direction[i];
      near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
    }
    if (far < Math.max(near, 0)) return null;
    const r = radiusFor(sticky.w, sticky.h, h, sticky.radius), epsilon = Math.max(0.00005, Math.min(...half) * 0.00001);
    let t = Math.max(0, near);
    for (let k = 0; k < 96 && t <= far + epsilon; k++) {
      const p = local.map((v, i) => v + direction[i] * t), gap = distance(p, half, r);
      if (gap < epsilon) {
        let normal;
        if (r) normal = unit(p.map((v, i) => v - clamp(v, -half[i] + r, half[i] - r)));
        else { const distances = p.map((v, i) => Math.abs(Math.abs(v) - half[i])); const axis = distances.indexOf(Math.min(...distances)); normal = [0, 0, 0]; normal[axis] = Math.sign(p[axis]); }
        return { t, point: p.map((v, i) => v + center[i]), normal, top: normal[2] > 0.6 };
      }
      t += Math.max(gap, epsilon * 0.5);
    }
    return null;
  }
  function overlapArea(a, b) { return Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)); }
  // A stack is supported when an upper base coincides with a lower top.
  // Recompute from the drag's original geometry, not the preceding frame,
  // so height changes never accumulate drift through a multi-cell stack.
  function followSupports(stickies, before, independent) {
    const byId = new Map(stickies.map(s => [s.id, s])), excluded = independent || new Set();
    const ordered = before.slice().sort((a, b) => (a.z || 0) - (b.z || 0));
    for (const old of ordered) {
      const s = byId.get(old.id); if (!s || excluded.has(s.id)) continue;
      s.z = old.z || 0;
      if (s.z <= 0) continue;
      const supports = before.filter(p => p.id !== s.id && Math.abs((p.z || 0) + (p.height || 8) - (old.z || 0)) < 0.002 && overlapArea(p, old) >= Math.min(p.w * p.h, old.w * old.h) * 0.1).map(p => byId.get(p.id)).filter(Boolean);
      if (supports.length) s.z = Math.max(0, ...supports.map(p => (p.z || 0) + (p.height || 8)));
    }
  }
  return { dot, unit, clamp, axes, mesh, radiusFor, distance, rayHit, overlapArea, followSupports };
});
