'use strict';

// A surface grip is local to its solid, so changing elevation never moves the
// authored grab spot to another face. This module has no DOM or physics state.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DragFeelGrip = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const X = 0.866, Y = 0.5, Z = 0.9, EPS = 1e-8;
  const clamp = (value, size) => Math.max(0, Math.min(size, value));
  const within = (value, size) => value >= -EPS && value <= size + EPS;
  const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
  const elevation = block => block.z === undefined ? 0 : block.z;
  const validScene = (block, camera) => block && finitePoint(block) && camera && finitePoint(camera.origin) &&
    Number.isFinite(camera.scale) && camera.scale > 0 && ['iso', 'top'].includes(camera.view) &&
    Number.isFinite(elevation(block)) && [block.w, block.h, block.height].every(size => Number.isFinite(size) && size > 0);

  function project(x, y, z, camera) {
    if (camera.view === 'top') return { x: camera.origin.x + x * camera.scale, y: camera.origin.y + y * camera.scale };
    return {
      x: camera.origin.x + (x - y) * X * camera.scale,
      y: camera.origin.y + ((x + y) * Y - z * Z) * camera.scale
    };
  }

  function delta(dx, dy, camera) {
    if (camera.view === 'top') return { x: dx / camera.scale, y: dy / camera.scale };
    const a = dx / (X * camera.scale), b = dy / (Y * camera.scale);
    return { x: (a + b) / 2, y: (b - a) / 2 };
  }

  function unproject(point, z, camera) {
    const dy = point.y - camera.origin.y + (camera.view === 'top' ? 0 : z * Z * camera.scale);
    return delta(point.x - camera.origin.x, dy, camera);
  }

  function pick(block, point, camera) {
    if (!validScene(block, camera) || !finitePoint(point)) return null;
    const base = elevation(block), roof = unproject(point, base + block.height, camera);
    let x = roof.x - block.x, y = roof.y - block.y;
    if (within(x, block.w) && within(y, block.h)) return {
      local: { x: clamp(x, block.w), y: clamp(y, block.h), z: block.height }, face: 'top'
    };
    if (camera.view === 'top') return null;

    // On each visible side one world coordinate is fixed. Solve the remaining
    // coordinate and height directly rather than projecting onto the roof.
    const a = (point.x - camera.origin.x) / (X * camera.scale);
    const b = (point.y - camera.origin.y) / camera.scale;
    const worldX = block.x + block.w, worldY = worldX - a;
    y = worldY - block.y;
    let z = ((worldX + worldY) * Y - b) / Z - base;
    if (within(y, block.h) && within(z, block.height)) return {
      local: { x: block.w, y: clamp(y, block.h), z: clamp(z, block.height) }, face: 'x'
    };
    const fixedY = block.y + block.h, solvedX = a + fixedY;
    x = solvedX - block.x;
    z = ((solvedX + fixedY) * Y - b) / Z - base;
    if (within(x, block.w) && within(z, block.height)) return {
      local: { x: clamp(x, block.w), y: block.h, z: clamp(z, block.height) }, face: 'y'
    };
    return null;
  }

  function screenPoint(block, grip, camera) {
    return project(block.x + grip.local.x, block.y + grip.local.y, elevation(block) + grip.local.z, camera);
  }

  function features(block, camera) {
    if (!validScene(block, camera)) return [];
    const result = [], blockId = block.id === undefined ? null : block.id;
    function add(type, key, local) {
      const faces = [];
      if (local.z === block.height) faces.push('top');
      if (camera.view === 'iso') {
        if (local.x === block.w) faces.push('x');
        if (local.y === block.h) faces.push('y');
      }
      if (!faces.length) return;
      const feature = { id: String(blockId ?? '') + ':' + key, blockId, type, local, face: faces[0], faces };
      feature.screen = screenPoint(block, feature, camera);
      result.push(feature);
    }
    // Enumerate box topology once, rather than once per owning face. Shared
    // corners and shared edge midpoints therefore produce one marker each.
    for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) {
      add('vertex', 'vertex-' + x + y + z, { x: x * block.w, y: y * block.h, z: z * block.height });
    }
    for (const y of [0, 1]) for (const z of [0, 1]) {
      add('midpoint', 'midpoint-x-' + y + z, { x: block.w / 2, y: y * block.h, z: z * block.height });
    }
    for (const x of [0, 1]) for (const z of [0, 1]) {
      add('midpoint', 'midpoint-y-' + x + z, { x: x * block.w, y: block.h / 2, z: z * block.height });
    }
    for (const x of [0, 1]) for (const y of [0, 1]) {
      add('midpoint', 'midpoint-z-' + x + y, { x: x * block.w, y: y * block.h, z: block.height / 2 });
    }
    return result;
  }

  function pickFeature(block, point, camera, options = {}) {
    if (!finitePoint(point)) return null;
    const radius = Number.isFinite(options.radius) ? Math.max(0, options.radius) : 10;
    const hysteresis = Number.isFinite(options.hysteresis) ? Math.max(0, options.hysteresis) : 3;
    const previousId = typeof options.previous === 'string' ? options.previous : options.previous && options.previous.id;
    let closest = null, previous = null;
    for (const feature of features(block, camera)) {
      // Occlusion belongs to the scene: callers test this feature pixel, not
      // just the pointer pixel, so an edge can acquire from outside its solid.
      if (typeof options.isVisible === 'function' && !options.isVisible(feature)) continue;
      const candidate = { ...feature, distance: Math.hypot(feature.screen.x - point.x, feature.screen.y - point.y) };
      if (candidate.id === previousId && candidate.distance <= radius + hysteresis + EPS) previous = candidate;
      if (candidate.distance <= radius + EPS && (!closest || candidate.distance < closest.distance - EPS)) closest = candidate;
    }
    // Retention extends capture modestly, but a substantially closer visible
    // target wins. Every distance is in CSS pixels, including after zoom/pan.
    if (previous && (!closest || closest.id === previous.id || closest.distance + hysteresis >= previous.distance)) return previous;
    return closest;
  }

  return Object.freeze({ project, unproject, pick, screenPoint, delta, features, pickFeature });
});
