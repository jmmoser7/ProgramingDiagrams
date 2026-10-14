'use strict';

// Shared fills for the board, export, and isometric renderer. A ramp belongs
// to a cohort of stickies, so changing an area or duplicating a member keeps
// the colors relative to the current smallest and largest member.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProgramAppearance = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DEFAULT_FILL = '#dcd7cf';
  const DEFAULT_START = '#ff3597';
  const DEFAULT_END = '#ff947e';
  const DEFAULT_HEIGHT = 8;
  const MATERIALS = Object.freeze({
    matte: Object.freeze({ title: 'Matte', opacity: 1, roughness: 0.86 }),
    glossy: Object.freeze({ title: 'Glossy', opacity: 1, roughness: 0.15 }),
    jelly: Object.freeze({ title: 'Jelly', opacity: 0.7, roughness: 0.12 }),
    glass: Object.freeze({ title: 'Beach glass', opacity: 0.58, roughness: 0.68 }),
    ceramic: Object.freeze({ title: 'Ceramic', opacity: 1, roughness: 0.72 }),
  });
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

  function hex(value, fallback) {
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
    return fallback === undefined ? null : fallback;
  }

  function interpolate(start, end, amount) {
    const a = hex(start, DEFAULT_START);
    const b = hex(end, DEFAULT_END);
    const t = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 0.5;
    let out = '#';
    for (let i = 1; i < 7; i += 2) {
      const x = parseInt(a.slice(i, i + 2), 16);
      const y = parseInt(b.slice(i, i + 2), 16);
      out += Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
    }
    return out;
  }

  function alive(model) {
    return ((model && model.stickies) || []).filter((s) => s && model.rows && model.rows[s.rowIndex] && !model.rows[s.rowIndex].dropped && areaOf(s) > 0);
  }

  // Scope may be a selection (ids, stickies, or {ids}), a locked group
  // ({group}), or a categorical sheet value ({key, value}). Category scopes
  // are resolved when applied; every resulting member shares the ramp id.
  function scopeMembers(model, scope) {
    const list = alive(model);
    if (typeof scope === 'string') return list.filter((s) => s.gradientId === scope);
    if (scope && scope.key != null) {
      return list.filter((s) => String(model.rows[s.rowIndex].fields[scope.key] == null ? '' : model.rows[s.rowIndex].fields[scope.key]) === String(scope.value == null ? '' : scope.value));
    }
    if (scope && scope.group != null) return list.filter((s) => s.group === scope.group);
    const src = Array.isArray(scope) ? scope : scope && Array.isArray(scope.ids) ? scope.ids : scope && scope.id ? [scope] : [];
    const ids = new Set(src.map((item) => typeof item === 'string' ? item : item && item.id));
    return list.filter((s) => ids.has(s.id));
  }

  function readGradients(source) {
    const out = Object.create(null);
    if (!source || typeof source !== 'object' || Array.isArray(source)) return out;
    Object.keys(source).forEach((id) => {
      const ramp = source[id];
      if (!/^r[0-9a-z]+$/i.test(id) || !ramp || !hex(ramp.start) || !hex(ramp.end)) return;
      out[id] = { start: hex(ramp.start), end: hex(ramp.end) };
    });
    return out;
  }

  function gradientFor(model, sticky) {
    const id = sticky && sticky.gradientId;
    const source = model && model.gradients;
    if (typeof id !== 'string' || !own(source, id)) return null;
    const ramp = source[id];
    if (!ramp || !hex(ramp.start) || !hex(ramp.end)) return null;
    return { id: id, start: hex(ramp.start), end: hex(ramp.end) };
  }

  function commonGradient(model, scope) {
    const list = scopeMembers(model, scope);
    if (!list.length) return null;
    const first = gradientFor(model, list[0]);
    if (!first || !list.every((s) => s.gradientId === first.id)) return null;
    return first;
  }

  function setGradient(model, scope, start, end) {
    const list = scopeMembers(model, scope);
    if (!list.length) return null;
    const first = commonGradient(model, list);
    // Reuse the ramp only when all its members are selected. Editing a
    // subset must not recolor notes outside the user's selection.
    let id = first && scopeMembers(model, first.id).length === list.length ? first.id : null;
    if (!model.gradients || typeof model.gradients !== 'object') model.gradients = Object.create(null);
    if (!id) {
      let next = 1;
      Object.keys(model.gradients).forEach((key) => {
        const n = /^r[0-9a-z]+$/i.test(key) ? parseInt(key.slice(1), 36) : 0;
        if (Number.isFinite(n)) next = Math.max(next, n + 1);
      });
      id = 'r' + next.toString(36);
    }
    model.gradients[id] = { start: hex(start, DEFAULT_START), end: hex(end, DEFAULT_END) };
    list.forEach((s) => { s.gradientId = id; });
    return id;
  }

  function clearGradient(model, scope) {
    let count = 0;
    scopeMembers(model, scope).forEach((s) => {
      if (!s.gradientId) return;
      s.gradientId = null;
      count += 1;
    });
    return count;
  }

  function areaOf(sticky) {
    if (sticky.tw === 0 && sticky.th === 0) return 0;
    const trueArea = sticky.tw * sticky.th;
    const drawnArea = sticky.w * sticky.h;
    return Number.isFinite(trueArea) && trueArea > 0 ? trueArea : Number.isFinite(drawnArea) && drawnArea > 0 ? drawnArea : 0;
  }

  function fillFor(model, sticky, prepared) {
    if (prepared && prepared.has(sticky.id)) return prepared.get(sticky.id);
    const ramp = gradientFor(model, sticky);
    if (!ramp) return hex(sticky && sticky.color, DEFAULT_FILL);
    const members = scopeMembers(model, ramp.id);
    let min = Infinity;
    let max = -Infinity;
    members.forEach((s) => {
      const a = areaOf(s);
      min = Math.min(min, a);
      max = Math.max(max, a);
    });
    const t = max > min ? (areaOf(sticky) - min) / (max - min) : 0.5;
    return interpolate(ramp.start, ramp.end, t);
  }

  // Renderers may prepare once per paint/export to resolve every ramp in
  // linear time. The map is explicit so edits can never silently reuse a
  // stale cache; fillFor without it always reads the current model.
  function prepare(model) {
    const list = alive(model);
    const ranges = new Map();
    const colors = new Map();
    list.forEach((s) => {
      const ramp = gradientFor(model, s);
      if (!ramp) {
        colors.set(s.id, hex(s.color, DEFAULT_FILL));
        return;
      }
      const a = areaOf(s);
      const range = ranges.get(ramp.id);
      if (range) {
        range.min = Math.min(range.min, a);
        range.max = Math.max(range.max, a);
      } else ranges.set(ramp.id, { min: a, max: a, ramp: ramp });
    });
    list.forEach((s) => {
      if (colors.has(s.id)) return;
      const range = ranges.get(s.gradientId);
      const t = range.max > range.min ? (areaOf(s) - range.min) / (range.max - range.min) : 0.5;
      colors.set(s.id, interpolate(range.ramp.start, range.ramp.end, t));
    });
    return colors;
  }

  function materialFor(sticky) {
    return sticky && own(MATERIALS, sticky.material) ? sticky.material : 'matte';
  }

  return {
    DEFAULT_FILL: DEFAULT_FILL,
    DEFAULT_START: DEFAULT_START,
    DEFAULT_END: DEFAULT_END,
    DEFAULT_HEIGHT: DEFAULT_HEIGHT,
    MATERIALS: MATERIALS,
    hex: hex,
    interpolate: interpolate,
    scopeMembers: scopeMembers,
    readGradients: readGradients,
    gradientFor: gradientFor,
    commonGradient: commonGradient,
    setGradient: setGradient,
    setScopeGradient: setGradient,
    clearGradient: clearGradient,
    areaOf: areaOf,
    fillFor: fillFor,
    prepare: prepare,
    materialFor: materialFor,
  };
});
