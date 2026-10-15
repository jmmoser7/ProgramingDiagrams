/* Pure SmartTrack geometry. Coordinates and capture radii must share a space.
 * A guide extends in both directions. A geometry intersection is confined to
 * the target segment; an optional z coordinate rejects projected crossings.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.InteractionTracking = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const EPSILON = 1e-8;
  const finitePoint = point => !!point && Number.isFinite(point.x) && Number.isFinite(point.y) && (point.z === undefined || Number.isFinite(point.z));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const clonePoint = point => point.z === undefined ? {x: point.x, y: point.y} : {x: point.x, y: point.y, z: point.z};
  function unit(direction) {
    if (!finitePoint(direction)) return null;
    const length = Math.hypot(direction.x, direction.y);
    if (!Number.isFinite(length) || length < EPSILON) return null;
    const result = {x: direction.x / length, y: direction.y / length};
    if (direction.z !== undefined) result.z = direction.z / length;
    return result;
  }
  function edgeData(value) {
    if (!value) return null;
    const pair = Array.isArray(value) ? value : value.edge;
    const a = pair ? pair[0] : value.a, b = pair ? pair[1] : value.b;
    if (!finitePoint(a) || !finitePoint(b)) return null;
    return {a, b, objectId: value.objectId || value.object && value.object.id || null};
  }
  function closestSegment(point, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared < EPSILON * EPSILON ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
    const q = {x: a.x + t * dx, y: a.y + t * dy};
    return {point: q, t, distance: distance(point, q)};
  }
  function uniqueDirections(directions) {
    const result = [];
    for (const direction of directions) {
      const normalized = unit(direction);
      if (!normalized) continue;
      // A dotted guide is a line: opposite directions describe the same guide.
      if (result.some(existing => Math.abs(existing.x * normalized.y - existing.y * normalized.x) < EPSILON && Math.abs((existing.z || 0) * normalized.x - (normalized.z || 0) * existing.x) < EPSILON && Math.abs((existing.z || 0) * normalized.y - (normalized.z || 0) * existing.y) < EPSILON)) continue;
      result.push(normalized);
    }
    return result;
  }
  function tangentDirections(object, point, geometry, options = {}) {
    if (!object || !finitePoint(point)) return [];
    if (object.kind === 'circle') {
      const rx = Number(object.width) / 2, ry = Number(object.height) / 2;
      if (!(rx > EPSILON && ry > EPSILON) || !Number.isFinite(rx) || !Number.isFinite(ry)) return [];
      const center = {x: Number(object.x) + rx, y: Number(object.y) + ry};
      if (!finitePoint(center)) return [];
      const angle = (Number.isFinite(object.rotation) ? object.rotation : 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
      const dx = point.x - center.x, dy = point.y - center.y;
      const x = dx * c + dy * s, y = -dx * s + dy * c;
      const normalizedRadius = Math.hypot(x / rx, y / ry);
      // A center snap has no curve tangent. Do not invent one from an axis.
      if (normalizedRadius < EPSILON) return [];
      const tx = -y / (ry * ry), ty = x / (rx * rx);
      return uniqueDirections([{x: tx * c - ty * s, y: tx * s + ty * c}]);
    }
    const edges = (geometry && geometry.edges || []).map(edgeData).filter(Boolean);
    if (!edges.length) return [];
    let nearest = Infinity;
    const measured = edges.map(edge => {
      const d = closestSegment(point, edge.a, edge.b).distance;
      nearest = Math.min(nearest, d);
      return {edge, distance: d};
    });
    const tolerance = Number.isFinite(options.tolerance) && options.tolerance >= 0 ? options.tolerance : 1e-5;
    // At a corner, retain every incident edge. A midpoint inherits its segment.
    // A polyline's closest segment is also useful for Near snaps displaced by
    // numeric tolerance; solid centers must not inherit an arbitrary perimeter.
    if (object.kind !== 'polyline' && nearest > tolerance) return [];
    return uniqueDirections(measured.filter(value => value.distance <= nearest + tolerance).map(({edge}) => ({x: edge.b.x - edge.a.x, y: edge.b.y - edge.a.y, ...(edge.a.z !== undefined || edge.b.z !== undefined ? {z: (edge.b.z || 0) - (edge.a.z || 0)} : {})})));
  }
  function makeReference(object, point, geometry, options = {}) {
    if (!finitePoint(point)) return null;
    const directions = tangentDirections(object, point, geometry, options);
    const inherited = directions.length > 0;
    return {point: clonePoint(point), directions: inherited ? directions : [{x: 1, y: 0}, {x: 0, y: 1}], label: options.label || (inherited && object && (object.kind === 'circle' || object.kind === 'polyline') ? 'Tangent' : 'Reference'), objectId: object && object.id || null, inherited};
  }
  function lineIntersection(origin, direction, a, b, options = {}) {
    if (!finitePoint(origin) || !finitePoint(a) || !finitePoint(b)) return null;
    const d = unit(direction);
    if (!d) return null;
    const ex = b.x - a.x, ey = b.y - a.y, edgeLength = Math.hypot(ex, ey);
    if (edgeLength < EPSILON) return null;
    const determinant = d.x * ey - d.y * ex;
    if (Math.abs(determinant) <= EPSILON * edgeLength) return null;
    const ax = a.x - origin.x, ay = a.y - origin.y;
    const t = (ax * ey - ay * ex) / determinant;
    const u = (ax * d.y - ay * d.x) / determinant;
    if (!Number.isFinite(t) || !Number.isFinite(u) || u < -EPSILON || u > 1 + EPSILON || options.forwardOnly && t < -EPSILON) return null;
    const point = {x: origin.x + t * d.x, y: origin.y + t * d.y};
    if (!finitePoint(point)) return null;
    if (origin.z !== undefined || d.z !== undefined || a.z !== undefined || b.z !== undefined) {
      const guideZ = (origin.z || 0) + t * (d.z || 0), edgeZ = (a.z || 0) + u * ((b.z || 0) - (a.z || 0));
      const tolerance = Number.isFinite(options.zTolerance) && options.zTolerance >= 0 ? options.zTolerance : 1e-5;
      if (!Number.isFinite(guideZ) || !Number.isFinite(edgeZ) || Math.abs(guideZ - edgeZ) > tolerance) return null;
      point.z = (guideZ + edgeZ) / 2;
    }
    return {point, t, u};
  }
  function closestGuide(reference, pointer, options = {}) {
    if (!reference || !finitePoint(reference.point) || !finitePoint(pointer) || !Array.isArray(reference.directions)) return null;
    const radius = Number.isFinite(options.radius) && options.radius >= 0 ? options.radius : Infinity;
    let best = null;
    for (const value of reference.directions) {
      const direction = unit(value);
      if (!direction) continue;
      let t = (pointer.x - reference.point.x) * direction.x + (pointer.y - reference.point.y) * direction.y;
      if (options.forwardOnly) t = Math.max(0, t);
      const point = {x: reference.point.x + direction.x * t, y: reference.point.y + direction.y * t};
      if (reference.point.z !== undefined || direction.z !== undefined) point.z = (reference.point.z || 0) + (direction.z || 0) * t;
      const d = distance(pointer, point);
      if (finitePoint(point) && d <= radius && (!best || d < best.distance)) best = {point, direction, distance: d, t, reference, objectId: reference.objectId || null, label: reference.label === 'Tangent' ? 'Tangent tracking' : 'Tracking', kind: 'projection'};
    }
    return best;
  }
  function guideCandidates(references, edgeValues, pointer, options = {}) {
    if (!Array.isArray(references) || !finitePoint(pointer)) return [];
    const radius = Number.isFinite(options.radius) && options.radius >= 0 ? options.radius : 13;
    const edges = (Array.isArray(edgeValues) ? edgeValues : []).map(edgeData).filter(Boolean), candidates = [];
    for (const reference of references) {
      const projection = closestGuide(reference, pointer, {...options, radius});
      if (!projection) continue;
      candidates.push(projection);
      for (const value of reference.directions) {
        const direction = unit(value);
        if (!direction) continue;
        for (const edge of edges) {
          if (reference.objectId && edge.objectId === reference.objectId) continue;
          const hit = lineIntersection(reference.point, direction, edge.a, edge.b, options);
          if (!hit) continue;
          const d = distance(pointer, hit.point);
          if (d > radius) continue;
          if (candidates.some(candidate => candidate.kind === 'intersection' && candidate.reference === reference && candidate.targetObjectId === edge.objectId && distance(candidate.point, hit.point) < EPSILON)) continue;
          candidates.push({point: hit.point, label: 'Tracking intersection', kind: 'intersection', reference, direction, distance: d, objectId: reference.objectId || null, targetObjectId: edge.objectId, t: hit.t, u: hit.u});
        }
      }
    }
    // A nearby real intersection is a stronger constraint than a free position
    // on the same guide. Within each class prefer the closest capture point.
    return candidates.sort((a, b) => (a.kind === 'intersection' ? 0 : 1) - (b.kind === 'intersection' ? 0 : 1) || a.distance - b.distance);
  }
  return {tangentDirections, makeReference, lineIntersection, closestGuide, guideCandidates};
});
