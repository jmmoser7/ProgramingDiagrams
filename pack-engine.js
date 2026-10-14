'use strict';

// Area-true rectangle packing for the pack board.
// Every layout tiles its rectangle: the tiles meet, they do not overlap,
// and their areas stay in proportion to the weights handed in.
// The frame's aspect is chosen by the user; its area is the sum of the weights.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PackBoard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ALGORITHMS = [
    { id: 'squarify', name: 'Squarified', blurb: 'Fat rectangles, largest first. The usual treemap.' },
    { id: 'ordered', name: 'Ordered squarify', blurb: 'Same rows, but the spreadsheet order is kept.' },
    { id: 'strip', name: 'Strip', blurb: 'Horizontal strips. Order is kept, rows stay readable.' },
    { id: 'slice', name: 'Slice', blurb: 'One full-width band per space.' },
    { id: 'dice', name: 'Dice', blurb: 'One full-height column per space.' },
    { id: 'slicedice', name: 'Slice and dice', blurb: 'Alternates direction at each nesting level.' },
    { id: 'binary', name: 'Binary', blurb: 'Splits the list into area halves. Order is kept.' },
    { id: 'pivot', name: 'Pivot', blurb: 'The largest space takes a strip. The rest pack beside it.' },
    { id: 'middle', name: 'Pivot middle', blurb: 'The middle space is the pivot, so order stays put.' },
  ];

  const NESTS = [
    { id: 'flat', name: 'Flat' },
    { id: 'dept', name: 'Department' },
    { id: 'both', name: 'Dept + group' },
  ];

  const ASPECTS = [
    { id: '1:1', label: '1:1', value: 1 },
    { id: '4:3', label: '4:3', value: 4 / 3 },
    { id: '3:2', label: '3:2', value: 3 / 2 },
    { id: '16:10', label: '16:10', value: 1.6 },
    { id: '16:9', label: '16:9', value: 16 / 9 },
    { id: '2:1', label: '2:1', value: 2 },
    { id: 'gold', label: 'Golden', value: (1 + Math.sqrt(5)) / 2 },
  ];

  function sumArea(items) {
    let s = 0;
    for (let i = 0; i < items.length; i++) s += items[i].area;
    return s;
  }

  function alive(items) {
    const out = [];
    for (let i = 0; i < items.length; i++) if (items[i].area > 0) out.push(items[i]);
    return out;
  }

  // Width and height whose product is totalArea * scale and whose ratio is aspect (w / h).
  function frameOf(totalArea, aspect, scale, origin) {
    const ratio = aspect > 0 ? aspect : 1;
    const k = scale > 0 ? scale : 1;
    const area = Math.max(0, totalArea) * k;
    const h = area > 0 ? Math.sqrt(area / ratio) : 0;
    const w = h * ratio;
    const x = origin ? origin.x : -w / 2;
    const y = origin ? origin.y : -h / 2;
    return { x: x, y: y, w: w, h: h, aspect: ratio, scale: k, area: area };
  }

  function aspectLabel(aspect) {
    for (let i = 0; i < ASPECTS.length; i++) {
      const p = ASPECTS[i];
      if (Math.abs(p.value - aspect) / p.value < 0.004) return p.label;
    }
    const r = Math.round(aspect * 100) / 100;
    return r + ':1';
  }

  // "16:9", "1.5", "200 x 80" all become a width/height ratio.
  function parseAspect(text) {
    const s = String(text == null ? '' : text).trim().toLowerCase().replace(/×/g, 'x');
    if (!s) return null;
    const parts = s.split(/\s*(?::|x|\/)\s*/);
    if (parts.length === 2) {
      const a = Number(parts[0]);
      const b = Number(parts[1]);
      if (Number.isFinite(a / b) && a / b > 0) return a / b;
      return null;
    }
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function worst(row, width) {
    let s = 0;
    let rmin = Infinity;
    let rmax = 0;
    for (let i = 0; i < row.length; i++) {
      const a = row[i].area;
      s += a;
      if (a < rmin) rmin = a;
      if (a > rmax) rmax = a;
    }
    if (!(s > 0) || !(width > 0) || !(rmin > 0)) return Infinity;
    const w2 = width * width;
    const s2 = s * s;
    return Math.max((w2 * rmax) / s2, s2 / (w2 * rmin));
  }

  // Lay a row against the short side of box, then shrink box. The last
  // tile in the row absorbs the rounding so the row meets the far edge.
  function layoutRow(row, box, out, fill) {
    const total = sumArea(row);
    const alongWidth = box.w <= box.h;
    if (alongWidth) {
      const rowH = fill || !(box.w > 0) ? box.h : Math.min(box.h, total / box.w);
      let x = box.x;
      for (let i = 0; i < row.length; i++) {
        const w = i === row.length - 1 ? box.x + box.w - x : (rowH > 0 ? row[i].area / rowH : 0);
        out.push({ id: row[i].id, x: x, y: box.y, w: Math.max(0, w), h: Math.max(0, rowH) });
        x += w;
      }
      box.y += rowH;
      box.h -= rowH;
    } else {
      const rowW = fill || !(box.h > 0) ? box.w : Math.min(box.w, total / box.h);
      let y = box.y;
      for (let i = 0; i < row.length; i++) {
        const h = i === row.length - 1 ? box.y + box.h - y : (rowW > 0 ? row[i].area / rowW : 0);
        out.push({ id: row[i].id, x: box.x, y: y, w: Math.max(0, rowW), h: Math.max(0, h) });
        y += h;
      }
      box.x += rowW;
      box.w -= rowW;
    }
  }

  // Bruls, Huizing, van Wijk. ordered keeps the incoming sequence;
  // otherwise the largest weight is placed first.
  function squarify(items, rect, ordered) {
    const list = alive(items).map((it) => ({ id: it.id, area: it.area }));
    if (!ordered) list.sort((a, b) => b.area - a.area || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const out = [];
    if (!list.length || !(rect.w > 0) || !(rect.h > 0)) return out;
    if (list.length === 1) {
      out.push({ id: list[0].id, x: rect.x, y: rect.y, w: rect.w, h: rect.h });
      return out;
    }
    const box = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    let i = 0;
    while (i < list.length && box.w > 1e-9 && box.h > 1e-9) {
      const width = Math.min(box.w, box.h);
      const row = [list[i]];
      i += 1;
      while (i < list.length && worst(row.concat([list[i]]), width) <= worst(row, width)) {
        row.push(list[i]);
        i += 1;
      }
      layoutRow(row, box, out, i >= list.length);
    }
    return out;
  }

  // Horizontal strips across the full width. The row grows while its
  // worst aspect does not get worse.
  function strip(items, rect) {
    const list = alive(items);
    const out = [];
    if (!list.length || !(rect.w > 0) || !(rect.h > 0)) return out;
    const box = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    let i = 0;
    while (i < list.length && box.h > 1e-9) {
      const row = [list[i]];
      i += 1;
      while (i < list.length && worst(row.concat([list[i]]), box.w) <= worst(row, box.w)) {
        row.push(list[i]);
        i += 1;
      }
      const last = i >= list.length;
      const total = sumArea(row);
      const rowH = last || !(box.w > 0) ? box.h : Math.min(box.h, total / box.w);
      let x = box.x;
      for (let k = 0; k < row.length; k++) {
        const w = k === row.length - 1 ? box.x + box.w - x : (rowH > 0 ? row[k].area / rowH : 0);
        out.push({ id: row[k].id, x: x, y: box.y, w: Math.max(0, w), h: Math.max(0, rowH) });
        x += w;
      }
      box.y += rowH;
      box.h -= rowH;
    }
    return out;
  }

  // horizontal: bands stacked down the rectangle. Otherwise columns across it.
  function bands(items, rect, horizontal) {
    const list = alive(items);
    const out = [];
    const total = sumArea(list);
    if (!list.length || !(total > 0) || !(rect.w > 0) || !(rect.h > 0)) return out;
    if (horizontal) {
      let y = rect.y;
      for (let i = 0; i < list.length; i++) {
        const h = i === list.length - 1 ? rect.y + rect.h - y : rect.h * (list[i].area / total);
        out.push({ id: list[i].id, x: rect.x, y: y, w: rect.w, h: Math.max(0, h) });
        y += h;
      }
    } else {
      let x = rect.x;
      for (let i = 0; i < list.length; i++) {
        const w = i === list.length - 1 ? rect.x + rect.w - x : rect.w * (list[i].area / total);
        out.push({ id: list[i].id, x: x, y: rect.y, w: Math.max(0, w), h: rect.h });
        x += w;
      }
    }
    return out;
  }

  // Recursive area-halves. Items stay in input order along the cuts.
  function binary(items, rect) {
    const list = alive(items);
    const out = [];
    if (!list.length || !(rect.w > 0) || !(rect.h > 0)) return out;
    const sums = new Array(list.length + 1);
    sums[0] = 0;
    for (let i = 0; i < list.length; i++) sums[i + 1] = sums[i] + list[i].area;
    partition(0, list.length, rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
    return out;

    function partition(i, j, x0, y0, x1, y1) {
      if (i >= j) return;
      if (!(x1 > x0) || !(y1 > y0)) return;
      if (i === j - 1) {
        out.push({ id: list[i].id, x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        return;
      }
      const value = sums[j] - sums[i];
      const valueTarget = sums[i] + value / 2;
      let k = i + 1;
      let hi = j - 1;
      while (k < hi) {
        const mid = (k + hi) >> 1;
        if (sums[mid] < valueTarget) k = mid + 1;
        else hi = mid;
      }
      if (valueTarget - sums[k - 1] < sums[k] - valueTarget && i + 1 < k) k -= 1;
      let vL = sums[k] - sums[i];
      let vR = sums[j] - sums[k];
      if (!(vL > 0) || !(vR > 0)) {
        k = i + 1;
        vL = sums[k] - sums[i];
        vR = sums[j] - sums[k];
      }
      if ((x1 - x0) >= (y1 - y0)) {
        const xk = x0 + (x1 - x0) * (vL / (vL + vR));
        partition(i, k, x0, y0, xk, y1);
        partition(k, j, xk, y0, x1, y1);
      } else {
        const yk = y0 + (y1 - y0) * (vL / (vL + vR));
        partition(i, k, x0, y0, x1, yk);
        partition(k, j, x0, yk, x1, y1);
      }
    }
  }

  function pivotSize(items, rect) {
    const list = alive(items);
    if (!list.length || !(rect.w > 0) || !(rect.h > 0)) return [];
    if (list.length === 1) return [{ id: list[0].id, x: rect.x, y: rect.y, w: rect.w, h: rect.h }];
    let pi = 0;
    for (let i = 1; i < list.length; i++) if (list[i].area > list[pi].area) pi = i;
    const pivot = list[pi];
    const rest = list.slice(0, pi).concat(list.slice(pi + 1));
    const total = sumArea(list);
    const frac = pivot.area / total;
    if (rect.w >= rect.h) {
      const pw = rect.w * frac;
      return [{ id: pivot.id, x: rect.x, y: rect.y, w: pw, h: rect.h }].concat(
        pivotSize(rest, { x: rect.x + pw, y: rect.y, w: rect.w - pw, h: rect.h })
      );
    }
    const ph = rect.h * frac;
    return [{ id: pivot.id, x: rect.x, y: rect.y, w: rect.w, h: ph }].concat(
      pivotSize(rest, { x: rect.x, y: rect.y + ph, w: rect.w, h: rect.h - ph })
    );
  }

  // The middle item sits with everything before it; everything after it
  // takes the remaining band. Recurses, so a long list stays ordered.
  function pivotMiddle(items, rect) {
    const list = alive(items);
    if (!list.length || !(rect.w > 0) || !(rect.h > 0)) return [];
    if (list.length === 1) return [{ id: list[0].id, x: rect.x, y: rect.y, w: rect.w, h: rect.h }];
    const mid = list.length >> 1;
    const pivot = list[mid];
    const before = list.slice(0, mid);
    const after = list.slice(mid + 1);
    const total = sumArea(list);
    const topArea = sumArea(before) + pivot.area;
    const topH = rect.h * (topArea / total);
    const out = [];
    if (!before.length) {
      out.push({ id: pivot.id, x: rect.x, y: rect.y, w: rect.w, h: topH });
    } else {
      const pW = rect.w * (pivot.area / topArea);
      out.push({ id: pivot.id, x: rect.x, y: rect.y, w: pW, h: topH });
      out.push.apply(out, pivotMiddle(before, { x: rect.x + pW, y: rect.y, w: rect.w - pW, h: topH }));
    }
    if (after.length) {
      out.push.apply(out, pivotMiddle(after, { x: rect.x, y: rect.y + topH, w: rect.w, h: rect.h - topH }));
    }
    return out;
  }

  function runAlgorithm(id, items, rect, depth) {
    // Squarify and strip consume geometric areas, while the other strategies
    // consume ratios. Normalize at every nesting level, including scaled frames.
    const total = sumArea(alive(items));
    if (!(total > 0)) return [];
    const factor = rect.w * rect.h / total;
    items = items.map((item) => ({ id: item.id, area: item.area * factor }));
    switch (id) {
      case 'ordered': return squarify(items, rect, true);
      case 'strip': return strip(items, rect);
      case 'slice': return bands(items, rect, true);
      case 'dice': return bands(items, rect, false);
      case 'slicedice': return bands(items, rect, depth % 2 === 0);
      case 'binary': return binary(items, rect);
      case 'pivot': return pivotSize(items, rect);
      case 'middle': return pivotMiddle(items, rect);
      default: return squarify(items, rect, false);
    }
  }

  function groupBy(items, key) {
    const groups = [];
    const index = new Map();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const name = String(it[key] == null || it[key] === '' ? '—' : it[key]);
      let g = index.get(name);
      if (!g) {
        g = { key: name, items: [], area: 0 };
        index.set(name, g);
        groups.push(g);
      }
      g.items.push(it);
      g.area += it.area;
    }
    return groups;
  }

  function layoutLevel(items, rect, algorithm, keys, depth) {
    const live = alive(items);
    if (!keys.length || !live.length) {
      return { tiles: runAlgorithm(algorithm, live, rect, depth), groups: [] };
    }
    const grouped = groupBy(live, keys[0]);
    const nodes = grouped.map((g, i) => ({ id: '\u0000' + depth + ':' + i, area: g.area }));
    const outer = runAlgorithm(algorithm, nodes, rect, depth);
    const tiles = [];
    const groups = [];
    const byId = new Map();
    for (let i = 0; i < outer.length; i++) byId.set(outer[i].id, outer[i]);
    for (let i = 0; i < grouped.length; i++) {
      const r = byId.get(nodes[i].id);
      if (!r) continue;
      groups.push({ label: grouped[i].key, depth: depth, x: r.x, y: r.y, w: r.w, h: r.h });
      const inner = layoutLevel(grouped[i].items, r, algorithm, keys.slice(1), depth + 1);
      tiles.push.apply(tiles, inner.tiles);
      groups.push.apply(groups, inner.groups);
    }
    return { tiles: tiles, groups: groups };
  }

  function nestKeys(nest) {
    if (nest === 'both') return ['dept', 'group'];
    if (nest === 'dept') return ['dept'];
    return [];
  }

  function pack(items, rect, options) {
    const o = options || {};
    return layoutLevel(items || [], rect, o.algorithm || 'squarify', nestKeys(o.nest), 0);
  }

  // A straight cut: every tile on the left of x (or above y) spans the same
  // interval as every tile on the right, with no holes. Dragging it keeps
  // a tiling. Partial corners are not cuts.
  function spanOf(tiles, origin, size) {
    if (!tiles.length) return null;
    const parts = tiles.map((t) => ({ a: t[origin], b: t[origin] + t[size] })).sort((p, q) => p.a - q.a);
    let a = parts[0].a;
    let b = parts[0].b;
    for (let i = 1; i < parts.length; i++) {
      if (parts[i].a > b + 1e-4) return null;
      if (parts[i].b > b) b = parts[i].b;
    }
    return { a: a, b: b };
  }

  function findCut(tiles, x, y, tol) {
    let best = null;
    let bestD = tol;
    const xs = [];
    const ys = [];
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      xs.push(t.x, t.x + t.w);
      ys.push(t.y, t.y + t.h);
    }
    const unique = (arr) => {
      const s = arr.slice().sort((a, b) => a - b);
      const out = [];
      for (let i = 0; i < s.length; i++) if (!out.length || s[i] - out[out.length - 1] > 1e-3) out.push(s[i]);
      return out;
    };
    const frameL = Math.min.apply(null, tiles.map((t) => t.x));
    const frameR = Math.max.apply(null, tiles.map((t) => t.x + t.w));
    const frameT = Math.min.apply(null, tiles.map((t) => t.y));
    const frameB = Math.max.apply(null, tiles.map((t) => t.y + t.h));
    unique(xs).forEach((edge) => {
      if (Math.abs(edge - frameL) < 1e-3 || Math.abs(edge - frameR) < 1e-3) return;
      if (Math.abs(x - edge) > tol) return;
      const left = [];
      const right = [];
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        if (Math.abs(t.x + t.w - edge) <= 1e-3) left.push(t);
        else if (Math.abs(t.x - edge) <= 1e-3) right.push(t);
      }
      if (!left.length || !right.length) return;
      const ls = spanOf(left, 'y', 'h');
      const rs = spanOf(right, 'y', 'h');
      if (!ls || !rs || Math.abs(ls.a - rs.a) > 1e-3 || Math.abs(ls.b - rs.b) > 1e-3) return;
      if (y < ls.a - tol || y > ls.b + tol) return;
      const d = Math.abs(x - edge);
      if (d <= bestD) {
        bestD = d;
        best = { axis: 'v', at: edge, left: left, right: right, a: ls.a, b: ls.b };
      }
    });
    unique(ys).forEach((edge) => {
      if (Math.abs(edge - frameT) < 1e-3 || Math.abs(edge - frameB) < 1e-3) return;
      if (Math.abs(y - edge) > tol) return;
      const top = [];
      const bottom = [];
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        if (Math.abs(t.y + t.h - edge) <= 1e-3) top.push(t);
        else if (Math.abs(t.y - edge) <= 1e-3) bottom.push(t);
      }
      if (!top.length || !bottom.length) return;
      const ts = spanOf(top, 'x', 'w');
      const bs = spanOf(bottom, 'x', 'w');
      if (!ts || !bs || Math.abs(ts.a - bs.a) > 1e-3 || Math.abs(ts.b - bs.b) > 1e-3) return;
      if (x < ts.a - tol || x > ts.b + tol) return;
      const d = Math.abs(y - edge);
      if (d <= bestD) {
        bestD = d;
        best = { axis: 'h', at: edge, top: top, bottom: bottom, a: ts.a, b: ts.b };
      }
    });
    return best;
  }

  // How far a cut can travel before a tile on either side collapses.
  function clampCut(cut, delta, minSide) {
    const min = minSide > 0 ? minSide : 0.5;
    let lo = -Infinity;
    let hi = Infinity;
    if (cut.axis === 'v') {
      for (let i = 0; i < cut.left.length; i++) lo = Math.max(lo, -(cut.left[i].w - min));
      for (let i = 0; i < cut.right.length; i++) hi = Math.min(hi, cut.right[i].w - min);
    } else {
      for (let i = 0; i < cut.top.length; i++) lo = Math.max(lo, -(cut.top[i].h - min));
      for (let i = 0; i < cut.bottom.length; i++) hi = Math.min(hi, cut.bottom[i].h - min);
    }
    if (lo > hi) return 0;
    return Math.max(lo, Math.min(hi, delta));
  }

  function applyCut(cut, delta) {
    if (cut.axis === 'v') {
      for (let i = 0; i < cut.left.length; i++) cut.left[i].w += delta;
      for (let i = 0; i < cut.right.length; i++) {
        cut.right[i].x += delta;
        cut.right[i].w -= delta;
      }
    } else {
      for (let i = 0; i < cut.top.length; i++) cut.top[i].h += delta;
      for (let i = 0; i < cut.bottom.length; i++) {
        cut.bottom[i].y += delta;
        cut.bottom[i].h -= delta;
      }
    }
    cut.at += delta;
  }

  function covers(tiles, rect, errors, label) {
    const area = rect.w * rect.h;
    let got = 0;
    const ids = new Set();
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (!(t.w > 0) || !(t.h > 0)) errors.push(label + ' has an empty tile ' + t.id);
      if (t.x < rect.x - 1e-4 || t.y < rect.y - 1e-4 || t.x + t.w > rect.x + rect.w + 1e-4 || t.y + t.h > rect.y + rect.h + 1e-4) {
        errors.push(label + ' tile ' + t.id + ' leaves the frame');
      }
      got += t.w * t.h;
      if (ids.has(t.id)) errors.push(label + ' repeats ' + t.id);
      ids.add(t.id);
      for (let j = i + 1; j < tiles.length; j++) {
        const u = tiles[j];
        const ow = Math.min(t.x + t.w, u.x + u.w) - Math.max(t.x, u.x);
        const oh = Math.min(t.y + t.h, u.y + u.h) - Math.max(t.y, u.y);
        if (ow > 1e-4 && oh > 1e-4) errors.push(label + ' overlaps ' + t.id + ' and ' + u.id);
      }
    }
    if (Math.abs(got - area) > Math.max(1e-4, area * 1e-6)) errors.push(label + ' area ' + got + ' != ' + area);
    return ids;
  }

  // Recover the slicing topology of a treemap. Reflowing this tree only moves
  // seams on the edited leaves' ancestor paths; unrelated branches stay put.
  function treeOf(tiles) {
    if (!tiles.length) return null;
    if (tiles.length === 1) return { id: tiles[0].id };
    const eps = 1e-7;
    for (const axis of ['x', 'y']) {
      const size = axis === 'x' ? 'w' : 'h';
      const edges = [...new Set(tiles.map((t) => t[axis] + t[size]))].sort((a, b) => a - b);
      for (const edge of edges) {
        const a = tiles.filter((t) => t[axis] + t[size] <= edge + eps);
        const b = tiles.filter((t) => t[axis] >= edge - eps);
        if (!a.length || !b.length || a.length + b.length !== tiles.length) continue;
        const left = treeOf(a), right = treeOf(b);
        if (left && right) return { axis: axis, a: left, b: right };
      }
    }
    return null;
  }

  function pruneTree(tree, ids) {
    if (!tree) return null;
    if (tree.id != null) return ids.has(tree.id) ? tree : null;
    const a = pruneTree(tree.a, ids), b = pruneTree(tree.b, ids);
    return a && b ? { axis: tree.axis, a, b } : a || b;
  }

  function layoutTree(tree, items, rect, progress = 1) {
    const weights = new Map(items.map((it) => [it.id, it.area]));
    const sums = new Map();
    function weight(node) {
      if (!node) return 0;
      let area;
      if (node.id != null) area = (weights.get(node.id) || 0) * (node.slot === 'from' ? 1 - progress : node.slot === 'to' ? progress : 1);
      else area = weight(node.a) + weight(node.b);
      sums.set(node, area);
      return area;
    }
    weight(tree);
    const out = [];
    function visit(node, box) {
      if (!node || !(sums.get(node) > 0)) return;
      if (node.id != null) { out.push({ ...box, id: node.id }); return; }
      const f = sums.get(node.a) / sums.get(node);
      if (node.axis === 'x') {
        visit(node.a, { x: box.x, y: box.y, w: box.w * f, h: box.h });
        visit(node.b, { x: box.x + box.w * f, y: box.y, w: box.w * (1 - f), h: box.h });
      } else {
        visit(node.a, { x: box.x, y: box.y, w: box.w, h: box.h * f });
        visit(node.b, { x: box.x, y: box.y + box.h * f, w: box.w, h: box.h * (1 - f) });
      }
    }
    visit(tree, rect);
    return out;
  }

  function insertTree(tree, id, targetId, side, transfer = false) {
    if (!tree) return null;
    if (tree.id != null) {
      if (tree.id === id) return transfer ? { id, slot: 'from' } : null;
      if (tree.id !== targetId) return { ...tree };
      const arrival = transfer ? { id, slot: 'to' } : { id };
      const before = side === 'left' || side === 'top';
      return { axis: side === 'left' || side === 'right' ? 'x' : 'y', a: before ? arrival : { ...tree }, b: before ? { ...tree } : arrival };
    }
    const a = insertTree(tree.a, id, targetId, side, transfer);
    const b = insertTree(tree.b, id, targetId, side, transfer);
    return a && b ? { axis: tree.axis, a, b } : a || b;
  }

  function localMove(tiles, items, rect, id, targetId, side) {
    const base = treeOf(tiles);
    if (!base || id === targetId || !tiles.some((t) => t.id === targetId)) return null;
    const tree = insertTree(base, id, targetId, side);
    const transition = insertTree(base, id, targetId, side, true);
    return { tree, transition, tiles: layoutTree(tree, items, rect) };
  }

  // Move a selection as one branch, preserving its relative slicing topology.
  // Copies use new IDs while leaving the source branch intact.
  function localMoveMany(tiles, items, rect, ids, targetId, side, copies) {
    const base = treeOf(tiles), moving = new Set(ids);
    if (!base || (!copies && moving.has(targetId)) || !tiles.some(t => t.id === targetId)) return null;
    const branch = pruneTree(base, moving);
    if (!branch) return null;
    function arrival(node, transfer) {
      if (node.id != null) return { id: copies?.get(node.id) || node.id, ...(transfer ? {slot: 'to'} : {}) };
      return {axis: node.axis, a: arrival(node.a, transfer), b: arrival(node.b, transfer)};
    }
    function insert(node, transfer) {
      if (node.id != null) {
        if (!copies && moving.has(node.id)) return transfer ? {id: node.id, slot: 'from'} : null;
        if (node.id !== targetId) return {...node};
        const add = arrival(branch, transfer && !copies), before = side === 'left' || side === 'top';
        return {axis: side === 'left' || side === 'right' ? 'x' : 'y', a: before ? add : {...node}, b: before ? {...node} : add};
      }
      const a = insert(node.a, transfer), b = insert(node.b, transfer);
      return a && b ? {axis: node.axis, a, b} : a || b;
    }
    const tree = insert(base, false), transition = insert(base, true);
    return {tree, transition, tiles: layoutTree(tree, items, rect)};
  }

  function selfTest() {
    const errors = [];
    const items = [
      { id: 'a', area: 6000, dept: 'Shop', group: 'Shop' },
      { id: 'b', area: 3200, dept: 'Shop', group: 'Team' },
      { id: 'c', area: 1800, dept: 'Offices', group: 'Faculty' },
      { id: 'd', area: 900, dept: 'Offices', group: 'Faculty' },
      { id: 'e', area: 400, dept: 'Offices', group: 'Staff' },
      { id: 'f', area: 200, dept: 'Support', group: 'Dock' },
    ];
    const total = sumArea(items);
    const frame = frameOf(total, 1.6, 1);
    if (Math.abs(frame.w / frame.h - 1.6) > 1e-9) errors.push('frame aspect');
    if (Math.abs(frame.w * frame.h - total) > 1e-6) errors.push('frame area');
    const grown = frameOf(total, 1.6, 2, { x: frame.x, y: frame.y });
    if (Math.abs(grown.w / grown.h - 1.6) > 1e-9 || Math.abs(grown.area - total * 2) > 1e-4) errors.push('scaled frame lost its lock');
    if (parseAspect('16:9') !== 16 / 9 || parseAspect('2 x 1') !== 2 || parseAspect('1.25') !== 1.25) errors.push('aspect parse');
    if (aspectLabel(1.6) !== '16:10') errors.push('aspect label');

    for (let a = 0; a < ALGORITHMS.length; a++) {
      const id = ALGORITHMS[a].id;
      for (let n = 0; n < NESTS.length; n++) {
        const nest = NESTS[n].id;
        const laid = pack(items, frame, { algorithm: id, nest: nest });
        const ids = covers(laid.tiles, frame, errors, id + '/' + nest);
        for (let i = 0; i < items.length; i++) if (!ids.has(items[i].id)) errors.push(id + '/' + nest + ' dropped ' + items[i].id);
        if (nest === 'flat' && laid.groups.length) errors.push(id + ' flat drew groups');
        if (nest === 'dept' && laid.groups.length !== 3) errors.push(id + ' dept groups ' + laid.groups.length);
      }
    }

    for (const ratio of [0.5, 1, 1.6, 2, 3.7]) {
      for (const scale of [0.2, 0.72, 1, 2, 8]) {
        const box = frameOf(total, ratio, scale);
        for (const algo of ALGORITHMS) for (const nest of NESTS) {
          const label = algo.id + '/' + nest.id + '/' + ratio + '/' + scale;
          const tiles = pack(items.concat([{ id: 'zero', area: 0 }]), box, { algorithm: algo.id, nest: nest.id }).tiles;
          const ids = covers(tiles, box, errors, label);
          if (ids.size !== items.length || ids.has('zero')) errors.push(label + ' wrong ids');
          for (const item of items) {
            const tile = tiles.find((t) => t.id === item.id);
            if (!tile || Math.abs(tile.w * tile.h - item.area * scale) > 1e-6 * total * scale) errors.push(label + ' wrong area for ' + item.id);
          }
        }
      }
    }

    const one = pack([{ id: 'only', area: 10, dept: 'A', group: '' }], frameOf(10, 1, 1), { algorithm: 'squarify', nest: 'flat' });
    if (one.tiles.length !== 1 || Math.abs(one.tiles[0].w - one.tiles[0].h) > 1e-6) errors.push('a single space should fill the square');

    const zeros = pack([{ id: 'z', area: 0, dept: 'A', group: '' }, { id: 'y', area: 5, dept: 'A', group: '' }], frameOf(5, 1, 1), { algorithm: 'slice', nest: 'flat' });
    if (zeros.tiles.length !== 1 || zeros.tiles[0].id !== 'y') errors.push('a zero area was drawn');

    const side = pack(
      [{ id: 'l', area: 30 }, { id: 'r', area: 10 }],
      { x: 0, y: 0, w: 40, h: 10 },
      { algorithm: 'dice', nest: 'flat' }
    );
    const cut = findCut(side.tiles, 30, 5, 2);
    if (!cut || cut.axis !== 'v') errors.push('a column boundary was not a cut');
    else {
      const d = clampCut(cut, 4, 1);
      applyCut(cut, d);
      covers(side.tiles, { x: 0, y: 0, w: 40, h: 10 }, errors, 'after cut');
      const left = side.tiles.find((t) => t.id === 'l');
      if (Math.abs(left.w - 34) > 1e-6) errors.push('cut did not move: ' + left.w);
    }
    const stuck = clampCut({ axis: 'v', left: [{ w: 1 }], right: [{ w: 1 }] }, 5, 1);
    if (stuck !== 0) errors.push('a cut was allowed to collapse a tile');

    // Squarified should beat a single slice on a set of very different areas,
    // measured by the worst tile aspect.
    function worstAspect(tiles) {
      let m = 1;
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        const r = Math.max(t.w / t.h, t.h / t.w);
        if (r > m) m = r;
      }
      return m;
    }
    const varied = [];
    for (let i = 0; i < 12; i++) varied.push({ id: 'v' + i, area: i < 2 ? 5000 : 200, dept: 'D', group: 'G' });
    const box = frameOf(sumArea(varied), 1.4, 1);
    const sq = worstAspect(pack(varied, box, { algorithm: 'squarify', nest: 'flat' }).tiles);
    const sl = worstAspect(pack(varied, box, { algorithm: 'slice', nest: 'flat' }).tiles);
    if (!(sq < sl)) errors.push('squarify was not fatter than slice: ' + sq + ' vs ' + sl);

    return errors;
  }

  return {
    ALGORITHMS: ALGORITHMS,
    NESTS: NESTS,
    ASPECTS: ASPECTS,
    sumArea: sumArea,
    frameOf: frameOf,
    aspectLabel: aspectLabel,
    parseAspect: parseAspect,
    pack: pack,
    findCut: findCut,
    clampCut: clampCut,
    applyCut: applyCut,
    treeOf: treeOf,
    pruneTree: pruneTree,
    layoutTree: layoutTree,
    insertTree: insertTree,
    localMove: localMove,
    localMoveMany: localMoveMany,
    selfTest: selfTest,
  };
});
