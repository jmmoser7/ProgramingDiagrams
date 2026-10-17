import * as T from "./vendor/three.module.min.js";
import {
  CYAN,
  vec,
  arr,
  worldObjects,
  topology,
  effective,
  selectedVertices,
  pivot,
} from "./model.js";
import { eligible, segmentDistance, inside } from "./precision.js";
function line(points, color, depthTest = true) {
  const g = new T.BufferGeometry().setFromPoints(points);
  return new T.Line(
    g,
    new T.LineBasicMaterial({
      color,
      depthTest,
      transparent: !depthTest,
      opacity: 1,
    }),
  );
}
function faceMesh(o, face, color, opacity) {
  const p = o.points.map(vec),
    positions = [];
  if (face.length === 4 && o.kind === "surface") {
    const [a, b, c, d] = face.map((i) => p[i]),
      steps = 12;
    const at = (u, v) =>
      a
        .clone()
        .multiplyScalar((1 - u) * (1 - v))
        .addScaledVector(b, u * (1 - v))
        .addScaledVector(c, u * v)
        .addScaledVector(d, (1 - u) * v);
    for (let i = 0; i < steps; i++)
      for (let j = 0; j < steps; j++) {
        const u = i / steps,
          v = j / steps,
          h = 1 / steps;
        for (const q of [
          at(u, v),
          at(u + h, v),
          at(u + h, v + h),
          at(u, v),
          at(u + h, v + h),
          at(u, v + h),
        ])
          positions.push(...arr(q));
      }
  } else
    for (let i = 1; i < face.length - 1; i++)
      for (const index of [face[0], face[i], face[i + 1]])
        positions.push(...o.points[index]);
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return new T.Mesh(
    g,
    new T.MeshStandardMaterial({
      color,
      roughness: 0.8,
      metalness: 0,
      side: T.DoubleSide,
      transparent: opacity < 1,
      opacity,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
  );
}
export class RenderScene {
  constructor(container, view) {
    this.view = view;
    this.renderer = new T.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "low-power",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    this.renderer.setClearColor("#edf0f1");
    container.append(this.renderer.domElement);
    this.canvas = this.renderer.domElement;
    this.scene = new T.Scene();
    this.scene.add(new T.HemisphereLight(0xffffff, 0x718291, 2.2));
    const sun = new T.DirectionalLight(0xffffff, 2.3);
    sun.position.set(-10, -20, 35);
    this.scene.add(sun);
    this.root = new T.Group();
    this.overlay = new T.Group();
    this.grid = new T.Group();
    this.scene.add(this.root, this.overlay, this.grid);
    this.picks = [];
  }
  disposeGroup(group) {
    group.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) {
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          m.dispose();
      }
    });
    group.clear();
  }
  resize(w, h) {
    this.renderer.setSize(w, h);
  }
  setGrid(f, size = 1) {
    this.disposeGroup(this.grid);
    const extent = 20;
    for (let i = -extent; i <= extent; i++) {
      const color = i === 0 ? "#a4b2b6" : i % 5 === 0 ? "#c2cbce" : "#dce1e3";
      for (const swap of [false, true]) {
        const a = f.origin
            .clone()
            .addScaledVector(swap ? f.v : f.u, i * size)
            .addScaledVector(swap ? f.u : f.v, -extent * size),
          b = a.clone().addScaledVector(swap ? f.u : f.v, extent * size * 2);
        this.grid.add(line([a, b], color));
      }
    }
  }
  rebuild(doc, selection, hover = null, preview = null) {
    this.disposeGroup(this.root);
    this.disposeGroup(this.overlay);
    this.picks = [];
    for (const o of worldObjects(doc)) {
      if (!o.visible) continue;
      const t = topology(o),
        parent = doc.objects.find((x) => x.id === o.id),
        color = o.props.color ?? effective(doc, parent, "color"),
        opacity = o.props.opacity ?? effective(doc, parent, "opacity");
      t.faces.forEach((face, index) => {
        const mesh = faceMesh(o, face, color, opacity);
        mesh.userData = { id: o.id, type: "face", index };
        this.root.add(mesh);
        this.picks.push(mesh);
      });
      for (const [index, [i, j]] of t.edges.entries()) {
        const edge = line(
          [vec(o.points[i]), vec(o.points[j])],
          o.locked ? "#a4adb2" : t.faces.length ? "#607783" : color,
        );
        edge.material.opacity = opacity;
        edge.material.transparent = opacity < 1;
        edge.userData = { id: o.id, type: "edge", index };
        this.root.add(edge);
        this.picks.push(edge);
      }
      const sels = selection.filter((s) => s.id === o.id);
      if (hover?.id === o.id) sels.push({ ...hover, hover: true });
      for (const s of sels) {
        const color = s.hover ? "#334950" : CYAN;
        if (s.type === "object") {
          for (const [i, j] of t.edges)
            this.overlay.add(
              line([vec(o.points[i]), vec(o.points[j])], color, false),
            );
        } else if (s.type === "edge") {
          const e = t.edges[s.index];
          if (e)
            this.overlay.add(
              line(
                e.map((i) => vec(o.points[i])),
                color,
                false,
              ),
            );
        } else if (s.type === "face") {
          const face = t.faces[s.index];
          if (face) {
            const mesh = faceMesh(o, face, color, 0.32);
            mesh.material.depthTest = false;
            mesh.renderOrder = 10;
            this.overlay.add(mesh);
            this.overlay.add(
              line(
                [...face, face[0]].map((i) => vec(o.points[i])),
                color,
                false,
              ),
            );
          }
        } else if (s.type === "vertex" && o.points[s.index]) {
          const g = new T.BufferGeometry().setFromPoints([
            vec(o.points[s.index]),
          ]);
          this.overlay.add(
            new T.Points(
              g,
              new T.PointsMaterial({
                color,
                size: 9,
                depthTest: false,
                sizeAttenuation: false,
              }),
            ),
          );
        }
      }
    }
    if (preview) {
      const fake = { ...preview, id: "preview" };
      if (fake.points) {
        const t = topology(fake);
        for (const face of t.faces) {
          const mesh = faceMesh(fake, face, "#57ada8", 0.23);
          this.overlay.add(mesh);
        }
        for (const [i, j] of t.edges)
          this.overlay.add(
            line([vec(fake.points[i]), vec(fake.points[j])], "#167e79", false),
          );
      }
    }
  }
  pick(doc, p, settings, components = false, type = "edge") {
    const raycaster = new T.Raycaster();
    raycaster.setFromCamera(
      new T.Vector2(
        (p.x / this.view.width) * 2 - 1,
        1 - (p.y / this.view.height) * 2,
      ),
      this.view.camera,
    );
    raycaster.params.Line.threshold =
      this.view.unitsPerPixel() * settings.hitRadius;
    const hits = raycaster.intersectObjects(this.picks, false).filter((h) =>
      eligible(
        doc.objects.find((o) => o.id === h.object.userData.id),
        settings.filter,
      ),
    );
    if (!components)
      return hits.length
        ? {
            id: hits[0].object.userData.id,
            type: "object",
            point: hits[0].point,
          }
        : null;
    let best = null;
    for (const o of worldObjects(doc)) {
      if (
        !eligible(o, settings.filter) ||
        doc.objects.find((x) => x.id === o.id)?.kind === "instance"
      )
        continue;
      const ps = o.points.map((x) => this.view.project(vec(x))),
        sets =
          type === "vertex"
            ? ps.map((_, i) => [i])
            : type === "face"
              ? topology(o).faces
              : topology(o).edges;
      for (let i = 0; i < sets.length; i++) {
        const indices = sets[i],
          poly = indices.map((i) => ps[i]);
        let d = Infinity;
        if (poly.some((p) => p.z < -1 || p.z > 1)) continue;
        if (type === "vertex") d = Math.hypot(p.x - poly[0].x, p.y - poly[0].y);
        else if (type === "edge") d = segmentDistance(p, ...poly).distance;
        else if (inside(p, poly)) d = 0;
        const depth = poly.reduce((a, b) => a + b.z, 0) / poly.length;
        if (
          d <= settings.hitRadius &&
          (!best ||
            d < best.d - 0.1 ||
            (Math.abs(d - best.d) < 0.1 && depth < best.depth))
        )
          best = { id: o.id, type, index: i, d, depth };
      }
    }
    return best;
  }
  draw() {
    this.renderer.render(this.scene, this.view.camera);
  }
}
// Screen-sized Gumball drawn over actual projected XYZ axes. No controls own camera gestures.
export class Gumball {
  constructor(svg, view) {
    this.svg = svg;
    this.view = view;
    this.handles = [];
  }
  draw(doc, selection, mode, enabled = true) {
    this.svg.replaceChildren();
    this.handles = [];
    if (!selection.length || !enabled) return;
    const c = pivot(doc, selection),
      origin = this.view.project(c),
      length = this.view.unitsPerPixel() * 78,
      axes = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      colors = ["#dc6059", "#409c71", "#447fe0"];
    const add = (tag, attrs) => {
      const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      this.svg.append(e);
      return e;
    };
    axes.forEach((axis, index) => {
      const v = vec(axis),
        end = this.view.project(c.clone().addScaledVector(v, length));
      if (mode === "rotate") {
        const u = vec(axes[(index + 1) % 3]),
          w = vec(axes[(index + 2) % 3]),
          pts = Array.from({ length: 65 }, (_, i) =>
            this.view.project(
              c
                .clone()
                .addScaledVector(
                  u,
                  Math.cos((i / 64) * Math.PI * 2) * length * 0.72,
                )
                .addScaledVector(
                  w,
                  Math.sin((i / 64) * Math.PI * 2) * length * 0.72,
                ),
            ),
          );
        add("polyline", {
          points: pts.map((p) => `${p.x},${p.y}`).join(" "),
          fill: "none",
          stroke: colors[index],
          "stroke-width": 2,
        });
        this.handles.push({
          axis,
          index,
          points: pts,
          center: c,
          origin,
          length,
        });
      } else {
        add("line", {
          x1: origin.x,
          y1: origin.y,
          x2: end.x,
          y2: end.y,
          stroke: colors[index],
          "stroke-width": 2,
        });
        if (mode === "scale")
          add("rect", {
            x: end.x - 4,
            y: end.y - 4,
            width: 8,
            height: 8,
            fill: colors[index],
          });
        else add("circle", { cx: end.x, cy: end.y, r: 5, fill: colors[index] });
        add("text", {
          x: end.x + 8,
          y: end.y - 5,
          fill: colors[index],
          "font-size": 11,
        }).textContent = "XYZ"[index];
        this.handles.push({
          axis,
          index,
          points: [end],
          center: c,
          origin,
          end,
          length,
        });
      }
    });
    add("circle", {
      cx: origin.x,
      cy: origin.y,
      r: 3,
      fill: "#fff",
      stroke: "#627784",
    });
  }
  hit(p) {
    let best = null;
    for (const h of this.handles) {
      let d = Infinity;
      if (h.points.length === 1) d = Math.hypot(h.end.x - p.x, h.end.y - p.y);
      else
        for (let i = 1; i < h.points.length; i++)
          d = Math.min(
            d,
            segmentDistance(p, h.points[i - 1], h.points[i]).distance,
          );
      if (d < 9 && (!best || d < best.d)) best = { ...h, d };
    }
    return best;
  }
  value(h, start, p, mode) {
    if (mode === "rotate") {
      const normal = vec(h.axis),
        a = this.view.onPlane(start, normal, h.center),
        b = this.view.onPlane(p, normal, h.center);
      if (a && b) {
        const u = a.sub(h.center).normalize(),
          v = b.sub(h.center).normalize();
        return T.MathUtils.radToDeg(
          Math.atan2(normal.dot(new T.Vector3().crossVectors(u, v)), u.dot(v)),
        );
      }
      const a0 = Math.atan2(start.y - h.origin.y, start.x - h.origin.x),
        b0 = Math.atan2(p.y - h.origin.y, p.x - h.origin.x);
      return T.MathUtils.radToDeg(b0 - a0);
    }
    let dx = h.end.x - h.origin.x,
      dy = h.end.y - h.origin.y,
      den = dx * dx + dy * dy;
    if (den < 36) {
      dx = 0;
      dy = -78;
      den = 78 * 78;
    }
    const amount = ((p.x - start.x) * dx + (p.y - start.y) * dy) / den;
    return mode === "scale" ? Math.max(0.001, 1 + amount) : amount * h.length;
  }
}
