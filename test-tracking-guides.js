'use strict';
const assert = require('node:assert/strict');
const Tracking = require('./interaction-lab/tracking-guides.js');
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }
function near(actual, expected, epsilon = 1e-7) { assert.ok(Math.abs(actual - expected) < epsilon, actual + ' should equal ' + expected); }
const curve = {id: 'curve', kind: 'polyline'}, curveGeometry = {edges: [[{x: 0, y: 0}, {x: 10, y: 10}], [{x: 10, y: 10}, {x: 20, y: 5}]]};
test('polyline midpoint inherits its diagonal segment rather than a crosshair', () => {
  const reference = Tracking.makeReference(curve, {x: 5, y: 5}, curveGeometry);
  assert.equal(reference.directions.length, 1); near(reference.directions[0].x, Math.SQRT1_2); near(reference.directions[0].y, Math.SQRT1_2);
  assert.equal(reference.label, 'Tangent'); assert.equal(reference.inherited, true);
  const result = Tracking.closestGuide(reference, {x: 30, y: 32}, {radius: 2});
  near(result.point.x, 31); near(result.point.y, 31);
});
test('polyline endpoint retains its two incident directions and deduplicates collinear ones', () => {
  assert.equal(Tracking.makeReference(curve, {x: 10, y: 10}, curveGeometry).directions.length, 2);
  const g = {edges: [[{x: 0, y: 0}, {x: 10, y: 10}], [{x: 10, y: 10}, {x: 20, y: 20}]]};
  assert.equal(Tracking.tangentDirections(curve, {x: 10, y: 10}, g).length, 1);
});
test('rotated elliptical profiles inherit the analytic tangent', () => {
  const ellipse = {id: 'ellipse', kind: 'circle', x: -10, y: -5, width: 20, height: 10, rotation: 30};
  const direction = Tracking.tangentDirections(ellipse, {x: 10 * Math.cos(Math.PI / 6), y: 10 * Math.sin(Math.PI / 6)})[0];
  near(direction.x, -.5); near(direction.y, Math.sqrt(3) / 2);
  const diagonal = Tracking.tangentDirections({...ellipse, rotation: 0}, {x: 10 / Math.sqrt(2), y: 5 / Math.sqrt(2)})[0];
  near(diagonal.x, -2 / Math.sqrt(5)); near(diagonal.y, 1 / Math.sqrt(5));
});
test('ellipse center retains ordinary reference axes because no tangent exists there', () => {
  const reference = Tracking.makeReference({kind: 'circle', x: -10, y: -5, width: 20, height: 10}, {x: 0, y: 0});
  assert.equal(reference.inherited, false); assert.deepEqual(reference.directions, [{x: 1, y: 0}, {x: 0, y: 1}]);
});
test('box corners inherit incident edges without inventing an arbitrary center tangent', () => {
  const box = {kind: 'box'}, geometry = {edges: [[{x: 0, y: 0}, {x: 10, y: 0}], [{x: 0, y: 0}, {x: 0, y: 10}], [{x: 0, y: 0}, {x: -4, y: -6}]]};
  assert.equal(Tracking.tangentDirections(box, {x: 0, y: 0}, geometry).length, 3);
  assert.deepEqual(Tracking.tangentDirections(box, {x: 5, y: 5}, geometry), []);
});
test('following an inherited line captures a finite target segment intersection', () => {
  const reference = Tracking.makeReference(curve, {x: 5, y: 5}, curveGeometry);
  const candidates = Tracking.guideCandidates([reference], [{objectId: 'target', edge: [{x: 25, y: 0}, {x: 25, y: 50}]}], {x: 26, y: 24}, {radius: 3});
  assert.equal(candidates[0].kind, 'intersection'); assert.deepEqual(candidates[0].point, {x: 25, y: 25}); assert.equal(candidates[0].targetObjectId, 'target');
  assert.equal(candidates[1].kind, 'projection');
});
test('intersections do not extend a finite target or attract from far away', () => {
  const reference = Tracking.makeReference(curve, {x: 5, y: 5}, curveGeometry);
  const shortTarget = {objectId: 'target', a: {x: 25, y: 0}, b: {x: 25, y: 10}};
  assert.ok(Tracking.guideCandidates([reference], [shortTarget], {x: 25, y: 25}, {radius: 3}).every(candidate => candidate.kind !== 'intersection'));
  const target = {objectId: 'target', a: {x: 25, y: 0}, b: {x: 25, y: 50}};
  assert.ok(Tracking.guideCandidates([reference], [target], {x: 50, y: 50}, {radius: 3}).every(candidate => candidate.kind !== 'intersection'));
  assert.deepEqual(Tracking.guideCandidates([reference], [target], {x: 50, y: 80}, {radius: 3}), []);
});
test('guides are bidirectional and can optionally be restricted to a forward ray', () => {
  const origin = {x: 0, y: 0}, direction = {x: 1, y: 0}, a = {x: -10, y: -5}, b = {x: -10, y: 5};
  assert.deepEqual(Tracking.lineIntersection(origin, direction, a, b).point, {x: -10, y: 0});
  assert.equal(Tracking.lineIntersection(origin, direction, a, b, {forwardOnly: true}), null);
});
test('target source exclusion and shared target endpoints avoid duplicate captures', () => {
  const reference = Tracking.makeReference(curve, {x: 5, y: 5}, curveGeometry);
  const edges = [{objectId: 'curve', a: {x: 25, y: 0}, b: {x: 25, y: 50}}, {objectId: 'target', a: {x: 25, y: 0}, b: {x: 25, y: 25}}, {objectId: 'target', a: {x: 25, y: 25}, b: {x: 25, y: 50}}];
  const candidates = Tracking.guideCandidates([reference], edges, {x: 25, y: 25}, {radius: 2}).filter(candidate => candidate.kind === 'intersection');
  assert.equal(candidates.length, 1); assert.equal(candidates[0].targetObjectId, 'target');
});
test('different elevations reject apparent intersections but equal elevations capture', () => {
  const origin = {x: 0, y: 0, z: 2}, direction = {x: 1, y: 0, z: 0};
  assert.equal(Tracking.lineIntersection(origin, direction, {x: 10, y: -5, z: 3}, {x: 10, y: 5, z: 3}), null);
  assert.deepEqual(Tracking.lineIntersection(origin, direction, {x: 10, y: -5, z: 0}, {x: 10, y: 5, z: 4}).point, {x: 10, y: 0, z: 2});
});
test('parallel, zero-length, malformed and nonfinite geometry never generates a candidate', () => {
  assert.equal(Tracking.lineIntersection({x: 0, y: 0}, {x: 1, y: 0}, {x: 0, y: 2}, {x: 10, y: 2}), null);
  assert.equal(Tracking.lineIntersection({x: 0, y: 0}, {x: 0, y: 0}, {x: 1, y: 0}, {x: 1, y: 5}), null);
  assert.equal(Tracking.lineIntersection({x: 0, y: NaN}, {x: 1, y: 0}, {x: 1, y: 0}, {x: 1, y: 5}), null);
  assert.equal(Tracking.makeReference({}, {x: Infinity, y: 0}), null);
  assert.deepEqual(Tracking.guideCandidates([null, {point: {x: 0, y: 0}, directions: [{x: 0, y: 0}]}], [null], {x: 1, y: 1}), []);
});
console.log(passed + ' tracking geometry checks passed.');
