'use strict';

// Each sibling set compacts on its own; then the compacted sets travel as
// temporary rigid bodies. The authored groups never change.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProgramGroupBundle = api;
})(typeof window !== 'undefined' ? window : null, function () {
  function centroid(stickies) {
    let x = 0, y = 0, area = 0;
    stickies.forEach(s => {
      const a = s.w * s.h;
      x += (s.x + s.w / 2) * a;
      y += (s.y + s.h / 2) * a;
      area += a;
    });
    return {x: x / area, y: y / area, area};
  }

  // Reserve room for a compact cloud rather than its current, often interleaved
  // spread. Authored rigid groups keep their full bounds in this estimate.
  function footprint(engine, stickies, gap) {
    const bodies = new Map();
    stickies.forEach(s => {
      const key = s.group || s;
      if (!bodies.has(key)) bodies.set(key, []);
      bodies.get(key).push(s);
    });
    const boxes = [...bodies.values()].map(body => engine.boundsOf(body));
    const area = boxes.reduce((sum, box) => sum + (box.w + gap) * (box.h + gap), 0);
    const width = Math.max(Math.sqrt(area), ...boxes.map(box => box.w + gap));
    let x = 0, y = 0, h = 0, w = 0;
    boxes.sort((a, b) => b.h - a.h || b.w - a.w).forEach(box => {
      if (x && x + box.w + gap > width) { y += h; x = 0; h = 0; }
      x += box.w + gap;
      h = Math.max(h, box.h + gap);
      w = Math.max(w, x);
    });
    return {w: Math.max(0, w - gap), h: Math.max(0, y + h - gap)};
  }

  function clampCenter(center, box, frame, gap) {
    if (!frame) return;
    ['x', 'y'].forEach((axis, i) => {
      const size = i ? 'h' : 'w';
      const lo = frame[axis] + gap + box[size] / 2;
      const hi = frame[axis] + frame[size] - gap - box[size] / 2;
      center[axis] = lo <= hi ? Math.max(lo, Math.min(hi, center[axis])) : frame[axis] + frame[size] / 2;
    });
  }

  function spaceCenters(engine, model, clusters) {
    const gap = engine.gapOf(model);
    const typical = Math.sqrt(clusters.reduce((sum, cluster) => sum + cluster.center.area, 0) /
      Math.max(1, clusters.reduce((sum, cluster) => sum + cluster.stickies.length, 0)));
    const air = Math.max(gap * 3, typical * 0.8);
    clusters.forEach(cluster => {
      cluster.footprint = footprint(engine, cluster.stickies, gap);
      clampCenter(cluster.center, cluster.footprint, model.frame, gap);
    });
    // Keep the layout's existing geography where possible. Coincident centers
    // receive a deterministic radial seed so interleaved sets do not all queue
    // along one axis; repeated rectangle separation reserves space by cloud size.
    for (let pass = 0; pass < 160; pass++) {
      let overlap = 0;
      for (let i = 0; i < clusters.length; i++) {
        const a = clusters[i];
        for (let j = i + 1; j < clusters.length; j++) {
          const b = clusters[j];
          let dx = b.center.x - a.center.x, dy = b.center.y - a.center.y;
          if (Math.abs(dx) + Math.abs(dy) < 1e-7) {
            const angle = (i + j * 2.399963229728653) % (Math.PI * 2);
            dx = Math.cos(angle) * 1e-4; dy = Math.sin(angle) * 1e-4;
          }
          const ox = (a.footprint.w + b.footprint.w) / 2 + air - Math.abs(dx);
          const oy = (a.footprint.h + b.footprint.h) / 2 + air - Math.abs(dy);
          if (ox <= 0 || oy <= 0) continue;
          overlap = Math.max(overlap, Math.min(ox, oy));
          const axis = ox < oy ? 'x' : 'y';
          const direction = Math.sign(axis === 'x' ? dx : dy) || (i % 2 ? -1 : 1);
          const shift = ((axis === 'x' ? ox : oy) + 1e-5) * direction;
          const weight = b.center.area / (a.center.area + b.center.area);
          a.center[axis] -= shift * weight;
          b.center[axis] += shift * (1 - weight);
          clampCenter(a.center, a.footprint, model.frame, gap);
          clampCenter(b.center, b.footprint, model.frame, gap);
        }
      }
      if (overlap < 0.01) break;
    }
  }

  function begin(engine, model, keys) {
    const list = engine.alive(model);
    const roles = engine.getColumnRoles ? engine.getColumnRoles(model) : {groupKeys: [model.groupKey].filter(Boolean)};
    const groupKeys = Array.isArray(keys) ? keys : roles.groupKeys;
    const parent = list.map((_, i) => i);
    const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
    const unite = (a, b) => { parent[find(b)] = find(a); };
    const categories = new Map(), rigid = new Map();
    list.forEach((s, i) => {
      const fields = model.rows[s.rowIndex].fields;
      const values = groupKeys.map(key => String(fields[key] || '').trim());
      if (values.some(Boolean)) {
        const tag = JSON.stringify(values);
        if (categories.has(tag)) unite(i, categories.get(tag)); else categories.set(tag, i);
      }
      if (s.group) {
        if (rigid.has(s.group)) unite(i, rigid.get(s.group)); else rigid.set(s.group, i);
      }
    });
    const byRoot = new Map();
    list.forEach((s, i) => {
      const key = find(i);
      if (!byRoot.has(key)) byRoot.set(key, []);
      byRoot.get(key).push(s);
    });
    const clusters = [...byRoot.values()].map(stickies => ({
      stickies, model: Object.assign({}, model, {stickies}), center: centroid(stickies), done: false,
    }));
    spaceCenters(engine, model, clusters);
    const travel = Math.max(0, ...clusters.flatMap(cluster => cluster.stickies.map(s =>
      Math.hypot(s.x + s.w / 2 - cluster.center.x, s.y + s.h / 2 - cluster.center.y))));
    return {engine, model, clusters, phase: 'siblings', frames: 0, travel, done: false,
      grouped: clusters.filter(c => c.stickies.length > 1).length};
  }

  function step(state, options) {
    if (state.done) return {done: true, moved: 0};
    const opts = Object.assign({pull: 0.1, maxPush: 9}, options);
    let moved = 0;
    state.frames += 1;
    // A distant sibling needs enough frames to arrive at the current animation
    // speed. A fixed timeout would freeze a still-sprawling set into one body.
    const limit = Math.max(420, Math.ceil(state.travel / Math.max(0.01, opts.maxPush)) * 2 + 180);
    if (state.phase === 'siblings') {
      state.clusters.forEach(cluster => {
        if (cluster.done) return;
        const delta = state.engine.bundleStep(cluster.model, [], Object.assign({}, opts, {center: cluster.center}));
        moved = Math.max(moved, delta);
        if (state.frames > 18 && delta < 0.05) cluster.done = true;
      });
      if (state.clusters.every(c => c.done) || state.frames >= limit) {
        const proxies = [];
        state.clusters.forEach((cluster, i) => {
          cluster.stickies.forEach(s => proxies.push(Object.assign({}, s, {group: 'bundle-cluster-' + i})));
        });
        state.proxy = Object.assign({}, state.model, {stickies: proxies});
        state.originals = new Map(state.engine.alive(state.model).map(s => [s.id, s]));
        const center = centroid(state.proxy.stickies);
        state.travel = Math.max(0, ...state.clusters.map(cluster => {
          const own = centroid(cluster.stickies);
          return Math.hypot(own.x - center.x, own.y - center.y);
        }));
        state.phase = 'clusters';
        state.frames = 0;
      }
    } else {
      moved = state.engine.bundleStep(state.proxy, [], opts);
      state.proxy.stickies.forEach(s => {
        const target = state.originals.get(s.id);
        if (target) { target.x = s.x; target.y = s.y; }
      });
      if (state.frames > 18 && (moved < 0.05 || state.frames >= limit)) state.done = true;
    }
    return {done: state.done, moved};
  }
  return {begin, step};
});
