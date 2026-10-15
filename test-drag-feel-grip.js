'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const G = require('./drag-feel/grip.js');
const camera = { view: 'iso', scale: 2.75, origin: { x: 321, y: 147 } };
const block = { x: 12, y: 20, z: 7, w: 22, h: 18, height: 9 };
function near(actual, expected, tolerance = 1e-7) { assert(Math.abs(actual - expected) < tolerance, `${actual} must be near ${expected}`); }
function pointNear(actual, expected) { near(actual.x, expected.x); near(actual.y, expected.y); }
function localNear(actual, expected) { pointNear(actual, expected); near(actual.z, expected.z); }
function projectedLocal(solid, local, view = camera) { return G.project(solid.x + local.x, solid.y + local.y, (solid.z || 0) + local.z, view); }
function picked(solid, local, face, view = camera) {
  const pixel = projectedLocal(solid, local, view), grip = G.pick(solid, pixel, view);
  assert(grip, 'surface point must be pickable'); assert.equal(grip.face, face);
  localNear(grip.local, local); pointNear(G.screenPoint(solid, grip, view), pixel);
  return grip;
}

// The browser UMD branch exposes the same pure API without require or a DOM.
const sandbox = {};
vm.runInNewContext(fs.readFileSync(require.resolve('./drag-feel/grip.js'), 'utf8'), sandbox);
assert.equal(typeof sandbox.DragFeelGrip.pick, 'function');
assert.deepEqual(Object.keys(sandbox.DragFeelGrip), Object.keys(G));

// Projection and motion inversion agree at every known elevation, independent
// of the camera origin. Screen motion never introduces an elevation change.
for (const view of ['iso', 'top']) for (const scale of [0.5, 1, 9.75]) {
  const cam = { view, scale, origin: { x: -127, y: 931 } }, world = { x: -12, y: 27 }, z = 13;
  pointNear(G.unproject(G.project(world.x, world.y, z, cam), z, cam), world);
  const moved = G.project(world.x + 18.25, world.y - 7.5, z, cam), initial = G.project(world.x, world.y, z, cam);
  pointNear(G.delta(moved.x - initial.x, moved.y - initial.y, cam), { x: 18.25, y: -7.5 });
}

// Side picks recover the actual height and horizontal surface coordinate.
picked(block, { x: 7, y: 8, z: 9 }, 'top');
const xGrip = picked(block, { x: 22, y: 5, z: 4 }, 'x');
const yGrip = picked(block, { x: 6, y: 18, z: 2.5 }, 'y');
for (const x of [0, block.w]) for (const y of [0, block.h]) picked(block, { x, y, z: block.height }, 'top');
picked(block, { x: block.w, y: block.h, z: 4 }, 'x'); // Shared vertical edge chooses x first.
picked(block, { x: block.w, y: block.h / 2, z: 0 }, 'x');
picked(block, { x: block.w / 2, y: block.h, z: 0 }, 'y');
assert.equal(G.pick(block, projectedLocal(block, { x: block.w, y: block.h, z: -0.5 }), camera), null);
assert.equal(G.pick(block, { x: -10000, y: -10000 }, camera), null);
assert.equal(G.pick(block, { x: NaN, y: 1 }, camera), null);
assert.equal(G.pick(block, { x: 1, y: 1 }, { ...camera, scale: 0 }), null);

// A grip remains on the same side spot through translation, climbing and
// descent. A roof approximation would fail these recovered local coordinates.
for (const grip of [xGrip, yGrip]) {
  const original = G.screenPoint(block, grip, camera);
  for (const z of [0, 37, 3]) {
    const raised = { ...block, z }, pixel = G.screenPoint(raised, grip, camera);
    near(pixel.x, original.x); near(pixel.y - original.y, -(z - block.z) * 0.9 * camera.scale);
    const recovered = G.pick(raised, pixel, camera); assert.equal(recovered.face, grip.face); localNear(recovered.local, grip.local);
  }
  const moved = { ...block, x: block.x + 8, y: block.y - 3 };
  const initial = G.screenPoint(block, grip, camera), next = G.screenPoint(moved, grip, camera);
  pointNear(G.delta(next.x - initial.x, next.y - initial.y, camera), { x: 8, y: -3 });
}

// In plan every footprint spot belongs to the roof. Elevation remains in the
// local anchor even though orthographic plan projection cannot display it.
const plan = { view: 'top', scale: 3, origin: { x: 42, y: 91 } };
picked(block, { x: 3, y: 7, z: block.height }, 'top', plan);
assert.equal(G.pick(block, G.project(block.x - 1, block.y + 2, 0, plan), plan), null);
const ground = { ...block }; delete ground.z;
picked(ground, { x: block.w, y: 7, z: 4 }, 'x');

// Rebase the camera around a grabbed surface spot: changing zoom and pan must
// preserve its pixel and the recovered local anchor, including on both sides.
for (const view of ['iso', 'top']) {
  const first = { ...camera, view }, grips = view === 'top' ? [{ local: { x: 7, y: 8, z: 9 }, face: 'top' }] : [xGrip, yGrip];
  for (const grip of grips) {
    const anchor = G.screenPoint(block, grip, first), next = { view, scale: first.scale * 2.5, origin: { x: 0, y: 0 } };
    const zero = G.screenPoint(block, grip, next); next.origin = { x: anchor.x - zero.x, y: anchor.y - zero.y };
    pointNear(G.screenPoint(block, grip, next), anchor);
    localNear(G.pick(block, anchor, next).local, grip.local);
  }
}

// Sweep varied dimensions, base elevations and camera transforms so face
// solving cannot accidentally rely on the initial four-block scene.
for (let i = 0; i < 60; i++) {
  const solid = { x: -31 + i * 1.3, y: 17 - i * 0.4, z: i * 0.7, w: 3 + i % 13, h: 5 + i % 11, height: 2 + i % 17 };
  const cam = { view: 'iso', scale: 0.5 + i * 0.15, origin: { x: 301 - i * 7, y: -67 + i * 5 } };
  picked(solid, { x: solid.w * 0.3, y: solid.h * 0.6, z: solid.height }, 'top', cam);
  picked(solid, { x: solid.w, y: solid.h * 0.4, z: solid.height * 0.37 }, 'x', cam);
  picked(solid, { x: solid.w * 0.4, y: solid.h, z: solid.height * 0.37 }, 'y', cam);
}
const unchanged = JSON.stringify({ block, camera, xGrip });
G.pick(block, G.screenPoint(block, xGrip, camera), camera);
assert.equal(JSON.stringify({ block, camera, xGrip }), unchanged);

// Visible box topology is deduplicated by feature rather than owning face.
// The rear bottom vertex and its three edges are hidden in this ISO camera.
const featured = { ...block, id: 'a' }, isoFeatures = G.features(featured, camera), planFeatures = G.features(featured, plan);
assert.equal(isoFeatures.filter(feature => feature.type === 'vertex').length, 7);
assert.equal(isoFeatures.filter(feature => feature.type === 'midpoint').length, 9);
assert.equal(planFeatures.filter(feature => feature.type === 'vertex').length, 4);
assert.equal(planFeatures.filter(feature => feature.type === 'midpoint').length, 4);
assert.equal(new Set(isoFeatures.map(feature => feature.id)).size, isoFeatures.length);
assert.equal(new Set(isoFeatures.map(feature => JSON.stringify(feature.local))).size, isoFeatures.length);
assert(!isoFeatures.some(feature => feature.id === 'a:vertex-000'));
assert(!isoFeatures.some(feature => ['a:midpoint-x-00', 'a:midpoint-y-00', 'a:midpoint-z-00'].includes(feature.id)));
for (const feature of isoFeatures) {
  pointNear(feature.screen, G.screenPoint(featured, feature, camera));
  assert.equal(feature.blockId, 'a'); assert.equal(feature.face, feature.faces[0]);
  assert(feature.faces.every(face => ['top', 'x', 'y'].includes(face)));
  const surface = G.pick(featured, feature.screen, camera); assert(surface); localNear(surface.local, feature.local);
}
assert(planFeatures.every(feature => feature.face === 'top' && feature.faces.length === 1 && feature.local.z === block.height));
assert.deepEqual(isoFeatures.find(feature => feature.id === 'a:vertex-111').faces, ['top', 'x', 'y']);
assert.deepEqual(isoFeatures.find(feature => feature.id === 'a:midpoint-z-11').faces, ['x', 'y']);
assert.equal(G.features({ ...block, w: 0 }, camera).length, 0);

// Feature radii are pixel-based and include silhouette points just outside
// the solid. Surface picking remains free when no feature is close enough.
const roomy = { id: 'roomy', x: 20, y: 30, z: 12, w: 100, h: 100, height: 9 };
for (const scale of [0.5, 2, 8]) {
  const cam = { view: 'top', scale, origin: { x: 91, y: -37 } };
  const corner = G.features(roomy, cam).find(feature => feature.id === 'roomy:vertex-001');
  const outside = { x: corner.screen.x - 9, y: corner.screen.y };
  assert.equal(G.pick(roomy, outside, cam), null);
  assert.equal(G.pickFeature(roomy, outside, cam).id, corner.id);
  near(G.pickFeature(roomy, outside, cam).distance, 9);
  assert.equal(G.pickFeature(roomy, { x: corner.screen.x - 10.1, y: corner.screen.y }, cam), null);
  const freePixel = projectedLocal(roomy, { x: 25, y: 25, z: roomy.height }, cam);
  assert.equal(G.pickFeature(roomy, freePixel, cam), null); assert(G.pick(roomy, freePixel, cam));
  const midpoint = G.features(roomy, cam).find(feature => feature.id === 'roomy:midpoint-x-01');
  assert.equal(G.pickFeature(roomy, midpoint.screen, cam).type, 'midpoint');
}

// IDs and local coordinates survive camera and elevation changes. Previously
// acquired features are reprojected rather than held at their old pixels.
const roofCorner = planFeatures.find(feature => feature.id === 'a:vertex-001');
const shiftedCamera = { ...plan, scale: plan.scale * 2, origin: { x: -412, y: 378 } };
const movedFeature = G.features({ ...featured, x: featured.x + 3, z: 37 }, shiftedCamera).find(feature => feature.id === roofCorner.id);
localNear(movedFeature.local, roofCorner.local);
assert.equal(G.pickFeature({ ...featured, x: featured.x + 3, z: 37 }, movedFeature.screen, shiftedCamera, { previous: roofCorner }).id, roofCorner.id);
assert.equal(G.pickFeature({ ...featured, id: 'b' }, roofCorner.screen, plan, { previous: roofCorner }).blockId, 'b');

// Hysteresis prevents small hover tremor from flickering between a vertex and
// an edge midpoint, then yields to a clearly closer feature or a distant hand.
const tight = { id: 'tight', x: 0, y: 0, z: 0, w: 24, h: 100, height: 4 }, direct = { view: 'top', scale: 1, origin: { x: 0, y: 0 } };
const acquired = G.pickFeature(tight, { x: 0, y: 0 }, direct); assert.equal(acquired.id, 'tight:vertex-001');
assert.equal(G.pickFeature(tight, { x: 7, y: 0 }, direct, { previous: acquired }).id, acquired.id);
assert.equal(G.pickFeature(tight, { x: 9, y: 0 }, direct, { previous: acquired }).id, 'tight:midpoint-x-01');
assert.equal(G.pickFeature(tight, { x: -12, y: 0 }, direct, { previous: acquired }).id, acquired.id);
assert.equal(G.pickFeature(tight, { x: -13.1, y: 0 }, direct, { previous: acquired }), null);
assert.equal(G.pickFeature(tight, { x: -12, y: 0 }, direct, { previous: acquired, hysteresis: 0 }), null);

// Scene occlusion rejects even a previously acquired candidate. Test its own
// screen point against a foreground solid; the hand need not hit either solid.
const foreground = { x: -5, y: -5, z: 20, w: 10, h: 10, height: 5 };
const isVisible = feature => !G.pick(foreground, feature.screen, direct);
assert.equal(G.pickFeature(tight, { x: -8, y: 0 }, direct, { previous: acquired, isVisible }), null);
assert.equal(G.pickFeature(tight, { x: 12, y: 0 }, direct, { isVisible }).id, 'tight:midpoint-x-01');
assert.equal(G.pickFeature(tight, { x: 0, y: 0 }, direct, { isVisible: () => false }), null);
assert.equal(G.pickFeature(tight, { x: NaN, y: 0 }, direct), null);
const featureInputs = JSON.stringify({ featured, camera, acquired });
G.features(featured, camera); G.pickFeature(featured, roofCorner.screen, plan, { previous: acquired });
assert.equal(JSON.stringify({ featured, camera, acquired }), featureInputs);
console.log('drag feel grip: exact surfaces, fixed anchors, pixel-radius vertex/midpoint acquisition, hover hysteresis and occlusion filtering passed');
