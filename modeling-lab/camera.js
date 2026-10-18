import * as T from "./vendor/three.module.min.js";
export function navigation(view, e) {
  if (e.ctrlKey && e.shiftKey) return "orbit-pointer";
  if (e.ctrlKey) return "zoom";
  if (view !== "Perspective" || e.shiftKey) return "pan";
  return "orbit";
}
export class ViewCamera {
  constructor(width = 1000, height = 700) {
    this.width = width;
    this.height = height;
    this.target = new T.Vector3(0, 0, 0);
    this.distance = 30;
    this.span = 24;
    this.view = "Perspective";
    this.direction = new T.Vector3(1, -1, 0.8).normalize();
    this.camera = new T.PerspectiveCamera(40, width / height, 0.01, 1e5);
    this.update();
  }
  update() {
    const c = this.camera;
    c.up.set(0, 0, 1);
    if (Math.abs(this.direction.z) > 0.99999) c.up.set(0, 1, 0);
    c.position.copy(this.target).addScaledVector(this.direction, this.distance);
    c.lookAt(this.target);
    if (c.isPerspectiveCamera) {
      c.aspect = this.width / this.height;
      c.near = Math.max(1e-9, this.distance / 1e5);
      c.far = Math.max(c.near * 1e7, this.distance * 1000);
    } else {
      c.left = (-this.span * this.width) / this.height / 2;
      c.right = -c.left;
      c.top = this.span / 2;
      c.bottom = -c.top;
      c.near = Math.max(1e-9, this.distance / 1e5);
      c.far = this.distance * 1000;
    }
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
  }
  resize(w, h) {
    this.width = w;
    this.height = h;
    this.update();
  }
  setView(name) {
    this.view = name;
    if (name === "Perspective") {
      this.direction.set(1, -1, 0.8).normalize();
      this.camera = new T.PerspectiveCamera(
        40,
        this.width / this.height,
        0.01,
        1e5,
      );
    } else {
      this.direction.copy(
        {
          Top: new T.Vector3(0, 0, 1),
          Front: new T.Vector3(0, -1, 0),
          Right: new T.Vector3(1, 0, 0),
        }[name],
      );
      this.camera = new T.OrthographicCamera();
    }
    this.update();
  }
  project(p) {
    const q = p.clone().project(this.camera);
    return {
      x: ((q.x + 1) * this.width) / 2,
      y: ((1 - q.y) * this.height) / 2,
      z: q.z,
    };
  }
  ray(p) {
    const r = new T.Raycaster();
    r.setFromCamera(
      new T.Vector2((p.x / this.width) * 2 - 1, 1 - (p.y / this.height) * 2),
      this.camera,
    );
    return r.ray;
  }
  onPlane(p, normal, origin) {
    return this.ray(p).intersectPlane(
      new T.Plane().setFromNormalAndCoplanarPoint(normal, origin),
      new T.Vector3(),
    );
  }
  unitsPerPixel() {
    return this.camera.isPerspectiveCamera
      ? (2 * this.distance * Math.tan(T.MathUtils.degToRad(20))) / this.height
      : this.span / this.height;
  }
  pan(dx, dy) {
    const right = new T.Vector3().setFromMatrixColumn(
        this.camera.matrixWorld,
        0,
      ),
      up = new T.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.target
      .addScaledVector(right, -dx * this.unitsPerPixel())
      .addScaledVector(up, dy * this.unitsPerPixel());
    this.update();
  }
  orbit(dx, dy) {
    const s = new T.Spherical().setFromVector3(this.direction); // Z-up via axis conversion
    const yUp = this.direction
      .clone()
      .applyAxisAngle(new T.Vector3(1, 0, 0), -Math.PI / 2);
    s.setFromVector3(yUp);
    s.theta -= dx * 0.007;
    s.phi = T.MathUtils.clamp(s.phi - dy * 0.007, 0.005, Math.PI - 0.005);
    this.direction
      .setFromSpherical(s)
      .applyAxisAngle(new T.Vector3(1, 0, 0), Math.PI / 2);
    this.update();
  }
  zoom(delta, p = { x: this.width / 2, y: this.height / 2 }, center = false) {
    const normal = this.direction.clone(),
      anchor = center ? null : this.onPlane(p, normal, this.target),
      factor = Math.exp(T.MathUtils.clamp(delta, -700, 700) * 0.0015);
    this.distance = T.MathUtils.clamp(this.distance * factor, 1e-7, 1e12);
    this.span = T.MathUtils.clamp(this.span * factor, 1e-7, 1e12);
    this.update();
    if (anchor) {
      const after = this.onPlane(p, normal, this.target);
      if (after) this.target.add(anchor.sub(after));
      this.update();
    }
  }
  frame(b) {
    if (b.isEmpty()) return;
    this.target.copy(b.getCenter(new T.Vector3()));
    const size = b.getSize(new T.Vector3()).length() || 1;
    this.span = size * 1.25;
    const fov = (40 * Math.PI) / 180;
    this.distance =
      (size * 0.65) /
      (Math.sin(fov / 2) * Math.min(1, this.width / this.height));
    this.update();
  }
  serialize() {
    return {
      view: this.view,
      target: this.target.toArray(),
      direction: this.direction.toArray(),
      distance: this.distance,
      span: this.span,
    };
  }
}
