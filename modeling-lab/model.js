import * as T from "./vendor/three.module.min.js";
export const CYAN = "#00ffee";
export const vec = (p) => new T.Vector3(...p);
export const arr = (v) => v.toArray();
export const clone = (x) => structuredClone(x);
export const uid = () => crypto.randomUUID();
export const frames = {
  XY: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  XZ: [
    [1, 0, 0],
    [0, 0, 1],
    [0, -1, 0],
  ],
  YZ: [
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 0],
  ],
};
export function plane(name = "XY", elevation = 0) {
  const [u, v, n] = frames[name].map(vec);
  return { name, u, v, n, origin: n.clone().multiplyScalar(elevation) };
}
export function toWorld(p, f) {
  return f.origin
    .clone()
    .addScaledVector(f.u, p[0])
    .addScaledVector(f.v, p[1])
    .addScaledVector(f.n, p[2]);
}
export function toLocal(p, f) {
  const d = p.clone().sub(f.origin);
  return [d.dot(f.u), d.dot(f.v), d.dot(f.n)];
}
export function object(kind, points, extra = {}) {
  return {
    id: uid(),
    kind,
    name: kind,
    points: points.map((p) => (Array.isArray(p) ? p : arr(p))),
    props: {},
    visible: true,
    locked: false,
    group: null,
    ...extra,
  };
}
export function box(a, b, height, f, cube = false, square = false) {
  const p = toLocal(a, f),
    q = toLocal(b, f);
  if (cube || square) {
    const d = Math.max(Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1]));
    q[0] = p[0] + Math.sign(q[0] - p[0] || 1) * d;
    q[1] = p[1] + Math.sign(q[1] - p[1] || 1) * d;
    if (cube) height = d;
  }
  q[2] = p[2];
  const bottom = [
    [p[0], p[1], p[2]],
    [q[0], p[1], p[2]],
    [q[0], q[1], p[2]],
    [p[0], q[1], p[2]],
  ];
  return [...bottom, ...bottom.map((x) => [x[0], x[1], x[2] + height])].map(
    (x) => arr(toWorld(x, f)),
  );
}
export function topology(o) {
  const n = o.points.length;
  if (o.kind === "box" || o.kind === "cube")
    return {
      edges: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [4, 5],
        [5, 6],
        [6, 7],
        [7, 4],
        [0, 4],
        [1, 5],
        [2, 6],
        [3, 7],
      ],
      faces: [
        [0, 3, 2, 1],
        [4, 5, 6, 7],
        [0, 1, 5, 4],
        [1, 2, 6, 5],
        [2, 3, 7, 6],
        [3, 0, 4, 7],
      ],
    };
  if (o.kind === "surface" || o.kind === "plane")
    return {
      edges: o.points.map((_, i) => [i, (i + 1) % n]),
      faces: [o.points.map((_, i) => i)],
    };
  return {
    edges: Array.from({ length: n - 1 }, (_, i) => [i, i + 1]),
    faces: [],
  };
}
export function expand(doc, o) {
  if (o.kind !== "instance") return [o];
  const def = doc.definitions.find((d) => d.id === o.definition);
  return def.objects.map((c) => ({
    ...c,
    id: o.id,
    group: o.group,
    visible: o.visible,
    locked: o.locked,
    props: { ...c.props, ...o.props },
    points: c.points.map((p) =>
      arr(vec(p).applyMatrix4(new T.Matrix4().fromArray(o.matrix))),
    ),
  }));
}
export function worldObjects(doc) {
  return doc.objects.flatMap((o) => expand(doc, o));
}
export function bounds(doc, ids = null) {
  const b = new T.Box3();
  for (const o of doc.objects)
    if (o.visible && (!ids || ids.has(o.id)))
      for (const c of expand(doc, o))
        for (const p of c.points) b.expandByPoint(vec(p));
  return b;
}
export function effective(doc, o, key) {
  return (
    o.props[key] ??
    doc.groups.find((g) => g.id === o.group)?.props[key] ??
    doc.defaults[key]
  );
}
export function blank() {
  return {
    format: "modeling-lab",
    version: 1,
    units: "model units",
    defaults: { color: "#c5d0d7", opacity: 1 },
    groups: [],
    definitions: [],
    objects: [],
  };
}
export function sample() {
  const d = blank(),
    f = plane();
  d.objects = [
    object("box", box(vec([-7, -3, 0]), vec([-2, 2, 0]), 6, f), {
      name: "Studio volume",
      props: { color: "#b9ced5" },
    }),
    object("cube", box(vec([1, -2, 0]), vec([4, 1, 0]), 3, f), {
      name: "Gallery cube",
      props: { color: "#d9c9b3" },
    }),
    object(
      "surface",
      [
        [-6, 5, 1],
        [0, 5, 2],
        [1, 9, 5],
        [-6, 9, 3],
      ],
      { name: "Warped bilinear canopy", props: { color: "#a1bbad" } },
    ),
    object(
      "polyline",
      [
        [4, 5, 0],
        [7, 5, 2],
        [7, 8, 5],
        [10, 8, 5],
      ],
      { name: "Spatial polyline", props: { color: "#8a95ae" } },
    ),
    object(
      "plane",
      [
        [-9, -6, 0],
        [10, -6, 0],
        [10, 11, 0],
        [-9, 11, 0],
      ],
      {
        name: "Locked reference floor",
        locked: true,
        props: { color: "#dce2e5", opacity: 0.35 },
      },
    ),
  ];
  return d;
}
function safeProps(p) {
  if (!p || typeof p !== "object" || Array.isArray(p))
    throw Error("Invalid properties");
  const r = {};
  if (p.color !== undefined) {
    if (!/^#[\da-f]{6}$/i.test(p.color)) throw Error("Invalid color");
    r.color = p.color;
  }
  if (p.opacity !== undefined) {
    if (!Number.isFinite(p.opacity) || p.opacity < 0.05 || p.opacity > 1)
      throw Error("Invalid opacity");
    r.opacity = p.opacity;
  }
  return r;
}
export function validate(raw) {
  if (!raw || raw.format !== "modeling-lab" || raw.version !== 1)
    throw Error("Expected modeling-lab JSON version 1");
  if (
    !Array.isArray(raw.objects) ||
    raw.objects.length > 2000 ||
    !Array.isArray(raw.groups) ||
    raw.groups.length > 2000 ||
    !Array.isArray(raw.definitions) ||
    raw.definitions.length > 100
  )
    throw Error("Document limits exceeded");
  const ids = new Set(),
    identifier = (x) =>
      typeof x === "string" &&
      x.length > 0 &&
      x.length <= 100 &&
      !["__proto__", "constructor", "prototype"].includes(x),
    name = (x) => (typeof x === "string" ? x.slice(0, 200) : "Untitled");
  const id = (x) => {
    if (!identifier(x) || ids.has(x))
      throw Error("Invalid or duplicate identity");
    ids.add(x);
    return x;
  };
  const d = blank();
  d.defaults = { ...d.defaults, ...safeProps(raw.defaults) };
  d.groups = raw.groups.map((g) => ({
    id: id(g.id),
    name: name(g.name),
    props: safeProps(g.props),
  }));
  const clean = (o, definition = false) => {
    const r = {
      id: id(o.id),
      name: name(o.name),
      kind: o.kind,
      visible: o.visible !== false,
      locked: o.locked === true,
      group: o.group ?? null,
      props: safeProps(o.props),
    };
    if (r.group !== null && !d.groups.some((g) => g.id === r.group))
      throw Error("Unknown group");
    if (o.kind === "instance") {
      if (definition || !d.definitions.some((x) => x.id === o.definition))
        throw Error("Unknown or nested block");
      if (
        !Array.isArray(o.matrix) ||
        o.matrix.length !== 16 ||
        !o.matrix.every((x) => Number.isFinite(x) && Math.abs(x) <= 1e12) ||
        o.matrix[3] !== 0 ||
        o.matrix[7] !== 0 ||
        o.matrix[11] !== 0 ||
        o.matrix[15] !== 1
      )
        throw Error("Invalid instance matrix");
      if (Math.abs(new T.Matrix4().fromArray(o.matrix).determinant()) < 1e-15)
        throw Error("Singular instance");
      return { ...r, definition: o.definition, matrix: [...o.matrix] };
    }
    if (
      !["box", "cube", "line", "polyline", "plane", "surface"].includes(
        o.kind,
      ) ||
      !Array.isArray(o.points) ||
      o.points.length > 1000 ||
      !o.points.every(
        (p) =>
          Array.isArray(p) &&
          p.length === 3 &&
          p.every((x) => Number.isFinite(x) && Math.abs(x) <= 1e9),
      )
    )
      throw Error("Invalid XYZ geometry");
    const n = o.points.length;
    if (
      (["box", "cube"].includes(o.kind) && n !== 8) ||
      (o.kind === "line" && n !== 2) ||
      (o.kind === "polyline" && n < 2) ||
      (o.kind === "plane" && n !== 4) ||
      (o.kind === "surface" && ![3, 4].includes(n))
    )
      throw Error("Invalid topology");
    return { ...r, points: o.points.map((p) => [...p]) };
  };
  d.definitions = raw.definitions.map((b) => {
    const bid = id(b.id);
    if (!Array.isArray(b.objects) || b.objects.length > 200)
      throw Error("Invalid block definition");
    return {
      id: bid,
      name: name(b.name),
      objects: b.objects.map((o) => clean(o, true)),
    };
  });
  d.objects = raw.objects.map((o) => clean(o));
  return d;
}
export class History {
  constructor(doc) {
    this.doc = doc;
    this.past = [];
    this.future = [];
  }
  commit(fn) {
    const before = clone(this.doc);
    try {
      fn(this.doc);
      this.doc = validate(this.doc);
    } catch (e) {
      this.doc = before;
      throw e;
    }
    if (JSON.stringify(before) !== JSON.stringify(this.doc)) {
      this.past.push(before);
      if (this.past.length > 100) this.past.shift();
      this.future = [];
      return true;
    }
    return false;
  }
  undo() {
    if (!this.past.length) return false;
    this.future.push(this.doc);
    this.doc = this.past.pop();
    return true;
  }
  redo() {
    if (!this.future.length) return false;
    this.past.push(this.doc);
    this.doc = this.future.pop();
    return true;
  }
}
export function selectionIds(doc, selection) {
  return new Set(
    selection
      .map((s) => s.id)
      .filter((id) =>
        doc.objects.some((o) => o.id === id && !o.locked && o.visible),
      ),
  );
}
export function groupIds(doc, id) {
  const o = doc.objects.find((o) => o.id === id);
  return o?.group
    ? doc.objects
        .filter((x) => x.group === o.group && !x.locked && x.visible)
        .map((x) => x.id)
    : [id];
}
export function selectedVertices(o, s) {
  const t = topology(o);
  if (s.type === "vertex") return [s.index];
  if (s.type === "edge") return t.edges[s.index];
  if (s.type === "face") return t.faces[s.index];
  return o.points.map((_, i) => i);
}
export function transform(doc, selection, matrix) {
  for (const o of doc.objects) {
    const sels = selection.filter((s) => s.id === o.id);
    if (!sels.length || o.locked || !o.visible) continue;
    if (o.kind === "instance") {
      o.matrix = new T.Matrix4()
        .multiplyMatrices(matrix, new T.Matrix4().fromArray(o.matrix))
        .toArray();
      continue;
    }
    const indices = new Set(sels.flatMap((s) => selectedVertices(o, s)));
    o.points = o.points.map((p, i) =>
      indices.has(i) ? arr(vec(p).applyMatrix4(matrix)) : p,
    );
  }
}
export function pivot(doc, selection) {
  const b = new T.Box3();
  for (const o of doc.objects)
    for (const s of selection.filter((s) => s.id === o.id)) {
      if (o.kind === "instance") {
        for (const c of expand(doc, o))
          for (const p of c.points) b.expandByPoint(vec(p));
      } else
        for (const i of selectedVertices(o, s))
          b.expandByPoint(vec(o.points[i]));
    }
  return b.isEmpty() ? new T.Vector3() : b.getCenter(new T.Vector3());
}
export function transformMatrix(mode, axis, value, center) {
  const a = vec(axis),
    m = new T.Matrix4();
  if (mode === "move")
    return m.makeTranslation(a.x * value, a.y * value, a.z * value);
  if (mode === "rotate") m.makeRotationAxis(a, (value * Math.PI) / 180);
  else {
    const s = [1, 1, 1];
    axis.forEach((x, i) => {
      if (x) s[i] = value;
    });
    m.makeScale(...s);
  }
  return new T.Matrix4()
    .makeTranslation(...arr(center))
    .multiply(m)
    .multiply(new T.Matrix4().makeTranslation(...arr(center.clone().negate())));
}
export function makeBlock(doc, selection, name) {
  if (selection.some((s) => s.type !== "object"))
    throw Error("Block requires whole objects");
  const ids = selectionIds(doc, selection),
    os = doc.objects.filter((o) => ids.has(o.id));
  if (!os.length || os.some((o) => o.kind === "instance"))
    throw Error("Select ordinary geometry; nested blocks are not supported");
  const c = pivot(doc, selection),
    def = {
      id: uid(),
      name: name || "Block",
      objects: os.map((o) => ({
        ...clone(o),
        id: uid(),
        group: null,
        props: {
          color: effective(doc, o, "color"),
          opacity: effective(doc, o, "opacity"),
        },
        points: o.points.map((p) => arr(vec(p).sub(c))),
      })),
    };
  doc.definitions.push(def);
  doc.objects = doc.objects.filter((o) => !ids.has(o.id));
  const inst = {
    id: uid(),
    kind: "instance",
    name: def.name,
    definition: def.id,
    matrix: new T.Matrix4().makeTranslation(...arr(c)).toArray(),
    props: {},
    group: null,
    visible: true,
    locked: false,
  };
  doc.objects.push(inst);
  return inst.id;
}
