'use strict';
const assert = require('node:assert/strict');
const {constrainDirection} = require('./direction-constraint.js');
const near = (actual, expected) => {
  assert.ok(Math.abs(actual.x-expected.x)<1e-9, 'constrained x: '+actual.x+' vs '+expected.x);
  assert.ok(Math.abs(actual.y-expected.y)<1e-9, 'constrained y: '+actual.y+' vs '+expected.y);
};
const anchor = {x:13,y:-29};
for (let degrees = -180; degrees < 180; degrees += 45) {
  const direction = degrees * Math.PI/180, rawAngle = (degrees+9)*Math.PI/180;
  const raw = {x:anchor.x+80*Math.cos(rawAngle),y:anchor.y+80*Math.sin(rawAngle)};
  const length = 80*Math.cos(9*Math.PI/180);
  near(constrainDirection(raw,anchor,45),{x:anchor.x+length*Math.cos(direction),y:anchor.y+length*Math.sin(direction)});
}
near(constrainDirection({x:8,y:7},{x:0,y:0},45),{x:7.5,y:7.5});
near(constrainDirection({x:-8,y:7},{x:0,y:0},45),{x:-7.5,y:7.5});
near(constrainDirection({x:8,y:-7},{x:0,y:0},45),{x:7.5,y:-7.5});
near(constrainDirection({x:-8,y:-7},{x:0,y:0},45),{x:-7.5,y:-7.5});
for (const [raw,expected] of [
  [{x:30,y:10},{x:30,y:0}],[{x:-30,y:10},{x:-30,y:0}],
  [{x:10,y:30},{x:0,y:30}],[{x:10,y:-30},{x:0,y:-30}]
]) assert.deepEqual(constrainDirection(raw,{x:0,y:0}),expected);
assert.deepEqual(constrainDirection(anchor,anchor,45),anchor,'zero motion stays at its anchor');
for (const invalid of [0,-45,NaN,Infinity,180,'45',Number.MIN_VALUE]) {
  assert.deepEqual(constrainDirection({x:30,y:10},{x:0,y:0},invalid),{x:30,y:0},'invalid increments use the safe 90° default');
}
for (const raw of [null,{x:0},{x:NaN,y:0},{x:1,y:Infinity}]) {
  assert.throws(()=>constrainDirection(raw,anchor,45),/finite XY/);
}
near(constrainDirection({x:Math.sqrt(3)*10,y:10},{x:0,y:0},30),{x:Math.sqrt(3)*10,y:10});
console.log('Direction constraint checks passed (45° all quadrants, 90° compatibility, anchors, custom increments and invalid input).');
