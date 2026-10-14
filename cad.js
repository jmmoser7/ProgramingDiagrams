/*
 * Program Board: Rhino .3dm export, loaded on the first export click.
 *
 *   ProgramBoardCad.export3dm(scene) -> Promise<Uint8Array>
 *   ProgramBoardCad.loadRhino()      -> Promise<rhino3dm module> (optional preload)
 *
 * Scene units are feet in y-down canvas space. The model is feet, y-up, on
 * z = 0. Texts: (x, y) is the top-left of the first line and `size` is the
 * font size (em) in feet; Rhino text height is cap height, CAP * size.
 *
 * The file is a version 7 archive, which both Rhino 7 and Rhino 8 open.
 *
 * rhino3dm (McNeel's WebAssembly build of openNURBS) writes curves, layers,
 * user text and units, but can neither give a hatch its boundary nor
 * construct annotation text. So:
 *   - a hatch is serialized here as an ON_Hatch (world-XY plane, the Solid
 *     system pattern at index -1, an outer loop plus any inner loops, whose
 *     curves rhino3dm serializes itself) and parsed back by openNURBS through
 *     CommonObject.decode, which must report it valid before it is added;
 *   - text is a small ON_Text from McNeel's openNURBS example files,
 *     decoded and refilled. It inherits the system "Default" dimstyle
 *     (which every Rhino resolves) with a per-object height override.
 *
 * rhino3dm's plainTextToRtf mangles non-ASCII, so rtf() below escapes to
 * \uN? itself. The Default dimstyle anchors text at its top-left, so a
 * sticky label is centered from Arial advance widths, not measured. A
 * sticky's `label` (the board's own fit: size, line breaks, area line) sets
 * its text; a sticky without one is fitted here.
 */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.ProgramBoardCad = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const IS_NODE = typeof module === 'object' && typeof require === 'function'
    && typeof process === 'object' && !!(process.versions && process.versions.node);
  const SCRIPT_SRC = !IS_NODE && root.document && root.document.currentScript
    ? root.document.currentScript.src : '';

  const FILE_VERSION = 7;

  // Arial: cap height and line pitch per em; advances per 1000 em, ' '..'~'.
  const CAP = 0.716;
  const LINE = 1.15 / CAP;
  const ADVANCE = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
  ];

  // Sticky label fit, as fractions of the sticky's short side.
  const LABEL = { PAD: 0.08, CAP: 0.1, MIN: 0.004, STEP: 0.92, MAX_LINES: 4 };

  // The frame title sits where app.js draws it: baseline TITLE.UP above the
  // frame's top edge, TITLE.IN from its left, TITLE.SIZE em tall.
  const TITLE = { SIZE: 12, IN: 2, UP: 6 };

  // A blob's label sits where app.js draws it: on the top edge of the
  // value's largest island at its left end, baseline UP * SIZE above that
  // edge and IN * SIZE in; SIZE em tall. EDGE is how far below the topmost
  // point still counts as the top edge.
  const BLOB_TITLE = { SIZE: 7, IN: 0.4, UP: 0.3, EDGE: 0.5 };

  const INK = { r: 50, g: 42, b: 32, a: 255 };
  const INK_LIGHT = { r: 255, g: 255, b: 255, a: 255 };
  const FRAME_INK = { r: 135, g: 142, b: 150, a: 255 };
  const NEUTRAL = { r: 128, g: 128, b: 128, a: 255 };
  const STICKY = { r: 242, g: 228, b: 170, a: 255 };
  // A sticky's outline is its fill pulled this far toward INK.
  const STROKE_SHADE = 0.35;

  // Stickies go on one top-level layer per department (DEPARTMENT when
  // blank); object attributes, not layers, carry their colours. Blobs are
  // the one nested case, BLOBS::<key>, so keys toggle separately.
  const LAYER = {
    FRAME: 'Frame',
    LINES: 'Lines',
    TEXT: 'Text',
    BLOBS: 'Blobs',
    BLOB_KEY: 'Blob',
    DEPARTMENT: 'Program',
  };
  // Draw order: blob fills behind sticky fills, both behind line work.
  const ORDER = { BLOB_HATCH: -2, STICKY_HATCH: -1 };

  // ON_Text with its overrides cleared, origin at 0,0,0, parented to the
  // system Default dimstyle. Source: opennurbs example_files/V6/V6_annotation.3dm.
  const TEXT_TEMPLATE = {
    version: 10000,
    archive3dm: 60,
    opennurbs: -1869833980,
    data: '+n8CAPEBAAAAAAAA+/8CABQAAAAAAAAASWM3V6liFkq0EaRrzVRHkEI6KyX8/wIAuQEAAAAAAAAAgABAqQEAAAAAAAABAAAAAAAAAACAAECRAQAAAAAAAAEAAAAEAAAAAIAAQLsAAAAAAAAAAQAAAAAAAAAFAAAAVABlAHgAdAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPA/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8D8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADwPwAAAAAAAAAAAAAAAAAAAAAAAAAAAADwPwAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8D8ABh0HtWkIuSUiAAROtJiYtBdfZf0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADwPwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPA/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8D8AAAAAAAAAAAAAAAAAAAAAAAAAAAAA8D8AAAAAAAAAgAkAAAAAgABADQAAAAAAAAABAAAAAQAAAABdKRLMAAAAAAAA8D8AAAAAAAAAAAHE/B7y99+IqQAAAAD/fwKAAAAAAAAAAAA=',
  };

  // --------------------------------------------------------------- loading

  let rhinoPromise = null;

  function loadRhino() {
    if (!rhinoPromise) {
      rhinoPromise = (IS_NODE ? loadNode() : loadBrowser()).catch((err) => {
        rhinoPromise = null;
        throw err;
      });
    }
    return rhinoPromise;
  }

  function loadNode() {
    const path = require('path');
    const zlib = require('zlib');
    const factory = require(path.join(__dirname, 'vendor', 'rhino3dm.min.js'));
    const b64 = require(path.join(__dirname, 'vendor', 'rhino3dm.wasm.js'));
    return factory({ wasmBinary: zlib.gunzipSync(Buffer.from(b64, 'base64')) });
  }

  async function loadBrowser() {
    if (typeof root.rhino3dm !== 'function') await loadScript('rhino3dm.min.js');
    if (typeof root.ProgramBoardRhinoWasm !== 'string') await loadScript('rhino3dm.wasm.js');
    const packed = fromBase64(root.ProgramBoardRhinoWasm);
    root.ProgramBoardRhinoWasm = undefined;
    return root.rhino3dm({ wasmBinary: await gunzip(packed) });
  }

  function loadScript(name) {
    const src = SCRIPT_SRC ? new URL('vendor/' + name, SCRIPT_SRC).href : 'vendor/' + name;
    return new Promise((resolve, reject) => {
      const el = root.document.createElement('script');
      el.src = src;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error('Could not load ' + src + '.'));
      root.document.head.appendChild(el);
    });
  }

  async function gunzip(bytes) {
    if (typeof root.DecompressionStream !== 'function') {
      throw new Error('This browser cannot unpack the Rhino exporter (no DecompressionStream).');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new root.DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // ----------------------------------------------------------------- bytes

  function fromBase64(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function toBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  function concat(parts) {
    let n = 0;
    for (const p of parts) n += p.length;
    const out = new Uint8Array(n);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }

  function scalar(size, write) {
    const b = new Uint8Array(size);
    write(new DataView(b.buffer));
    return b;
  }
  const u32 = (v) => scalar(4, (d) => d.setUint32(0, v >>> 0, true));
  const i32 = (v) => scalar(4, (d) => d.setInt32(0, v, true));
  const u64 = (v) => scalar(8, (d) => d.setUint32(0, v >>> 0, true));
  const f64 = (v) => scalar(8, (d) => d.setFloat64(0, v, true));

  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // openNURBS archive chunks (version 5+ archives use 8-byte lengths).
  const TCODE_CLASS = 0x00027ffa;
  const TCODE_CLASS_UUID = 0x0002fffb;
  const TCODE_CLASS_DATA = 0x0002fffc;
  const TCODE_CLASS_END = 0x80027fff;
  // ON_Hatch class id {0559733B-5332-49d1-A936-0532AC76ADE5}, as stored.
  const HATCH_CLASS_ID = Uint8Array.of(
    0x3b, 0x73, 0x59, 0x05, 0x32, 0x53, 0xd1, 0x49,
    0xa9, 0x36, 0x05, 0x32, 0xac, 0x76, 0xad, 0xe5);
  const SOLID_PATTERN = -1;
  const OUTER_LOOP = 0;
  const INNER_LOOP = 1;

  function chunk(tcode, content, withCrc) {
    const body = withCrc ? concat([content, u32(crc32(content))]) : content;
    return concat([u32(tcode), u64(body.length), body]);
  }

  // What ON_BinaryArchive::WriteObject produces for an object of this class.
  function classObject(classId, data) {
    return chunk(TCODE_CLASS, concat([
      chunk(TCODE_CLASS_UUID, classId, true),
      chunk(TCODE_CLASS_DATA, data, true),
      u32(TCODE_CLASS_END), u64(0),
    ]), false);
  }

  // ON_Hatch::Write, chunk version 1.2, on the world XY plane. Each loop,
  // { curve, inner }, is ON_HatchLoop::Write around an already-serialized
  // 2d curve object.
  function hatchObject(loops) {
    const parts = [Uint8Array.of(0x12)];
    for (const v of [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0]) parts.push(f64(v));
    parts.push(f64(1), f64(0), i32(SOLID_PATTERN), i32(loops.length));
    for (const loop of loops) parts.push(Uint8Array.of(0x11), i32(loop.inner ? INNER_LOOP : OUTER_LOOP), loop.curve);
    parts.push(f64(0), f64(0));
    return classObject(HATCH_CLASS_ID, concat(parts));
  }

  // --------------------------------------------------------------- helpers

  function color(hex, fallback) {
    let s = String(hex || '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(s)) s = s.replace(/./g, '$&$&');
    if (!/^[0-9a-f]{6}$/i.test(s)) return fallback;
    const n = parseInt(s, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 255 };
  }

  const shade = (c, t) => ({
    r: Math.round(c.r + (INK.r - c.r) * t),
    g: Math.round(c.g + (INK.g - c.g) * t),
    b: Math.round(c.b + (INK.b - c.b) * t),
    a: 255,
  });
  const isDark = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b < 128;
  const finite = (...v) => v.every(Number.isFinite);

  // Rhino rejects names that start with a space or bracket, end with a
  // space, contain control characters, or (for layers) contain "::".
  function componentName(value, fallback) {
    const s = String(value == null ? '' : value)
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
      .replace(/::+/g, ':')
      .replace(/\s+/g, ' ')
      .replace(/^[\s()[\]{}]+/, '')
      .trim();
    return s || fallback;
  }

  function areaText(area) {
    const n = typeof area === 'number' ? area : Number(String(area).replace(/,/g, ''));
    if (area === '' || area == null || !Number.isFinite(n)) return area == null ? '' : String(area);
    return Math.round(n).toLocaleString('en-US') + ' sf';
  }

  // ASCII-only RTF in the shape openNURBS writes, one group per line.
  function rtf(lines) {
    const esc = (s) => {
      let out = '';
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c === 0x5c || c === 0x7b || c === 0x7d) out += '\\' + s[i];
        else if (c < 0x20) out += ' ';
        else if (c < 0x80) out += s[i];
        else out += '\\u' + (c > 0x7fff ? c - 0x10000 : c) + '?';
      }
      return out;
    };
    const body = lines.map((l, i) => '{\\f0 ' + esc(l) + (i < lines.length - 1 ? '\\par' : '') + '}');
    return '{\\rtf1\\deff0{\\fonttbl{\\f0 Arial;}}\\f0 \\fs18' + body.join('') + '}';
  }

  // Width of a string in cap heights.
  function measure(s) {
    let w = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      w += c >= 32 && c <= 126 ? ADVANCE[c - 32] : 556;
    }
    return w / 1000 / CAP;
  }

  function wrap(words, limit) {
    const lines = [];
    let line = '';
    for (const word of words) {
      const next = line ? line + ' ' + word : word;
      if (line && measure(next) > limit) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  // Largest cap height at which the wrapped name plus the area line fit
  // inside the sticky's padded box.
  function fitLabel(name, area, w, h) {
    const m = Math.min(w, h);
    const innerW = w - 2 * LABEL.PAD * m;
    const innerH = h - 2 * LABEL.PAD * m;
    const words = String(name || '').split(/\s+/).filter(Boolean);
    if (!(innerW > 0 && innerH > 0) || (!words.length && !area)) return null;
    let best = null;
    for (let cap = LABEL.CAP * m; cap >= LABEL.MIN * m; cap *= LABEL.STEP) {
      const lines = wrap(words, innerW / cap).slice(0, LABEL.MAX_LINES);
      if (area) lines.push(area);
      const width = Math.max(...lines.map(measure)) * cap;
      const height = cap * (1 + LINE * (lines.length - 1));
      best = { lines, cap, width, height };
      if (width <= innerW && height <= innerH) break;
    }
    return best;
  }

  // The label the board fitted, when the scene carries one: `size` is the
  // name's font size (em) in feet, `lines` its line breaks, `y0` / `lineH`
  // the first line's centre and pitch, and `areaY` / `areaSize` the area
  // line's, all from the sticky's centre in y-down feet. `mid` is the
  // centre of the name lines. Null means fit here instead.
  function boardLabel(l) {
    if (!l || !(Number(l.size) > 0) || !Array.isArray(l.lines)) return null;
    const size = Number(l.size);
    const lines = l.lines.map((x) => String(x));
    const lineH = Number(l.lineH) > 0 ? Number(l.lineH) : size * CAP * LINE;
    const y0 = finite(l.y0) ? Number(l.y0) : -((lines.length - 1) * lineH) / 2;
    const areaText = l.area && l.areaText != null && lines.length ? String(l.areaText) : '';
    const areaSize = Number(l.areaSize) > 0 ? Number(l.areaSize) : size;
    const areaY = finite(l.areaY) ? Number(l.areaY) : 0;
    return { size, lines, mid: y0 + ((lines.length - 1) * lineH) / 2, areaText, areaSize, areaY, color: color(l.color, null) };
  }

  // Closed boundary in Rhino space: a PolylineCurve when sharp, otherwise
  // a PolyCurve of lines and quarter arcs, counterclockwise.
  function boundary(rhino, x, y, w, h, radius) {
    const l = x;
    const r = x + w;
    const t = -y;
    const b = -(y + h);
    const rad = Math.max(0, Math.min(Number(radius) || 0, w / 2, h / 2));
    const eps = 1e-9 * Math.max(1, w, h);
    if (rad <= eps) {
      return new rhino.PolylineCurve([[l, b, 0], [r, b, 0], [r, t, 0], [l, t, 0], [l, b, 0]]);
    }
    const curve = new rhino.PolyCurve();
    const line = (x0, y0, x1, y1) => {
      if (Math.hypot(x1 - x0, y1 - y0) > eps) curve.appendLine(new rhino.Line([x0, y0, 0], [x1, y1, 0]));
    };
    const arc = (cx, cy, from) => {
      const at = (deg) => {
        const a = (deg * Math.PI) / 180;
        return [cx + rad * Math.cos(a), cy + rad * Math.sin(a), 0];
      };
      curve.appendArc(rhino.Arc.createFromPoints(at(from), at(from + 45), at(from + 90)));
    };
    line(l + rad, b, r - rad, b);
    arc(r - rad, b + rad, -90);
    line(r, b + rad, r, t - rad);
    arc(r - rad, t - rad, 0);
    line(r - rad, t, l + rad, t);
    arc(l + rad, t - rad, 90);
    line(l, t - rad, l, b + rad);
    arc(l + rad, b + rad, 180);
    return curve;
  }

  // A blob loop's points, finite, without consecutive or closing repeats;
  // null when fewer than three remain or the loop encloses nothing.
  function loopPoints(points) {
    if (!Array.isArray(points)) return null;
    const out = [];
    for (const p of points) {
      if (!p || !finite(p[0], p[1])) continue;
      const last = out[out.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push([p[0], p[1]]);
    }
    while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
    return out.length >= 3 && polygonArea(out) > 0 ? out : null;
  }

  function polygonArea(pts) {
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    return Math.abs(a) / 2;
  }

  function insidePolygon(x, y, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // A blob loop's exact contour ([{ k: 0 line | 1 arc, x0, y0, x1, y1, cx,
  // cy, r, a0, da }], canvas space), every number finite; null otherwise.
  function blobSegs(segs) {
    if (!Array.isArray(segs) || !segs.length) return null;
    for (const s of segs) {
      if (!s || !finite(s.x0, s.y0, s.x1, s.y1)) return null;
      if (s.k === 1 && !(finite(s.cx, s.cy, s.r, s.a0, s.da) && s.r > 0)) return null;
      if (s.k !== 0 && s.k !== 1) return null;
    }
    return segs;
  }

  // The exact contour as a PolyCurve of lines and arcs in Rhino space (y
  // flipped), each piece starting where the last ended; null unless
  // openNURBS takes it as a valid closed curve.
  function blobPolyCurve(rhino, segs) {
    const P = (x, y) => [x, -y, 0];
    const curve = new rhino.PolyCurve();
    const first = P(segs[0].x0, segs[0].y0);
    let from = first;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const last = i === segs.length - 1;
      const end = last ? first : P(s.x1, s.y1);
      if (Math.hypot(end[0] - from[0], end[1] - from[1]) <= 1e-9 && (s.k === 0 || Math.abs(s.da) < Math.PI)) continue;
      // Quarter turns at most, so three points always pin a short arc;
      // an arc too short to pin is a line.
      if (s.k === 0 || s.r * Math.abs(s.da) < 1e-4) {
        curve.appendLine(new rhino.Line(from, end));
        from = end;
        continue;
      }
      const n = Math.max(1, Math.ceil(Math.abs(s.da) / (Math.PI / 2) - 1e-9));
      for (let k = 1; k <= n; k++) {
        const am = s.a0 + (s.da * (k - 0.5)) / n;
        const a1 = s.a0 + (s.da * k) / n;
        const to = k === n ? end : P(s.cx + s.r * Math.cos(a1), s.cy + s.r * Math.sin(a1));
        curve.appendArc(rhino.Arc.createFromPoints(from, P(s.cx + s.r * Math.cos(am), s.cy + s.r * Math.sin(am)), to));
        from = to;
      }
    }
    if (curve.isValid && curve.isClosed) return curve;
    curve.delete();
    return null;
  }

  // A blob loop's outline in Rhino space: its exact lines and arcs when it
  // carries them, otherwise a closed, periodic degree-3 NURBS with the
  // loop's points as control points. Blob points are a dense contour, so
  // the curve hugs them; unlike interpolation it cannot overshoot between
  // unevenly spaced points into a self-crossing loop.
  function blobCurve(rhino, pts, segs) {
    const exact = segs && blobPolyCurve(rhino, segs);
    if (exact) return exact;
    const cps = pts.map((p) => [p[0], -p[1], 0]);
    const nurbs = rhino.NurbsCurve.create(true, 3, cps);
    if (nurbs && nurbs.isValid && nurbs.isClosed) return nurbs;
    if (nurbs) nurbs.delete();
    return new rhino.PolylineCurve(cps.concat([cps[0]]));
  }

  // ---------------------------------------------------------------- export

  async function export3dm(scene) {
    const rhino = await loadRhino();
    return build(rhino, scene || {});
  }

  function build(rhino, scene) {
    const owned = [];
    const own = (o) => {
      owned.push(o);
      return o;
    };
    try {
      return write(rhino, scene, own);
    } finally {
      for (let i = owned.length - 1; i >= 0; i--) {
        try {
          owned[i].delete();
        } catch (err) {
          // Already released by the table that took it.
        }
      }
    }
  }

  function write(rhino, scene, own) {
    const doc = own(new rhino.File3dm());
    const settings = own(doc.settings());
    settings.modelUnitSystem = rhino.UnitSystem.Feet;
    settings.modelAbsoluteTolerance = 0.001;
    doc.applicationName = 'Program Board';
    if (scene.title) own(doc.strings()).set('Title', String(scene.title));

    const objects = own(doc.objects());
    const layers = own(doc.layers());
    const groups = own(doc.groups());
    const dim = own(new rhino.DimensionStyle());
    const stickies = (scene.stickies || []).filter((s) => s && finite(s.x, s.y, s.w, s.h) && s.w > 0 && s.h > 0);

    // Layers: Frame, Lines, Text, Blobs::<key> when there are blobs, then one
    // top-level layer per department. Layer names are case-insensitive in
    // Rhino, among siblings.
    const layerIds = new Map();
    const addLayer = (name, rgba, parent) => {
      const key = (parent ? parent.toLowerCase() + '::' : '') + name.toLowerCase();
      if (layerIds.has(key)) return layerIds.get(key);
      const layer = own(new rhino.Layer());
      layer.name = name;
      layer.color = rgba;
      if (parent) layer.parentLayerId = own(layers.get(layerIds.get(parent.toLowerCase()))).id;
      const index = layers.add(layer);
      layerIds.set(key, index);
      return index;
    };
    const frameLayer = addLayer(LAYER.FRAME, FRAME_INK);
    const lineLayer = addLayer(LAYER.LINES, INK);
    const textLayer = addLayer(LAYER.TEXT, INK);
    const reserved = new Set([...layerIds.keys(), LAYER.BLOBS.toLowerCase()]);
    const departmentLayer = (department) => {
      let name = componentName(department, LAYER.DEPARTMENT);
      if (reserved.has(name.toLowerCase())) name += ' (' + LAYER.DEPARTMENT + ')';
      return addLayer(name, NEUTRAL);
    };

    const attributes = (layerIndex, name, strings) => {
      const a = own(new rhino.ObjectAttributes());
      a.layerIndex = layerIndex;
      if (name) a.name = name;
      if (strings) for (const [k, v] of strings) a.setUserString(k, v);
      return a;
    };
    const paint = (a, rgba) => {
      a.colorSource = rhino.ObjectColorSource.ColorFromObject;
      a.objectColor = rgba;
      a.plotColorSource = rhino.ObjectPlotColorSource.PlotColorFromObject;
      a.plotColor = rgba;
      return a;
    };
    const text = (lines, x, top, cap, attrs) => {
      const t = own(rhino.CommonObject.decode(TEXT_TEMPLATE));
      t.setRichText(rtf(lines), dim);
      t.setTextHeight(dim, cap);
      t.translate([x, top, 0]);
      objects.add(t, attrs);
    };
    const groupNames = new Set();
    const addGroup = (name) => {
      let unique = name;
      for (let n = 2; groupNames.has(unique.toLowerCase()); n++) unique = name + ' (' + n + ')';
      groupNames.add(unique.toLowerCase());
      const group = own(new rhino.Group());
      group.name = unique;
      groups.add(group);
      const index = groups.count - 1;
      return (a) => {
        a.addToGroup(index);
        return a;
      };
    };
    // Loops are [{ curve, inner }] of curves already added to the model; each
    // curve is flattened to 2d here, which ON_Hatch requires of its loops.
    const hatchOf = (loops, what) => {
      let meta = null;
      const parts = loops.map(({ curve, inner }) => {
        curve.changeDimension(2);
        meta = curve.toJSON();
        return { curve: fromBase64(meta.data), inner };
      });
      const hatch = own(rhino.CommonObject.decode({
        version: meta.version,
        archive3dm: meta.archive3dm,
        opennurbs: meta.opennurbs,
        data: toBase64(hatchObject(parts)),
      }));
      if (!hatch || !hatch.isValid) throw new Error('openNURBS rejected the hatch for ' + what + '.');
      return hatch;
    };

    // Frame.
    const f = scene.frame;
    if (f && finite(f.x, f.y, f.w, f.h) && f.w > 0 && f.h > 0) {
      const strings = [];
      if (f.title) strings.push(['Title', String(f.title)]);
      if (f.fill) strings.push(['Fill', String(f.fill)]);
      objects.addCurve(own(boundary(rhino, f.x, f.y, f.w, f.h, f.radius)),
        attributes(frameLayer, f.title ? String(f.title) : 'Frame', strings));
      if (f.title) {
        const cap = TITLE.SIZE * CAP;
        text([String(f.title)], f.x + TITLE.IN, -(f.y - TITLE.UP - cap), cap, attributes(frameLayer));
      }
    }

    // Blobs: an outline per loop on Blobs::<key>, one solid hatch per island
    // with the holes it contains cut out, and the value's label; one group
    // per key and value.
    const blobValues = new Map();
    for (const b of Array.isArray(scene.blobs) ? scene.blobs : []) {
      const pts = b && loopPoints(b.points);
      if (!pts) continue;
      const key = b.key == null ? '' : String(b.key);
      const value = b.value == null ? '' : String(b.value);
      const id = key + '\u001f' + value;
      if (!blobValues.has(id)) blobValues.set(id, { key, value, color: color(b.color, NEUTRAL), stroke: finite(b.stroke) ? Math.max(0, b.stroke) : null, loops: [] });
      blobValues.get(id).loops.push({ pts, segs: blobSegs(b.segs), hole: b.hole === true, area: polygonArea(pts) });
    }
    if (blobValues.size) addLayer(LAYER.BLOBS, NEUTRAL);
    for (const { key, value, color: rgba, stroke, loops } of blobValues.values()) {
      const layer = addLayer(componentName(key, LAYER.BLOB_KEY), NEUTRAL, LAYER.BLOBS);
      const inGroup = addGroup(componentName('Blob ' + key + ': ' + value, 'Blob'));
      const strings = (hole) => [['Key', key], ['Value', value], ['Hole', hole ? 'true' : 'false']]
        .concat(stroke == null ? [] : [['Stroke', String(stroke)]]);
      // A zero stroke still exports the outline (it bounds the hatch), set
      // to No Plot (plot weight -1) so it does not print.
      for (const loop of loops) {
        loop.curve = own(blobCurve(rhino, loop.pts, loop.segs));
        const outline = paint(inGroup(attributes(layer, value, strings(loop.hole))), rgba);
        if (stroke === 0) {
          outline.plotWeightSource = rhino.ObjectPlotWeightSource.PlotWeightFromObject;
          outline.plotWeight = -1;
        }
        objects.addCurve(loop.curve, outline);
      }
      const islands = loops.filter((l) => !l.hole);
      const cuts = new Map(islands.map((l) => [l, []]));
      for (const hole of loops.filter((l) => l.hole)) {
        let home = null;
        for (const island of islands) {
          if (island.area > hole.area && (!home || island.area < home.area)
            && insidePolygon(hole.pts[0][0], hole.pts[0][1], island.pts)) home = island;
        }
        if (home) cuts.get(home).push(hole);
      }
      for (const island of islands) {
        const hatch = hatchOf([{ curve: island.curve, inner: false }]
          .concat(cuts.get(island).map((h) => ({ curve: h.curve, inner: true }))), 'blob ' + key + ': ' + value);
        const hatchAttrs = paint(inGroup(attributes(layer, value, [['Key', key], ['Value', value]])), rgba);
        hatchAttrs.displayOrder = ORDER.BLOB_HATCH;
        objects.add(hatch, hatchAttrs);
      }
      const largest = islands.reduce((a, l) => (!a || l.area > a.area ? l : a), null);
      if (largest && value) {
        const size = BLOB_TITLE.SIZE;
        const top = Math.min(...largest.pts.map((p) => p[1]));
        const left = Math.min(...largest.pts.filter((p) => p[1] <= top + size * BLOB_TITLE.EDGE).map((p) => p[0]));
        const cap = size * CAP;
        text([value], left + size * BLOB_TITLE.IN, -(top - size * BLOB_TITLE.UP - cap), cap,
          paint(inGroup(attributes(layer, value, [['Key', key], ['Value', value]])), rgba));
      }
    }

    // Stickies: boundary, solid hatch, and a centered label, grouped on the
    // department's layer.
    stickies.forEach((s, i) => {
      const fill = color(s.fill, STICKY);
      const layer = departmentLayer(s.department);
      const name = s.name == null ? '' : String(s.name);
      const label = areaText(s.area);

      const strings = [['Name', name], ['Area', s.area == null ? '' : String(s.area)]];
      if (s.department != null && s.department !== '') strings.push(['Department', String(s.department)]);
      if (s.group != null && s.group !== '') strings.push(['Group', String(s.group)]);
      if (s.id != null) strings.push(['Id', String(s.id)]);
      strings.push(['Fill', '#' + [fill.r, fill.g, fill.b].map((v) => v.toString(16).padStart(2, '0')).join('')]);
      const taken = new Set(strings.map(([k]) => k.toLowerCase()));
      for (const [k, v] of Object.entries(s.meta || {})) {
        const key = String(k).trim();
        if (key && !taken.has(key.toLowerCase()) && v != null) {
          taken.add(key.toLowerCase());
          strings.push([key, String(v)]);
        }
      }

      const inGroup = addGroup('Sticky ' + (i + 1));

      const curve = own(boundary(rhino, s.x, s.y, s.w, s.h, s.radius));
      objects.addCurve(curve, paint(inGroup(attributes(layer, name, strings)), shade(fill, STROKE_SHADE)));

      const hatch = hatchOf([{ curve, inner: false }], 'sticky ' + (s.id || i + 1));
      const hatchAttrs = paint(inGroup(attributes(layer, name, strings)), fill);
      hatchAttrs.displayOrder = ORDER.STICKY_HATCH;
      objects.add(hatch, hatchAttrs);

      const board = boardLabel(s.label);
      const ink = (board && board.color) || (isDark(fill) ? INK_LIGHT : INK);
      const labelAttrs = () => paint(inGroup(attributes(layer, name, strings)), ink);
      const cx = s.x + s.w / 2;
      const cy = -(s.y + s.h / 2);
      if (board) {
        // The board's own fit: its size, its line breaks, and its area line.
        if (board.lines.length) {
          const cap = board.size * CAP;
          const width = Math.max(...board.lines.map(measure)) * cap;
          const height = cap * (1 + LINE * (board.lines.length - 1));
          text(board.lines, cx - width / 2, cy - board.mid + height / 2, cap, labelAttrs());
        }
        if (board.areaText) {
          const cap = board.areaSize * CAP;
          text([board.areaText], cx - (measure(board.areaText) * cap) / 2, cy - board.areaY + cap / 2, cap, labelAttrs());
        }
      } else {
        const fit = fitLabel(name, label, s.w, s.h);
        if (fit) text(fit.lines, cx - fit.width / 2, cy + fit.height / 2, fit.cap, labelAttrs());
      }
    });

    // Lines.
    for (const line of scene.lines || []) {
      if (!line || !Array.isArray(line.points)) continue;
      const pts = [];
      for (const p of line.points) {
        if (!p || !finite(p[0], p[1])) continue;
        const q = [p[0], -p[1], 0];
        const last = pts[pts.length - 1];
        if (!last || last[0] !== q[0] || last[1] !== q[1]) pts.push(q);
      }
      if (pts.length < 2) continue;
      const strings = [];
      if (line.width != null) strings.push(['Width', String(line.width)]);
      if (line.id != null) strings.push(['Id', String(line.id)]);
      const ink = color(line.color, null);
      const lineAttrs = (extra) => {
        const a = attributes(lineLayer, '', strings.concat(extra || []));
        return ink ? paint(a, ink) : a;
      };
      objects.addPolyline(pts, lineAttrs());
      // End caps on the line's layer in its colour: arrowheads, squares, and
      // dots as closed curves with a solid hatch; open arrows, ticks, and
      // bars as polylines (centrelines, their stroke width as Width).
      for (const cap of Array.isArray(line.caps) ? line.caps : []) {
        const tag = [['End', String(cap.at || '')], ['Kind', String(cap.kind || '')]];
        if (cap.k === 'dot' && finite(cap.x, cap.y, cap.r) && cap.r > 0) {
          const curve = own(own(new rhino.Circle([cap.x, -cap.y, 0], cap.r)).toNurbsCurve());
          objects.addCurve(curve, lineAttrs(tag));
          objects.add(hatchOf([{ curve, inner: false }], 'line end'), lineAttrs(tag));
          continue;
        }
        const cps = (Array.isArray(cap.pts) ? cap.pts : []).filter((p) => p && finite(p[0], p[1])).map((p) => [p[0], -p[1], 0]);
        if (cap.k === 'fill' && cps.length >= 3) {
          const curve = own(new rhino.PolylineCurve(cps.concat([cps[0]])));
          objects.addCurve(curve, lineAttrs(tag));
          objects.add(hatchOf([{ curve, inner: false }], 'line end'), lineAttrs(tag));
        } else if (cap.k === 'stroke' && cps.length >= 2) {
          objects.addPolyline(cps, lineAttrs(tag.concat([['Width', String(cap.w)]])));
        }
      }
    }

    // Texts.
    for (const t of scene.texts || []) {
      if (!t || !finite(t.x, t.y) || t.text == null || String(t.text) === '') continue;
      const size = Number(t.size) > 0 ? Number(t.size) : 1;
      const strings = t.id != null ? [['Id', String(t.id)]] : null;
      const own = color(t.color, null);
      const attrs = attributes(textLayer, '', strings);
      text(String(t.text).split(/\r\n|\r|\n/), t.x, -t.y, size * CAP, own ? paint(attrs, own) : attrs);
    }

    const options = own(new rhino.File3dmWriteOptions());
    options.version = FILE_VERSION;
    options.saveUserData = true;
    return new Uint8Array(doc.toByteArrayOptions(options));
  }

  return {
    export3dm,
    loadRhino,
    internals: {
      hatchObject, rtf, fitLabel, boardLabel, measure, areaText, componentName, boundary, shade, blobSegs,
      CAP, LAYER, ORDER, BLOB_TITLE, FILE_VERSION, STROKE_SHADE, INK, INK_LIGHT, NEUTRAL,
    },
  };
});
