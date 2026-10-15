'use strict';

// Each sibling set compacts on its own; then the compacted sets travel as
// temporary rigid bodies. The authored groups never change.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProgramGroupBundle = api;
})(typeof window !== 'undefined' ? window : null, function () {
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
      stickies, model: Object.assign({}, model, {stickies}), done: stickies.length < 2,
    }));
    return {engine, model, clusters, phase: 'siblings', frames: 0, done: false,
      grouped: clusters.filter(c => c.stickies.length > 1).length};
  }

  function step(state, options) {
    if (state.done) return {done: true, moved: 0};
    const opts = Object.assign({pull: 0.1, maxPush: 9}, options);
    let moved = 0;
    state.frames += 1;
    if (state.phase === 'siblings') {
      state.clusters.forEach(cluster => {
        if (cluster.done) return;
        const delta = state.engine.bundleStep(cluster.model, [], opts);
        moved = Math.max(moved, delta);
        if (state.frames > 18 && delta < 0.05) cluster.done = true;
      });
      if (state.clusters.every(c => c.done) || state.frames >= 420) {
        const proxies = [];
        state.clusters.forEach((cluster, i) => {
          cluster.stickies.forEach(s => proxies.push(Object.assign({}, s, {group: 'bundle-cluster-' + i})));
        });
        state.proxy = Object.assign({}, state.model, {stickies: proxies});
        state.originals = new Map(state.engine.alive(state.model).map(s => [s.id, s]));
        state.phase = 'clusters';
        state.frames = 0;
      }
    } else {
      moved = state.engine.bundleStep(state.proxy, [], opts);
      state.proxy.stickies.forEach(s => {
        const target = state.originals.get(s.id);
        if (target) { target.x = s.x; target.y = s.y; }
      });
      if (state.frames > 18 && (moved < 0.05 || state.frames >= 420)) state.done = true;
    }
    return {done: state.done, moved};
  }
  return {begin, step};
});
