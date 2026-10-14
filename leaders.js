'use strict';

// Screen-space callouts shared by the plan and isometric boards. Every
// diagonal has a 1:1 rise/run, followed by a horizontal landing. Placement is
// deterministic and follows the projected Y of the host, not its data order.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProgramLeaders = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  function layout(points, viewport, options) {
    const o = options || {};
    // The diagram frame owns its callouts. Work in frame-local coordinates,
    // then return screen coordinates so every mode can use the same layout.
    if (o.frame && !o.frameLocal) {
      const f = o.frame;
      const x = Math.max(0, Number(f.x) || 0), y = Math.max(0, Number(f.y) || 0);
      const right = Math.min(viewport.width, (Number(f.x) || 0) + Math.max(0, Number(f.w) || 0));
      const bottom = Math.min(viewport.height, (Number(f.y) || 0) + Math.max(0, Number(f.h) || 0));
      if (right <= x || bottom <= y) return { items: [], hidden: 0, hiddenIds: [] };
      const source = new Map();
      const local = (points || []).filter(p => p && p.x >= x && p.y >= y && p.x + p.w <= right && p.y + p.h <= bottom).map(p => {
        source.set(p.id, p);
        return Object.assign({}, p, { x: p.x - x, y: p.y - y });
      });
      const unit = o.scale || 1, inset = o.margin == null ? 9 * unit : o.margin;
      const columnWidth = Math.min(o.labelWidth || 184 * unit, (right - x) * .23);
      const eligible = local.filter(p => Math.min(p.w,p.h) <= (Number(o.threshold)||0) && String(p.text||'').trim());
      const columns = {};
      // A packed cluster of small rooms should not send its leaders across
      // the entire program. Keep a vertical column beside that cluster.
      if (eligible.length && eligible.every(p => p.x + p.w / 2 > (right - x) * .6)) columns.leftX = Math.max(inset,Math.min(right-x-columnWidth*2-40*unit,Math.min(...eligible.map(p=>p.x))-columnWidth-54*unit));
      if (eligible.length && eligible.every(p => p.x + p.w / 2 < (right - x) * .4)) columns.rightX = Math.min(right-x-inset-columnWidth,Math.max(inset+columnWidth+40*unit,Math.max(...eligible.map(p=>p.x+p.w))+54*unit));
      const result = layout(local, { width: right - x, height: bottom - y }, Object.assign({}, o, {
        frameLocal: true, frame: null, margin: o.margin == null ? 9 * (o.scale || 1) : o.margin,
        top: o.top == null ? 10 * (o.scale || 1) : o.top, bottom: o.bottom == null ? 10 * (o.scale || 1) : o.bottom,
      }, columns));
      result.items.forEach(item => {
        item.source = source.get(item.id);
        for (const key of ['anchor', 'elbow', 'end', 'label']) { item[key].x += x; item[key].y += y; }
      });
      if (Array.isArray(o.polygon) && o.polygon.length >= 3) {
        const inside = p => {
          let hit = false;
          for (let i = 0, j = o.polygon.length - 1; i < o.polygon.length; j = i++) {
            const a = o.polygon[i], b = o.polygon[j];
            if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
          }
          return hit;
        };
        result.items = result.items.filter(item => {
          const b = item.label;
          const valid = [item.anchor, item.elbow, item.end, {x:b.x-3,y:b.y-2}, {x:b.x+b.w+3,y:b.y-2}, {x:b.x-3,y:b.y+b.h+2}, {x:b.x+b.w+3,y:b.y+b.h+2}].every(inside);
          if (!valid) result.hiddenIds.push(item.id);
          return valid;
        });
        result.hidden = result.hiddenIds.length;
      }
      result.frame = { x, y, w: right - x, h: bottom - y };
      return result;
    }
    const width = Math.max(1, Number(viewport.width) || 1);
    const height = Math.max(1, Number(viewport.height) || 1);
    const threshold = Math.max(0, Number(o.threshold) || 0);
    if (!threshold) return { items: [], hidden: 0, hiddenIds: [] };
    const scale = Math.max(0.001, Number(o.scale) || 1);
    const margin = Math.max(0, o.margin == null ? 20 * scale : o.margin);
    const top = Math.max(margin, o.top == null ? margin : o.top);
    const bottom = Math.max(margin, o.bottom == null ? margin : o.bottom);
    const labelWidth = Math.max(1, Math.min(o.labelWidth || 184 * scale, width * 0.23));
    const labelHeight = Math.max(1, o.labelHeight || 22 * scale);
    const gap = Math.max(labelHeight + 3 * scale, o.gap || 27 * scale);
    const landing = 8 * scale;
    const minHorizontal = 8 * scale;
    const leftX = o.leftX == null ? margin : clamp(o.leftX,margin,width-margin-labelWidth);
    const rightX = o.rightX == null ? width - margin - labelWidth : clamp(o.rightX,margin,width-margin-labelWidth);
    const leftEnd = leftX + labelWidth + landing;
    const rightEnd = rightX - landing;
    const sides = { left: [], right: [] };
    const hiddenIds = [];

    (points || []).forEach((p) => {
      if (!p || !String(p.text || '').trim() || ![p.x, p.y, p.w, p.h].every(Number.isFinite)) return;
      if (!(p.w > 0 && p.h > 0) || Math.min(p.w, p.h) > threshold) return;
      if (p.x > width || p.y > height || p.x + p.w < 0 || p.y + p.h < 0) return;
      const cy = p.y + p.h * 0.5;
      const leftRun = p.x - leftEnd - minHorizontal;
      const rightRun = rightEnd - p.x - p.w - minHorizontal;
      let side = p.x + p.w * 0.5 < width * 0.5 ? 'left' : 'right';
      if ((side === 'left' ? leftRun : rightRun) < 2 * scale) side = side === 'left' ? 'right' : 'left';
      const run = side === 'left' ? leftRun : rightRun;
      if (run < 0 || height - bottom - top < labelHeight) {
        hiddenIds.push(p.id);
        return;
      }
      sides[side].push({ p: p, cy: cy, run: run, lo: Math.max(top + labelHeight / 2, cy - run), hi: Math.min(height - bottom - labelHeight / 2, cy + run) });
    });

    const items = [];
    ['left', 'right'].forEach((side) => {
      let list = sides[side].sort((a, b) => a.cy - b.cy || a.p.x - b.p.x || String(a.p.id).localeCompare(String(b.p.id)));
      const capacity = Math.max(0, Math.floor((height - top - bottom - labelHeight) / gap) + 1);
      if (list.length > capacity) {
        const chosen = new Set();
        for (let i = 0; i < capacity; i++) chosen.add(capacity === 1 ? Math.floor(list.length / 2) : Math.round(i * (list.length - 1) / (capacity - 1)));
        list = list.filter((e, i) => { if (chosen.has(i)) return true; hiddenIds.push(e.p.id); return false; });
      }
      // Each host constrains how far a 45° diagonal can travel before its
      // horizontal landing. Remove only an infeasible callout, keeping its
      // original inside label visible. This avoids reversed doglegs.
      for (let retry = list.length; retry >= 0 && list.length; retry--) {
        let next = height - bottom + gap;
        let bad = -1;
        for (let i = list.length - 1; i >= 0; i--) {
          const e = list[i];
          e.upper = Math.min(e.hi, next - gap);
          if (e.upper < e.lo) bad = i;
          next = e.upper;
        }
        let prev = top - gap;
        if (bad < 0) {
          for (let i = 0; i < list.length; i++) {
            const e = list[i];
            e.target = clamp(e.cy - 12 * scale, Math.max(e.lo, prev + gap), e.upper);
            if (e.target < prev + gap - 1e-7 || e.target < e.lo - 1e-7 || e.target > e.upper + 1e-7) { bad = i; break; }
            prev = e.target;
          }
        }
        if (bad < 0) break;
        hiddenIds.push(list[bad].p.id);
        list.splice(bad, 1);
      }
      list.forEach((e) => {
        const p = e.p;
        const sign = side === 'left' ? -1 : 1;
        const ax = side === 'left' ? p.x : p.x + p.w;
        let ay = e.cy;
        if (Math.abs(e.target - ay) < 0.01 * scale) ay += Math.min(p.h * 0.25, 0.5 * scale);
        const elbowX = ax + sign * Math.abs(e.target - ay);
        items.push({
          id: p.id, side: side, text: String(p.text), source: p,
          anchor: { x: ax, y: ay }, elbow: { x: elbowX, y: e.target },
          end: { x: side === 'left' ? leftEnd : rightEnd, y: e.target },
          label: { x: side === 'left' ? leftX : rightX, y: e.target - labelHeight / 2, w: labelWidth, h: labelHeight },
        });
      });
    });
    return { items: items, hidden: hiddenIds.length, hiddenIds: hiddenIds };
  }

  return { layout: layout, ANGLE: 45 };
});
