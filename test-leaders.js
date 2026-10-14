'use strict';

const assert = require('assert');
const leaders = require('./leaders.js');

const points = Array.from({ length: 18 }, (_, i) => ({
  id: 'cell-' + i, x: i % 2 ? 620 : 350, y: 90 + i * 20,
  w: 14, h: 12, text: 'Room ' + i,
}));
const viewport = { width: 1000, height: 620 };
assert.strictEqual(leaders.layout(points, viewport, { threshold: 0 }).items.length, 0);
assert.strictEqual(leaders.layout(points, viewport, { threshold: 8 }).items.length, 0);

function check(result) {
  assert(result.items.length > 0);
  result.items.forEach((e) => {
    const dx = e.elbow.x - e.anchor.x;
    const dy = e.elbow.y - e.anchor.y;
    assert(Math.abs(Math.abs(dx) - Math.abs(dy)) < 1e-7, 'Every diagonal stays at 45 degrees');
    assert(Math.abs(dx) > 0, 'Diagonal has a visible direction');
    assert.strictEqual(e.elbow.y, e.end.y, 'Landing is horizontal');
    assert(e.side === 'left' ? dx < 0 && e.elbow.x >= e.end.x : dx > 0 && e.elbow.x <= e.end.x, 'Leader travels outward without reversing');
    assert(e.label.y >= 20 && e.label.y + e.label.h <= viewport.height - 20, 'Label stays inside viewport');
  });
  ['left', 'right'].forEach((side) => {
    const list = result.items.filter((e) => e.side === side);
    for (let i = 1; i < list.length; i++) {
      assert(list[i].source.y >= list[i - 1].source.y, 'Stack follows host Y order');
      assert(list[i].label.y >= list[i - 1].label.y + list[i - 1].label.h + 2.99, 'Stack has no text overlaps');
    }
  });
}

const normal = leaders.layout(points, viewport, { threshold: 30 });
check(normal);
assert.strictEqual(normal.items.length, points.length);
assert.deepStrictEqual(normal, leaders.layout(points.slice().reverse(), viewport, { threshold: 30 }), 'Input data order does not change placement');

const dense = Array.from({ length: 200 }, (_, i) => ({ id: i, x: 420 + (i % 2) * 150, y: 250 + i * 0.2, w: 10, h: 10, text: 'Dense ' + i }));
const result = leaders.layout(dense, viewport, { threshold: 30 });
check(result);
assert.strictEqual(result.items.length + result.hidden, dense.length, 'Dense scenes retain an accurate overflow count');
assert(result.hidden > 0, 'Excess callouts fall back to their cell labels');
console.log('Leader layout: fixed angles, monotone stacks, gutters, thresholds, density, and deterministic placement passed.');

const frame={x:100,y:70,w:760,h:480};
const framed=leaders.layout(points,viewport,{threshold:30,frame});
assert(framed.items.length>0,'In-frame callouts remain available');
for(const item of framed.items){
  for(const p of [item.anchor,item.elbow,item.end,{x:item.label.x-3,y:item.label.y-2},{x:item.label.x+item.label.w+3,y:item.label.y+item.label.h+2}]){
    assert(p.x>=frame.x&&p.x<=frame.x+frame.w&&p.y>=frame.y&&p.y<=frame.y+frame.h,'Leader path and text backing stay inside its host frame');
  }
}
const clustered=Array.from({length:6},(_,i)=>({id:'right'+i,x:860,y:170+i*45,w:12,h:12,text:'Small room'}));
const close=leaders.layout(clustered,viewport,{threshold:30,frame:{x:40,y:40,w:920,h:540},labelWidth:140});
assert(close.items.length>0&&close.items.some(item=>item.side==='left'&&item.label.x>400),'Small packed cluster uses a nearby column');
console.log('Frame bounds and nearby packed-cluster columns passed.');
