'use strict';

// The isometric view draws the same editable solids as the plan view. This
// renderer owns only their presentation: geometry, camera and colors arrive
// from the board. No demo objects or alternative layout live in this module.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProgramIsoRenderer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const unit = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const smooth = (a, b, n) => { const t=clamp((n-a)/(b-a),0,1);return t*t*(3-2*t); };
  const rgb = hex => /^#[0-9a-f]{6}$/i.test(hex || '') ? [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) : [0.84, 0.83, 0.81];
  const linear = c => c.map(v => Math.pow(v, 2.2));
  const srgb = c => c.map(v => Math.pow(clamp(v, 0, 1), 1 / 2.2));
  const hOf = s => Math.max(0.1, s.height || 8), zOf = s => Math.max(0, s.z || 0);
  const centerOf = s => [s.x + s.w / 2, s.y + s.h / 2, zOf(s) + hOf(s) / 2];
  // Roughness, clear-coat, transmission, frost. Matte is deliberately a
  // low-gloss ceramic surface; jelly has more body than transparent glass.
  const materials = {
    matte: [0.82, 0.08, 0, 0], ceramic: [0.78, 0.10, 0, 0],
    glossy: [0.25, 0.70, 0, 0], jelly: [0.16, 0.95, 0.70, 0.08],
    glass: [0.46, 0.62, 0.66, 0.78]
  };
  const vertexShader = `
    attribute vec3 aPosition, aNormal;
    uniform vec3 uOffset, uCenter, uRight, uUp, uToward;
    uniform vec2 uViewport;
    uniform float uScale, uDepth;
    varying vec3 vNormal, vWorld, vLocal;
    void main(){
      vec3 w=aPosition+uOffset, p=w-uCenter;
      gl_Position=vec4(dot(p,uRight)*uScale*2.0/uViewport.x,
        dot(p,uUp)*uScale*2.0/uViewport.y,-dot(p,uToward)/uDepth,1.0);
      vWorld=w; vLocal=aPosition; vNormal=aNormal;
    }`;
  const fragmentShader = `
    precision highp float;
    uniform vec3 uColor, uToward, uRight, uUp, uLight, uHalf;
    uniform vec4 uMaterial;
    uniform float uSelected, uTop, uRadius, uBase, uBack, uHover;
    uniform vec4 uNearMin[10],uNearMax[10];
    uniform int uNearCount;
    varying vec3 vNormal,vWorld,vLocal;

    // Wide rectangular softboxes, expressed in the reflection's angular
    // domain. Their rounded rectangle falloff reads as studio illumination,
    // rather than a circular highlight stuck to the cell's center.
    float panel(vec3 r, vec3 direction, vec3 axis, vec2 size, float blur){
      vec3 d=normalize(direction), x=normalize(axis-dot(axis,d)*d), y=normalize(cross(d,x));
      float forward=dot(r,d);
      vec2 q=vec2(dot(r,x),dot(r,y))/max(0.15,forward);
      vec2 e=abs(q)-size;
      float distanceToPanel=length(max(e,0.0))+min(max(e.x,e.y),0.0);
      return (1.0-smoothstep(-blur,blur,distanceToPanel))*smoothstep(0.0,0.2,forward);
    }
    float boxRay(vec3 origin,vec3 direction,vec3 lo,vec3 hi){
      vec3 inv=1.0/(direction+vec3(0.00001));
      vec3 a=(lo-origin)*inv,b=(hi-origin)*inv;
      vec3 small=min(a,b),large=max(a,b);
      float near=max(max(small.x,small.y),small.z),far=min(min(large.x,large.y),large.z);
      return step(max(near,0.001),far)*step(0.001,far);
    }
    void main(){
      vec3 n=normalize(vNormal); if(uBack>0.5)n=-n;
      vec3 v=normalize(uToward), reflected=reflect(-v,n);
      float facing=clamp(dot(n,v),0.0,1.0), rough=uMaterial.x;
      float transmit=uMaterial.z,frost=uMaterial.w;
      float ndl=max(0.0,dot(n,uLight));
      float sky=0.5+0.5*n.z;
      // A broad fill preserves color, a smaller key establishes a clear
      // left/right value difference, and a warm floor bounce lifts the base.
      vec3 lit=vec3(0.31)+vec3(0.29,0.30,0.32)*sky+vec3(0.45,0.43,0.40)*ndl;
      float sideGradient=clamp((vLocal.z+uHalf.z)/(uHalf.z*2.0),0.0,1.0);
      lit*=mix(0.80,1.0,smoothstep(0.0,0.9,sideGradient));
      lit*=1.0-0.07*pow(max(0.0,n.z),4.0);
      // Local ambient occlusion is evaluated against neighboring real
      // volumes. It follows moved stacks instead of becoming a baked image.
      float ao=0.0,shadow=0.0;
      for(int i=0;i<10;i++){
        if(i>=uNearCount)break;
        vec3 lo=uNearMin[i].xyz,hi=uNearMax[i].xyz;
        vec3 delta=clamp(vWorld,lo,hi)-vWorld;
        float distanceToBox=length(delta);
        float contactScale=max(0.6,min(hi.x-lo.x,hi.y-lo.y)*0.085);
        float hemi=max(0.0,dot(n,delta/max(0.0001,distanceToBox)));
        ao+=hemi*exp(-distanceToBox/contactScale)*0.36;
        float lift=max(0.0,(lo.z+hi.z)*0.5-vWorld.z);
        vec2 shadowCenter=(lo.xy+hi.xy)*0.5-uLight.xy/uLight.z*lift;
        vec2 shadowHalf=(hi.xy-lo.xy)*0.5;
        float shadowRadius=min(hi.z-lo.z,min(shadowHalf.x,shadowHalf.y))*0.16;
        vec2 q=abs(vWorld.xy-shadowCenter)-shadowHalf+shadowRadius;
        float sd=length(max(q,0.0))+min(max(q.x,q.y),0.0)-shadowRadius;
        float penumbra=max(0.5,(hi.z-lo.z)*0.25+max(0.0,lo.z-vWorld.z)*0.20);
        shadow+=(1.0-smoothstep(-penumbra,penumbra,sd))*step(vWorld.z+0.015,hi.z)*max(0.0,n.z)*0.42;
      }
      float groundContact=(1.0-max(0.0,n.z))*exp(-max(0.0,vWorld.z)/max(0.7,uHalf.z*0.40))*0.12;
      float ambient=clamp(1.0-ao-groundContact,0.46,1.0);
      lit*=ambient*(1.0-clamp(shadow,0.0,0.62)*ndl*0.50);
      vec3 c=uColor*lit;
      float fresnel=0.04+0.96*pow(1.0-facing,5.0);
      vec3 roofReflection=vec3(-v.x,-v.y,v.z);
      float softbox=panel(reflected,normalize(roofReflection-uRight*0.40+vec3(0.0,0.0,0.32)),uRight,vec2(0.95,0.33),mix(0.045,0.52,rough));
      float strip=panel(reflected,normalize(uRight*0.95+uUp*0.28+v*0.72),uUp,vec2(0.66,0.08),mix(0.025,0.43,rough));
      float overhead=panel(reflected,normalize(vec3(0.0,0.0,1.0)+v*0.2),uRight,vec2(0.95,0.70),mix(0.12,0.55,rough));
      vec3 environment=vec3(0.96,0.98,1.0)*(softbox*0.62+strip*0.38+overhead*0.15);
      float coat=uMaterial.y;
      c+=environment*coat*(0.12+fresnel*0.85);
      // Top planes receive a broad, subtle sweep of the softbox across
      // their surface, with no point light hotspot.
      vec2 plane=vLocal.xy/max(uHalf.xy,vec2(0.001));
      float sweep=clamp(0.5+dot(plane,normalize(vec2(uLight.x,uLight.y)))*0.17,0.0,1.0);
      c+=vec3(0.035)*max(n.z,0.0)*sweep;
      float upperBevel=smoothstep(0.02,0.35,n.z)*(1.0-smoothstep(0.83,0.999,n.z));
      c+=vec3(0.10)*upperBevel*coat;
      float alpha=1.0;
      if(transmit>0.0){
        // Beer-Lambert absorption follows the path through this actual
        // rounded volume; grazing faces carry a deeper optical edge tint.
        vec3 backDistance=(uHalf+sign(v)*vLocal)/max(abs(v),vec3(0.05));
        float path=min(min(backDistance.x,backDistance.y),backDistance.z);
        float body=1.0-exp(-max(0.0,path)/(max(0.2,uHalf.z)*4.0));
        float edge=pow(1.0-facing,2.0);
        vec3 tint=pow(max(uColor,vec3(0.025)),vec3(0.64+body*0.14));
        float roofSweep=clamp(0.50+plane.x*0.15-plane.y*0.20,0.0,1.0);
        vec3 roof=mix(vec3(1.0),tint,(0.45+body*0.07+roofSweep*0.13)*(1.0-frost*0.20));
        vec3 wall=mix(tint,vec3(0.96,0.975,0.98),frost*0.16)*mix(0.80,1.06,sky)*mix(0.86,1.04,sideGradient);
        c=mix(wall,roof,smoothstep(0.12,0.96,max(0.0,n.z)));
        c*=ambient*(1.0-clamp(shadow,0.0,0.6)*0.15);
        c+=environment*(0.10+fresnel*0.32)*(1.0-frost*0.70);
        float edgeLight=pow(max(0.0,dot(n,normalize(uLight+v))),mix(64.0,14.0,frost));
        c+=vec3(0.68,0.83,0.91)*edgeLight*0.22*(1.0-frost*0.85);
        c+=vec3(0.015,0.025,0.035)*edge*(1.0-frost*0.45);
        float bloom=0.05*max(0.0,n.z)*clamp(0.65+plane.x*0.2-plane.y*0.13,0.0,1.0);
        float broadReflection=exp(-pow(plane.x*0.65+plane.y*0.42-0.25,2.0)*3.0);
        c+=vec3(bloom)+vec3(0.025,0.030,0.035)*broadReflection*max(n.z,0.0)*(1.0-frost*0.90);
        // The upper fillet catches a long white softbox. A second, weaker
        // edge reflection runs around the base and gives clear solids a
        // visible polished rim instead of a uniformly translucent cap.
        c=mix(c,vec3(0.98,0.995,1.0),upperBevel*0.52*(1.0-frost*0.85));
        float lowerBevel=smoothstep(0.05,0.40,-n.z)*(1.0-smoothstep(0.87,1.0,-n.z));
        c+=vec3(0.08,0.12,0.13)*lowerBevel*(1.0-frost*0.60);
        alpha=mix(0.55,0.78,body)+edge*0.13+frost*0.06;
        if(uBack>0.5){alpha*=0.18;c=mix(vec3(0.97),tint,0.32);}
      }
      c=mix(c,vec3(0.12,0.44,0.38),uSelected*(uTop>0.5?max(0.0,n.z)*0.07:0.0));
      c+=uHover*vec3(0.008);
      // Work in linear light, then encode once for the display. This keeps
      // white ceramics white and colored glass luminous without clipping.
      c=pow(max(c,vec3(0.0)),vec3(1.0/2.2));
      float grain=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-0.5;
      c+=grain*(0.0015+frost*0.003);
      gl_FragColor=vec4(c,clamp(alpha,0.0,0.94+step(transmit,0.0)*0.06));
    }`;

  function create(options) {
    const canvas = options.canvas, ground = options.ground, geo = options.geometry;
    if (!canvas || !ground || !geo) throw new Error('Isometric renderer requires scene, ground and geometry.');
    let floor = ground.getContext('2d');
    const meshes = new Map(), floorCache=document.createElement('canvas'), floorCacheContext=floorCache.getContext('2d');
    let floorCacheKey='';
    let width = 1, height = 1, pixelRatio = 1, gl = null, program = null, uniforms = {}, attributes = {}, fallback = null, mode = 'software';
    let disposed = false, contextLost = false, lastInput = null;
    function compile(kind, source) {
      const shader = gl.createShader(kind); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const err = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(err); }
      return shader;
    }
    function initGL() {
        program = gl.createProgram();
        const v = compile(gl.VERTEX_SHADER, vertexShader), f = compile(gl.FRAGMENT_SHADER, fragmentShader);
        gl.attachShader(program, v); gl.attachShader(program, f); gl.linkProgram(program); gl.deleteShader(v); gl.deleteShader(f);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
        ['Offset','Center','Right','Up','Toward','Viewport','Scale','Depth','Color','Material','Selected','Top','Radius','Base','Half','Light','Back','Hover','NearCount'].forEach(name => { uniforms[name] = gl.getUniformLocation(program, 'u' + name); });
        uniforms.NearMin = gl.getUniformLocation(program, 'uNearMin[0]'); uniforms.NearMax = gl.getUniformLocation(program, 'uNearMax[0]');
        attributes.position = gl.getAttribLocation(program, 'aPosition'); attributes.normal = gl.getAttribLocation(program, 'aNormal');
        gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.CULL_FACE); gl.enable(gl.BLEND);
        // The browser composites this transparent canvas with its studio
        // floor. Accumulate premultiplied RGB with independent alpha to
        // avoid multiplying glass opacity twice and turning it muddy.
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    try {
      if (!options.software) gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
      if (gl) {
        initGL(); mode = 'webgl';
        canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); contextLost = true; });
        canvas.addEventListener('webglcontextrestored', () => {
          if(disposed)return;
          // GPU resources are invalid after restoration. Rebuild them in
          // place so an unsaved edit or selection is never lost to a reload.
          meshes.clear();initGL();contextLost=false;if(lastInput)render(lastInput);
        });
      }
    } catch (error) {
      console.warn('Studio rendering uses the software fallback:', error.message || error); gl = null;
    }
    if (!gl) {
      fallback = canvas.getContext('2d');
      if (!fallback) {
        const surface = document.createElement('canvas'); surface.id='iso-software-surface';surface.setAttribute('aria-hidden','true');surface.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none';
        canvas.after(surface); fallback = surface.getContext('2d');
      }
    }
    function resize(w, h, ratio) {
      width = Math.max(1, w || canvas.clientWidth); height = Math.max(1, h || canvas.clientHeight); pixelRatio = clamp(ratio || devicePixelRatio || 1, 1, 2);
      [canvas, ground, ...(fallback && fallback.canvas !== canvas ? [fallback.canvas] : [])].forEach(c => { const cw = Math.round(width * pixelRatio), ch = Math.round(height * pixelRatio); if(c.width !== cw)c.width = cw; if(c.height !== ch)c.height = ch; });
      floor.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    }
    function meshFor(s) {
      const h = hOf(s), r = geo.radiusFor(s.w, s.h, h, s.radius), key = [s.w, s.h, h, r].map(v => v.toFixed(5)).join('/');
      if (!meshes.has(key)) {
        const mesh = geo.mesh(s.w, s.h, h, r, 8);
        if (gl) {
          mesh.positionBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, mesh.positionBuffer); gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
          mesh.normalBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normalBuffer); gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
        }
        meshes.set(key, mesh);
        if (meshes.size > 160) { const first = meshes.keys().next().value, old = meshes.get(first); if(gl){gl.deleteBuffer(old.positionBuffer);gl.deleteBuffer(old.normalBuffer);} meshes.delete(first); }
      }
      return meshes.get(key);
    }
    function project(point, state) {
      const p = point.map((v, i) => v - [state.camera.x,state.camera.y,state.camera.z][i]);
      return {x: width / 2 + dot(p,state.basis.right) * state.camera.scale, y: height / 2 - dot(p,state.basis.up) * state.camera.scale, z:dot(p,state.basis.toward)};
    }
    function onFloor(x, y, state) {
      const b = state.basis, c = state.camera, sx = (x - width / 2) / c.scale, sy = -(y - height / 2) / c.scale;
      const p = [c.x,c.y,c.z].map((v,i)=>v+b.right[i]*sx+b.up[i]*sy);
      const t = -p[2]/b.toward[2]; return p.map((v,i)=>v+b.toward[i]*t);
    }
    function outline(s, z, state, offset) {
      const r = Math.min(s.w/2,s.h/2,geo.radiusFor(s.w,s.h,hOf(s),s.radius)), points=[];
      for (let corner=0;corner<4;corner++) {
        const cx = s.x+(corner===0||corner===3?s.w-r:r), cy=s.y+(corner<2?s.h-r:r);
        for(let i=0;i<=7;i++) {
          const a=corner*Math.PI/2+i*Math.PI/14;
          points.push(project([cx+r*Math.cos(a)+(offset?offset[0]:0),cy+r*Math.sin(a)+(offset?offset[1]:0),z],state));
        }
      }
      return points;
    }
    function path(context, points) { context.beginPath(); points.forEach((p,i)=>i?context.lineTo(p.x,p.y):context.moveTo(p.x,p.y));context.closePath(); }
    function fillFor(s, state) { return state.fills && state.fills.get(s.id) || s.color || '#d7d6d2'; }
    function materialFor(s) { return materials[s.material] || materials.matte; }
    function colorFor(s, state) {
      // Unpainted matte solids use the architectural white clay reference.
      // This is a material presentation default: the board's canonical fill
      // remains unchanged, and explicit colors or size ramps stay colored.
      if ((s.material || 'matte') === 'matte' && !/^#[0-9a-f]{6}$/i.test(s.color || '') && !s.gradientId) return rgb('#f4f4f2');
      const c = rgb(fillFor(s,state));
      return s.material === 'ceramic' ? mix(c,[0.96,0.965,0.97],0.91) : mix(c,[1,1,1],materialFor(s)[2]>0?0.01:0.10);
    }
    function paintFloor(state) {
      floor.setTransform(pixelRatio,0,0,pixelRatio,0,0); floor.clearRect(0,0,width,height);
      const bg = state.view && /^#[0-9a-f]{6}$/i.test(state.view.background || '') ? state.view.background : '#f6f6f5';
      floor.fillStyle = bg; floor.fillRect(0,0,width,height);
      const glow = floor.createRadialGradient(width*0.32,height*0.18,0,width*0.44,height*0.33,Math.max(width,height)*0.9);
      glow.addColorStop(0,'#ffffffb0');glow.addColorStop(0.64,'#ffffff00');glow.addColorStop(1,'#77808906');floor.fillStyle=glow;floor.fillRect(0,0,width,height);
      const corners = [[0,0],[width,0],[width,height],[0,height]].map(p=>onFloor(p[0],p[1],state));
      const minX=Math.min(...corners.map(p=>p[0])),maxX=Math.max(...corners.map(p=>p[0])),minY=Math.min(...corners.map(p=>p[1])),maxY=Math.max(...corners.map(p=>p[1]));
      let step = Number(state.view && state.view.gridStep) || 10;while(step*state.camera.scale<36)step*=2;while(step*state.camera.scale>105)step/=2;
      if (!state.view || state.view.isoGrid !== false && state.view.grid !== false) {
        floor.strokeStyle='#71818d0c';floor.lineWidth=0.65;
        for(let x=Math.floor(minX/step)*step;x<=maxX;x+=step){const a=project([x,minY,0],state),b=project([x,maxY,0],state);floor.beginPath();floor.moveTo(a.x,a.y);floor.lineTo(b.x,b.y);floor.stroke();}
        for(let y=Math.floor(minY/step)*step;y<=maxY;y+=step){const a=project([minX,y,0],state),b=project([maxX,y,0],state);floor.beginPath();floor.moveTo(a.x,a.y);floor.lineTo(b.x,b.y);floor.stroke();}
      }
      paintShadows(state,state.list);
    }
    function paintShadows(state,list) {
      const light = state.light;
      for(const s of list) {
        const mat=materialFor(s), translucent=mat[2]>0, tint=rgb(fillFor(s,state)), z=zOf(s), h=hOf(s), scale=state.camera.scale;
        const cast=outline(s,0,state,[-light[0]/light[2]*(z+h)*0.58,-light[1]/light[2]*(z+h)*0.58]);
        const shadowColor=translucent?`rgba(${Math.round(tint[0]*190)},${Math.round(tint[1]*190)},${Math.round(tint[2]*190)},0.16)`:'rgba(51,57,62,0.105)';
        floor.save();floor.fillStyle=shadowColor;floor.filter=`blur(${Math.max(5,Math.min(28,(h*0.42+z*0.26)*scale))}px)`;path(floor,cast);floor.fill();floor.restore();
        if(z<0.05) {
          const contact=outline(s,0,state);floor.save();floor.fillStyle=translucent?'rgba(35,44,48,0.045)':'rgba(27,32,36,0.13)';floor.filter=`blur(${Math.max(1.8,Math.min(6,h*scale*0.10))}px)`;path(floor,contact);floor.fill();floor.restore();
        }
        if(translucent) {
          floor.save();floor.fillStyle=`rgba(${Math.round(tint[0]*255)},${Math.round(tint[1]*255)},${Math.round(tint[2]*255)},0.11)`;floor.filter=`blur(${Math.max(7,Math.min(24,h*scale*0.8))}px)`;path(floor,outline(s,0,state));floor.fill();floor.restore();
        }
      }
    }
    function drawFloor(state) {
      // Keep the floor and stationary contact shadows on a separate surface
      // during a drag. Only the held solids' shadows need to move; repeatedly
      // blurring every cell would make a large board feel heavy underhand.
      const moving=state.active && state.selected ? state.list.filter(s=>state.selected.has(s.id)) : [];
      const movingIds=new Set(moving.map(s=>s.id)),stationary=state.list.filter(s=>!movingIds.has(s.id));
      const key=[width,height,pixelRatio,state.camera.x,state.camera.y,state.camera.z,state.camera.scale,...state.basis.right,...state.basis.up,...state.basis.toward,state.view.background,state.view.gridStep,state.view.grid,state.view.isoGrid,
        ...stationary.flatMap(s=>[s.id,s.x,s.y,s.w,s.h,zOf(s),hOf(s),s.radius,s.material,fillFor(s,state)])].join('|');
      if(key!==floorCacheKey){
        const current=floor;
        if(floorCache.width!==ground.width)floorCache.width=ground.width;if(floorCache.height!==ground.height)floorCache.height=ground.height;
        floor=floorCacheContext;paintFloor({...state,list:stationary});floor=current;floorCacheKey=key;
      }
      floor.setTransform(1,0,0,1,0,0);floor.clearRect(0,0,ground.width,ground.height);floor.drawImage(floorCache,0,0);
      floor.setTransform(pixelRatio,0,0,pixelRatio,0,0);if(moving.length)paintShadows(state,moving);
    }
    function neighbors(s, list) {
      const c=centerOf(s), radius=Math.max(s.w,s.h)*1.5+hOf(s)*2;
      return list.filter(t=>t.id!==s.id).map(t=>({s:t,d:Math.hypot(...centerOf(t).map((v,i)=>v-c[i]))-Math.max(t.w,t.h)/2})).filter(t=>t.d<radius).sort((a,b)=>a.d-b.d).slice(0,10).map(t=>t.s);
    }
    function drawGL(state) {
      const b=state.basis,c=state.camera,u=uniforms;
      gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(0,0,0,0);gl.depthMask(true);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(program);
      gl.uniform3fv(u.Center,[c.x,c.y,c.z]);gl.uniform3fv(u.Right,b.right);gl.uniform3fv(u.Up,b.up);gl.uniform3fv(u.Toward,b.toward);
      gl.uniform2f(u.Viewport,width,height);gl.uniform1f(u.Scale,c.scale);gl.uniform1f(u.Depth,state.depth);gl.uniform3fv(u.Light,state.light);
      function draw(s,back) {
        const mesh=meshFor(s),mat=materialFor(s),near=neighbors(s,state.list),lo=new Float32Array(40),hi=new Float32Array(40);
        near.forEach((n,i)=>{lo.set([n.x,n.y,zOf(n),0],i*4);hi.set([n.x+n.w,n.y+n.h,zOf(n)+hOf(n),0],i*4);});
        gl.uniform4fv(u.NearMin,lo);gl.uniform4fv(u.NearMax,hi);gl.uniform1i(u.NearCount,near.length);
        gl.bindBuffer(gl.ARRAY_BUFFER,mesh.positionBuffer);gl.enableVertexAttribArray(attributes.position);gl.vertexAttribPointer(attributes.position,3,gl.FLOAT,false,0,0);
        gl.bindBuffer(gl.ARRAY_BUFFER,mesh.normalBuffer);gl.enableVertexAttribArray(attributes.normal);gl.vertexAttribPointer(attributes.normal,3,gl.FLOAT,false,0,0);
        gl.uniform3fv(u.Offset,centerOf(s));gl.uniform3fv(u.Color,linear(colorFor(s,state)));gl.uniform4fv(u.Material,mat);
        gl.uniform3fv(u.Half,[s.w/2,s.h/2,hOf(s)/2]);gl.uniform1f(u.Radius,mesh.radius);gl.uniform1f(u.Base,zOf(s));
        gl.uniform1f(u.Selected,state.selected && state.selected.has(s.id)?1:0);gl.uniform1f(u.Top,state.topMode?1:0);gl.uniform1f(u.Back,back?1:0);gl.uniform1f(u.Hover,state.hover && state.hover.id===s.id?1:0);
        gl.drawArrays(gl.TRIANGLES,0,mesh.count);
      }
      gl.cullFace(gl.BACK);state.list.filter(s=>materialFor(s)[2]===0).forEach(s=>draw(s,false));
      gl.depthMask(false);
      state.list.filter(s=>materialFor(s)[2]>0).sort((a,b)=>dot(centerOf(a),state.basis.toward)-dot(centerOf(b),state.basis.toward)).forEach(s=>{gl.cullFace(gl.FRONT);draw(s,true);gl.cullFace(gl.BACK);draw(s,false);});
      gl.depthMask(true);
    }
    // Rasterize the same rounded triangles when WebGL is unavailable. Pixel
    // coverage and a depth buffer avoid the hairline seams of canvas paths.
    const softwareBuffer = document.createElement('canvas');
    function drawSoftware(state) {
      const quality=state.active?0.60:Math.min(pixelRatio,1.25),w=Math.max(1,Math.round(width*quality)),h=Math.max(1,Math.round(height*quality));
      softwareBuffer.width=w;softwareBuffer.height=h;
      const buffer=softwareBuffer.getContext('2d'),pixels=buffer.createImageData(w,h),data=pixels.data,depth=new Float32Array(w*h);depth.fill(-Infinity);
      const b=state.basis,light=state.light,half=unit(light.map((v,i)=>v+b.toward[i]));
      function raster(s,back) {
        const mesh=meshFor(s),p=mesh.positions,n=mesh.normals,offset=centerOf(s),tint=linear(colorFor(s,state)),mat=materialFor(s),transparent=mat[2]>0;
        for(let i=0;i<p.length;i+=9) {
          const avg=[0,1,2].map(j=>(n[i+j]+n[i+3+j]+n[i+6+j])/3),front=dot(avg,b.toward)>0;if(front===back)continue;
          const vertices=[0,3,6].map(k=>{const v=project([p[i+k]+offset[0],p[i+k+1]+offset[1],p[i+k+2]+offset[2]],state);return{x:v.x*quality,y:v.y*quality,z:v.z};});
          const [a,c,d]=vertices,area=(c.y-d.y)*(a.x-d.x)+(d.x-c.x)*(a.y-d.y);if(Math.abs(area)<0.00001)continue;
          const x0=Math.max(0,Math.floor(Math.min(a.x,c.x,d.x))),x1=Math.min(w-1,Math.ceil(Math.max(a.x,c.x,d.x))),y0=Math.max(0,Math.floor(Math.min(a.y,c.y,d.y))),y1=Math.min(h-1,Math.ceil(Math.max(a.y,c.y,d.y))),sign=back?-1:1;
          for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++) {
            const px=x+0.5,py=y+0.5,wa=((c.y-d.y)*(px-d.x)+(d.x-c.x)*(py-d.y))/area,wb=((d.y-a.y)*(px-d.x)+(a.x-d.x)*(py-d.y))/area,wc=1-wa-wb;
            if(wa<0||wb<0||wc<0)continue;
            const index=y*w+x,z=wa*a.z+wb*c.z+wc*d.z;if(z<depth[index]-0.0001)continue;
            const normal=unit([0,1,2].map(j=>sign*(wa*n[i+j]+wb*n[i+3+j]+wc*n[i+6+j]))),ndl=Math.max(0,dot(normal,light)),facing=Math.max(0,dot(normal,b.toward)),rim=Math.pow(1-facing,2),sky=0.5+normal[2]*0.5;
            const localZ=wa*p[i+2]+wb*p[i+5]+wc*p[i+8],sweep=clamp((localZ+hOf(s)/2)/hOf(s),0,1),gradient=0.80+0.20*(sweep*sweep*(3-2*sweep));
            const key=Math.pow(Math.max(0,dot(normal,half)),6+26*(1-mat[0]))*mat[1]*(0.12+rim*0.5),lit=(0.31+0.30*sky+0.43*ndl)*gradient*(1-0.07*Math.pow(Math.max(0,normal[2]),4));
            let source=tint.map(v=>v*lit+key+(normal[2]>0?0.02:0)),alpha=1;
            if(transparent){
              const localX=wa*p[i]+wb*p[i+3]+wc*p[i+6],localY=wa*p[i+1]+wb*p[i+4]+wc*p[i+7];
              const through=Math.min((s.w/2+Math.sign(b.toward[0])*localX)/Math.max(0.05,Math.abs(b.toward[0])),(s.h/2+Math.sign(b.toward[1])*localY)/Math.max(0.05,Math.abs(b.toward[1])),(hOf(s)/2+localZ)/Math.max(0.05,b.toward[2]));
              const body=1-Math.exp(-Math.max(0,through)/(Math.max(0.2,hOf(s)/2)*4)),planeX=localX/(s.w/2),planeY=localY/(s.h/2),roofSweep=clamp(0.50+planeX*0.15-planeY*0.20,0,1);
              const concentration=(0.45+body*0.07+roofSweep*0.13)*(1-mat[3]*0.20),optical=tint.map(v=>Math.pow(Math.max(0.025,v),0.64+body*0.14));
              const roof=optical.map(v=>1+(v-1)*concentration),wall=mix(optical,[0.96,0.975,0.98],mat[3]*0.16).map(v=>v*(0.80+0.26*sky)*(0.86+0.18*sweep));
              source=mix(wall,roof,smooth(0.12,0.96,Math.max(0,normal[2])));
              const upperBevel=smooth(0.02,0.35,normal[2])*(1-smooth(0.83,0.999,normal[2])),lowerBevel=smooth(0.05,0.40,-normal[2])*(1-smooth(0.87,1,-normal[2]));
              const edgeLight=Math.pow(Math.max(0,dot(normal,half)),64+(14-64)*mat[3]);
              const bloom=0.05*Math.max(0,normal[2])*clamp(0.65+planeX*0.2-planeY*0.13,0,1),broad=Math.exp(-Math.pow(planeX*0.65+planeY*0.42-0.25,2)*3)*Math.max(0,normal[2])*(1-mat[3]*0.90);
              source=source.map((v,j)=>v+[0.68,0.83,0.91][j]*edgeLight*0.22*(1-mat[3]*0.85)+[0.015,0.025,0.035][j]*rim*(1-mat[3]*0.45)+bloom+[0.025,0.03,0.035][j]*broad);
              source=mix(source,[0.98,0.995,1],upperBevel*0.52*(1-mat[3]*0.85)).map((v,j)=>v+[0.08,0.12,0.13][j]*lowerBevel*(1-mat[3]*0.6));
              alpha=0.55+0.23*body+rim*0.13+mat[3]*0.06;
              if(back){alpha*=0.18;source=optical.map(v=>0.97+(v-0.97)*0.32);}
            }
            source=srgb(source).map(v=>v*255);const k=index*4;
            if(!transparent){data[k]=source[0];data[k+1]=source[1];data[k+2]=source[2];data[k+3]=255;depth[index]=z;}
            else {const previous=data[k+3]/255,next=alpha+previous*(1-alpha);for(let j=0;j<3;j++)data[k+j]=(source[j]*alpha+data[k+j]*previous*(1-alpha))/next;data[k+3]=next*255;}
          }
        }
      }
      state.list.filter(s=>materialFor(s)[2]===0).forEach(s=>raster(s,false));
      state.list.filter(s=>materialFor(s)[2]>0).sort((a,c)=>dot(centerOf(a),b.toward)-dot(centerOf(c),b.toward)).forEach(s=>{raster(s,true);raster(s,false);});
      buffer.putImageData(pixels,0,0);fallback.setTransform(1,0,0,1,0,0);fallback.clearRect(0,0,fallback.canvas.width,fallback.canvas.height);fallback.imageSmoothingEnabled=true;fallback.drawImage(softwareBuffer,0,0,fallback.canvas.width,fallback.canvas.height);
    }
    function render(input) {
      lastInput=input;if(disposed||contextLost)return;
      const state={...input,list:input.list||[],view:input.view||{}};
      if(input.width && (input.width!==width||input.height!==height))resize(input.width,input.height,pixelRatio);
      state.light=unit(state.basis.right.map((v,i)=>-0.48*v+state.basis.toward[i]*0.30+(i===2?1.45:0)));
      state.depth=Math.max(1000,...state.list.map(s=>Math.hypot(...centerOf(s))+s.w+s.h+hOf(s)+Math.hypot(state.camera.x,state.camera.y,state.camera.z)))*2;
      drawFloor(state);if(gl)drawGL(state);else drawSoftware(state);
    }
    function dispose(){disposed=true;if(gl){for(const mesh of meshes.values()){gl.deleteBuffer(mesh.positionBuffer);gl.deleteBuffer(mesh.normalBuffer);}gl.deleteProgram(program);}meshes.clear();if(fallback && fallback.canvas!==canvas)fallback.canvas.remove();}
    return {mode,resize,render,dispose,meshFor};
  }
  return {create,materials};
});
