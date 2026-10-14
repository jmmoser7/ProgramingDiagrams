'use strict';

const assert = require('assert');
const G = require('./iso-geometry.js');
const E = require('./engine.js');
const A = require('./appearance.js');
const near = (a, b, message, tolerance = 1e-5) => assert(Math.abs(a - b) <= tolerance, `${message}: ${a} != ${b}`);

// These checks protect the actual solid rather than its on-screen cap:
// the roof, base, twelve rounded edges and spherical vertices all use the
// same signed-distance surface and outward normals as selection rays.
let vertices = 0;
for (const [w, d, h, radius] of [[20, 30, 10, 2], [20, 30, 10, 50], [12, 12, 12, 6], [20, 30, 10, 0], [2, 3, 0.1, 1]]) {
  const m = G.mesh(w, d, h, radius), half = [w / 2, d / 2, h / 2], capped = Math.min(radius, ...half);
  near(m.radius, capped, 'radius is capped by all three dimensions');
  assert(m.count > 0 && m.count % 3 === 0, 'solid contains complete triangles');
  for (let i = 0; i < m.positions.length; i += 3) {
    const p = [...m.positions.slice(i, i + 3)], n = [...m.normals.slice(i, i + 3)];
    near(G.distance(p, half, capped), 0, 'vertex lies on analytic rounded solid', 2e-6);
    near(Math.hypot(...n), 1, 'normal has unit length', 2e-6);
    assert(G.dot(p, n) > 0, 'normal points outward');
    p.forEach((v, j) => assert(Math.abs(v) <= half[j] + 1e-6, 'rounding stays within footprint and extrusion'));
    vertices++;
  }
  for (let i = 0; i < m.positions.length; i += 9) {
    const a = [...m.positions.slice(i, i + 3)], b = [...m.positions.slice(i + 3, i + 6)], c = [...m.positions.slice(i + 6, i + 9)];
    const ab = b.map((v, j) => v - a[j]), ac = c.map((v, j) => v - a[j]), cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const n = [...m.normals.slice(i, i + 3)]; assert(G.dot(cross, n) > -1e-7, 'triangle winding faces outward for culling');
  }
}

const rounded = { id: 'a', x: -10, y: -15, w: 20, h: 30, height: 10, z: 0, radius: 2 };
const roof = G.rayHit([0, 0, 100], [0, 0, -1], rounded);
assert(roof && roof.top, 'top-face selection identifies the roof'); near(roof.point[2], 10, 'roof height');
const side = G.rayHit([100, 0, 5], [-1, 0, 0], rounded);
assert(side && !side.top, 'side cannot masquerade as top-face selection'); near(side.point[0], 10, 'side extent');
const base = G.rayHit([0, 0, -100], [0, 0, 1], rounded);
assert(base && base.normal[2] < -0.99, 'underside is part of the solid'); near(base.point[2], 0, 'base level');
assert.strictEqual(G.rayHit([-10, -15, 100], [0, 0, -1], rounded), null, 'cut-away corners are not selectable');
assert(G.rayHit([-10, -15, 100], [0, 0, -1], { ...rounded, radius: 0 }), 'sharp corner remains selectable');

const expected = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
[-Math.PI / 4, Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4].forEach((angle, i) => {
  const { right, up, toward } = G.axes(angle);
  for (const v of [right, up, toward]) near(Math.hypot(...v), 1, 'camera basis unit length');
  near(G.dot(right, up), 0, 'camera basis orthogonal'); near(G.dot(right, toward), 0, 'right and view orthogonal'); near(G.dot(up, toward), 0, 'up and view orthogonal');
  assert(Math.sign(toward[0]) === expected[i][0] && Math.sign(toward[1]) === expected[i][1], 'compass corner matches camera position');
  for (let axis = 0; axis < 3; axis++) near(Math.hypot(right[axis], up[axis]), Math.sqrt(2 / 3), 'true isometric foreshortening');
});

const solid = (id, z, height, x = 0) => ({ id, x, y: 0, w: 20, h: 20, z, height });
const stack = [solid('base', 0, 8), solid('middle', 8, 4), solid('top', 12, 3), solid('away', 8, 4, 100)];
const before = stack.map(s => ({ ...s }));
stack[0].height = 12; G.followSupports(stack, before);
near(stack[1].z, 12, 'middle follows lower top-face extrusion'); near(stack[2].z, 16, 'upper stack follows transitively'); near(stack[3].z, 8, 'unrelated elevation stays fixed');
stack[0].height = 6; G.followSupports(stack, before);
near(stack[1].z, 6, 'shrinking restores support without drift'); near(stack[2].z, 10, 'shrinking propagates transitively');
stack[0].z = 10; G.followSupports(stack, before, new Set(['base']));
near(stack[1].z, 16, 'body elevation carries supported cells'); near(stack[2].z, 20, 'raised stack remains coherent');

const model = E.modelFromCsv('Name,Area\nSmall,100\nLarge,400\n', 'test.csv');
model.stickies.forEach((s, i) => { s.height = 9 + i; s.z = i * 10; s.material = i ? 'glass' : 'jelly'; s.radius = 2; });
A.setGradient(model, model.stickies, '#ff3597', '#ff947e');
const copied = E.restore(JSON.parse(JSON.stringify(E.capture(model))));
copied.stickies.forEach((s, i) => { near(s.height, 9 + i, 'height survives shared Board/Iso persistence'); near(s.z, i * 10, 'elevation survives persistence'); assert.strictEqual(s.material, i ? 'glass' : 'jelly'); assert.strictEqual(A.fillFor(copied, s), i ? '#ff947e' : '#ff3597'); });
const layout = E.unpackLayout(E.packLayout(copied, { isoDirection: 'SW', isoCamera: { x: 1, y: 2, z: 3, scale: 4, direction: 'SW' } }));
assert.strictEqual(layout.view.isoCamera.direction, 'SW', 'save layout preserves locked corner');

console.log(JSON.stringify({ ok: true, surfaceVertices: vertices, checks: 'rounded solid, outward normals, ray faces, compass basis, stack propagation, shared style/save round trip' }));
