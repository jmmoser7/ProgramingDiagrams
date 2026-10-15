'use strict';

// Presentation geometry only. The caller supplies a separate render model;
// source snapshots and the authoritative restored board remain untouched.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProgramBoardTransition = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const STICKY = ['x', 'y', 'w', 'h', 'z', 'height', 'radius', 'stroke', 'shadow'];
  const FRAME = ['x', 'y', 'w', 'h'];
  const TEXT = ['x', 'y', 'w', 'size'];
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const list = value => Array.isArray(value) ? value : [];

  function index(items) {
    const byId = new Map();
    for (const item of items) {
      if (!item || item.id == null || item.id === '') continue;
      byId.set(item.id, byId.has(item.id) ? null : item);
    }
    return byId;
  }

  function create(fromState, renderModel, targetCamera) {
    if (!renderModel || typeof renderModel !== 'object') throw new TypeError('A separate render model is required.');
    const source = fromState && fromState.board || {};
    const sourceCamera = fromState && fromState.camera || {};
    const camera = Object.assign({}, targetCamera);
    const target = {
      x: finite(camera.x) ? camera.x : 0,
      y: finite(camera.y) ? camera.y : 0,
      z: finite(camera.z) && camera.z > 0 ? camera.z : 1,
    };
    const start = {
      x: finite(sourceCamera.x) ? sourceCamera.x : target.x,
      y: finite(sourceCamera.y) ? sourceCamera.y : target.y,
      z: finite(sourceCamera.z) && sourceCamera.z > 0 ? sourceCamera.z : target.z,
    };
    const tracks = [];
    let needsCrossfade = !!source.frame !== !!renderModel.frame;

    function geometry(before, after, keys) {
      for (const key of keys) {
        // Missing optional target properties stay missing. Missing source
        // values begin at the target instead of manufacturing NaN values.
        if (!finite(after[key])) continue;
        tracks.push({object: after, key, from: finite(before[key]) ? before[key] : after[key], to: after[key]});
      }
    }

    function matching(name, visit) {
      const oldItems = list(source[name]), newItems = list(renderModel[name]);
      const oldById = index(oldItems), newById = index(newItems);
      if (oldItems.length !== newItems.length || oldById.size !== oldItems.length || newById.size !== newItems.length) needsCrossfade = true;
      for (const item of newItems) {
        const old = item && oldById.get(item.id);
        if (!old || newById.get(item.id) !== item) { needsCrossfade = true; continue; }
        visit(old, item);
      }
    }

    matching('stickies', (before, after) => geometry(before, after, STICKY));
    matching('texts', (before, after) => geometry(before, after, TEXT));
    matching('lines', (before, after) => {
      if (!Array.isArray(before.points) || !Array.isArray(after.points) || before.points.length !== after.points.length) {
        needsCrossfade = true;
        return;
      }
      for (let i = 0; i < after.points.length; i++) {
        if (!Array.isArray(before.points[i]) || !Array.isArray(after.points[i])) { needsCrossfade = true; continue; }
        geometry(before.points[i], after.points[i], [0, 1]);
      }
    });
    if (source.frame && renderModel.frame) geometry(source.frame, renderModel.frame, FRAME);

    function apply(progress) {
      const value = Number(progress);
      const t = Number.isNaN(value) ? 0 : Math.max(0, Math.min(1, value));
      const eased = t === 0 || t === 1 ? t : t * t * t * (t * (t * 6 - 15) + 10);
      for (const track of tracks) {
        track.object[track.key] = eased === 0 ? track.from : eased === 1 ? track.to : track.from * (1 - eased) + track.to * eased;
      }
      camera.x = eased === 0 ? start.x : eased === 1 ? target.x : start.x * (1 - eased) + target.x * eased;
      camera.y = eased === 0 ? start.y : eased === 1 ? target.y : start.y * (1 - eased) + target.y * eased;
      camera.z = eased === 0 ? start.z : eased === 1 ? target.z : Math.exp(Math.log(start.z) * (1 - eased) + Math.log(target.z) * eased);
      return eased;
    }

    apply(0);
    return {model: renderModel, camera, apply, needsCrossfade};
  }

  return {create};
});
