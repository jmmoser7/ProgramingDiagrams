import * as T from "./vendor/three.module.min.js";
import {
  CYAN,
  vec,
  arr,
  plane,
  toLocal,
  toWorld,
  clone,
  uid,
  object,
  sample,
  blank,
  validate,
  History,
  bounds,
  effective,
  groupIds,
  selectionIds,
  transform,
  pivot,
  transformMatrix,
  makeBlock,
} from "./model.js";
import { ViewCamera, navigation } from "./camera.js";
import {
  coordinates,
  snap,
  constrained,
  elevatorPoint,
  marquee,
  eligible,
} from "./precision.js";
import { Command, commandNames } from "./commands.js";
import { RenderScene, Gumball } from "./render.js";
const $ = (id) => document.getElementById(id),
  viewport = $("viewport"),
  view = new ViewCamera(),
  history = new History(sample());
let renderer;
try {
  renderer = new RenderScene(viewport, view);
} catch (e) {
  $("error").hidden = false;
  $("error").textContent = "WebGL initialization failed: " + e.message;
  throw e;
}
const gumball = new Gumball($("gumball"), view),
  accepted = window.InteractionAcceptedPreferences?.cases;
// Published preferences are read only. This app never contacts the lab feedback worker.
const base = accepted?.["snap-end"]?.settings || {},
  componentBase = accepted?.["subobject-edge"]?.settings || {};
const settings = {
  snap: true,
  grid: false,
  gridSize: 1,
  ortho: false,
  angle: 45,
  smart: true,
  project: false,
  filter: "all",
  snapRadius: base.snapRadius || 16,
  hitRadius: base.hitRadius || 8,
  dragThreshold: base.dragThreshold || 12,
  hoverDelay: base.hoverDelay || 80,
  prehighlight: base.prehighlight ?? false,
};
let selection = [],
  cmd = null,
  lastCommand = "Box",
  mode = "move",
  component = "edge",
  pointer = { x: 0, y: 0 },
  resolved = null,
  raw = null,
  snapResult = null,
  drag = null,
  hover = null,
  hoverTimer = null,
  trackTimer = null,
  trackKey = "",
  tracks = [],
  activeGuides = [],
  targetMode = false,
  dirty = true,
  scheduled = false,
  framesRendered = 0,
  errorTimer,
  shiftHeld = false;
const cplanes = {
  Perspective: { name: "XY", elevation: 0 },
  Top: { name: "XY", elevation: 0 },
  Front: { name: "XZ", elevation: 0 },
  Right: { name: "YZ", elevation: 0 },
};
const f = () => plane(cplanes[view.view].name, cplanes[view.view].elevation);
const same = (a, b) =>
  a.id === b.id && a.type === b.type && a.index === b.index;
const clean = (s) => ({
  id: s.id,
  type: s.type,
  ...(s.index !== undefined ? { index: s.index } : {}),
});
function message(text) {
  $("error").textContent = text;
  $("error").hidden = false;
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => ($("error").hidden = true), 5000);
}
function guarded(fn) {
  try {
    return fn();
  } catch (e) {
    message(e.message);
    return null;
  }
}
function request(rebuild = false) {
  dirty ||= rebuild;
  if (!scheduled && !document.hidden) {
    scheduled = true;
    requestAnimationFrame(draw);
  }
}
function draw() {
  scheduled = false;
  if (document.hidden) return;
  if (dirty) {
    let preview = cmd?.result(resolved, shiftHeld);
    if (cmd?.name === "Box" && cmd.points.length === 2 && resolved) {
      preview = cmd.result(resolved);
    }
    renderer.rebuild(
      history.doc,
      selection,
      settings.prehighlight || hover?.type !== "object" ? hover : null,
      preview,
    );
    dirty = false;
  }
  gumball.draw(history.doc, selection, mode, !cmd && !targetMode);
  drawGuides();
  renderer.draw();
  framesRendered++;
  $("status").textContent =
    `WebGL 2 · ${view.view}${view.camera.isOrthographicCamera ? " / parallel" : ""} · ${history.doc.objects.length} objects · ${selection.length} selected · ${cmd ? "Point acquisition" : "Selection"} · ${settings.project ? "Projected snaps" : "True XYZ snaps"}`;
}
function drawGuides() {
  const svg = $("guides");
  svg.replaceChildren();
  function add(a, b) {
    const p = view.project(a),
      q = view.project(b),
      el = document.createElementNS("http://www.w3.org/2000/svg", "line");
    for (const [k, v] of Object.entries({
      x1: p.x,
      y1: p.y,
      x2: q.x,
      y2: q.y,
      stroke: "#83a9a4",
      "stroke-width": 1,
      "stroke-dasharray": "4 5",
    }))
      el.setAttribute(k, v);
    svg.append(el);
  }
  const frame = f();
  if (cmd && resolved) {
    for (const g of activeGuides) add(g, resolved);
    if (cmd.lock && cmd.points.length) {
      const a = cmd.points.at(-1),
        length = view.unitsPerPixel() * 300;
      add(
        a.clone().addScaledVector(cmd.lock, -length),
        a.clone().addScaledVector(cmd.lock, length),
      );
    }
    if (cmd.elevator) add(cmd.elevator, resolved);
    if (snapResult?.source) add(snapResult.source, resolved);
  }
  const marker = $("marker");
  marker.hidden = !cmd || !resolved;
  if (!marker.hidden) {
    const p = view.project(resolved);
    marker.style.left = p.x + "px";
    marker.style.top = p.y + "px";
    marker.querySelector("span").textContent = cmd.elevator
      ? "Elevator"
      : snapResult?.label ||
        (activeGuides.length
          ? "SmartTrack"
          : cmd.lock
            ? "Direction locked"
            : settings.grid
              ? "Grid"
              : "CPlane");
  }
}
function resize() {
  const { width, height } = viewport.getBoundingClientRect();
  view.resize(width, height);
  renderer.resize(width, height);
  request();
}
new ResizeObserver(resize).observe(viewport);
function updatePrompt() {
  const name = cmd?.name || "Ready";
  $("prompt").replaceChildren();
  const b = document.createElement("b");
  b.textContent = name;
  $("prompt").append(
    b,
    document.createTextNode(
      targetMode
        ? "Pick geometry or a CPlane point for the camera target"
        : cmd
          ? cmd.prompt()
          : "Select geometry or start a command.",
    ),
  );
  $("direction").textContent = "Tab lock: " + (cmd?.lock ? "on" : "off");
  document
    .querySelectorAll("[data-command]")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.command === cmd?.name),
    );
}
function refresh() {
  selection = selection.filter((s) =>
    history.doc.objects.some((o) => o.id === s.id && !o.locked && o.visible),
  );
  tree();
  inspector();
  $("undo").disabled = !history.past.length;
  $("redo").disabled = !history.future.length;
  $("count").textContent = history.doc.objects.length;
  const defs = $("definitions"),
    current = defs.value;
  defs.replaceChildren();
  if (!history.doc.definitions.length) {
    const o = document.createElement("option");
    o.value = "";
    o.textContent = "No blocks";
    defs.append(o);
  }
  for (const def of history.doc.definitions) {
    const o = document.createElement("option");
    o.value = def.id;
    o.textContent = def.name;
    defs.append(o);
  }
  if (history.doc.definitions.some((x) => x.id === current))
    defs.value = current;
  updatePrompt();
  request(true);
}
function mutate(fn) {
  guarded(() => {
    history.commit(fn);
    refresh();
  });
}
function tree() {
  const root = $("tree");
  root.replaceChildren();
  for (const o of history.doc.objects) {
    const row = document.createElement("div");
    row.className =
      "tree-row" + (selection.some((s) => s.id === o.id) ? " selected" : "");
    const name = document.createElement("button");
    name.className = "object-name";
    name.textContent =
      (o.kind === "instance"
        ? "▧ "
        : ["line", "polyline"].includes(o.kind)
          ? "⌁ "
          : "◇ ") + o.name;
    name.title = o.kind + (o.group ? " · grouped" : "");
    name.onclick = (e) => {
      if (!eligible(o, settings.filter)) return;
      choose([{ id: o.id, type: "object" }], e);
      viewport.focus();
    };
    const vis = document.createElement("button");
    vis.textContent = o.visible ? "◉" : "○";
    vis.title = "Toggle visibility";
    vis.onclick = () =>
      mutate((d) => {
        d.objects.find((x) => x.id === o.id).visible = !o.visible;
      });
    const lock = document.createElement("button");
    lock.textContent = o.locked ? "▣" : "▫";
    lock.title = "Toggle lock";
    lock.onclick = () =>
      mutate((d) => {
        d.objects.find((x) => x.id === o.id).locked = !o.locked;
      });
    row.append(name, vis, lock);
    root.append(row);
  }
}
function inspector() {
  const ids = selectionIds(history.doc, selection),
    os = history.doc.objects.filter((o) => ids.has(o.id)),
    scope = $("scope").value,
    gids = new Set(os.map((o) => o.group).filter(Boolean)),
    groups = history.doc.groups.filter((g) => gids.has(g.id));
  const documentScope = scope === "document" || !os.length,
    groupScope = scope === "groups" && !documentScope;
  $("selection-title").textContent = documentScope
    ? "Document defaults"
    : groupScope
      ? `${groups.length} selected groups`
      : `${os.length} ${selection.some((s) => s.type !== "object") ? "component owners" : "objects"}`;
  const common = (key) => {
    const values = documentScope
      ? [history.doc.defaults[key]]
      : groupScope
        ? groups.map((g) => g.props[key] ?? history.doc.defaults[key])
        : os.map((o) => effective(history.doc, o, key));
    return values.length && values.every((x) => x === values[0])
      ? values[0]
      : null;
  };
  const color = common("color"),
    opacity = common("opacity");
  $("color").value = color || "#c5d0d7";
  $("color").title = color ? "Common effective color" : "Mixed colors";
  $("opacity").value = opacity ?? "";
  $("opacity").placeholder = "Mixed";
  $("name").value =
    !documentScope && !groupScope && os.length === 1 ? os[0].name : "";
  $("name").disabled = documentScope || groupScope || os.length !== 1;
  $("property-source").textContent =
    groupScope && !groups.length
      ? "Select grouped objects to edit group styles."
      : color === null || opacity === null
        ? "Mixed values · edit only the property to unify."
        : "Object → group → document inheritance. Unrelated overrides stay intact.";
  $("pivot").textContent =
    "Pivot XYZ: " +
    arr(pivot(history.doc, selection))
      .map((x) => x.toFixed(2))
      .join(", ");
}
function stylePatch(key, value) {
  mutate((d) => {
    const scope = $("scope").value,
      ids = selectionIds(d, selection),
      os = d.objects.filter((o) => ids.has(o.id));
    if (scope === "document" || !os.length) d.defaults[key] = value;
    else if (scope === "groups") {
      const gids = new Set(os.map((o) => o.group).filter(Boolean));
      if (!gids.size) throw Error("Selection has no groups");
      for (const g of d.groups) if (gids.has(g.id)) g.props[key] = value;
    } else for (const o of os) o.props[key] = value;
  });
}
function choose(hits, e = {}) {
  const components =
    (e.ctrlKey && e.shiftKey) || settings.filter === "components";
  let expanded = hits.flatMap((s) =>
    s.type === "object" && !components
      ? groupIds(history.doc, s.id).map((id) => ({ id, type: "object" }))
      : [clean(s)],
  );
  expanded = [...new Map(expanded.map((s) => [JSON.stringify(s), s])).values()];
  if (e.ctrlKey && !e.shiftKey) {
    selection = selection.filter(
      (s) =>
        !expanded.some(
          (x) => same(s, x) || (x.type === "object" && x.id === s.id),
        ),
    );
  } else if (e.shiftKey || components) {
    for (const s of expanded) {
      selection = selection.filter(
        (x) =>
          x.id !== s.id ||
          (s.type === "object" ? x.type === "object" : x.type !== "object"),
      );
      const index = selection.findIndex((x) => same(s, x));
      if (components && index >= 0) selection.splice(index, 1);
      else if (index < 0) selection.push(s);
    }
  } else selection = expanded;
  refresh();
}
function start(name) {
  if (!commandNames.includes(name)) throw Error("Unknown command " + name);
  if (drag?.kind === "transform") cancelDrag();
  const definition =
    name === "Insert"
      ? history.doc.definitions.find((x) => x.id === $("definitions").value)
      : null;
  if (name === "Insert" && !definition) throw Error("Make a Block first");
  cmd = new Command(name, f(), definition);
  lastCommand = name;
  targetMode = false;
  tracks = [];
  resolved = null;
  snapResult = null;
  clearTimeout(trackTimer);
  $("command").value = "";
  viewport.focus();
  updatePrompt();
  request(true);
}
function finishObject(o) {
  if (!o) return;
  mutate((d) => {
    d.objects.push(o);
  });
  cmd = null;
  resolved = null;
  tracks = [];
  clearTimeout(trackTimer);
  selection = [{ id: o.id, type: "object" }];
  $("command").value = "";
  refresh();
}
function cancel() {
  if (drag?.kind === "transform") {
    cancelDrag();
    return;
  }
  if (cmd || targetMode) {
    cmd = null;
    targetMode = false;
    resolved = null;
    tracks = [];
    clearTimeout(trackTimer);
    $("command").value = "";
    updatePrompt();
    request(true);
  } else {
    selection = [];
    refresh();
  }
  $("recent").hidden = true;
}
function accept() {
  guarded(() => {
    if (targetMode) {
      if (resolved) {
        view.target.copy(resolved);
        view.update();
        targetMode = false;
        updatePrompt();
        request();
      }
      return;
    }
    if (cmd) {
      if (cmd.elevator) {
        if (resolved) {
          const q = resolved.clone();
          cmd.elevator = null;
          pickPoint(q);
        }
        return;
      }
      if (
        cmd.name === "Polyline" ||
        (cmd.name === "SrfPt" && cmd.points.length === 3)
      )
        finishObject(cmd.finish());
      else if (resolved) pickPoint(resolved);
      else throw Error("Pick or type the next point");
    } else start(lastCommand);
  });
}
function pickPoint(p, e = {}) {
  const result = cmd.pick(p, { shift: e.shiftKey });
  if (cmd.complete()) finishObject(result);
  else {
    updatePrompt();
    resolvePointer(e);
    request(true);
  }
}
function resolvePointer(e = {}) {
  if (!cmd && !targetMode) return;
  const frame = f();
  raw = view.onPlane(pointer, frame.n, frame.origin);
  activeGuides = [];
  if (cmd?.elevator) {
    resolved = elevatorPoint(view, pointer, cmd.elevator, frame);
    snapResult = null;
  } else if (cmd?.name === "Box" && cmd.points.length === 2) {
    resolved = elevatorPoint(view, pointer, cmd.points[1], cmd.frame);
    snapResult = null;
  } else {
    snapResult = snap(
      history.doc,
      view,
      pointer,
      frame,
      { ...settings, snap: settings.snap !== !!e.altKey },
      raw,
      cmd?.points.at(-1),
    );
    resolved = snapResult?.point.clone() || raw;
    if (!resolved) return;
    const previous = cmd?.points.at(-1);
    if (!snapResult && settings.grid) {
      const p = toLocal(resolved, frame);
      resolved = toWorld(
        [
          Math.round(p[0] / settings.gridSize) * settings.gridSize,
          Math.round(p[1] / settings.gridSize) * settings.gridSize,
          p[2],
        ],
        frame,
      );
    }
    if (!snapResult && settings.smart && cmd) {
      for (const q of tracks) {
        const l = toLocal(resolved, frame),
          t = toLocal(q, frame);
        for (let axis = 0; axis < 2; axis++) {
          const test = [...l];
          test[axis] = t[axis];
          const point = toWorld(test, frame),
            s = view.project(point);
          if (Math.hypot(s.x - pointer.x, s.y - pointer.y) < 9) {
            resolved = point;
            activeGuides.push(q);
          }
        }
      }
    }
    if (cmd && previous) {
      const constrainedPoint = constrained(resolved, previous, frame, {
        lock: cmd.lock,
        ortho: settings.ortho !== !!e.shiftKey,
        angle: settings.angle,
      });
      if (constrainedPoint.distanceTo(resolved) > 1e-7) snapResult = null;
      resolved = constrainedPoint;
    }
  }
  if (resolved) {
    $("coordinates").textContent =
      "World " +
      arr(resolved)
        .map((x) => x.toFixed(3))
        .join(", ") +
      "  |  CP " +
      toLocal(resolved, frame)
        .map((x) => x.toFixed(3))
        .join(", ");
    if (cmd && settings.smart && snapResult && !cmd.elevator) {
      const key = arr(snapResult.point).join(",");
      if (key !== trackKey) {
        clearTimeout(trackTimer);
        trackKey = key;
        const point = snapResult.point.clone();
        trackTimer = setTimeout(() => {
          if (cmd && settings.smart) {
            tracks.push(point);
            tracks = tracks.slice(-4);
          }
        }, 450);
      }
    } else {
      clearTimeout(trackTimer);
      trackKey = "";
    }
  }
}
function eventPoint(e) {
  const r = viewport.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
viewport.addEventListener("contextmenu", (e) => e.preventDefault());
viewport.addEventListener("pointerdown", (e) => {
  if (e.target !== renderer.canvas) return;
  e.preventDefault();
  viewport.focus();
  pointer = eventPoint(e);
  viewport.setPointerCapture(e.pointerId);
  clearTimeout(hoverTimer);
  hover = null;
  if (e.button === 2) {
    const nav = navigation(view.view, e);
    if (nav === "orbit-pointer") {
      const h = renderer.pick(history.doc, pointer, {
        ...settings,
        filter: "all",
      });
      if (h?.point) {
        view.target.copy(h.point);
        view.direction
          .copy(view.camera.position.clone().sub(view.target))
          .normalize();
        view.distance = view.camera.position.distanceTo(view.target);
        view.update();
      }
    }
    drag = {
      kind: "nav",
      start: { ...pointer },
      last: { ...pointer },
      moved: false,
    };
    return;
  }
  if (e.button === 1) {
    drag = { kind: "middle", start: { ...pointer }, moved: false };
    return;
  }
  if (e.button !== 0) return;
  if (cmd || targetMode) {
    drag = {
      kind: "point",
      start: { ...pointer },
      event: { ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey },
      moved: false,
    };
    return;
  }
  const handle = gumball.hit(pointer);
  if (handle) {
    drag = {
      kind: "transform",
      start: { ...pointer },
      handle,
      before: clone(history.doc),
      moved: false,
    };
    $("axis").value = "XYZ"[handle.index];
    return;
  }
  drag = {
    kind: "select",
    start: { ...pointer },
    last: { ...pointer },
    event: { ctrlKey: e.ctrlKey, shiftKey: e.shiftKey },
    moved: false,
  };
});
viewport.addEventListener("pointermove", (e) => {
  pointer = eventPoint(e);
  shiftHeld = e.shiftKey;
  const d = drag;
  if (d) {
    if (
      Math.hypot(pointer.x - d.start.x, pointer.y - d.start.y) >
      settings.dragThreshold
    )
      d.moved = true;
    if (d.kind === "nav") {
      if (d.moved) {
        const dx = pointer.x - d.last.x,
          dy = pointer.y - d.last.y,
          nav = navigation(view.view, e);
        if (nav === "zoom") view.zoom(dy * 5, undefined, true);
        else if (nav === "pan") view.pan(dx, dy);
        else view.orbit(dx, dy);
        d.last = { ...pointer };
        renderer.canvas.style.cursor = nav === "pan" ? "grabbing" : "move";
        if (cmd) resolvePointer(e);
        request();
      }
      return;
    }
    if (d.kind === "middle") return;
    if (d.kind === "transform") {
      if (d.moved) {
        history.doc = clone(d.before);
        const value = gumball.value(d.handle, d.start, pointer, mode);
        transform(
          history.doc,
          selection,
          transformMatrix(mode, d.handle.axis, value, d.handle.center),
        );
        $("transform-value").value = value.toFixed(4);
        request(true);
      }
      return;
    }
    if (d.kind === "select" && d.moved) {
      const el = $("marquee");
      el.hidden = false;
      el.classList.toggle("crossing", pointer.x < d.start.x);
      Object.assign(el.style, {
        left: Math.min(pointer.x, d.start.x) + "px",
        top: Math.min(pointer.y, d.start.y) + "px",
        width: Math.abs(pointer.x - d.start.x) + "px",
        height: Math.abs(pointer.y - d.start.y) + "px",
      });
      return;
    }
  }
  if (cmd || targetMode) {
    resolvePointer(e);
    renderer.canvas.style.cursor = "crosshair";
    request(true);
  } else {
    const h = gumball.hit(pointer);
    if (h) {
      renderer.canvas.style.cursor = "move";
      return;
    }
    const hit = renderer.pick(
      history.doc,
      pointer,
      settings,
      (e.ctrlKey && e.shiftKey) || settings.filter === "components",
      component,
    );
    renderer.canvas.style.cursor =
      hit && $("preset").value === "discovery" ? "pointer" : "auto";
    clearTimeout(hoverTimer);
    if (settings.prehighlight || hit?.type !== "object") {
      hoverTimer = setTimeout(() => {
        hover = hit ? clean(hit) : null;
        request(true);
      }, settings.hoverDelay);
    }
  }
});
viewport.addEventListener("pointerup", (e) => {
  const d = drag;
  if (!d) return;
  pointer = eventPoint(e);
  drag = null;
  try {
    viewport.releasePointerCapture(e.pointerId);
  } catch {}
  $("marquee").hidden = true;
  renderer.canvas.style.cursor = cmd ? "crosshair" : "auto";
  if (d.kind === "nav") {
    if (!d.moved && !e.ctrlKey && !e.shiftKey) accept();
    request();
    return;
  }
  if (d.kind === "middle") {
    if (!d.moved) {
      const r = $("recent");
      r.replaceChildren();
      for (const name of [
        lastCommand,
        ...commandNames.filter((n) => n !== lastCommand),
      ].slice(0, 6)) {
        const b = document.createElement("button");
        b.textContent = name;
        b.onclick = () =>
          guarded(() => {
            r.hidden = true;
            start(name);
          });
        r.append(b);
      }
      r.hidden = false;
    }
    return;
  }
  if (d.kind === "transform") {
    if (d.moved) {
      const after = clone(history.doc);
      history.doc = d.before;
      mutate((doc) => Object.assign(doc, after));
    } else {
      $("transform-value").focus();
      $("transform-value").select();
    }
    return;
  }
  if (d.kind === "point") {
    if (!cmd && !targetMode) return;
    resolvePointer(e);
    if (!resolved) return;
    if (targetMode) {
      const hit = renderer.pick(history.doc, pointer, {
        ...settings,
        filter: "all",
      });
      view.target.copy(hit?.point || resolved);
      view.direction
        .copy(view.camera.position.clone().sub(view.target))
        .normalize();
      view.distance = view.camera.position.distanceTo(view.target);
      view.update();
      targetMode = false;
      updatePrompt();
      request();
      return;
    }
    if (cmd.elevator) {
      const p = resolved.clone();
      cmd.elevator = null;
      guarded(() => pickPoint(p, e));
    } else if (d.event.ctrlKey) {
      cmd.elevator = resolved.clone();
      updatePrompt();
      request(true);
    } else guarded(() => pickPoint(resolved, e));
    return;
  }
  if (d.kind === "select") {
    const modifiers = d.event,
      components =
        (modifiers.ctrlKey && modifiers.shiftKey) ||
        settings.filter === "components",
      hits = d.moved
        ? marquee(
            history.doc,
            view,
            d.start,
            pointer,
            components,
            settings.filter,
            component,
          )
        : [
            renderer.pick(
              history.doc,
              pointer,
              settings,
              components,
              component,
            ),
          ].filter(Boolean);
    choose(hits, modifiers);
  }
});
function cancelDrag() {
  if (drag?.kind === "transform") history.doc = drag.before;
  drag = null;
  $("marquee").hidden = true;
  refresh();
}
viewport.addEventListener("pointercancel", cancelDrag);
viewport.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    pointer = eventPoint(e);
    view.zoom(e.deltaY, pointer, e.ctrlKey);
    if (cmd) resolvePointer(e);
    request(!!cmd);
  },
  { passive: false },
);
function parseCommand(text) {
  guarded(() => {
    const value = text.trim(),
      lower = value.toLowerCase();
    if (!value) {
      accept();
      return;
    }
    $("command").value = "";
    if (cmd) {
      if (lower === "undo") {
        cmd.undo();
        updatePrompt();
        request(true);
        return;
      }
      if (lower === "close") {
        finishObject(cmd.close());
        return;
      }
      if (value.includes(",")) {
        pickPoint(coordinates(value, f(), cmd.points.at(-1)));
        return;
      }
      const number = Number(value);
      if (Number.isFinite(number)) {
        if (cmd.elevator) {
          const p = cmd.elevator.clone().addScaledVector(f().n, number);
          cmd.elevator = null;
          pickPoint(p);
          return;
        }
        if (cmd.name === "Box" && cmd.points.length === 2) {
          finishObject(cmd.height(number));
          return;
        }
        if (cmd.points.length && resolved) {
          const anchor = cmd.points.at(-1),
            dir = resolved.clone().sub(anchor).normalize();
          if (dir.lengthSq() === 0)
            throw Error("Aim a direction before entering length");
          pickPoint(anchor.clone().addScaledVector(dir, number));
          return;
        }
      }
      throw Error("Expected coordinates, length, Undo, Close or Enter");
    }
    if (lower === "ze") {
      view.frame(bounds(history.doc));
      request();
      return;
    }
    if (lower === "zs") {
      view.frame(bounds(history.doc, selectionIds(history.doc, selection)));
      request();
      return;
    }
    const name = commandNames.find((n) => n.toLowerCase() === lower);
    if (name) {
      start(name);
      return;
    }
    throw Error("Unknown command: " + value);
  });
}
$("command").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    parseCommand(e.target.value);
  }
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    cancel();
    viewport.focus();
  }
});
document.addEventListener("keydown", (e) => {
  const input = e.target.closest(
    "input,textarea,select,[contenteditable=true]",
  );
  if (input) return;
  if ($("guide").open) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.key === "Escape") {
    e.preventDefault();
    cancel();
    return;
  }
  if (ctrl && e.shiftKey && e.key.toLowerCase() === "e") {
    e.preventDefault();
    view.frame(bounds(history.doc));
    request();
    return;
  }
  if (ctrl && e.key.toLowerCase() === "s") {
    e.preventDefault();
    save();
    return;
  }
  if (ctrl && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (cmd) {
      cmd.undo();
      updatePrompt();
      request(true);
    } else {
      if (e.shiftKey) history.redo();
      else history.undo();
      refresh();
    }
    return;
  }
  if (ctrl && e.key.toLowerCase() === "y") {
    e.preventDefault();
    history.redo();
    refresh();
    return;
  }
  if (e.key === "Enter" || e.code === "Space") {
    e.preventDefault();
    accept();
    return;
  }
  if (e.key === "Tab" && cmd) {
    e.preventDefault();
    if (cmd.lock) cmd.lock = null;
    else if (cmd.points.length && resolved) {
      const v = resolved.clone().sub(cmd.points.at(-1));
      if (v.lengthSq() > 1e-16) cmd.lock = v.normalize();
    }
    updatePrompt();
    resolvePointer(e);
    request(true);
    return;
  }
  if (e.key === "F8" || e.key === "F9") {
    e.preventDefault();
    const key = e.key === "F8" ? "ortho" : "grid";
    settings[key] = !settings[key];
    $(key).checked = settings[key];
    request();
    return;
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    if (cmd) {
      cmd.undo();
      updatePrompt();
      request(true);
    } else remove();
    return;
  }
  if (!ctrl && !e.altKey && e.key.length === 1) {
    $("command").focus();
    $("command").value = e.key;
    e.preventDefault();
  }
});
document.addEventListener("keyup", (e) => {
  if (e.key === "Shift") {
    shiftHeld = false;
    if (cmd) {
      resolvePointer(e);
      request(true);
    }
  }
});
for (const name of commandNames.filter((x) => x !== "Insert")) {
  const b = document.createElement("button");
  b.textContent = name;
  b.dataset.command = name;
  b.onclick = () => guarded(() => start(name));
  $("commands").append(b);
}
$("accept").onclick = () => parseCommand($("command").value);
$("cancel").onclick = cancel;
$("undo").onclick = () => {
  if (cmd) {
    cmd.undo();
    updatePrompt();
    request(true);
  } else {
    history.undo();
    refresh();
  }
};
$("redo").onclick = () => {
  history.redo();
  refresh();
};
function newDoc(doc) {
  cancel();
  mutate((d) => Object.assign(d, doc));
  selection = [];
  view.frame(bounds(history.doc));
  refresh();
}
$("new").onclick = () => newDoc(blank());
$("sample").onclick = () => newDoc(sample());
function save() {
  const doc = validate(history.doc),
    blob = new Blob([JSON.stringify(doc, null, 2)], {
      type: "application/json",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "modeling-lab-v1.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
$("save").onclick = () => guarded(save);
$("load").onclick = () => $("file").click();
$("file").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 16 * 1024 * 1024) throw Error("JSON exceeds 16 MiB");
    const doc = validate(JSON.parse(await file.text()));
    newDoc(doc);
    message("Document loaded and validated.");
  } catch (err) {
    message(err.message);
  }
  e.target.value = "";
};
$("help").onclick = () => $("guide").showModal();
$("close-help").onclick = () => $("guide").close();
$("view").onchange = (e) => {
  view.setView(e.target.value);
  const p = cplanes[view.view];
  $("cplane").value = p.name;
  $("elevation").value = p.elevation;
  renderer.setGrid(f(), settings.gridSize);
  $("view-label").textContent = view.view.toUpperCase();
  $("projection").textContent = view.camera.isPerspectiveCamera
    ? "Perspective"
    : "Parallel";
  request(true);
};
function changePlane() {
  const elev = Number($("elevation").value);
  if (!Number.isFinite(elev) || Math.abs(elev) > 1e9) {
    message("Invalid CPlane elevation");
    return;
  }
  cplanes[view.view] = { name: $("cplane").value, elevation: elev };
  renderer.setGrid(f(), settings.gridSize);
  if (cmd) resolvePointer();
  request(true);
}
$("cplane").onchange = changePlane;
$("elevation").onchange = changePlane;
$("extents").onclick = () => {
  view.frame(bounds(history.doc));
  request();
};
$("selected").onclick = () => {
  view.frame(bounds(history.doc, selectionIds(history.doc, selection)));
  request();
};
$("target").onclick = () => {
  targetMode = !targetMode;
  cmd = null;
  updatePrompt();
  request(true);
};
for (const key of ["snap", "grid", "ortho", "smart", "project"])
  $(key).onchange = (e) => {
    settings[key] = e.target.checked;
    if (cmd) resolvePointer();
    request(true);
  };
$("grid-size").onchange = (e) => {
  const value = Number(e.target.value);
  if (value > 0 && value <= 1e9) {
    settings.gridSize = value;
    renderer.setGrid(f(), value);
    request();
  } else {
    e.target.value = settings.gridSize;
    message("Grid spacing must be positive");
  }
};
$("angle").onchange = (e) => (settings.angle = Number(e.target.value));
$("direction").onclick = () => {
  if (cmd?.lock) cmd.lock = null;
  else if (cmd?.points.length && resolved)
    cmd.lock = resolved.clone().sub(cmd.points.at(-1)).normalize();
  updatePrompt();
  request();
};
$("filter").onchange = (e) => {
  settings.filter = e.target.value;
  hover = null;
  request(true);
};
$("component").onchange = (e) => (component = e.target.value);
$("color").onchange = (e) => stylePatch("color", e.target.value);
$("opacity").onchange = (e) => stylePatch("opacity", Number(e.target.value));
$("name").onchange = (e) =>
  mutate((d) => {
    if (selection.length) {
      const o = d.objects.find((o) => o.id === selection[0].id);
      o.name = e.target.value.slice(0, 200);
    }
  });
$("inherit").onclick = () =>
  mutate((d) => {
    const ids = selectionIds(d, selection);
    for (const o of d.objects) if (ids.has(o.id)) o.props = {};
  });
$("scope").onchange = inspector;
$("group").onclick = () =>
  mutate((d) => {
    const ids = selectionIds(d, selection);
    if (ids.size < 2) throw Error("Select at least two objects");
    const id = uid();
    d.groups.push({ id, name: "Group " + (d.groups.length + 1), props: {} });
    for (const o of d.objects) if (ids.has(o.id)) o.group = id;
  });
$("ungroup").onclick = () =>
  mutate((d) => {
    const ids = selectionIds(d, selection);
    for (const o of d.objects)
      if (ids.has(o.id)) {
        // Preserve effective styles when removing inheritance.
        for (const key of ["color", "opacity"])
          o.props[key] = effective(d, o, key);
        o.group = null;
      }
  });
$("block").onclick = () => {
  let id;
  mutate((d) => {
    id = makeBlock(d, selection, "Block " + (d.definitions.length + 1));
  });
  if (id) {
    selection = [{ id, type: "object" }];
    refresh();
  }
};
$("insert").onclick = () => guarded(() => start("Insert"));
function remove() {
  mutate((d) => {
    const ids = selectionIds(d, selection);
    if (selection.some((s) => s.type !== "object"))
      throw Error(
        "Component deletion changes topology and is not available; select whole objects",
      );
    d.objects = d.objects.filter((o) => !ids.has(o.id));
  });
}
$("delete").onclick = remove;
$("transform-modes").onclick = (e) => {
  const b = e.target.closest("[data-mode]");
  if (!b) return;
  mode = b.dataset.mode;
  document
    .querySelectorAll("[data-mode]")
    .forEach((x) => x.classList.toggle("active", x === b));
  $("transform-value").value = mode === "scale" ? 1 : 0;
  request();
};
$("apply-transform").onclick = () => {
  const value = Number($("transform-value").value);
  if (
    !Number.isFinite(value) ||
    Math.abs(value) > 1e9 ||
    (mode === "scale" && value <= 0)
  ) {
    message("Enter a finite transform; scale must be positive");
    return;
  }
  const axis = $("axis").value,
    a = axis === "XYZ" ? [1, 1, 1] : [..."XYZ"].map((x) => Number(x === axis));
  if (mode === "rotate" && axis === "XYZ") {
    message("Choose one rotation axis");
    return;
  }
  mutate((d) =>
    transform(
      d,
      selection,
      transformMatrix(mode, a, value, pivot(d, selection)),
    ),
  );
};
$("transform-value").onkeydown = (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    $("apply-transform").click();
    viewport.focus();
  }
};
$("preset").onchange = (e) => {
  settings.prehighlight = e.target.value === "discovery";
  hover = null;
  request(true);
};
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) request();
});
renderer.setGrid(f(), settings.gridSize);
view.frame(bounds(history.doc));
refresh();
resize();
// Read-only diagnostics and a small deterministic command API used by cloud integration checks.
window.modelingLab = {
  get document() {
    return clone(history.doc);
  },
  get selection() {
    return clone(selection);
  },
  get command() {
    return cmd
      ? {
          name: cmd.name,
          points: cmd.points.map(arr),
          locked: !!cmd.lock,
          elevator: !!cmd.elevator,
        }
      : null;
  },
  get camera() {
    return view.serialize();
  },
  get framesRendered() {
    return framesRendered;
  },
  get settings() {
    return { ...settings };
  },
  project: (p) => view.project(vec(p)),
  start: (name) => start(name),
  enter: (text) => parseCommand(text),
  select: (ids) => {
    selection = ids.map((id) => ({ id, type: "object" }));
    refresh();
  },
  undo: () => {
    history.undo();
    refresh();
  },
  redo: () => {
    history.redo();
    refresh();
  },
  export: () => JSON.stringify(validate(history.doc)),
  load: (text) => newDoc(validate(JSON.parse(text))),
  get rendererInfo() {
    return {
      calls: renderer.renderer.info.render.calls,
      triangles: renderer.renderer.info.render.triangles,
      webgl: renderer.renderer.capabilities.isWebGL2,
    };
  },
};
