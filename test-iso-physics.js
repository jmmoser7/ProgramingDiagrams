'use strict';
const assert = require('assert'), P = require('./iso-physics.js');
const cell = (id, x, y = 0, z = 0, height = 4) => ({ id, x, y, z, height, w: 10, h: 10 });
const near = (actual, expected, message) => assert(Math.abs(actual - expected) < 0.001, `${message}: ${actual} / ${expected}`);
const clear = list => { for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) assert(!P.intersects(list[i], list[j]), 'solids must not interpenetrate'); };

// A one-frame movement far past an obstacle must stop at its first surface.
let list = [cell('a', 0), { ...cell('b', 20), locked: true }];
let result = P.move(list, ['a'], 500, 0, { mode: 'isolate', gap: 2 }); near(list[0].x, 8, 'swept collision prevents tunneling'); assert(result.blocked); clear(list);
// Ordinary contact pushes a whole train, preserving legal contact gaps.
list = [cell('a', 0), cell('b', 15), cell('c', 30)];
P.move(list, ['a'], 25, 0, { gap: 1 }); near(list[0].x, 25, 'held body reaches target'); near(list[1].x, 36, 'first neighbor pushed'); near(list[2].x, 47, 'push propagates to second neighbor'); clear(list);
// Frame pressure clamps every branch, without leaving speculative overpush.
list = [cell('a', 0), cell('b', 15), cell('c', 30)];
result = P.move(list, ['a'], 100, 0, { gap: 0, frame: { x: 0, y: -10, w: 45, h: 30 } });
near(list[0].x, 15, 'wall stops the train'); near(list[1].x, 25, 'middle stops at contact'); near(list[2].x, 35, 'last stays within frame'); assert(result.blocked); clear(list);
// Different layers pass in plan, but overlapping height volumes collide.
list = [cell('a', 0, 0, 4), { ...cell('b', 20, 0, 0), locked: true }];
P.move(list, ['a'], 30, 0, { mode: 'isolate' }); near(list[0].x, 30, 'touching top/base surfaces do not collide');
list = [cell('a', 0, 0, 3), { ...cell('b', 20), locked: true }];
P.move(list, ['a'], 30, 0, { mode: 'isolate' }); near(list[0].x, 10, 'partial Z overlap still blocks'); clear(list);
// Moving a support carries the complete stack horizontally and vertically.
list = [cell('a', 0), cell('b', 0, 0, 4), cell('c', 0, 0, 8)];
P.move(list, ['a'], 12, 5); list.forEach(s => { near(s.x, 12, 'stack follows horizontal support'); near(s.y, 5, 'stack follows second horizontal axis'); });
P.verticalMove(list, ['a'], 6); near(list[0].z, 6, 'support lifted'); near(list[1].z, 10, 'first passenger lifted'); near(list[2].z, 14, 'transitive passenger lifted'); clear(list);
list = [cell('a', 0), { ...cell('locked-upper', 0, 0, 4), locked: true }]; P.move(list, ['a'], 5, 0); near(list[1].x, 0, 'a locked passenger is never carried'); near(P.verticalMove(list, ['a'], 5), 0, 'locked overhead cell blocks vertical movement');
// Group offsets remain rigid when one member meets a fixed obstacle.
list = [{ ...cell('a', 0), group: 'g' }, { ...cell('b', 0, 15), group: 'g' }, { ...cell('wall', 20, 15), locked: true }];
P.move(list, ['a'], 30, 0, { mode: 'isolate' }); near(list[0].x, list[1].x, 'group offsets are rigid even when one member is grabbed'); near(list[0].x, 10, 'one blocked member stops group'); clear(list);
// Diagonal walls collide only with the clipped segment, not the empty bbox.
list = [cell('a', 0, 80)]; P.move(list, ['a'], 30, 0, { lines: [{ id: 'wall', points: [[0, 0], [100, 100]], width: 2 }] }); near(list[0].x, 30, 'diagonal wall bounding box is not a solid');
P.move(list, ['a'], 100, 0, { lines: [{ id: 'wall', points: [[0, 0], [100, 100]], width: 2 }] }); assert(list[0].x < 80 && list[0].x > 60, 'diagonal segment stops swept movement');

// A short press never jumps. Continued blocked pressure animates upward,
// then the raised cell moves onto the top instead of teleporting on release.
list = [cell('a', 0), { ...cell('b', 20), locked: true }];
let drag = P.session(list, ['a'], { mode: 'isolate', gap: 0, maxSpeed: Infinity }); drag.setTarget(23, 0);
for (let i = 0; i < 15; i++) drag.step(1 / 60); near(list[0].z, 0, 'short pressure remains at ground'); assert(drag.pressure.ratio > 0 && drag.pressure.ratio < 1);
drag.setTarget(-5, 0); drag.step(1 / 60); assert.strictEqual(drag.pressure.ratio, 0, 'withdrawing cancels accumulated pressure'); near(list[0].z, 0, 'withdrawing never pops');
drag.setTarget(23, 0); let intermediate = false;
for (let i = 0; i < 70; i++) { drag.step(1 / 60); if (list[0].z > 0.01 && list[0].z < 3.99) intermediate = true; clear(list); }
assert(intermediate, 'hop has genuine intermediate heights'); near(list[0].z, 4, 'hop lands at obstacle top'); near(list[0].x, 23, 'raised body moves onto support'); drag.release(); assert.strictEqual(drag.pressure.ratio, 0, 'release clears pressure');
// An actual wall is never converted into a hoppable cell.
list = [cell('a', 0)]; drag = P.session(list, ['a'], { mode: 'isolate', frame: { x: 0, y: 0, w: 25, h: 25 } }); drag.setTarget(100, 0); for (let i = 0; i < 100; i++) drag.step(1 / 60); near(list[0].z, 0, 'frame wall cannot be hopped'); near(list[0].x, 15, 'frame remains impenetrable');
// Gravity lands on the highest support beneath the footprint without bounce.
list = [cell('base', 0), cell('falling', 2, 2, 30)]; const velocities = new Map(); let previous = list[1].z;
for (let i = 0; i < 120; i++) { P.gravity(list, 1 / 60, new Set(), velocities); assert(list[1].z <= previous + 1e-6); assert(list[1].z >= 4); previous = list[1].z; }
near(list[1].z, 4, 'gravity settles exactly on support'); clear(list);
// Ghost release makes horizontal room rather than changing cell elevations.
list = [cell('held', 0), cell('neighbor', 5)]; assert(P.separate(list, new Set(['held']), { gap: 1 })); near(list[0].x, 0, 'ghost release keeps held location'); list.forEach(s => near(s.z, 0, 'ghost release does not teleport upward')); clear(list);

console.log('iso physics: swept contact, push trains, layers, support carriage, group rigidity, diagonal walls, pressure cancellation/hop, gravity and ghost release passed');
