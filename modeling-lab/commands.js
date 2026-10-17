import * as T from "./vendor/three.module.min.js";
import { object, box, toLocal, toWorld, vec, arr } from "./model.js";
export const commandNames = [
  "Box",
  "Cube",
  "Line",
  "Polyline",
  "Plane",
  "SrfPt",
  "Insert",
];
export class Command {
  constructor(name, f, definition = null) {
    this.name = name;
    this.frame = f;
    this.points = [];
    this.lock = null;
    this.elevator = null;
    this.definition = definition;
    this.square = false;
  }
  prompt() {
    if (this.elevator) return "Elevator: pick or type normal elevation";
    const n = this.points.length;
    return {
      Line: n ? "End point" : "Start point",
      Polyline: n
        ? "Next vertex · Enter finish · Undo · Close"
        : "First vertex",
      Box:
        n === 0
          ? "First base corner"
          : n === 1
            ? "Opposite base corner · Shift square"
            : "Height (number or pick)",
      Cube: n ? "Opposite base corner · equal edges" : "First base corner",
      Plane: n ? "Opposite corner" : "First corner",
      SrfPt: n < 3 ? `Corner ${n + 1}` : "Fourth corner · Enter for triangle",
      Insert: "Insertion point",
    }[this.name];
  }
  pick(point, { shift = false } = {}) {
    this.points.push(point.clone());
    if (this.name === "Box" && this.points.length === 2) this.square = shift;
    return this.result(null, shift);
  }
  result(hover = null, shift = false) {
    const ps = [...this.points];
    if (hover) ps.push(hover);
    const f = this.frame,
      n = ps.length;
    switch (this.name) {
      case "Line":
        if (n >= 2) return object("line", ps.slice(0, 2));
        break;
      case "Polyline":
        if (n >= 2) return object("polyline", ps);
        break;
      case "Plane":
        if (n >= 2) {
          const a = toLocal(ps[0], f),
            b = toLocal(ps[1], f);
          return object(
            "plane",
            [a, [b[0], a[1], a[2]], [b[0], b[1], a[2]], [a[0], b[1], a[2]]].map(
              (x) => toWorld(x, f),
            ),
          );
        }
        break;
      case "SrfPt":
        if (n >= 3) return object("surface", ps.slice(0, 4));
        break;
      case "Box":
      case "Cube":
        if (n >= 2) {
          const h = n >= 3 ? ps[2].clone().sub(ps[0]).dot(f.n) : 1;
          return object(
            this.name.toLowerCase(),
            box(ps[0], ps[1], h, f, this.name === "Cube", this.square || shift),
          );
        }
        break;
      case "Insert":
        if (n)
          return {
            id: crypto.randomUUID(),
            kind: "instance",
            name: this.definition.name,
            definition: this.definition.id,
            matrix: new T.Matrix4().makeTranslation(...arr(ps[0])).toArray(),
            props: {},
            group: null,
            visible: true,
            locked: false,
          };
    }
    return null;
  }
  complete() {
    const n = this.points.length;
    return (
      (["Line", "Plane", "Cube"].includes(this.name) && n >= 2) ||
      (this.name === "Box" && n >= 3) ||
      (this.name === "SrfPt" && n >= 4) ||
      (this.name === "Insert" && n >= 1)
    );
  }
  finish() {
    const n = this.points.length;
    if (
      (this.name === "Polyline" && n >= 2) ||
      (this.name === "SrfPt" && n === 3)
    )
      return this.result();
    throw Error("More points are required");
  }
  undo() {
    this.points.pop();
    this.elevator = null;
  }
  close() {
    if (this.name !== "Polyline" || this.points.length < 3)
      throw Error("Close requires at least 3 vertices");
    this.points.push(this.points[0].clone());
    return this.result();
  }
  height(value) {
    if (this.name !== "Box" || this.points.length !== 2)
      throw Error("Height is available after the base corners");
    if (
      !Number.isFinite(value) ||
      Math.abs(value) < 1e-9 ||
      Math.abs(value) > 1e9
    )
      throw Error("Enter a nonzero finite height");
    return this.pick(
      this.points[0].clone().addScaledVector(this.frame.n, value),
    );
  }
}
