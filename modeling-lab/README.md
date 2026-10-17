# Modeling lab 0.1

A separate true XYZ / WebGL modeling environment. Entry: `../modeling-lab.html`.
Based on main `d798c0d77d51180c2cd230e708b1b1bff4f5cb1f`. Existing interaction-lab and product modes remain independent.

## Launch

From the repository root, serve HTTP (`python3 -m http.server 5173`) and open `/modeling-lab.html`. All runtime dependencies are vendored, so there is no runtime installation or CDN. ES modules need HTTP rather than file://.

For development, `npm ci --prefix modeling-lab` installs pinned Three.js 0.180.0 from the lockfile. Vendored `three.module.min.js` and `three.core.min.js` are the unmodified package builds. Preserve `vendor/three-LICENSE.txt` (MIT) and the root MIT license. Tests require Node 20+ and use built-in node:test.

```
npm --prefix modeling-lab test
npm --prefix modeling-lab run build
```

The isolated build writes `modeling-lab/dist/`. Serve that directory for a portable preview. It does not deploy anything, change the original build, or include any program/client data. The full repository is required for the header's Program Board link; the isolated build intentionally contains only the modeler.

## Working commands

Box: two base corners then signed height. Shift at the second corner squares the base. Cube: two opposite base corners, equal three dimensions. Plane: rectangle in the command's CPlane. Line: two XYZ points. Polyline: joined vertex list, Enter to finish, `Undo` to remove last point, `Close` after three. SrfPt: three corners then Enter for a triangle, or four for a quadrilateral. Picked and typed points share live previews.

Type `x,y,z` in CPlane space, `wx,y,z` in world space, `@dx,dy,dz` relative in CPlane axes. Two coordinates imply a zero third coordinate. A single number after a start point sets aimed length; Box height has its own numeric stage. Ctrl+LMB enters Elevator, followed by a picked normal height or typed signed distance. The Elev field moves the active construction plane along its normal. Each view remembers its own XY / XZ / YZ plane and elevation. Shape orientation is fixed by the plane at command start; numeric and free point acquisition use the current viewport plane.

Enter, Space and unmodified non-drag RMB finish valid Polyline / triangle SrfPt drafts or repeat the last idle command. Esc discards a draft. Navigation preserves command points. Tab locks the current XYZ direction and deliberately keeps it across successive Polyline picks; Tab again or the visible button releases it. This is the requested lab convention, not a claim of Rhino's native Tab radius cycle. Shift temporarily inverts persistent Ortho at the configured angle, default 45 degrees.

## Navigation and interaction

Perspective RMB orbits around the existing target. Shift+RMB pans camera and target together in the view plane. Parallel Top/Front/Right RMB pans. Ctrl+RMB vertical movement dollies / changes orthographic span; perspective FOV stays constant. Ctrl+Shift+RMB explicitly retargets to editable geometry under the press and rotates parallel or perspective views; a miss retains the target. Wheel anchors to a point on the camera-target plane under the cursor; Ctrl+wheel uses viewport center. ZE / Ctrl+Shift+E fit extents; ZS fits selection. Set target provides explicit framing. Middle click opens recent commands and never orbits. Navigation requires the accepted 12 px drag threshold before suppressing click accept/repeat.

LMB replaces, Shift adds, Ctrl removes. Left-to-right window requires enclosure; right-to-left crossing tests strokes and face polygons, including a region wholly inside a face. Ctrl+Shift targets selected edges/segments, vertices or faces across objects. Components can also be targeted via the filter. Only chosen components receive cyan highlight. Hidden, locked and filtered geometry is excluded from ordinary picks, marquee and snaps. In this first version locked objects cannot serve as snap references (unlike Rhino's default). Groups expand whole-object selection but not component selection.

Move / Rotate / Scale switch the one shared XYZ Gumball. Drag a tip or ring; click a handle to focus numeric entry. Numeric transforms act on selected geometry/components around their shared bounds center. XYZ means uniform scaling or equal movement on all axes. Negative scale/mirror is unavailable. Geometry changes commit once per gesture; Esc restores a live transform. Camera and selection do not enter the document journal.

The inspector edits only the chosen field across selected objects, selected groups or document defaults. Object style overrides retain precedence over group/default changes. Mixed values are shown without editing them. Clear selected style overrides re-enables group/default inheritance. Ungroup preserves effective styles. Visibility/lock are explicit tree buttons.

Block converts whole selected ordinary geometry into an immutable reusable definition and one instance. Insert references the same definition, placed at the picked/typed point. Transforming an instance updates its matrix. Definitions are serialized without flattening. Nested blocks, definition editing and instance sub-selection are unavailable.

## Precision and rendering

Real perspective/orthographic cameras, depth-tested shaded meshes and Three.js ray picking. Boxes are polygon meshes. A four-corner SrfPt is a tessellated **bilinear surface**, including noncoplanar points; three corners form one triangle. These are **not Rhino NURBS**. Component edges are the patch boundaries, not internal tessellation edges. Mesh face warps do not heal topology.

End / Mid / Center / Intersection snaps use the accepted 16 CSS-pixel radius; endpoints and intersections take priority. Intersections must coincide in XYZ, so view-projected crossings at different depths are rejected. Centers are vertex averages (box/rectangle/bilinear patch center); open-polyline Center is the vertex centroid, not an arc-length midpoint. Project explicitly moves a snap to the CPlane and labels it Projected. The raw OS cursor stays separate from the resolved marker. Alt temporarily inverts object snaps. Grid attraction and displayed grid are separate; grid display has a fixed 40-step extent. SmartTrack captures a snapped location after 450 ms, retaining the last four CPlane-parallel references; this is a bounded subset of Rhino SmartTrack. No curved primitives exist, so tangent, quadrant, curved-near and perpendicular modes are unavailable rather than simulated.

Accepted baseline cursor/timing/radius values are read from `interaction-lab/accepted-preferences.js` without modifying it. The accepted native-arrow / quiet-hover preset and an explicit discovery-hover alternative are available. Aqua-cyan #00ffee is used for every selected object and component. Native cursor bitmaps, full tooltip tuning, radius locks and dense overlap menus are not implemented.

Rendering is on demand, idle has no animation loop, hidden documents do not redraw, DPR is capped at 1.75, and replaced GPU geometries/materials are disposed. Large-scene precision candidate generation is bounded by nearby screen edges but remains quadratic for dense coincident edges; this is a small-model workbench, not a production scene manager.

## Persistence and boundaries

Save downloads validated `modeling-lab` version 1 JSON. Open validates format, topology, finite bounded XYZ/matrices, unique IDs, group/definition references, styles and object counts before replacing anything; a failed import leaves the document intact. Imports are at most 16 MiB / 2,000 top-level objects / 100 definitions / 200 objects per definition / 1,000 points per object. Undo/redo holds at most 100 document transactions. Empty document is undoable. Save includes document geometry, groups, defaults and definitions; camera, transient selections, tool preferences and undo history are intentionally session-only. There is no autosave, server backend or external write.

No booleans, NURBS editing, curved primitives, extrusion tools, .3dm import/export, layer hierarchy, topology loops, arbitrary custom CPlane orientation, quad viewport layout, gumball relocation/copy/plane handles, or collision solver. Axis movement/scale drags use projected screen-axis distance; near view-axis alignment uses a vertical fallback. Numeric axes remain exact. Selection uses nearest ray hits / screen component candidates rather than a Rhino ambiguity menu.

See `VERIFICATION.md` for actual cloud checks and reproducible browser tests.
