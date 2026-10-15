'use strict';
const assert = require('assert');
const F = require('./drag-feel/physics.js');
const P = require('./iso-physics.js');
const block = (id, x, y = 40, extra = {}) => ({ id, x, y, z: 0, w: 20, h: 20, height: 8, ...extra });
const frame = { x: 0, y: 0, w: 160, h: 120 };
const free = { gridEnabled: false, edgeEnabled: false, climbEnabled: false, inertia: 0 };
const near = (value, expected, tolerance = 0.02) => assert(Math.abs(value - expected) < tolerance, `${value} must be near ${expected}`);
function clear(blocks) {
  blocks.forEach(a => blocks.forEach(b => { if (a !== b) assert(!P.intersects(a, b), `${a.id} interpenetrates ${b.id}`); }));
}
function run(controller, seconds, callback) {
  const count = Math.ceil(seconds * 120);
  for (let i = 0; i < count; i++) { controller.step(seconds / count); if (callback) callback(); }
}

// The control catalog is the UI contract; every control changes a real setting.
assert(F.controls.length >= 20);
assert.strictEqual(new Set(F.controls.map(control => control.key)).size, F.controls.length);
for (const control of F.controls) {
  assert(Object.hasOwn(F.defaults, control.key));
  assert(control.section && control.label && control.description);
}
for (const name of ['crisp', 'soft', 'heavy']) assert(F.presets[name]);

// Large pointer jumps and released inertia still use swept solid collisions.
let blocks = [block('a', 10), block('stop', 70, 40, { locked: true })], events = [];
let controller = F.create(blocks, { ...free, maxSpeed: 450, inertia: 1 }, { frame, onEvent: event => events.push(event) });
assert(controller.begin('a', { x: 20, y: 50 }));
controller.target({ x: 1000, y: 50 }); run(controller, 0.5, () => clear(blocks));
near(blocks[0].x, 48); near(blocks[1].x, 70);
assert(events.some(event => event.type === 'collision' && event.strength > 0));
controller.release(); run(controller, 2, () => clear(blocks)); near(blocks[0].x, 48);
assert(!controller.begin('stop', { x: 75, y: 50 }), 'locked fixture cannot be grabbed');

// Direct manipulation preserves the grab offset, and a normal drag pushes a
// train rather than passing through it or ignoring the boundary.
blocks = [block('a', 10), block('b', 38), block('c', 66)];
controller = F.create(blocks, free, { frame });
controller.begin('a', { x: 17, y: 47 }); controller.target({ x: 147, y: 47 });
run(controller, 1, () => clear(blocks));
near(blocks[2].x + blocks[2].w, 158); near(blocks[1].x + 22, blocks[2].x); near(blocks[0].x + 22, blocks[1].x);
assert(blocks[0].y === 40);

// A firm grip preserves the exact chosen grab offset on the first frame,
// bypassing spring lag, friction and speed limits while sweeping solids.
blocks = [block('a', 10)];
controller = F.create(blocks, { ...free, follow: 4, damping: 2, friction: 30, maxSpeed: 30 }, { frame });
controller.begin('a', { x: 17, y: 49 }, { firm: true }); controller.target({ x: 117, y: 79 }); controller.step(1 / 60);
near(blocks[0].x, 110, 0.0001); near(blocks[0].y, 70, 0.0001); clear(blocks);
controller.advance(-12, 5); controller.step(1 / 60); near(blocks[0].x, 98, 0.0001); near(blocks[0].y, 75, 0.0001);
assert(!controller.advance(NaN, 0)); controller.cancel(); near(blocks[0].x, 10); near(blocks[0].y, 40);

// Huge relative motion into a contact face stops at the buffer and becomes
// bounded pressure. Reversing physical motion unloads that pressure promptly.
blocks = [block('a', 10), block('step', 60, 40, { locked: true })];
controller = F.create(blocks, { ...free, climbEnabled: true, climbHold: 1200, inertia: 1 }, { frame });
controller.begin('a', { x: 10, y: 40 }, { firm: true }); controller.advance(1000, 0); controller.step(1 / 60);
near(blocks[0].x, 38); near(controller.telemetry.overtravel, 22); near(controller.telemetry.force, 1); clear(blocks);
controller.advance(-2, 0); controller.step(1 / 60); assert(controller.telemetry.force < 1 && controller.telemetry.force > 0.3);
controller.advance(-10, 0); const unloadingProgress = controller.telemetry.pressure; controller.step(1 / 60);
assert(controller.telemetry.force < controller.telemetry.minPressure); assert(controller.telemetry.pressure < unloadingProgress);
controller.release(); assert.strictEqual(controller.activeId, null); run(controller, 0.5, () => clear(blocks)); near(blocks[0].x, 38);

// Once pressure gives way, a huge blocked input enters only the adjacent
// platform center; it cannot launch across the floor using banked travel.
blocks = [block('a', 10), block('platform', 60, 40, { w: 30, height: 12, locked: true })];
controller = F.create(blocks, { ...free, climbEnabled: true, climbHold: 100 }, { frame });
controller.begin('a', { x: 10, y: 40 }, { firm: true }); controller.advance(1000, 0);
let firmIntermediateLift = false;
run(controller, 1, () => { clear(blocks); if (blocks[0].z > 0.01 && blocks[0].z < 11.99) firmIntermediateLift = true; });
assert(firmIntermediateLift); near(blocks[0].x, 65, 0.0001); near(blocks[0].z, 12); assert.strictEqual(controller.activeId, 'a');
controller.advance(55, 0); run(controller, 0.9, () => clear(blocks)); near(blocks[0].x, 120, 0.0001); near(blocks[0].z, 0);
controller.cancel(); near(blocks[0].x, 10); near(blocks[0].z, 0);

// Boundary overtravel is small and independent on both blocked axes.
// A small reverse delta moves immediately instead of paying down a huge bank.
blocks = [block('a', 10)]; controller = F.create(blocks, free, { frame });
controller.begin('a', { x: 10, y: 40 }, { firm: true }); controller.advance(1000, 1000); controller.step(1 / 60);
near(blocks[0].x, 138); near(blocks[0].y, 98); controller.advance(-6, -6); controller.step(1 / 60);
near(blocks[0].x, 137); near(blocks[0].y, 97);

// Pointerup may arrive before the next animation frame. A firm release
// consumes its last real motion without adding pressure hold or climb time.
blocks = [block('a', 10)]; controller = F.create(blocks, free, { frame });
controller.begin('a', { x: 17, y: 49 }, { firm: true }); controller.advance(50, 20); controller.release();
near(blocks[0].x, 60, 0.0001); near(blocks[0].y, 60, 0.0001); assert.strictEqual(controller.activeId, null);
blocks = [block('a', 20)]; controller = F.create(blocks, { ...free, gridEnabled: true }, { frame });
controller.begin('a', { x: 20, y: 40 }, { firm: true }); controller.advance(10.8, 0); controller.release(); near(blocks[0].x, 30, 0.0001);
blocks = [block('a', 10), block('neighbor', 60)]; events = [];
controller = F.create(blocks, { ...free, climbEnabled: true, climbHold: 80, inertia: 1 }, { frame, onEvent: event => events.push(event) });
controller.setIsolated(true); controller.begin('a', { x: 10, y: 40 }, { firm: true }); controller.advance(1000, 0); controller.release();
near(blocks[0].x, 38); near(blocks[0].z, 0); near(blocks[1].x, 60); assert(!events.some(event => event.type === 'climb')); assert.strictEqual(controller.activeId, null);
run(controller, 0.5, () => { clear(blocks); near(blocks[1].x, 60); }); near(blocks[0].x, 38);

// A firm held still clears release velocity; a recent real movement can coast,
// with throw speed capped independently of the uncapped direct grip.
blocks = [block('a', 10)]; controller = F.create(blocks, { ...free, inertia: 1 }, { frame });
controller.begin('a', { x: 10, y: 40 }, { firm: true }); controller.advance(50, 0); controller.step(1 / 60); controller.step(1 / 60);
controller.release(); assert.strictEqual(controller.activeId, null); run(controller, 0.5); near(blocks[0].x, 60, 0.0001);
blocks = [block('a', 10)]; controller = F.create(blocks, { ...free, inertia: 1, friction: 0, maxSpeed: 30 }, { frame });
controller.begin('a', { x: 10, y: 40 }, { firm: true }); controller.advance(50, 0); controller.step(1 / 60);
controller.advance(0, 0); controller.target({ x: 60, y: 40 }); controller.release();
assert.strictEqual(controller.activeId, 'a'); run(controller, 0.1); assert(blocks[0].x > 60 && blocks[0].x <= 63.001);

// Firm normal contact pushes, while Ctrl freezes the neighbor and carries
// the selected support's passenger rigidly. Magnetic targets remain exact.
blocks = [block('a', 10), block('neighbor', 50)]; controller = F.create(blocks, free, { frame });
controller.begin('a', { x: 10, y: 40 }, { firm: true }); controller.advance(80, 0); controller.step(1 / 60);
near(blocks[0].x, 90); near(blocks[1].x, 112); clear(blocks);
blocks = [block('base', 10), block('passenger', 10, 40, { z: 8 }), block('neighbor', 60)];
controller = F.create(blocks, free, { frame }); controller.setIsolated(true); controller.begin('base', { x: 10, y: 40 }, { firm: true }); controller.advance(100, 0); controller.step(1 / 60);
near(blocks[0].x, 38); near(blocks[1].x, 38); near(blocks[1].z, 8); near(blocks[2].x, 60); clear(blocks);
blocks = [block('a', 20)]; controller = F.create(blocks, { ...free, gridEnabled: true }, { frame });
controller.begin('a', { x: 20, y: 40 }, { firm: true }); controller.advance(10.8, 0); controller.step(1 / 60); near(blocks[0].x, 30, 0.0001);

// Runtime isolation can be enabled before grabbing. It freezes free
// neighbors at the buffer, while an ordinary drag pushes the same scene.
function isolationTrial(isolated) {
  const scene = [block('a', 10), block('neighbor', 50)];
  const sim = F.create(scene, free, { frame }); sim.setIsolated(isolated);
  sim.begin('a', { x: 10, y: 40 }); sim.target({ x: 90, y: 40 }); run(sim, 0.6, () => clear(scene));
  return { scene, sim };
}
const normalDrag = isolationTrial(false), isolatedDrag = isolationTrial(true);
assert(normalDrag.scene[1].x > 60); near(isolatedDrag.scene[1].x, 50); near(isolatedDrag.scene[0].x, 28); assert(isolatedDrag.sim.isIsolated);
isolatedDrag.sim.release(); assert(!isolatedDrag.sim.isIsolated);

// Toggling isolation during one drag freezes the neighbor at its current
// position and allows pushing to resume when the modifier is released.
blocks = [block('a', 10), block('neighbor', 60)]; controller = F.create(blocks, free, { frame });
controller.begin('a', { x: 10, y: 40 }); controller.target({ x: 130, y: 40 }); run(controller, 0.08);
controller.setIsolated(true); const frozenNeighborX = blocks[1].x;
run(controller, 0.4, () => { clear(blocks); near(blocks[1].x, frozenNeighborX); }); near(blocks[0].x + 22, blocks[1].x);
controller.setIsolated(false); run(controller, 0.35, () => clear(blocks)); assert(blocks[1].x > frozenNeighborX + 10); assert.strictEqual(controller.activeId, 'a');
controller.setIsolated(true); controller.cancel(); assert(!controller.isIsolated);

// A Ctrl release cannot launch its frozen neighbor through inertia. Once
// that released drag finishes, the ephemeral modifier no longer persists.
blocks = [block('a', 10), block('neighbor', 60)]; controller = F.create(blocks, { ...free, inertia: 1, friction: 1 }, { frame });
controller.setIsolated(true); controller.begin('a', { x: 10, y: 40 }); controller.target({ x: 100, y: 40 }); run(controller, 0.07);
assert(blocks[0].x < 38); controller.release(); assert(controller.isIsolated);
// Keyup and ordinary pointer moves clear the current Ctrl flag after a drop;
// they must not erase the isolation latched by that released drag.
controller.setIsolated(false); assert(controller.isIsolated);
run(controller, 2, () => { controller.setIsolated(false); clear(blocks); near(blocks[1].x, 60); }); assert(!controller.isIsolated);
controller.begin('a', { x: blocks[0].x, y: 40 }); assert(!controller.isIsolated); controller.cancel();

// A static no-push baseline survives runtime modifier changes and resets.
blocks = [block('a', 10), block('neighbor', 60)]; controller = F.create(blocks, free, { frame, push: false });
controller.setIsolated(false); assert(controller.isIsolated); controller.begin('a', { x: 10, y: 40 }); controller.target({ x: 100, y: 40 }); run(controller, 0.5);
near(blocks[1].x, 60); controller.cancel(); assert(controller.isIsolated); controller.reset(); assert(controller.isIsolated);

// Isolated manipulation still carries passengers, and pressure can climb
// onto a movable neighbor while keeping that neighbor frozen in place.
blocks = [block('base', 10), block('passenger', 10, 40, { z: 8 }), block('neighbor', 60)];
controller = F.create(blocks, free, { frame }); controller.setIsolated(true); controller.begin('base', { x: 10, y: 40 }); controller.target({ x: 100, y: 40 });
run(controller, 0.6, () => { clear(blocks); near(blocks[0].x, blocks[1].x); near(blocks[1].z - blocks[0].z, 8); near(blocks[2].x, 60); }); near(blocks[0].x, 38);
blocks = [block('a', 10), block('neighbor', 60)]; controller = F.create(blocks, { ...free, climbEnabled: true, climbHold: 100 }, { frame });
controller.setIsolated(true); controller.begin('a', { x: 10, y: 40 }); controller.target({ x: 75, y: 40 });
run(controller, 1.3, () => { clear(blocks); near(blocks[1].x, 60); }); near(blocks[0].z, 8); assert(controller.isIsolated);

// Cancel is one transaction and restores every neighbor pushed by this drag.
blocks = [block('a', 10), block('b', 38)];
controller = F.create(blocks, free, { frame }); const original = P.state(blocks);
controller.begin('a', { x: 20, y: 50 }); controller.target({ x: 90, y: 50 }); run(controller, 0.5);
assert(blocks[1].x > 38); controller.cancel();
assert.deepStrictEqual(P.state(blocks), original); assert.strictEqual(controller.activeId, null);

// Response, smoothing, friction, and inertia have measurable effects rather
// than being decorative controls.
function displacement(settings, seconds = 0.1) {
  const scene = [block('a', 10)], sim = F.create(scene, { ...free, maxSpeed: 450, ...settings }, { frame });
  sim.begin('a', { x: 15, y: 45 }); sim.target({ x: 45, y: 45 }); run(sim, seconds);
  return { scene, sim, x: scene[0].x };
}
assert(displacement({ follow: 45 }).x > displacement({ follow: 8 }).x + 8);
assert(displacement({ damping: 0.3 }).x > displacement({ damping: 1.8 }).x + 5);
assert(displacement({ friction: 0 }).x > displacement({ friction: 30 }).x + 3);
const stop = displacement({ inertia: 0 }), coast = displacement({ inertia: 1, friction: 2 });
stop.sim.release(); coast.sim.release(); run(stop.sim, 0.2); run(coast.sim, 0.2);
near(stop.scene[0].x, stop.x); assert(coast.scene[0].x > coast.x + 5);
run(coast.sim, 8); assert.strictEqual(coast.sim.activeId, null); assert(!coast.sim.isActive);

// Grid magnets hold through small pointer tremor and release beyond their
// separate breakaway radius. Turning them off takes effect on the next step.
blocks = [block('a', 20)]; events = [];
controller = F.create(blocks, { ...free, gridEnabled: true, snapRadius: 2, snapRelease: 4 }, { frame, onEvent: event => events.push(event) });
controller.begin('a', { x: 25, y: 45 }); controller.target({ x: 35.8, y: 45 }); run(controller, 0.8);
near(blocks[0].x, 30); assert(controller.guides.some(guide => guide.axis === 'x' && guide.kind === 'grid'));
controller.target({ x: 38, y: 45 }); run(controller, 0.4); near(blocks[0].x, 30);
controller.target({ x: 40, y: 45 }); run(controller, 0.4); near(blocks[0].x, 35, 0.08);
assert(!controller.guides.some(guide => guide.axis === 'x'));
controller.configure({ gridEnabled: false }); controller.target({ x: 36.2, y: 45 }); run(controller, 0.5); near(blocks[0].x, 31.2, 0.05);
assert(events.some(event => event.type === 'snap'));

// A nearby captured grid detent completes on release, and release inertia
// cannot coast that axis back off the line. A far-behind body never jumps.
blocks = [block('a', 20)];
controller = F.create(blocks, { ...free, gridEnabled: true, follow: 12, inertia: 1 }, { frame });
controller.begin('a', { x: 20, y: 40 }); controller.target({ x: 30.8, y: 40 });
for (let i = 0; i < 240 && blocks[0].x < 26.1; i++) controller.step(1 / 120);
assert(blocks[0].x < 29.9 && controller.guides.some(guide => guide.axis === 'x'));
controller.release(); near(blocks[0].x, 30, 0.0001); run(controller, 0.5); near(blocks[0].x, 30, 0.0001);
blocks = [block('a', 20)];
controller = F.create(blocks, { ...free, gridEnabled: true, follow: 4 }, { frame });
controller.begin('a', { x: 20, y: 40 }); controller.target({ x: 80.8, y: 40 }); controller.step(1 / 120);
const laggingX = blocks[0].x; assert(controller.guides.some(guide => guide.axis === 'x'));
controller.release(); near(blocks[0].x, laggingX, 0.0001);

// A captured target behind a solid surface remains blocked on release.
blocks = [block('a', 30), block('stop', 61, 40, { locked: true })];
controller = F.create(blocks, { ...free, gridEnabled: true, inertia: 1 }, { frame });
controller.begin('a', { x: 30, y: 40 }); controller.target({ x: 40.8, y: 40 }); run(controller, 0.5);
near(blocks[0].x, 39); assert(controller.guides.some(guide => guide.axis === 'x'));
controller.release(); clear(blocks); near(blocks[0].x, 39); run(controller, 0.5, () => clear(blocks)); near(blocks[0].x, 39);

// Neighbor attraction uses the buffer and is available with the grid enabled.
blocks = [block('a', 10), block('reference', 66, 40, { locked: true })];
controller = F.create(blocks, { ...free, edgeEnabled: true, buffer: 3, snapRadius: 2 }, { frame });
controller.begin('a', { x: 15, y: 45 }); controller.target({ x: 47.4, y: 45 }); run(controller, 0.8);
near(blocks[0].x, 43); near(blocks[1].x - blocks[0].x - blocks[0].w, 3);
assert(controller.guides.some(guide => guide.kind === 'edge'));

// Buffered neighbor detents also complete a short spring lag on release.
blocks = [block('a', 10), block('reference', 66, 40, { locked: true })];
controller = F.create(blocks, { ...free, edgeEnabled: true, buffer: 3, follow: 12, inertia: 1 }, { frame });
controller.begin('a', { x: 10, y: 40 }); controller.target({ x: 43.4, y: 40 });
for (let i = 0; i < 240 && blocks[0].x < 39.1; i++) controller.step(1 / 120);
assert(blocks[0].x < 42.9 && controller.guides.some(guide => guide.axis === 'x' && guide.kind === 'edge'));
controller.release(); clear(blocks); near(blocks[0].x, 43, 0.0001); run(controller, 0.5); near(blocks[0].x, 43, 0.0001);

// Resting blocks acquire real support-roof corners and edge midpoints. The
// live source is on the held base, so both marker coordinates meet in 3D.
blocks = [block('held', 40.8, 40.6, { z: 8 }), block('support', 40, 40, { w: 60, h: 60, locked: true })];
controller = F.create(blocks, { ...free, edgeEnabled: true }, { frame });
controller.begin('held', { x: 40.8, y: 40.6 }, { firm: true, grip: { x: 0, y: 0, z: 8 } }); controller.step(1 / 60);
near(blocks[0].x, 40, 0.0001); near(blocks[0].y, 40, 0.0001); near(blocks[0].z, 8); clear(blocks);
assert.strictEqual(controller.guides.length, 2); assert(controller.guides.every(guide => guide.role === 'support' && guide.featurePair && guide.targetId === 'support'));
for (const guide of controller.guides) { near(guide.source.x, guide.target.x, 0.0001); near(guide.source.y, guide.target.y, 0.0001); near(guide.source.z, guide.target.z, 0.0001); near(guide.sourceLocal.z, 0); near(guide.targetLocal.z, 8); }
assert(controller.telemetry.snap.includes('Support Vertex'));
blocks = [block('held', 60.6, 40.5, { z: 8 }), block('support', 40, 40, { w: 60, h: 60, locked: true })];
controller = F.create(blocks, { ...free, edgeEnabled: true }, { frame });
controller.begin('held', { x: 70.6, y: 40.5 }, { firm: true, grip: { x: 10, y: 0, z: 8 } }); controller.step(1 / 60);
near(blocks[0].x, 60, 0.0001); near(blocks[0].y, 40, 0.0001); assert(controller.guides.every(guide => guide.source.feature === 'midpoint' && guide.target.feature === 'midpoint'));
assert(controller.telemetry.snap.includes('Support Midpoint'));

// Grab-side bias changes acquisition reach and ranking. A stronger nearby
// source corner can win over a geometrically closer far-side source corner.
function biasedSupport(bias) {
  const scene = [block('held', 48, 40, { z: 8 }), block('support', 40, 40, { w: 70, h: 70, locked: true })];
  const sim = F.create(scene, { ...free, edgeEnabled: true, featureBias: bias, snapRadius: 8 }, { frame });
  sim.begin('held', { x: 48, y: 40 }, { firm: true, grip: { x: 0, y: 0, z: 0 } }); sim.step(1 / 60);
  return { scene, sim };
}
const unbiasedFeature = biasedSupport(0), biasedFeature = biasedSupport(1);
near(unbiasedFeature.scene[0].x, 55, 0.0001); near(biasedFeature.scene[0].x, 40, 0.0001);
assert(unbiasedFeature.sim.guides[0].source.featureId === 'ne'); assert(biasedFeature.sim.guides[0].source.featureId === 'nw');
function biasedNeighbor(gripX) {
  const scene = [block('held', 10), block('neighbor', 66, 40, { locked: true })];
  const sim = F.create(scene, { ...free, edgeEnabled: true, buffer: 3 }, { frame });
  sim.begin('held', { x: 10 + gripX, y: 50 }, { firm: true, grip: { x: gripX, y: 10, z: 8 } }); sim.target({ x: 41.8 + gripX, y: 50 }); sim.step(1 / 60);
  return { scene, sim };
}
const nearSide = biasedNeighbor(20), farSide = biasedNeighbor(0);
near(nearSide.scene[0].x, 43, 0.0001); near(farSide.scene[0].x, 41.8, 0.0001);
assert(nearSide.sim.guides.some(guide => guide.axis === 'x' && guide.source.feature === 'midpoint'));
assert(!farSide.sim.guides.some(guide => guide.axis === 'x'));

// Object feature pairs beat grid lines inside their reach. Both axes always
// share the same source and target pair, including after changing detents.
blocks = [block('held', 41.8, 41.8, { z: 8 }), block('support', 41, 41, { w: 40, h: 40, locked: true })];
controller = F.create(blocks, { ...free, edgeEnabled: true, gridEnabled: true }, { frame });
controller.begin('held', { x: 41.8, y: 41.8 }, { firm: true, grip: { x: 0, y: 0, z: 8 } }); controller.step(1 / 60);
near(blocks[0].x, 41, 0.0001); near(blocks[0].y, 41, 0.0001); assert(controller.guides.every(guide => guide.kind === 'edge'));
controller.configure({ featureGrabEnabled: false, featureGrabRadius: 24, gridEnabled: false }); controller.step(1 / 60);
assert(controller.guides.every(guide => guide.kind === 'edge'), 'hover grip targeting does not disable object magnets');
controller.advance(10, 0); controller.step(1 / 60);
assert.strictEqual(controller.guides.length, 2);
const pairedGuides = controller.guides;
assert.strictEqual(pairedGuides[0].source.featureId, pairedGuides[1].source.featureId); assert.strictEqual(pairedGuides[0].target.featureId, pairedGuides[1].target.featureId);
pairedGuides.forEach(guide => { near(guide.source.x, guide.target.x, 0.0001); near(guide.source.y, guide.target.y, 0.0001); });

// Locks follow a target's live position and discard its old elevation. Guide
// world coordinates are computed after motion, rather than a frame behind it.
blocks = [block('held', 41, 41, { z: 8 }), block('support', 41, 41, { w: 40, h: 40, locked: true })];
controller = F.create(blocks, { ...free, edgeEnabled: true }, { frame });
controller.begin('held', { x: 41, y: 41 }, { firm: true, grip: { x: 0, y: 0, z: 8 } }); controller.step(1 / 60);
blocks[1].x += 1; controller.step(1 / 60); near(blocks[0].x, 42, 0.0001);
controller.guides.forEach(guide => { near(guide.source.x, guide.target.x, 0.0001); near(guide.target.x, 42, 0.0001); });
blocks[1].height = 4; controller.step(1 / 60); assert(!controller.guides.some(guide => guide.role === 'support')); run(controller, 0.6, () => clear(blocks)); near(blocks[0].z, 4);

// A support pair cannot place the footprint wholly outside the supporting
// roof. A same-level flush pair cannot steal a legal buffered detent either.
blocks = [block('held', 80.5, 80.5, { z: 8 }), block('support', 40, 40, { w: 40, h: 40, locked: true })];
controller = F.create(blocks, { ...free, edgeEnabled: true }, { frame });
controller.begin('held', { x: 80.5, y: 80.5 }, { firm: true, grip: { x: 0, y: 0, z: 8 } }); controller.step(1 / 60);
assert(!controller.guides.some(guide => guide.role === 'support')); run(controller, 0.8, () => clear(blocks)); near(blocks[0].z, 0);
blocks = [block('held', 10), block('neighbor', 66, 40, { locked: true })];
controller = F.create(blocks, { ...free, edgeEnabled: true, buffer: 3, snapRadius: 8 }, { frame });
controller.begin('held', { x: 30, y: 50 }, { firm: true, grip: { x: 20, y: 10, z: 8 } }); controller.target({ x: 63.4, y: 50 }); controller.step(1 / 60);
near(blocks[0].x, 43, 0.0001); clear(blocks); assert(controller.guides.some(guide => guide.axis === 'x' && !guide.featurePair));

// Increasing the buffer makes space while preserving fixed fixtures and solid
// nonpenetration. Later drags use the newly configured clearance.
blocks = [block('a', 10), block('fixed', 32, 40, { locked: true }), block('b', 54)];
controller = F.create(blocks, free, { frame }); controller.configure({ buffer: 7 });
clear(blocks); near(blocks[1].x, 32);
assert(!P.xyOverlap(blocks[0], blocks[1], 6.99));
assert(!P.xyOverlap(blocks[2], blocks[1], 6.99));

// A short push cannot climb. Withdrawing cancels pressure; a fresh sustained
// push animates through real intermediate heights before moving onto the top.
blocks = [block('a', 10), block('step', 60, 40, { locked: true })]; events = [];
controller = F.create(blocks, { ...free, climbEnabled: true, climbHold: 300, climbRelease: 0 }, { frame, onEvent: event => events.push(event) });
controller.begin('a', { x: 15, y: 45 }); controller.target({ x: 105, y: 45 }); run(controller, 0.22);
assert(controller.telemetry.pressure > 0 && controller.telemetry.pressure < 1); near(blocks[0].z, 0);
controller.target({ x: 30, y: 45 }); run(controller, 0.04); near(controller.telemetry.pressure, 0); near(blocks[0].z, 0);
controller.target({ x: 80, y: 45 }); let intermediate = false;
run(controller, 1.2, () => { clear(blocks); if (blocks[0].z > 0.01 && blocks[0].z < 7.99) intermediate = true; });
assert(intermediate); near(blocks[0].z, 8); near(blocks[0].x, 75, 0.1);
assert(events.some(event => event.type === 'climb')); assert(events.some(event => event.type === 'land' && event.kind === 'climb'));
controller.release(); run(controller, 1); near(blocks[0].z, 8);

// Tangential spring lag must not count as pressure into a contact face. Here
// the pointer is only one unit into the neighboring block but far along Y.
blocks = [block('a', 80, 49, { w: 24, h: 22, height: 9 }), block('step', 106, 49, { w: 32, h: 42, height: 12, locked: true })];
controller = F.create(blocks, { ...free, climbEnabled: true, follow: 4, climbHold: 80, climbResistance: 0 }, { frame });
controller.begin('a', { x: 80, y: 49 }); controller.target({ x: 81, y: 75 });
for (let i = 0; i < 20; i++) { controller.step(1 / 120); clear(blocks); }
near(blocks[0].z, 0); near(controller.telemetry.pressure, 0); near(controller.telemetry.force, 0);

// Pressure is the signed overtravel beyond dead travel, scaled so aligning
// the centers is full force. Below the minimum, waiting cannot cause a climb.
function pressureScene(requestedForce, patch = {}) {
  const scene = [block('a', 38), block('step', 60, 40, { locked: true })];
  const sim = F.create(scene, { ...free, climbEnabled: true, climbHold: 600, ...patch }, { frame });
  const s = sim.settings, centerDistance = 22;
  const dead = Math.min(s.climbPressure * (0.55 + 0.9 * s.climbResistance), centerDistance - 1);
  sim.begin('a', { x: 38, y: 40 }); sim.target({ x: 38 + dead + (centerDistance - dead) * requestedForce, y: 40 });
  return { scene, sim };
}
let belowMinimum = pressureScene(0.2); run(belowMinimum.sim, 5);
near(belowMinimum.scene[0].z, 0); near(belowMinimum.sim.telemetry.pressure, 0); near(belowMinimum.sim.telemetry.force, 0.2, 0.0001);
near(belowMinimum.sim.telemetry.minPressure, 0.3); belowMinimum.sim.release(); near(belowMinimum.sim.telemetry.force, 0); near(belowMinimum.sim.telemetry.overtravel, 0);
const lightPush = pressureScene(0.4), deepPush = pressureScene(0.85);
run(lightPush.sim, 0.2); run(deepPush.sim, 0.2);
near(lightPush.sim.telemetry.force, 0.4, 0.0001); near(deepPush.sim.telemetry.force, 0.85, 0.0001);
assert(deepPush.sim.telemetry.pressure > lightPush.sim.telemetry.pressure * 1.8);
function climbTime(requestedForce) {
  const trial = pressureScene(requestedForce);
  for (let i = 1; i < 1200; i++) { trial.sim.step(1 / 120); clear(trial.scene); if (trial.sim.telemetry.state === 'climbing') return i / 120; }
  assert.fail('qualifying sustained pressure never climbed');
}
assert(climbTime(0.4) > climbTime(0.85) * 1.5);

// The threshold is inclusive, including 100%, and slider edits take effect
// within the current drag. Lowering it lets the same held push give way.
let thresholdTrial = pressureScene(0.4, { climbMinPressure: 60 }); run(thresholdTrial.sim, 3);
near(thresholdTrial.scene[0].z, 0); near(thresholdTrial.sim.telemetry.pressure, 0);
thresholdTrial.sim.configure({ climbMinPressure: 40 }); near(thresholdTrial.sim.telemetry.minPressure, 0.4);
run(thresholdTrial.sim, 2.4, () => clear(thresholdTrial.scene)); near(thresholdTrial.scene[0].z, 8);
const fullPressure = pressureScene(1, { climbMinPressure: 100 }); run(fullPressure.sim, 1.4, () => clear(fullPressure.scene)); near(fullPressure.scene[0].z, 8);
thresholdTrial = pressureScene(0.6, { climbRelease: 200 }); run(thresholdTrial.sim, 0.2);
const partialProgress = thresholdTrial.sim.telemetry.pressure; assert(partialProgress > 0);
thresholdTrial.sim.configure({ climbMinPressure: 80 }); thresholdTrial.sim.step(1 / 120);
near(thresholdTrial.sim.telemetry.force, 0.6, 0.0001); assert(thresholdTrial.sim.telemetry.pressure < partialProgress);
thresholdTrial.sim.target({ x: 30, y: 40 }); thresholdTrial.sim.step(1 / 120);
near(thresholdTrial.sim.telemetry.force, 0); assert(thresholdTrial.sim.telemetry.pressure > 0);
run(thresholdTrial.sim, 0.25); near(thresholdTrial.sim.telemetry.pressure, 0);
thresholdTrial.sim.target({ x: 60, y: 40 }); run(thresholdTrial.sim, 0.2); assert(thresholdTrial.sim.telemetry.force > 0);
thresholdTrial.sim.configure({ climbEnabled: false }); near(thresholdTrial.sim.telemetry.force, 0); near(thresholdTrial.sim.telemetry.pressure, 0);
thresholdTrial.sim.configure({ climbEnabled: true }); run(thresholdTrial.sim, 0.1); thresholdTrial.sim.cancel(); near(thresholdTrial.sim.telemetry.force, 0);

// Different sizes reach the same pressure at the same fraction toward center.
// Even a dead-travel setting larger than a small block reaches 100% at center.
function sizeForce(heldWidth, obstacleWidth, requestedForce, patch = {}) {
  const start = 60 - heldWidth - 2, centerDistance = (heldWidth + obstacleWidth) / 2 + 2;
  const scene = [block('a', start, 40, { w: heldWidth }), block('step', 60, 40, { w: obstacleWidth, locked: true })];
  const sim = F.create(scene, { ...free, climbEnabled: true, climbHold: 1200, ...patch }, { frame });
  const s = sim.settings, dead = Math.min(s.climbPressure * (0.55 + 0.9 * s.climbResistance), centerDistance - Math.min(1, centerDistance));
  sim.begin('a', { x: start, y: 40 }); sim.target({ x: start + dead + (centerDistance - dead) * requestedForce, y: 40 }); sim.step(1 / 120);
  return sim.telemetry.force;
}
near(sizeForce(12, 8, 0.5), 0.5, 0.0001); near(sizeForce(20, 40, 0.5), 0.5, 0.0001);
near(sizeForce(2, 2, 1, { climbPressure: 24, climbResistance: 1, climbMinPressure: 100 }), 1, 0.0001);

// In a jammed train, pressure refers to the directly touching neighbor's
// center and top rather than the distant fixture stopping the entire chain.
blocks = [block('a', 56, 40, { w: 22 }), block('neighbor', 80, 40, { w: 24, height: 9 }), block('far-stop', 106, 40, { w: 32, height: 12, locked: true })]; events = [];
controller = F.create(blocks, { ...free, climbEnabled: true, climbMinPressure: 100, climbHold: 100 }, { frame, onEvent: event => events.push(event) });
controller.begin('a', { x: 56, y: 40 }); controller.target({ x: 81, y: 40 }); controller.step(1 / 120); near(controller.telemetry.force, 1, 0.0001);
run(controller, 1.2, () => clear(blocks)); near(blocks[0].z, 9); assert(events.some(event => event.type === 'climb' && event.obstacle === 'neighbor'));

// Releasing halfway through a climb cancels the lift; gravity settles legally.
blocks = [block('a', 10), block('step', 60, 40, { locked: true })];
controller = F.create(blocks, { ...free, climbEnabled: true, climbHold: 80, climbDuration: 700 }, { frame });
controller.begin('a', { x: 15, y: 45 }); controller.target({ x: 105, y: 45 });
for (let i = 0; i < 180 && blocks[0].z < 1; i++) controller.step(1 / 120);
assert(blocks[0].z > 0 && blocks[0].z < 8); controller.release();
run(controller, 1.5, () => clear(blocks)); near(blocks[0].z, 0);

// Climb onto a platform, then keep the same drag active while moving off.
// Gravity lowers the held block without a pointer release or a new grab.
blocks = [block('a', 10), block('platform', 60, 40, { w: 30, height: 12, locked: true })];
controller = F.create(blocks, { ...free, climbEnabled: true, climbHold: 100 }, { frame });
controller.begin('a', { x: 15, y: 45 }); controller.target({ x: 70, y: 45 }); run(controller, 1.3, () => clear(blocks));
near(blocks[0].z, 12); assert.strictEqual(controller.activeId, 'a');
controller.target({ x: 125, y: 45 }); let fallingWhileHeld = false;
run(controller, 1.5, () => { clear(blocks); assert.strictEqual(controller.activeId, 'a'); if (blocks[0].z > 0.001 && blocks[0].z < 11.99) fallingWhileHeld = true; });
assert(fallingWhileHeld); near(blocks[0].z, 0); near(blocks[0].x, 120, 0.05); assert(controller.isActive);
controller.target({ x: 135, y: 45 }); run(controller, 0.6); near(blocks[0].x, 130, 0.05);

// A held block descending from a higher platform lands smoothly on an
// intermediate support, then drops to ground when dragged beyond that too.
blocks = [block('held', 25, 40, { z: 16 }), block('high', 20, 40, { w: 40, height: 16, locked: true }), block('low', 70, 40, { w: 50, height: 8, locked: true })];
controller = F.create(blocks, free, { frame }); controller.begin('held', { x: 30, y: 45 }); controller.target({ x: 95, y: 45 });
let intermediateFall = false;
run(controller, 1.4, () => { clear(blocks); if (blocks[0].z > 8.01 && blocks[0].z < 15.99) intermediateFall = true; });
assert(intermediateFall); near(blocks[0].z, 8); near(blocks[0].x, 90, 0.05); assert.strictEqual(controller.activeId, 'held');
controller.target({ x: 135, y: 45 }); run(controller, 1.2, () => clear(blocks)); near(blocks[0].z, 0);

// Passengers stay rigid with a held support through the entire fall, and
// cancellation restores their original supported height as one transaction.
blocks = [block('base', 20, 40, { z: 16 }), block('passenger', 20, 40, { z: 24 }), block('platform', 10, 40, { w: 50, height: 16, locked: true })];
controller = F.create(blocks, free, { frame }); const supportedBefore = P.state(blocks);
controller.begin('base', { x: 25, y: 45 }); controller.target({ x: 105, y: 45 });
run(controller, 1.3, () => { clear(blocks); near(blocks[1].x, blocks[0].x); near(blocks[1].y, blocks[0].y); near(blocks[1].z - blocks[0].z, 8); });
near(blocks[0].z, 0); near(blocks[1].z, 8); assert.strictEqual(controller.activeId, 'base');
controller.cancel(); assert.deepStrictEqual(P.state(blocks), supportedBefore);

// Boundaries are never stairs and maximum step height is honored.
blocks = [block('a', 10)]; controller = F.create(blocks, { ...free, climbEnabled: true }, { frame });
controller.begin('a', { x: 15, y: 45 }); controller.target({ x: 500, y: 45 }); run(controller, 2); near(blocks[0].z, 0); near(controller.telemetry.pressure, 0);
blocks = [block('a', 10), block('tall', 60, 40, { locked: true, height: 24 })];
controller = F.create(blocks, { ...free, climbEnabled: true, maxClimb: 10 }, { frame });
controller.begin('a', { x: 15, y: 45 }); controller.target({ x: 105, y: 45 }); run(controller, 2); near(blocks[0].z, 0);

// Fixed substeps make the feel stable across ordinary browser frame rates.
function atRate(rate) {
  const scene = [block('a', 10)], sim = F.create(scene, free, { frame });
  sim.begin('a', { x: 15, y: 45 }); sim.target({ x: 100, y: 70 });
  for (let i = 0; i < rate; i++) sim.step(1 / rate);
  return scene[0];
}
const slow = atRate(30), fast = atRate(120); near(slow.x, fast.x, 0.04); near(slow.y, fast.y, 0.04);

// A carried stack stays rigid; independent elevated blocks settle onto a
// real support. Input validation cannot inject NaN into the solid solver.
blocks = [block('base', 10), block('upper', 10, 40, { z: 8 })];
controller = F.create(blocks, free, { frame }); controller.begin('base', { x: 15, y: 45 });
controller.target({ x: 55, y: 65 }); run(controller, 0.7, () => clear(blocks));
near(blocks[0].x, blocks[1].x); near(blocks[0].y, blocks[1].y); near(blocks[1].z, 8);
const positions = P.state(blocks); controller.target({ x: NaN, y: Infinity }); controller.step(0); assert.deepStrictEqual(P.state(blocks), positions);
controller.configure({ follow: NaN, buffer: -999, inertia: 100 });
assert.strictEqual(controller.settings.buffer, 0); assert.strictEqual(controller.settings.inertia, 1); assert(Number.isFinite(controller.settings.follow));
blocks = [block('base', 40), block('falling', 42, 42, { z: 28 })];
controller = F.create(blocks, free, { frame }); run(controller, 1.5, () => clear(blocks)); near(blocks[1].z, 8);

console.log('drag feel: solid contact, buffer, motion knobs, magnetic hysteresis, inertia, cancellation, pressure/climb, gravity and frame pacing passed');
