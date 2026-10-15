# Interaction laboratory coverage

Snapshot: 14 October 2026. The first edition has 48 browser studies in nine categories. **Implemented browser study** means the workbench offers a live exercise with dummy geometry and adjustable settings. It does not mean the complete native Rhino command, a geometry kernel, or measured parity with Rhino is implemented. **Analogy** means the visible cue can be tested but the underlying 3D behavior cannot. **Extension backlog** means research exists and a dedicated runnable study remains to be added.

This matrix maps research subjects to stable case IDs in [catalog.js](../../interaction-lab/catalog.js). Open the [interaction laboratory](../../interaction-lab.html) to exercise them. Detailed findings and evidence are in [Rhino selection and Gumball research](../research/rhino-selection-gumball.md) and [Atlas and precision research](../research/atlas-and-precision.md).

## Selection matrix

- `selection-click` — Implemented browser study: whole-object pick and empty-space deselect; passive hover and committed selection have distinct treatments.
- `selection-add-remove` — Implemented browser study: Shift adds, Ctrl removes. This profile must remain distinct from Atlas's modifier toggling conventions.
- `selection-window` — Implemented browser study: drag a containing rectangle left to right.
- `selection-crossing` — Implemented browser study: drag a crossing rectangle right to left.
- `selection-overlap` — Implemented browser study: overlapping candidates reveal a menu; hovering a row previews that candidate before selection. Native menu wheel/click cycling and keyboard acceptance are extensions.
- `selection-filter` — Implemented browser study: body-type filtering. Failed-pick filter auto-disable preferences are research only.
- `selection-group` — Implemented browser study: Assembly A selects together; Ctrl+Shift can target a member. Hierarchical groups and block definitions are extensions.
- `selection-locked` — Implemented browser study: an illustrative locked reference rejects normal manipulation. Native layers, worksessions, and Atlas force-selection of a locked member are extensions.

Sweep intersection and containing tests operate on the illustrative projected geometry. They are useful for evaluating target tolerance and feedback, not native NURBS, trimmed-surface, or SubD selection conformance.

## Sub-selection matrix

- `subobject-face` — Implemented browser study: projected box-face targeting; selection and hover paint only the targeted face. Ctrl+Shift also targets individual polyline segments and vertices. Component deformation and NURBS/SubD topology are extensions.
- `subobject-edge` — Implemented browser study: projected edge targeting with screen-space tolerance; highlights stay on the targeted edge. Individual polyline segments and vertices are targetable with Ctrl+Shift.
- `subobject-vertex` — Implemented browser study: projected corner targeting with screen-space tolerance; highlights stay on the vertex. Ctrl+Shift also targets individual polyline segments. Topological welding is outside this study.
- `subobject-filter` — Implemented browser study: the Sub-objects filter makes plain click target components. Ctrl+Shift targets a solid parent, while preserving individual polyline segment/vertex picks. Component hover and selection leave the rest of the parent in its normal appearance.

All four component studies support Ctrl+Shift marquee from empty space across multiple geometry objects. Window selects fully contained components; crossing selects touched components. Ctrl+Shift adds to the existing set. The face and edge studies collect polyline segments with their corresponding solid components, and the vertex study collects vertices. Plain marquee with the Sub-objects filter also targets components; its Ctrl+Shift parent inversion is limited to point picking.

Extension backlog: edge loops, edge rings, face loops, vertex chains, bounded flood fill, connected control-point selection, multiple-component editing, group/block nesting, front/back component eligibility, and selection of native curve knots or control polygons.

## Gumball matrix

- `gumball-move` — Implemented browser study: axis translation of the selected geometry set.
- `gumball-plane` — Implemented browser study: XY translation through a plane control.
- `gumball-rotate` — Implemented browser study: XY rotation around a widget pivot. Full spatial rotation is an extension.
- `gumball-scale` — Implemented browser study: uniform scale of the illustrative geometry and its arrangement. Independent axis scale, plane scale, and native handle layouts are extensions.
- `gumball-numeric` — Implemented browser study: clicking an arrow without a drag opens numeric entry and commits a precise transform.
- `gumball-copy` — Implemented browser study: Alt held at drag start duplicates. Native Alt-tap behavior during an already running manipulation is an extension; do not describe the two triggers as identical.
- `gumball-relocate` — Implemented browser study: double-click a control and place a new widget pivot separately from geometry.
- `gumball-snappy` — Implemented browser study: object-snap acquisition can be compared with smooth motion. It is not the full native Gumball constraint solver.
- `gumball-gain` — Implemented browser study: adjustable input gain. Laboratory gain is a persistent preset rather than the native DragStrength control lifecycle.

Extension backlog: full XYZ frames; CPlane/world/object alignment profiles; surface-normal frames; three-point relocation; native reset/retain placement rules; numeric rotation and individual axis/plane scales; handle-specific modifier transitions; Ctrl extrusion; Alt copy during a live drag; extrusion/cut/split control variants; and native undo interaction with Gumball relocation.

## Precision snap matrix

- `snap-end` — Implemented browser study: discrete endpoints on illustrative projected geometry.
- `snap-mid` — Implemented browser study: segment midpoint acquisition.
- `snap-center` — Implemented browser study: hovering near a circular or elliptical profile boundary acquires its geometric center; direct center acquisition remains available. The marker stays at the center and the raw pointer is connected by a leader. Box bounding-box centers are not invented as snap features.
- `snap-intersection` — Implemented browser study: finite-edge crossings must agree in modeled XYZ coordinates, rejecting apparent intersections caused by projected extrusion depth. Circular profiles use their 64-segment display approximation. Exact curve/curve, surface, and native mesh intersection support is an extension.
- `snap-near` — Implemented browser study: continuously varying points on fixture segments or an ellipse approximation.
- `snap-grid` — Implemented browser study: adjustable model-unit grid spacing. Independent viewport grid visibility, minor/major spacing, and grid-snap settings are extensions.
- `snap-project` — Analogy: illustrated elevated vertices project to base XY by removing the extrusion cue. Arbitrary CPlane and Planar projection in 3D are extensions.
- `snap-tangent` — Implemented browser study: analytical tangency to the circular fixture from the last picked anchor, with XY origin as the initial anchor. General ellipse and NURBS tangency are extensions.
- `snap-perp` — Implemented browser study: perpendicular foot on a finite fixture segment from the last picked anchor, with XY origin as the initial anchor. General curve/surface normals are extensions.
- `snap-quad` — Implemented browser study: quadrants of the circular fixture.
- `snap-vertex` — Implemented browser study: projected box vertices.

Acquisition and release distances are laboratory controls measured in screen pixels. Release hysteresis is an experimental feature rather than a claimed native Rhino setting. Visible snap feedback distinguishes the raw pointer from the resolved point.

Extension backlog: Point and Knot snap kinds; persistent combinations and one-shot overrides; isolated-kind right-click restore; Disable state and Alt inversion; the snapped-drag basepoint hold; per-kind feature priority; general true 3D curve/surface intersections beyond the modeled fixture edges; locked/occluded/filtered/selected-only snap eligibility; mesh-edge eligibility; approximate-circle center recognition; reference snaps Along, AlongParallel, Between, From, PerpendicularFrom, and TangentFrom; OnCurve/OnSurface/OnPolysurface/OnMesh constraints; Percentage; and native numeric coordinates combined with these aids.

## Constraints and tracking matrix

- `tracking-smarttrack` — Implemented browser study: dwell captures up to three references. Polyline points inherit segment directions, curve corners retain incident directions, and circular/elliptical boundary points inherit analytic rotated tangents. A center reference retains XY guides. Following a guide can capture its intersection with another eligible finite fixture edge, with source exclusion and matching modeled elevation. This remains a simplified inference system.
- `tracking-ortho` — Implemented browser study: direction constraints at 45° intervals by default; editable Ortho angle increment supports 1°–90°. Held Shift inverts the enabled constraint. The 45° starting value is a user preference, not a claim about Rhino's default.
- `tracking-tab` — Implemented browser study: capture an arbitrary XY direction, then radius, then release. The third-tap release is a lab convenience; the cited native documentation establishes the first two states.
- `tracking-planar` — Analogy: planar placement cue on an already planar board. It cannot exercise varying elevation or switching between 3D construction planes.

Extension backlog: Z tracking and full spatial direction constraints; guide-to-guide solving across multiple references, arbitrary NURBS tangency and perpendicular inference; manual Ctrl capture and double-tap clear; adjustable reference capacity and lifecycle; active versus captured styling; Implied From numeric ownership; authored guides; full Planar elevation; elevator mode; Auto CPlane selection alignment; and independent or universal multi-viewport CPlanes.

## Navigation matrix

- `navigation-pan` — Implemented browser study: middle-drag, Space-drag, and right-drag move the 2D camera while preserving the scene. The right-drag mapping is a board convention; perspective orbit is a separate exercise.
- `navigation-zoom` — Implemented browser study: wheel zoom remains anchored at the pointer and has adjustable response.
- `navigation-orbit` — Analogy: right-drag changes an affine extrusion projection. It has no perspective camera, true depth, or occlusion solver.

Extension backlog: true perspective versus parallel navigation; camera target and object-under-pointer orbit; target recovery after pan/zoom; native lens versus dolly behavior; linked viewports; cursor wrap; dynamic redraw quality and latency; configurable middle-button actions; rate-driven turbo pan; Zoom Window/Extents/Selected; camera history; and nested portal camera ownership.

## Hover and cursor matrix

- `feedback-cursor` — Implemented browser study: body, grip, transform, copy, and unavailable cursor affordances. Cursor presentation can use experimental affordances or a native-style arrow policy. Object and group overrides can choose hover cursor kinds.
- `feedback-tooltip` — Implemented browser study: delayed contextual tooltip while resting over a body or handle. Native cursor-tooltip combinations and autosuppression are extensions.
- `feedback-prehighlight` — Implemented browser study: optional universal passive prehighlight as an Atlas-inspired experiment. Native ambiguous-selection preview is represented by `selection-overlap`; universal native idle prehighlight is not claimed.

Extension backlog: measured native cursor assets and hotspots for every command state; exact cursor-versus-marker composition; projected-snap leaders; tooltip content modes and offsets; native object-snap cursor/tooltip mutual exclusion; delayed asynchronous subject silhouettes; video scrub and album hover preview; and cross-DPI cursor measurements.

## Command and recovery matrix

- `command-polyline` — Implemented browser study: temporary point-pick draft; Enter or double-click completes; Escape cancels the laboratory draft. Atlas's Escape-finish conventions remain an explicit comparison extension.
- `command-cancel` — Implemented browser study: Escape restores a live manipulation; geometry Undo/Redo replays committed scene transactions.

Extension backlog: a full command prompt and option grammar; type-to-command delay; tool-family discovery; sticky versus one-shot tool profiles; native repeat and right-button hold timing; exact distance/angle/coordinate input; local draft undo before document undo; multi-layer Escape ownership; delayed/asynchronous failure recovery; and preset-override undo history. The current Undo/Redo controls concern geometry transactions; settings overrides persist separately.

## Atlas crossover matrix

- `atlas-resize` — Implemented browser study: edge and corner resize grips on projected geometry. Free resize is separate from the program board's constant-area product contract. Center anchors, modifier inversion, mirrors, and mixed arrangement scale are extensions.
- `atlas-fillet` — Implemented browser study: dedicated corner-radius grip and rounded projected-face cue. This approximates a visual corner treatment rather than native topology editing.
- `atlas-rename` — Implemented browser study: focused inline naming owns typing; Enter accepts and Escape cancels. Atlas's commit-on-Escape text behavior is a separate comparison extension.
- `atlas-context` — Implemented browser study: right-click object actions; a completed pan suppresses the menu. Detailed object-type recipes, preserved menu target selection, hover submenus, and native held-menu timing are extensions.

Additional researched Atlas backlog: alignment/distribution with locked members; nudge profiles; connector ports and rewiring; strict connector containment; Bézier anchors/tangents; per-vertex styling; Trim/Split/Join; ink tools and their modifier HUDs; image crop, lasso, layers and asynchronous subject extraction; text/sticky creation; content focus in web/File Atlas/Slate/model/agent portals; file and clipboard carries; source-file write boundaries; presentation; hover-open toolbar families; source availability states; feedback reproduction recording; optional bumper pushing; and authored versus transient state boundaries in each specialized editor.

## Tuning and feedback coverage

The workbench supports document, category, marked-prototype batch, geometry-group, and individual-object scopes. Common settings are computed through capability intersection. Group scope expands to every member of the selected groups, and mixed values stay mixed until that field is edited. Child overrides retain precedence. Box and circle dimensions are compatible; a mixed group containing a polyline does not expose direct width/height controls because its point geometry needs a different operation.

Cursor policy, hover cursor override, and crosshair size are tunable with timing, targeting, appearance, manipulation, precision, and camera settings where supported. The laboratory does not imply that native Rhino uses this same storage hierarchy or exposes every experimental control.

Written feedback saves its case, selected objects, scope, effective settings, overrides, and scene snapshot locally. Workspace export/import carries presets, geometry, drafts, and notes. Import validation checks finite geometry, IDs, supported kinds, bounded arrays, safe property types, and cursor enum values before applying a workspace. It strips dangerous dictionary keys and unsupported metadata. The feedback workflow sends no report externally.

Explicit preference commits capture independent accepted revisions, saved observations, and the current written draft. Capsules distinguish neutral Unaltered, amber Altered or Feedback pending, green Locked in or Settings applied, and purple Addressed. Any post-commit preference or note change shows Altered again. Shift-click selects capsule ranges, per-capsule buttons accept one interface, and the sidebar can accept a batch.

With the local preview server running, supported numeric/style settings enter a durable background queue, pass scene/model/stage checks, and are published as accepted lab presets. That completion is Settings applied. Written requests remain Feedback pending until an implementation receipt matching their exact content records the summary, files, checks, and date; only that evidence permits Addressed. The local worker does not author code from comments. It targets the interaction lab alone, preserves failed/superseded outcomes, and matches exact revision fingerprints before updating a capsule. Direct/static use retains local commits without claiming background settings application.

## Validation boundary

[test-interaction-lab.js](../../test-interaction-lab.js) exercises catalog identities, source references, inheritance, shared-property intersections, group/object isolation, mixed values, enums, import types, scene geometry, and prototype-pollution payloads without dependencies. The main stage suite is supplemented by [component marquee checks](../../interaction-lab/test-component-marquee.js), [tracking geometry checks](../../test-tracking-guides.js), [precision-stage checks](../../interaction-lab/test-precision-stage.js), and [direction-constraint checks](../../interaction-lab/test-direction-constraint.js). Browser checks verify visible feedback and gesture behavior. Passing these checks does not establish native Rhino parity, and a documented backlog entry does not count as a runnable case.
