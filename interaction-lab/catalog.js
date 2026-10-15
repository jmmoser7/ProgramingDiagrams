(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InteractionCatalog = api;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const base = 'https://docs.mcneel.com/rhino/8/help/en-us/';
  const sources = {
    selection: [base + 'popup_actions/select_objects.htm', 'Rhino · selecting objects'],
    commands: [base + 'commands/selection_commands.htm', 'Rhino · selection commands'],
    mouse: [base + 'options/mouse.htm', 'Rhino · mouse options'],
    ambiguity: [base + 'options/selection_menu.htm', 'Rhino · selection menu'],
    filter: [base + 'commands/selectionfilter.htm', 'Rhino · selection filter'],
    gumball: [base + 'commands/gumball.htm', 'Rhino · Gumball'],
    widget: [base + 'options/modeling_aids_gumball.htm', 'Rhino · Gumball appearance'],
    snaps: [base + 'user_interface/object_snaps.htm', 'Rhino · object snaps'],
    aids: [base + 'options/modeling_aids.htm', 'Rhino · modeling aids'],
    track: [base + 'options/modeling_aids_smarttrack.htm', 'Rhino · SmartTrack'],
    ortho: [base + 'commands/ortho.htm', 'Rhino · Ortho'],
    tab: [base + 'user_interface/accurate_modeling.htm', 'Rhino · Tab constraints'],
    planar: [base + 'commands/planar.htm', 'Rhino · planar mode'],
    navigation: [base + 'seealso/sak_navigate.htm', 'Rhino · viewport navigation'],
    tooltips: [base + 'options/modeling_aids_cursor_tooltips.htm', 'Rhino · cursor tooltips'],
    cursor: [base + 'popup_moreinformation/cursor_tracking_line.htm', 'Rhino · cursor & marker'],
    polyline: [base + 'commands/polyline.htm', 'Rhino · Polyline'],
    atlas: ['docs/interaction-language/README.md', 'Atlas / Slate · audited interaction inventory']
  };
  const categories = [
    {id:'selection', name:'Selection', label:'Pick, collect & resolve', icon:'↖', description:'Target the right object without losing your place.'},
    {id:'subobject', name:'Sub-selection', label:'Faces, edges & vertices', icon:'◇', description:'Move between a whole object and its parts.'},
    {id:'gumball', name:'Gumball', label:'Direct manipulation', icon:'⊹', description:'Translate, rotate, scale and relocate with visible handles.'},
    {id:'snap', name:'Snaps', label:'Precision point picking', icon:'⌖', description:'Compare acquisition, release and resolved-point feedback.'},
    {id:'tracking', name:'Constraints & tracking', label:'Inferred relationships', icon:'┼', description:'Find directions and alignments without drawing construction geometry.'},
    {id:'navigation', name:'Navigation', label:'Camera & input ownership', icon:'↔', description:'Keep spatial context while moving through a scene.'},
    {id:'feedback', name:'Hover & cursors', label:'Before the click', icon:'◌', description:'Make available actions discoverable without committing a selection.'},
    {id:'command', name:'Command lifecycle', label:'Draft, commit & cancel', icon:'⌁', description:'Keep temporary work and authored changes distinct.'},
    {id:'atlas', name:'Atlas crossovers', label:'Reusable canvas patterns', icon:'▱', description:'Compare Slate conventions with this project’s direct manipulation.'}
  ];
  const cases = [];
  function add(category, variant, title, gesture, expected, source, options = {}) {
    cases.push({id:category+'-'+variant, category, mode:category, variant, title, gesture, expected,
      source:source || category, status:'Interactive study', fidelity:'Browser interaction study; timings and colors are experimental presets, not measured Rhino defaults.',
      question:'Does the feedback explain the action before you commit?', ...options});
  }
  add('selection','click','Single-object pick','Click a body. Click empty space to clear.','Committed selection has its own treatment, independent from passive hover.','selection');
  add('selection','add-remove','Build & reduce a selection','Shift-click adds. Ctrl-click removes.','Modifiers change the selection set without a drag.','commands');
  add('selection','window','Window selection','Drag left → right across empty space.','Only fully enclosed geometry is included.','mouse');
  add('selection','crossing','Crossing selection','Drag right → left across empty space.','Geometry touched by the rectangle is included.','mouse');
  add('selection','overlap','Ambiguous pick menu','Click the overlapping boxes; hover the list, then choose.','Candidate preview stays distinct from committed selection.','ambiguity',{question:'Can you identify the hidden candidate without trial and error?'});
  add('selection','filter','Type-filtered selection','Use the type filter above the viewport, then pick.','Excluded types cannot be committed as a selection.','filter',{fidelity:'Type filtering is interactive. Rhino’s failed-pick auto-disable preference is research-only.'});
  add('selection','group','Grouped objects','Click either object in Assembly A.','The assembly selects and moves together. Ctrl+Shift isolates a member.','commands');
  add('selection','locked','Locked geometry','Try to select or drag the locked reference.','A locked reference rejects authored manipulation and signals its state.','selection');
  add('subobject','face','Select a face','Ctrl+Shift-click the front, top or side of a box.','Only the targeted face is highlighted. Polyline segments are also individually targetable.','selection',{fidelity:'2.5D box components and polyline segments/vertices; no NURBS/SubD topology. Component deformation is outside this study.'});
  add('subobject','edge','Select an edge','Ctrl+Shift-click close to a box edge.','Only the targeted edge or polyline segment is highlighted.','selection',{fidelity:'2D edge targeting on projected boxes and polylines; polyline vertices remain targetable.'});
  add('subobject','vertex','Select a vertex','Ctrl+Shift-click a box corner.','Screen-pixel tolerance targets one vertex; polyline segments remain individually targetable.','selection',{fidelity:'Projected box/polyline vertices and polyline segments; no topological welding or mesh editing.'});
  add('subobject','filter','Sub-object filter inversion','Enable Sub-objects in the viewport filter. Click a face.','With this filter enabled, plain click targets a part; Ctrl+Shift targets a solid parent or one polyline segment.','filter',{fidelity:'Projected solid and polyline parts; the curve modifier behavior is a laboratory preference.'});
  add('gumball','move','Axis translation','Select a box and drag the red or green arrow.','The selected set moves along one axis, with a shared widget.','gumball');
  add('gumball','plane','Plane translation','Select a box; drag the small plane square.','Two degrees of freedom use one visible plane control.','gumball');
  add('gumball','rotate','Rotate about a pivot','Select a box; drag the circular arc.','The angular preview follows the pointer around the widget origin.','gumball',{fidelity:'XY rotation only; this is a 2.5D study, not a 3D rotation solver.'});
  add('gumball','scale','Scale from a handle','Select a box; drag a square at an axis end.','Handle shape distinguishes scale from translation.','gumball');
  add('gumball','numeric','Numeric transform entry','Select a box; click an arrow without dragging and enter a distance.','A precise value commits a single transform transaction.','gumball');
  add('gumball','copy','Duplicate during manipulation','Select a box; Alt-drag a Gumball handle.','A duplicate leaves the original in place. Escape cancels the operation.','gumball',{fidelity:'The lab uses held Alt at drag start. Rhino’s Alt tap during a live Gumball operation is documented in the report.'});
  add('gumball','relocate','Relocate the widget','Select a box; double-click a handle, then pick a new pivot.','The pivot changes independently of the object.','gumball');
  add('gumball','snappy','Snappy vs smooth dragging','Select a box; toggle Osnap and drag an axis toward another feature.','Snap acquisition can be compared with uninterrupted movement.','gumball');
  add('gumball','gain','Drag strength','Set Drag strength in the inspector; drag an arrow the same distance.','Different input gain changes control precision.','gumball',{fidelity:'Lab gain persists as a preset. Rhino’s DragStrength control resets to 100% on closing.'});
  ['end','mid','center','intersection','near','grid','project','tangent','perp','quad','vertex'].forEach((variant, i) => {
    const titles = ['Endpoint acquisition','Midpoint acquisition','Center acquisition','Intersection acquisition','Nearest point on a curve','Grid snap','Projected snap marker','Tangent point','Perpendicular foot','Circle quadrants','Vertex acquisition'];
    const targets = ['a polyline endpoint','the middle of a segment','the circle center','the crossing curves','any point along a segment','a grid intersection','a box vertex','a tangent on the circle','the perpendicular foot on the line','a cardinal point of the circle','a box corner'];
    add('snap', variant, titles[i], 'Move near '+targets[i]+', then click to place a point.', 'The raw pointer and the resolved point remain visually distinguishable.', variant==='grid'?'aids':'snaps', {
      question:'Is acquisition predictable, and does release feel sticky or unstable?',
      fidelity: variant==='tangent' ? 'Analytical tangency to the circular fixture from the last picked point (XY origin before a pick); general ellipse tangency is outside this study.' : variant==='perp' ? 'Perpendicular foot on a finite segment from the last picked point (XY origin before a pick); no general NURBS construction.' : variant==='project' ? 'Projects illustrated box vertices to base XY. This is a 2.5D cue, not Rhino’s full 3D CPlane projection.' : '2D analytical snap study. Snap release hysteresis is a lab experiment, not a documented Rhino setting.'
    });
  });
  Object.assign(cases.find(c=>c.id==='snap-center'),{gesture:'Hover near the circular profile boundary or center, then click to place its center.',expected:'The edge acquires the real profile center while the raw pointer remains visible.',fidelity:'Circular and elliptical profile centers, acquired from the boundary or center. Open polylines and solid bounding-box centers are not invented.'});
  Object.assign(cases.find(c=>c.id==='snap-intersection'),{expected:'Only modeled edges that meet in XYZ acquire an Intersection snap; apparent projected crossings are rejected.',fidelity:'Modeled box depth and planar curves distinguish actual from apparent intersections. Circular profiles use 64-segment intersection approximation; no NURBS kernel.'});
  for(const c of cases.filter(c=>c.category==='subobject'))c.gesture+=' Ctrl+Shift-drag from empty space for window / crossing component selection.';
  add('tracking','smarttrack','Dwell to capture a reference','Dwell over a curve or snap feature, then follow its inherited dotted guide to other geometry.','Curve tangents and segment directions guide placement; nearby guide intersections acquire a distinct marker.','track',{fidelity:'Up to three captured references, analytic ellipse tangents and polyline/incident-edge directions. Target intersections use eligible finite plane edges. Manual Ctrl capture and a general NURBS inference engine remain extensions.'});
  add('tracking','ortho','Orthogonal constraint','Enable Ortho in the inspector. Click a start, then move; hold Shift to invert.','The resolved point follows the nearest permitted direction, at 45° intervals by default.','ortho',{defaults:{orthoAngle:45},fidelity:'The lab uses configurable 45° intervals for this study. This is a user preference, not a claim about Rhino’s default Ortho angle.'});
  add('tracking','tab','Direction lock & radius','Click a start, move, tap Tab: direction → radius → free.','The captured relationship survives pointer movement.','tab',{fidelity:'Rhino documents direction then radius tracking. Third-tap release is a lab convenience; its native Rhino cycle was not verified.'});
  add('tracking','planar','Planar placement','Click points and inspect the flat preview plane.','Successive points share a plane.','planar',{status:'2D analogy',fidelity:'The lab is already planar. This tests the visible plane cue only; varying 3D elevation requires a native Rhino test.'});
  add('navigation','pan','Temporary pan','Middle-drag or Space-drag. Right-drag also pans in this lab.','Panning preserves geometry, selection and any draft.','navigation',{fidelity:'Right-drag follows Slate/project convention. Rhino perspective right-drag normally rotates; mapping is documented in the report.'});
  add('navigation','zoom','Zoom at the pointer','Scroll over a feature; compare different Zoom response values.','The feature under the pointer remains the zoom anchor.','navigation');
  add('navigation','orbit','Orbit cue','Right-drag to change the projected view angle.','View manipulation is distinct from object manipulation.','navigation',{status:'2D analogy',fidelity:'Affine projection of a 2.5D scene; no perspective camera or occlusion solver.'});
  add('feedback','cursor','Cursor affordance matrix','Hover a body, a selected edge, a handle and a locked reference.','Grab, transform, resize, copy and unavailable states announce intent.','cursor',{fidelity:'Browser cursor mapping is an experimental design choice. Native cursor assets and a full Rhino cursor matrix were not measured.'});
  add('feedback','tooltip','Delayed contextual tooltip','Rest over a body or handle; change Tooltip delay.','A stable hover reveals useful context after a configurable delay.','tooltips');
  add('feedback','prehighlight','Passive hover vs selection','Enable Passive highlight; compare hover and selection colors.','A passive outline can aid discovery without implying selection.','ambiguity',{fidelity:'Universal idle-object prehighlight is an Atlas-inspired experiment. Rhino selection-menu dynamic highlight is documented separately.'});
  add('command','polyline','Point-pick draft','Click several points. Enter commits; Escape cancels the draft.','Draft geometry stays temporary until committed.','polyline');
  add('command','cancel','Cancel, undo & redo','Drag a box; press Escape before releasing. Then try Undo / Redo.','Cancel restores the starting state; committed gestures are one undo step.','atlas');
  add('atlas','resize','Edge & corner resize','Select a box; hover an edge or corner, then drag.','A larger invisible hit target can coexist with a small painted grip.','atlas',{fidelity:'Free resize study. The program board’s constant-area resize remains a separate product-specific contract.'});
  add('atlas','fillet','Corner-radius grip','Select a box; drag its small radius grip.','A dedicated grip wins over nearby general resize controls.','atlas');
  add('atlas','rename','Inline name editing','Double-click a body. Type a name; Enter saves, Escape cancels.','Focused text input owns typing and suppresses scene shortcuts.','atlas');
  add('atlas','context','Contextual actions','Right-click a body without dragging. Choose a menu action.','A click opens a menu; a pan gesture suppresses it.','atlas');
  // Complete standard CSS cursor vocabulary. SVGs are local, fixed previews;
  // actual cursors use the platform's native assets at 100% size.
  const cursorArrow = '<path d="M4 2v17l4-5 4 8 4-2-4-8h7Z"/>';
  const cursorHand = '<path d="M7 13V4a2 2 0 0 1 4 0v7-4a2 2 0 0 1 4 0v5-3a2 2 0 0 1 4 0v5-2a2 2 0 0 1 3 0v6l-4 5H9l-6-7a2 2 0 0 1 3-3Z"/>';
  const cursorDoubleArrow = '<path d="M2 12h20M2 12l4-4M2 12l4 4M22 12l-4-4M22 12l-4 4"/>';
  const cursorOneArrow = '<path d="M12 22V2M12 2l-5 5M12 2l5 5"/>';
  const cursorIcon = body => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+body+'</svg>';
  const cursorChoices = [
    ['auto','Automatic','General',cursorArrow+'<path d="M20 2v4M18 4h4"/>'],
    ['default','Arrow','General',cursorArrow],
    ['none','Hidden cursor','General','<circle cx="12" cy="12" r="8" stroke-dasharray="2 3"/><path d="m5 19 14-14"/>'],
    ['context-menu','Context menu','General',cursorArrow+'<path d="M15 13h8v9h-8M17 15h4M17 18h4"/>'],
    ['help','Help','General','<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 0 1 6 0c0 3-3 2-3 5M12 17v.1"/>'],
    ['pointer','Link pointer','General',cursorHand],
    ['progress','Working in background','Status',cursorArrow+'<path d="M17 3a5 5 0 1 1-3 9M17 1v4h4"/>'],
    ['wait','Busy / wait','Status','<path d="M6 2h12M6 22h12M7 2v5l5 5-5 5v5M17 2v5l-5 5 5 5v5M9 5h6M9 19h6"/>'],
    ['cell','Cell selection','Selection','<path d="M3 3h18v18H3ZM3 9h18M3 15h18M9 3v18M15 3v18"/><path d="M9 12h6M12 9v6" stroke-width="2.5"/>'],
    ['crosshair','Precision crosshair','Selection','<path d="M12 1v8M12 15v8M1 12h8M15 12h8"/><circle cx="12" cy="12" r="3"/>'],
    ['text','Text caret','Text','<path d="M8 3h8M12 3v18M8 21h8"/>'],
    ['vertical-text','Vertical text caret','Text','<path d="M3 8v8M3 12h18M21 8v8"/>'],
    ['alias','Shortcut / alias','Action','<path d="M3 21v-8a6 6 0 0 1 6-6h12M15 1l6 6-6 6"/>'],
    ['copy','Copy','Action',cursorArrow+'<path d="M16 15h7v8h-7ZM19.5 17v4M17.5 19h4"/>'],
    ['move','Move','Action',cursorDoubleArrow+'<g transform="rotate(90 12 12)">'+cursorDoubleArrow+'</g>'],
    ['no-drop','Drop unavailable','Status',cursorArrow+'<circle cx="18" cy="18" r="5"/><path d="m15 15 6 6"/>'],
    ['not-allowed','Action unavailable','Status','<circle cx="12" cy="12" r="9"/><path d="M5.5 5.5l13 13"/>'],
    ['grab','Open hand / grab','Action',cursorHand],
    ['grabbing','Closed hand / dragging','Action','<path d="M4 11v-1a2 2 0 0 1 4 0V7a2 2 0 0 1 4 0V6a2 2 0 0 1 4 0v2a2 2 0 0 1 4 0v9l-4 5H9l-5-6Z"/><path d="M8 10v4M12 8v6M16 9v5"/>'],
    ['all-scroll','Scroll in any direction','Navigation',cursorDoubleArrow+'<g transform="rotate(90 12 12)">'+cursorDoubleArrow+'</g><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>'],
    ['col-resize','Resize column','Resize',cursorDoubleArrow+'<path d="M9 3v5M9 16v5M15 3v5M15 16v5"/>'],
    ['row-resize','Resize row','Resize','<g transform="rotate(90 12 12)">'+cursorDoubleArrow+'<path d="M9 3v5M9 16v5M15 3v5M15 16v5"/></g>'],
    ...[['n',0,'North'],['e',90,'East'],['s',180,'South'],['w',270,'West'],['ne',45,'Northeast'],['nw',315,'Northwest'],['se',135,'Southeast'],['sw',225,'Southwest']].map(([direction,angle,label])=>[direction+'-resize',label+' resize','Directional resize','<g transform="rotate('+angle+' 12 12)">'+cursorOneArrow+'</g>']),
    ...[['ew',0,'Horizontal'],['ns',90,'Vertical'],['nesw',-45,'Northeast–southwest'],['nwse',45,'Northwest–southeast']].map(([direction,angle,label])=>[direction+'-resize',label+' resize','Resize','<g transform="rotate('+angle+' 12 12)">'+cursorDoubleArrow+'</g>']),
    ['zoom-in','Zoom in','Navigation','<circle cx="10" cy="10" r="7"/><path d="m15 15 7 7M7 10h6M10 7v6"/>'],
    ['zoom-out','Zoom out','Navigation','<circle cx="10" cy="10" r="7"/><path d="m15 15 7 7M7 10h6"/>']
  ].map(([value,label,group,body])=>({value,label,group,icon:cursorIcon(body)}));
  const cursorValues = cursorChoices.map(choice=>choice.value);
  const common = ['hoverDelay','tooltipDelay','hitRadius','dragThreshold','highlightColor','selectionColor','strokeWidth','handleSize','showLabels','prehighlight','opacity','cursorPolicy','idleCursor','hoverCursor','cursorScale','hoverPresentation','hoverOpacity'];
  const capabilityKeys = {
    selection:[], subobject:[], gumball:['gumballSize','dragStrength','rotationStep','snapRadius','snapRelease','snapEnabled'],
    snap:['snapRadius','snapRelease','snapEnabled','gridSize'], tracking:['snapRadius','snapRelease','snapEnabled','gridSize','ortho','trackDelay'],
    navigation:['zoomSpeed'], feedback:[], command:['snapRadius','snapRelease','snapEnabled','gridSize'], atlas:[]
  };
  const fields = {
    hoverDelay:{label:'Hover delay',type:'number',min:0,max:1500,step:25,unit:'ms',default:80,section:'Timing'},
    tooltipDelay:{label:'Tooltip delay',type:'number',min:0,max:2500,step:25,unit:'ms',default:550,section:'Timing'},
    dragThreshold:{label:'Drag threshold',type:'number',min:1,max:24,step:1,unit:'px',default:4,section:'Targeting'},
    hitRadius:{label:'Pick tolerance',type:'number',min:2,max:30,step:1,unit:'px',default:8,section:'Targeting'},
    handleSize:{label:'Handle size',type:'number',min:4,max:24,step:1,unit:'px',default:8,section:'Targeting'},
    highlightColor:{label:'Hover color',type:'color',default:'#15998c',section:'Appearance'},
    selectionColor:{label:'Selection color',type:'color',default:'#00ffee',section:'Appearance'},
    strokeWidth:{label:'Outline weight',type:'number',min:0.5,max:6,step:0.5,unit:'px',default:1.5,section:'Appearance'},
    opacity:{label:'Object opacity',type:'number',min:15,max:100,step:5,unit:'%',default:100,section:'Appearance'},
    showLabels:{label:'Object labels',type:'boolean',default:true,section:'Appearance'},
    prehighlight:{label:'Passive highlight',type:'boolean',default:false,section:'Appearance'},
    cursorPolicy:{label:'Cursor behavior',type:'enum',options:['affordance','native'],default:'affordance',section:'Cursor'},
    idleCursor:{label:'Cursor presentation',type:'enum',options:cursorValues,default:'auto',section:'Cursor'},
    hoverCursor:{label:'Hover presentation',type:'enum',options:cursorValues,default:'auto',section:'Cursor'},
    cursorScale:{label:'Cursor size',type:'number',min:50,max:200,step:5,unit:'%',default:100,section:'Cursor'},
    hoverPresentation:{label:'Geometry hover style',type:'enum',options:['none','outline','fill','outline-fill','bounds','corners','halo'],default:'outline',section:'Cursor'},
    hoverOpacity:{label:'Hover fill opacity',type:'number',min:10,max:100,step:5,unit:'%',default:30,section:'Cursor'},
    snapRadius:{label:'Snap acquisition',type:'number',min:3,max:60,step:1,unit:'px',default:16,section:'Precision'},
    snapRelease:{label:'Snap release',type:'number',min:3,max:90,step:1,unit:'px',default:24,section:'Precision'},
    snapEnabled:{label:'Object snaps',type:'boolean',default:true,section:'Precision'},
    gridSize:{label:'Grid spacing',type:'number',min:5,max:100,step:5,unit:'units',default:25,section:'Precision'},
    ortho:{label:'Ortho enabled',type:'boolean',default:false,section:'Precision'},
    orthoAngle:{label:'Ortho angle increment',type:'number',min:1,max:90,step:1,unit:'°',default:90,section:'Precision'},
    trackDelay:{label:'Reference dwell',type:'number',min:100,max:2000,step:25,unit:'ms',default:450,section:'Precision'},
    gumballSize:{label:'Gumball radius',type:'number',min:30,max:130,step:5,unit:'px',default:65,section:'Manipulation'},
    dragStrength:{label:'Drag strength',type:'number',min:10,max:200,step:5,unit:'%',default:100,section:'Manipulation'},
    rotationStep:{label:'Angle increment',type:'number',min:1,max:90,step:1,unit:'°',default:15,section:'Manipulation'},
    zoomSpeed:{label:'Zoom response',type:'number',min:20,max:200,step:5,unit:'%',default:100,section:'Camera'},
    locked:{label:'Locked',type:'boolean',default:false,section:'Geometry'},
    width:{label:'Width',type:'number',min:10,max:400,step:5,unit:'units',default:100,section:'Geometry'},
    height:{label:'Height',type:'number',min:10,max:400,step:5,unit:'units',default:80,section:'Geometry'},
    depth:{label:'Extrusion cue',type:'number',min:0,max:100,step:5,unit:'units',default:25,section:'Geometry'},
    cornerRadius:{label:'Corner radius',type:'number',min:0,max:50,step:1,unit:'units',default:0,section:'Geometry'}
  };
  function keysFor(c) { return common.concat(capabilityKeys[c.category] || [],c.id==='tracking-ortho'?['orthoAngle']:[]); }
  return {version:1,categories,cases,sources,fields,common,keysFor,cursorChoices};
});
