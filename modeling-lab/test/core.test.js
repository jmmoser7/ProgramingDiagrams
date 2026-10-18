import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "../vendor/three.module.min.js";
import {
  vec,
  arr,
  plane,
  toWorld,
  toLocal,
  object,
  box,
  blank,
  sample,
  validate,
  History,
  transform,
  transformMatrix,
  pivot,
  makeBlock,
  expand,
  effective,
} from "../model.js";
import { ViewCamera, navigation } from "../camera.js";
import {
  coordinates,
  intersection3D,
  constrained,
  marquee,
  snap,
  elevatorPoint,
} from "../precision.js";
import { Command } from "../commands.js";
const near = (a, b, t = 1e-8) => assert.ok(Math.abs(a - b) < t, `${a} ≠ ${b}`);
const vnear = (a, b) => a.forEach((x, i) => near(x, b[i]));
test("navigation maps projection and modifiers without middle-button orbit", () => {
  assert.equal(navigation("Perspective", {}), "orbit");
  assert.equal(navigation("Perspective", { shiftKey: true }), "pan");
  for (const v of ["Top", "Front", "Right"])
    assert.equal(navigation(v, {}), "pan");
  assert.equal(navigation("Perspective", { ctrlKey: true }), "zoom");
  assert.equal(
    navigation("Top", { ctrlKey: true, shiftKey: true }),
    "orbit-pointer",
  );
});
test("orbit stable target, pan translates camera and target together, dolly keeps FOV", () => {
  const v = new ViewCamera(1000, 700),
    target = v.target.clone(),
    dist = v.distance;
  v.orbit(170, -80);
  vnear(arr(v.target), arr(target));
  near(v.distance, dist);
  const cam = v.camera.position.clone();
  v.pan(15, 20);
  vnear(
    arr(v.camera.position.clone().sub(cam)),
    arr(v.target.clone().sub(target)),
  );
  const fov = v.camera.fov;
  v.zoom(-100, undefined, true);
  near(v.camera.fov, fov);
  assert.ok(v.distance < dist);
});
test("cursor anchor invariant in perspective and parallel; tiny / huge clipping remains finite", () => {
  for (const name of ["Perspective", "Top", "Front", "Right"]) {
    const v = new ViewCamera(900, 650);
    v.setView(name);
    const p = { x: 650, y: 180 },
      anchor = v.onPlane(p, v.direction, v.target);
    for (let i = 0; i < 10; i++) v.zoom(-40, p);
    const q = v.project(anchor);
    near(q.x, p.x, 1e-6);
    near(q.y, p.y, 1e-6);
    for (const d of [1e-7, 1e12]) {
      v.distance = d;
      v.span = d;
      v.update();
      assert.ok(v.camera.near > 0 && v.camera.far > v.camera.near);
      assert.ok(v.camera.projectionMatrix.elements.every(Number.isFinite));
    }
  }
});
test("CPlane/world/relative numeric entry with elevation and rejected malformed values", () => {
  const f = plane("XZ", 3);
  vnear(arr(coordinates("2,4,5", f)), [2, -8, 4]);
  vnear(arr(coordinates("w2,4,5", f)), [2, 4, 5]);
  vnear(arr(coordinates("@1,2,3", f, vec([10, 20, 30]))), [11, 17, 32]);
  vnear(toLocal(toWorld([1, 2, 3], f), f), [1, 2, 3]);
  for (const s of ["1,,3", "1,Infinity,3", "1,2,3,4"])
    assert.throws(() => coordinates(s, f));
  assert.throws(() => coordinates("@1,2", f));
});
test("free point hits chosen CPlane; Elevator resolves normal distance", () => {
  const v = new ViewCamera(900, 650),
    f = plane("XZ", 2),
    p = { x: 300, y: 300 },
    hit = v.onPlane(p, f.n, f.origin);
  near(toLocal(hit, f)[2], 0);
  const base = vec([1, 2, 0]),
    raised = vec([1, 2, 6]),
    screen = v.project(raised);
  vnear(arr(elevatorPoint(v, screen, base, plane())), arr(raised));
});
test("Line/Polyline lifecycle, undo segment, close, preview never mutates points", () => {
  const f = plane(),
    c = new Command("Line", f);
  c.pick(vec([1, 2, 3]));
  assert.equal(c.complete(), false);
  const preview = c.result(vec([5, 6, 7]));
  assert.equal(c.points.length, 1);
  assert.equal(preview.points[1][2], 7);
  c.pick(vec([5, 6, 7]));
  assert.equal(c.complete(), true);
  const p = new Command("Polyline", f);
  p.pick(vec([0, 0, 0]));
  assert.throws(() => p.finish());
  p.pick(vec([1, 0, 2]));
  p.pick(vec([1, 3, 4]));
  p.undo();
  assert.equal(p.points.length, 2);
  p.pick(vec([4, 5, 6]));
  assert.deepEqual(p.close().points.at(-1), [0, 0, 0]);
});
test("Box signed height in local normal, Cube equal edges, Plane, noncoplanar SrfPt", () => {
  const f = plane("YZ", 5),
    a = toWorld([0, 0, 0], f),
    b = toWorld([4, 3, 0], f),
    c = new Command("Box", f);
  c.pick(a);
  c.pick(b, { shift: true });
  const o = c.height(-7);
  near(vec(o.points[4]).sub(vec(o.points[0])).dot(f.n), -7);
  near(vec(o.points[1]).distanceTo(vec(o.points[0])), 4);
  near(vec(o.points[3]).distanceTo(vec(o.points[0])), 4);
  const cube = new Command("Cube", f);
  cube.pick(a);
  const q = cube.pick(b);
  near(vec(q.points[4]).distanceTo(vec(q.points[0])), 4);
  const s = new Command("SrfPt", plane());
  for (const p of [
    [0, 0, 0],
    [3, 0, 1],
    [3, 3, 5],
  ])
    s.pick(vec(p));
  assert.equal(s.finish().points.length, 3);
  assert.equal(s.complete(), false);
  s.pick(vec([0, 3, 1]));
  assert.equal(s.complete(), true);
});
test("direction lock survives successive picks; Ortho defaults to 45-degree increments", () => {
  const c = new Command("Polyline", plane());
  c.pick(vec([0, 0, 0]));
  c.lock = vec([1, 0, 1]).normalize();
  for (const anchor of [vec([0, 0, 0]), vec([2, 0, 2])]) {
    const p = constrained(vec([5, 3, 4]), anchor, plane(), { lock: c.lock });
    near(p.y, 0);
    near(p.x - anchor.x, p.z - anchor.z);
  }
  c.pick(vec([2, 0, 2]));
  assert.ok(c.lock);
  const q = constrained(vec([3, 2, 0]), vec([0, 0, 0]), plane(), {
    ortho: true,
    angle: 45,
  });
  near(q.x, q.y);
});
test("intersections prove XYZ coincidence and reject projected depth crossing", () => {
  assert.equal(
    intersection3D(
      vec([-1, 0, 0]),
      vec([1, 0, 0]),
      vec([0, -1, 5]),
      vec([0, 1, 5]),
    ),
    null,
  );
  vnear(
    arr(
      intersection3D(
        vec([-1, 0, 2]),
        vec([1, 0, 2]),
        vec([0, -1, 2]),
        vec([0, 1, 2]),
      ),
    ),
    [0, 0, 2],
  );
});
test("screen-pixel snaps preserve XYZ; project is explicit; eligibility excludes locked and hidden", () => {
  const d = blank();
  d.objects = [
    object("line", [
      [0, 0, 4],
      [8, 0, 4],
    ]),
  ];
  const v = new ViewCamera(900, 650);
  v.setView("Top");
  const p = v.project(vec([0, 0, 4])),
    settings = { snap: true, snapRadius: 16, filter: "all", project: false };
  let s = snap(d, v, p, plane(), settings);
  near(s.point.z, 4);
  assert.equal(s.label, "End");
  s = snap(d, v, p, plane(), { ...settings, project: true });
  near(s.point.z, 0);
  assert.ok(s.label.startsWith("Projected"));
  d.objects[0].locked = true;
  assert.equal(snap(d, v, p, plane(), settings), null);
});
test("directional marquee exact stroke touches and components across owners", () => {
  const d = blank();
  d.objects = [
    object("line", [
      [-5, 0, 0],
      [5, 0, 0],
    ]),
    object("line", [
      [-5, 1, 0],
      [5, 1, 0],
    ]),
  ];
  const v = new ViewCamera(1000, 700);
  v.setView("Top");
  const center = v.project(vec([0, 0, 0])),
    a = { x: center.x - 5, y: center.y - 50 },
    b = { x: center.x + 5, y: center.y + 50 };
  assert.equal(marquee(d, v, a, b, false).length, 0);
  assert.equal(marquee(d, v, b, a, false).length, 2);
  assert.equal(marquee(d, v, b, a, true, "all", "edge").length, 2);
  d.objects[0].locked = true;
  assert.equal(marquee(d, v, b, a, true, "all", "edge").length, 1);
});
test("component transform edits only selected vertices; group styles inherit with overrides", () => {
  const d = blank(),
    o = object("box", box(vec([0, 0, 0]), vec([2, 2, 0]), 2, plane()));
  d.objects = [o];
  const before = structuredClone(o.points);
  transform(
    d,
    [{ id: o.id, type: "edge", index: 0 }],
    transformMatrix("move", [0, 0, 1], 3, vec([0, 0, 0])),
  );
  near(o.points[0][2], 3);
  near(o.points[1][2], 3);
  assert.deepEqual(o.points[2], before[2]);
  d.groups = [{ id: "g", name: "g", props: { color: "#112233" } }];
  o.group = "g";
  assert.equal(effective(d, o, "color"), "#112233");
  o.props.color = "#abcdef";
  d.groups[0].props.color = "#ffffff";
  assert.equal(effective(d, o, "color"), "#abcdef");
});
test("move/rotate/scale use selection pivot; locked objects resist transforms", () => {
  const d = blank(),
    o = object("line", [
      [0, 0, 0],
      [2, 0, 0],
    ]);
  d.objects = [o];
  const sel = [{ id: o.id, type: "object" }],
    c = pivot(d, sel);
  transform(d, sel, transformMatrix("rotate", [0, 0, 1], 90, c));
  vnear(o.points[0], [1, -1, 0]);
  transform(d, sel, transformMatrix("scale", [1, 1, 1], 2, c));
  vnear(o.points[0], [1, -2, 0]);
  o.locked = true;
  transform(d, sel, transformMatrix("move", [1, 0, 0], 5, c));
  vnear(o.points[0], [1, -2, 0]);
});
test("Block is definition + instances, preserved on save/load without flattening", () => {
  const d = blank();
  d.objects = [
    object("line", [
      [1, 2, 3],
      [3, 2, 3],
    ]),
  ];
  d.objects[0].props.color = "#123456";
  const id = makeBlock(
    d,
    [{ id: d.objects[0].id, type: "object" }],
    "Reusable",
  );
  assert.equal(d.objects[0].kind, "instance");
  assert.equal(d.definitions.length, 1);
  assert.equal(d.definitions[0].objects[0].props.color, "#123456");
  assert.deepEqual(expand(d, d.objects[0])[0].points, [
    [1, 2, 3],
    [3, 2, 3],
  ]);
  const restored = validate(JSON.parse(JSON.stringify(d)));
  assert.equal(restored.objects[0].definition, d.definitions[0].id);
  assert.equal(restored.objects[0].id, id);
});
test("geometry undo/redo and validated load are atomic; invalid version/points/IDs cannot replace", () => {
  const h = new History(blank());
  h.commit((d) =>
    d.objects.push(
      object("line", [
        [0, 0, 0],
        [1, 2, 3],
      ]),
    ),
  );
  assert.equal(h.past.length, 1);
  h.undo();
  assert.equal(h.doc.objects.length, 0);
  h.redo();
  assert.equal(h.doc.objects.length, 1);
  const saved = JSON.stringify(h.doc);
  assert.throws(() => h.commit((d) => (d.objects[0].points[0][2] = Infinity)));
  assert.equal(JSON.stringify(h.doc), saved);
  assert.throws(() => validate({ ...h.doc, version: 2 }));
  assert.throws(() =>
    validate({ ...h.doc, objects: [...h.doc.objects, ...h.doc.objects] }),
  );
  assert.deepEqual(validate(JSON.parse(saved)), h.doc);
});
