(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InteractionDirectionConstraint = api;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  // Closest-point projection keeps the old horizontal/vertical constraint at
  // 90°, and extends it to diagonal or finer directions around the same anchor.
  function constrainDirection(point, anchor, step = 90) {
    if (![point?.x, point?.y, anchor?.x, anchor?.y].every(Number.isFinite)) {
      throw new TypeError('Direction constraints require finite XY points.');
    }
    if (!Number.isFinite(step) || step < 1 || step > 90) step = 90;
    const dx = point.x - anchor.x, dy = point.y - anchor.y;
    if (!dx && !dy) return {x:anchor.x,y:anchor.y};
    const radians = step * Math.PI / 180;
    const angle = Math.round(Math.atan2(dy, dx) / radians) * radians;
    const clean = value => Math.abs(value) < 1e-12 ? 0 : value;
    const ux = clean(Math.cos(angle)), uy = clean(Math.sin(angle));
    const projected = dx * ux + dy * uy;
    return {x:anchor.x + projected * ux,y:anchor.y + projected * uy};
  }
  return {constrainDirection};
});
