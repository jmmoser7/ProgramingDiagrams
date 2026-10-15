(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.InteractionScenePrecision=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  // Screen crossings are candidates, not proof that two modeled edges meet.
  function trueIntersection(projectedA,modelA,projectedB,modelB){
    const [a,b]=projectedA,[c,d]=projectedB,dx=b.x-a.x,dy=b.y-a.y,ex=d.x-c.x,ey=d.y-c.y,den=dx*ey-dy*ex;
    if(Math.abs(den)<1e-10)return null;
    const t=((c.x-a.x)*ey-(c.y-a.y)*ex)/den,u=((c.x-a.x)*dy-(c.y-a.y)*dx)/den;
    if(t < -1e-9||t > 1+1e-9||u < -1e-9||u > 1+1e-9)return null;
    const interpolate=(edge,v)=>Object.fromEntries(['x','y','z'].map(key=>[key,(edge[0][key]||0)+((edge[1][key]||0)-(edge[0][key]||0))*v]));
    const p=interpolate(modelA,t),q=interpolate(modelB,u),length=edge=>Math.hypot(edge[1].x-edge[0].x,edge[1].y-edge[0].y,(edge[1].z||0)-(edge[0].z||0)),scale=Math.max(1,length(modelA),length(modelB)),magnitude=Math.max(1,...[...modelA,...modelB].flatMap(v=>[Math.abs(v.x),Math.abs(v.y),Math.abs(v.z||0)]));
    if(Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)>Math.max(scale*1e-9,magnitude*Number.EPSILON*32))return null;
    return {point:{x:a.x+dx*t,y:a.y+dy*t},modelPoint:p,t,u};
  }
  return {trueIntersection};
});
