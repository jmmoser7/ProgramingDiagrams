# Rhino 8 Windows: selection and Gumball interaction research

Research date: October 14, 2026. Baseline: current official Rhino 8 Windows Help, with official McNeel learning material used for context. A later read-only inspection of the user's running Rhino 8 SR30 is recorded separately in Section 10. Proposed browser studies are **2.5D interaction studies**; they do not validate native Rhino rendering, CAD topology, cursor pixels, timing, or hit testing.

The strongest transferable idea is a small set of persistent interaction rules supported by several distinct feedback channels: geometry highlighting, a context-dependent manipulator, cursor/marker feedback, nearby instructions, and the command/status area. The interpretation and experimental recommendations below are ours. Documented rules are explicitly labeled and linked.

## 1. Selection: whole objects, additive selection, and enclosure

**Documented.** Ordinary selection uses left click. Shift adds objects; Control removes them. A rectangle drawn left to right includes wholly enclosed objects, while right to left includes objects touching or crossing its bounds. [McNeel selection introduction](https://www.rhino3d.com/e-news/followup/v8-new/r8fu3d/)

**Documented.** Clicking empty space clears selection. Ctrl+Shift supports subobject picking through a click, window, or crossing gesture; Ctrl removes subobjects. Selection can happen before a command or in response to a command prompt. In blocks, whole contained objects can be picked, but their edges/faces cannot; nested block contents have further restrictions. [Rhino 8 selection commands](https://docs.mcneel.com/rhino/8/help/en-us/commands/selection_commands.htm)

**Documented.** Mouse options can force window, crossing, or direction-dependent combination behavior. Alt+left drag forces rectangular selection even when starting near geometry. Independent pixel thresholds control object and control-point drag initiation. An option restricts dragging to already selected objects. Subobject selection, selection of objects whose control points are on, automatic point display for certain single-object selections, and control-polygon pickability are configurable. A pickable control polygon supports double click to select a row. [Rhino 8 mouse options](https://docs.mcneel.com/rhino/8/help/en-us/options/mouse.htm)

**Feel interpretation.** Direction is a compact language for two different selection intents. The benefit depends on immediate visual differentiation: the tester should know which rule is active before releasing. A drag threshold mediates a real conflict between selecting a small target and moving it by mistake. Object and control-point thresholds deserve separate controls because their precision requirements differ.

**Runnable studies.**

- `selection.single`: one solid, one curve, one point; acquire, replace, and clear selection.
- `selection.add-remove`: spaced dummy objects with a live count; compare modifier disclosure and add/remove cursor badges.
- `selection.window-crossing`: partially intersecting boxes and long curves; reverse drag direction during the gesture and inspect inclusion.
- `selection.force-window`: a dense curve bundle around the drag start; compare forced marquee with ordinary picking.
- `selection.drag-threshold`: small points and larger solids; adjust the threshold and count unintended drags.
- `selection.selected-only-drag`: selected and unselected objects side by side; test whether the restriction feels protective or obstructive.

**Suggested controls, not measured Rhino defaults:** object/point pick radius, object/point drag threshold, selection outline width, selection tint/opacity, marquee stroke/fill, edge inclusion epsilon, add/remove badges, and whether already selected geometry receives a distinct hover treatment.

## 2. Ambiguous picks: a temporary preview before commitment

**Documented.** When a pick has several plausible objects, Rhino presents a selection menu and highlights the current candidate. A user can click a listed candidate; cycle with repeated left clicks at the pick point or the wheel; then accept with right click. None, clicking away, or picking another object cancels the ambiguity process. [Rhino 8 selection commands](https://docs.mcneel.com/rhino/8/help/en-us/commands/selection_commands.htm)

**Documented.** The menu can follow the cursor with pixel offsets or remain at its last location. Height can grow to a configured maximum. Labels can include name/type, layer/color, and curve subtype. An optional All entry selects the listed objects. Dynamic highlighting while hovering menu items can be disabled or assigned a custom color. [Rhino 8 selection menu options](https://docs.mcneel.com/rhino/8/help/en-us/options/selection_menu.htm)

**Feel interpretation.** Candidate preview must remain separate from committed selection. If a candidate becomes selected merely because the pointer passes over its row, exploration feels risky. The menu is a spatial disambiguation tool: the geometric preview is as important as the text.

**Runnable studies.**

- `selection.ambiguity`: three overlapping silhouettes with descriptive names; preview each row without committing.
- `selection.ambiguity-cycle`: vary overlap count from two to eight; test cycling without moving the pointer to the list.
- `selection.ambiguity-placement`: compare fixed, cursor-following, and edge-clamped placement.
- `selection.ambiguity-identity`: identical type names on different layers; test label detail and swatches.

**Suggested controls:** overlap threshold, preview color, preview line width, row height, menu offset, visible item limit, label fields, All availability, and candidate order. Any deliberate menu-opening delay, animation, or sticky hover behavior is an experiment; no source here establishes those native defaults.

## 3. Subobjects and selection filters

**Documented.** SelectionFilter applies to multiple selection methods and can restrict object types. Enabling its Sub-objects mode makes ordinary click select subobjects and Ctrl+Shift+click target the top-level object. Points/vertices, curves/edges, and surfaces/faces can be restricted separately. Closing the panel disables filters. Four unsuccessful picks normally disable them; the advanced RepeatDisableCount setting can remove that recovery rule. One-shot filters temporarily restrict the next selection, then restore the earlier settings. F5 cycles common subobject filters. [Rhino 8 SelectionFilter](https://docs.mcneel.com/rhino/8/help/en-us/commands/selectionfilter.htm)

**Documented.** With appropriate subobject filters, double-click selects a mesh/SubD edge loop. Shift-modified gestures can define a loop range; Alt participates in edge-ring gestures. Face loops and vertex chains use a starting element and a second element to determine direction. Ctrl-modified gestures remove a loop, ring, or chain. A tangent surface-edge chain also supports double-click selection. These gestures depend on the active filter. [Rhino 8 filtered loop/ring selection](https://docs.mcneel.com/rhino/8/help/en-us/popup_actions/select_loop_ring_subobject_filter.htm)

**Feel interpretation.** There are two orthogonal questions: which object is under the pointer, and which level of its structure is eligible. The lab should make eligibility visible. A front-facing face, a shared edge, and a vertex need distinguishable candidate marks. Filter changes should not silently redefine the meaning of a gesture without a persistent mode cue.

**Runnable studies.**

- `subselection.face-edge-vertex`: a faceted cube with individually addressable faces, edges, and vertices.
- `subselection.group-member`: three shapes in one group; compare group ownership with member eligibility.
- `subselection.filtered`: same geometry under face-only, edge-only, and vertex-only modes.
- `subselection.failed-picks`: intentionally pick ineligible geometry; test recovery after a configurable count.
- `subselection.loop-ring`: a small regular quad grid wrapped into a cylinder; inspect loop versus ring direction.

**Suggested controls:** vertex diameter, edge hit tolerance, face inset, parent dimming, eligible/ineligible preview, active-filter badge, failure recovery count, and whether the parent boundary stays visible around a selected subobject. Browser topology experiments must be labeled separately from a faithful NURBS/SubD implementation.

## 4. Selection appearance, control points, locked and hidden objects

**Documented.** Rhino's training guide describes yellow as the default selected-object color and explains that shaded objects can be clicked on their filled area. The guide found under the Rhino 8 training path is internally titled Rhino 6, so it is supporting historical evidence, not an exact Rhino 8 build reference. [McNeel Windows user guide PDF](https://docs.mcneel.com/rhino/8/training-command/en-us/usersguide/Rhino%20User%27s%20Guide%20for%20Windows.pdf)

**Documented.** Application color options separately configure selected objects, locked objects, drag feedback curves, tracking lines, crosshairs, grid lines, and axes. [Rhino 8 color options](https://docs.mcneel.com/rhino/8/help/en-us/options/appearance_colors.htm)

**Documented.** A display mode can shade-highlight selected surfaces/polysurfaces or meshes. Control-point styles include outlined and solid round/square marks; size is in pixels and also affects the mouse marker and object-snap point. Control polygons have independent color, stroke, visibility, and neighboring-segment highlight settings. Locked-object display can use a chosen color, transparency, or placement behind other geometry; these settings can also apply to locked layers. [Rhino 8 display-mode object options](https://docs.mcneel.com/rhino/8/help/en-us/options/view_display_mode_objects.htm)

**Documented.** Locked objects remain visible and can be snapped to, but cannot be selected for editing. [Rhino 8 Lock](https://docs.mcneel.com/rhino/8/help/en-us/commands/lock.htm) Hide removes selected objects from view. [Rhino 8 Hide](https://docs.mcneel.com/rhino/8/help/en-us/commands/hide.htm)

**Feel interpretation.** A locked reference is useful geometry that lacks edit permission, not merely low-contrast decoration. Dimming it too aggressively destroys its reference value. Selected fill and selected outline should be independently adjustable, particularly where overlapping faces obscure each other. Point size affects both readability and pickability, but the browser lab should allow these to be decoupled to study the tradeoff.

**Runnable studies.**

- `state.selected-fill`: overlapping solids, with outline-only versus tinted-face selection.
- `state.locked-reference`: one locked reference and one movable shape; inspect snap/reference readability.
- `state.hidden`: hide and restore one selected shape; inspect selection and ownership feedback.
- `points.control-polygon`: a curve with a visible polygon and small grips; compare neighboring segment emphasis.

## 5. Gumball as one contextual manipulator

**Documented.** The official guide says Gumball starts off and appears after activation when objects are selected. Multiple selected objects share one widget. Handle availability depends on object type: solid editing grips vary with curves, faces, points, and full 3D objects. Eligible extend faces have a halo around the extrusion dot. Hovering handles reveals actions and modifiers. The guide describes the origin at the selection bounding-box center and dynamic relocation through double-clicking a handle or origin. F4 cycles alignment options. [McNeel Gumball guide](https://www.rhino3d.com/en/docs/guides/user-guide/gumball-basics/)

**Documented.** Arrows translate on one axis, plane handles move within a plane, arcs rotate, and scale handles resize along an axis. The origin supports free movement. Clicking a handle accepts a numeric distance, angle, or scale factor; Alt+click makes a numeric copy. During drag, tapping Alt toggles copying. Shift modifies scaling to uniform 3D, or uniform 2D on a plane handle. Double-click edits widget placement; Ctrl+double-click supports numeric widget adjustment. Relocation enables snapping. Right-click-and-hold on the widget, then release when its page icon appears, accesses its menu under Windows mouse settings. Relative scale handles retain screen size through zoom; absolute handles track model bounds and support dimensions. Negative scale input mirrors. A relocated widget requires Reset before a new alignment takes effect. [Rhino 8 Windows Gumball command](https://docs.mcneel.com/rhino/8/help/en-us/commands/gumball.htm)

**Feel interpretation.** The manipulator connects a visual target to an immediately understandable direction. A single shared widget is important for mass operations: selecting three shapes should not create three competing transform targets. Numeric entry and dragging should expose the same operation in two precision modes. Widget relocation must look visibly different from object transformation because their pointer gestures are similar but their effects are fundamentally different.

**Runnable studies.**

- `gumball.axis-move`: one axis active, with a clear projected direction and live delta.
- `gumball.plane-move`: a small plane patch and dummy objects that reveal out-of-plane drift.
- `gumball.rotate`: an asymmetric object so rotation is obvious; compare angle feedback and arc coverage.
- `gumball.scale`: a rectangular solid; compare one-axis, uniform, and pivot-dependent resizing.
- `gumball.multi-object`: two far-apart shapes and one shared manipulator; compare group centers.
- `gumball.numeric`: enter distance, angle, and scale with immediate preview, commit, and cancel.
- `gumball.copy`: moving preview plus original; inspect whether copy mode remains unmistakable.
- `gumball.relocate`: move the pivot to a corner, then rotate the object; inspect the before/after causality.
- `gumball.relative-absolute`: zoom while inspecting the same geometry; compare constant-pixel and model-relative controls.

**Suggested controls:** manipulator radius, visual shaft/arc thickness, independent invisible hit area, arrowhead size, scale-square size, plane offset/size, active-handle emphasis, inactive-handle opacity, pivot size, copy ghost opacity, numeric panel distance, pivot marker, and active-axis guide extension. Keep the visual handle size separate from its hit target.

## 6. Alignment, snapping, dragging gain, and contextual geometry actions

**Documented.** World and CPlane alignment use their corresponding axes and oriented bounding-box centers; object alignment depends on the geometry, while View follows the viewport plane. AutoReset restores the initial axis alignment after rotation. Smooth dragging ignores object snaps; Snappy dragging uses them. Drag strength is a percentage of mouse movement, with 100% following the mouse. Lower strength gives smaller object movement for the same hand movement. [Rhino 8 status bar and Gumball menu](https://docs.mcneel.com/rhino/8/help/en-us/user_interface/rhino_window.htm)

**Documented.** Gumball appearance options expose axis/menu colors and pixel sizes for the radius, arrow tips, scale handles, planes, axes, arcs, menu ball, and extrusion ball. Plane visibility is angular: 0 degrees shows only perfect view alignment, 90 always shows, and the documented default is 50. Zero size can disable several handle types. [Rhino 8 Gumball options](https://docs.mcneel.com/rhino/8/help/en-us/options/modeling_aids_gumball.htm)

**Documented.** DragMode supports CPlane, View, World, UVN, and control-polygon-constrained movement. DragStrength affects both Gumball and direct geometry dragging. Its control supports a number, slider, and half/double spinners. Closing the control resets gain to 100%, while reopening within the editing session restores its remembered value. [Rhino 8 DragMode and DragStrength](https://docs.mcneel.com/rhino/8/help/en-us/commands/dragmode.htm)

**Documented.** The official coffee-table exercise demonstrates practical combined operations: duplicate curve profiles, relocate a pivot to a snapped corner, resize around that corner, extrude profiles into solids, select individual faces, and cut/boss using planar curves. It supplies a downloadable Rhino model. [McNeel Gumball coffee-table tutorial](https://www.rhino3d.com/docs/guides/general/gumball-advanced/)

**Documented.** Rhino 8 adds grips for extension and extrusion to the transform widget. [Rhino 8 feature overview](https://www.rhino3d.com/en/8/new/)

**Runnable studies.**

- `gumball.alignment`: a rotated box and tilted face; compare World, Object, CPlane, and View.
- `gumball.reset`: manually adjusted pivot followed by a requested alignment change; test a clear reset affordance.
- `gumball.snappy-smooth`: position a shape near multiple reference targets; adjust capture and release behavior.
- `gumball.drag-strength`: place a point precisely between crowded targets; compare gain at 100%, 50%, and 10%.
- `gumball.context-handles`: switch among point, curve, face, and complete solid; inspect handle availability and explanatory hover content.
- `gumball.extrude-extend`: a planar profile beside a faceted solid; study directional feedback and mode disclosure. Any dummy topology operation must be marked as a visual approximation.

**Suggested controls:** coordinate mode, pivot mode, reset policy, snap enabled, capture radius, release radius, target priority, drag gain, angle increment, plane visibility angle, context-sensitive handle availability, and tooltip delay. Capture/release hysteresis, smoothing, and acceleration are proposed experimental variables; the research did not establish Rhino's native values.

## 7. Hover and cursor presentation: evidence boundaries

This review confirms documented hover feedback for selection-menu candidates and Gumball tooltips. It does **not** establish a universal idle-viewport prehighlight for every Rhino object. The native inspection in Section 10 found no idle prehighlight on its single shaded box. A dashboard's broad object-hover tint should therefore carry an experimental label, rather than claiming native parity. Command-specific eligible-object highlighting also must not be generalized to every scene state.

The cited sources do not specify a complete inventory of native cursor glyphs per handle, their exact pixel dimensions, cursor hotspots, animated transitions, OS scaling treatment, pointer speed, dwell timing, or click-versus-drag timing. These need a dedicated observation session in the target Rhino 8 Windows service release. Documentation is sufficient for gesture semantics; it is not sufficient for those perceptual measurements.

**Proposed browser cursor study, not a Rhino claim:** compare arrow on empty scene; pointer or precision crosshair over selectable geometry; move over a free-translation target; directional resize over an axis target; a rotation-specific custom glyph over arcs; and not-allowed plus a small lock cue for unavailable edits. Keep snap markers and modifier badges separate from the OS cursor so they can be tuned independently. Test the policy with both mouse and trackpad, zoomed-in and zoomed-out geometry, light and dark backgrounds.

Suggested study dimensions are cursor type, cursor size, hotspot, hover delay, geometry preview strength, modifier badge, tooltip location, and pointer occlusion. A useful acceptance prompt is: "Before clicking, can I predict what will change, in which direction, and at which structural level?"

## 8. Fine-tuning model for this repository

This is a proposed architecture, not a Rhino feature claim. Effective settings should resolve from document → interaction category → case/prototype → dummy object or object group, with explicit local overrides. A value edited at document scope should only affect inheriting descendants. A local Reset should remove an override, rather than copy today's parent value.

Use capability intersections for filtered editors. When a user selects move, rotate, and selection studies together, show only parameters meaningful to all three, such as feedback colors or hover delay. Axis length should disappear unless every selected study supports it. Within a case, selected dummy objects should show their common geometry-level controls. If existing values differ, show Mixed until the user applies a shared value; selecting a mixed set must not itself overwrite anything.

Keep prototype-selection separate from geometry-selection. The first chooses which experiments receive settings. The second exercises the interaction being studied. Distinguish the two with different framing, an explicit scope label, and a target count. Store written feedback with case ID, active scope, selection, effective settings, and timestamp; this lets later changes be traced to their original observation.

For every case, keep a visible task, reset action, current state readout, evidence status, and source link. Record whether the case has been browser-tested, native-observed, or remains a conceptual study. Cursor controls deserve their own section because changing cursor type is a meaningful feedback experiment even when geometry does not move.

## 9. Follow-up observation checklist

These are open research questions, not assertions:

1. Extend the single-box idle-hover observation to curves, mesh faces, SubD edges, control points, and additional display modes.
2. Extend the arrow/scale/arc hover observations to every Gumball control, subobject mode, and drag state; measure cursor hotspot at 100%, 150%, and 200% Windows scaling.
3. Measure click-to-feedback latency, tooltip dwell, drag-start movement, ambiguity list ordering, and cancellation behavior.
4. Observe whether overlapping selected objects remain legible while a candidate or manipulator handle is hovered.
5. Compare moved pivots, multiple selections, and alignment resets across the target Rhino service release.
6. Validate depth/occlusion and topology-dependent selection using a real 3D model; projected browser silhouettes cannot settle these behaviors.

Official video references are [Hello Gumball](https://vimeo.com/84954262) and [Gumball Advanced](https://vimeo.com/260472052), both linked from the Rhino 8 Help page. Their accessible descriptions identify Rhino 6 material. They are useful historical demonstrations, but were not frame-analyzed here and should not be treated as exact Rhino 8 cursor or timing evidence.

## 10. Native observation: Rhino 8 SR30 on this computer

**Evidence type: direct UI observation, October 14, 2026.** The About panel identified Version 8 SR30, build 8.30.26103.11001, dated April 13, 2026. The scene contained an existing closed extrusion shaped as a box and a polyline. Its active Perspective viewport used Shaded display. The model was Untitled and was not saved. The earlier inspection dismissed a transient partially typed command/autocomplete state before this pass; no new geometry was created for the research.

The following observations are narrow and reproducible in that existing scene:

- Placing the pointer over the unselected box's filled front face and waiting did not tint, outline, or otherwise prehighlight the object. The captured pointer remained an arrow.
- Clicking that face selected the extrusion. Edges changed to bright yellow, including rear edges visible across the shaded object. The Properties panel changed from viewport properties to object properties and identified a closed extrusion. The command history reported one object added to selection.
- A single Gumball appeared around the box's center. The visible axes were red, green, and blue, with arcs, small outlined scale squares, plane patches, and a small origin mark.
- Hovering the red movement arrow changed the arrow/shaft to black. A nearby tooltip presented movement, copying by tapping Alt, numeric entry by click, and widget movement by double click. The captured pointer retained an arrow shape.
- Hovering the red scale square changed its feedback to black and showed the one-dimensional scale action plus uniform scaling with Shift, copying, numeric entry, and handle adjustment. Its pointer also retained an arrow shape.
- Hovering the rotation arc changed that arc to black and displayed rotation, copy, numeric entry, and widget-rotation instructions. Its pointer retained an arrow shape.
- Clicking the movement arrow opened a small empty input field beside the tip. Rotation arcs and scale grips temporarily disappeared, leaving movement axes visible. Escape removed the field and restored the complete widget; the box remained selected and unmoved.
- Clicking empty space cleared the selection and removed Gumball. Geometry and camera values remained unchanged during these selection/input observations.

The captured pointer had a blue halo. That halo is treated as computer-use/capture feedback and is excluded from the Rhino interaction findings. Cursor hotspot, tooltip delay, and pixel-perfect glyph measurements were not established. After closing About, the app appeared in a smaller restored window; the viewport resized without an intentional camera operation.

### Current configured values inspected without changing them

These are this installation's current settings, **not claims about factory defaults**. The Options dialog was closed with Cancel; no values or checkboxes were edited.

- **Mouse:** Combo selection; control-point drag threshold 12 px; object drag threshold 12 px; dragging restricted to already selected objects off. Click-and-hold context menus on, delay 250 ms. Subobjects, selecting objects with points on, automatic control points for eligible single selections, and pickable control polygons all on.
- **Gumball:** enabled, Snappy selected, rotate-view-around-Gumball off, merge-faces-after-extrude off. X/Y/Z swatches red/green/blue; menu ball white. Radius 80 px; tip length 20; tip width 5; scale-handle size 4; plane location 40; plane size 20; plane visibility 50 degrees; axis and arc thickness 2; menu ball location 30; menu ball size 5; extrusion ball size 5.
- **Cursor ToolTips:** Osnap and Gumball on; distance, point, relative point/angle, command prompt, and Autosuppress off. X and Y offsets both 20.
- **Selection Menu:** follow cursor on, X/Y offset 22/15 px; automatic height on with maximum 20 items; titlebar/border on. Name/type, object type, and object color on; layer, curve details, and All off. Dynamic highlighting on, custom highlight color on, with a pale pink swatch.

### Consequences for the browser lab

Keep a native-observed preset with an ordinary arrow over selectable faces and inspected Gumball targets, no general idle-object hover tint, yellow committed outlines, black active-handle feedback, and contextual action tooltips. Offer alternate cursor and hover policies as intentional experiments. This makes it possible to study whether richer cursor changes improve discovery without mislabeling them as Rhino behavior.

The pass did not exercise transforms, copy creation, extrusion, subobject-modifier clicks, dense overlap, snapping, or loops. It did not validate the user-configured drag thresholds by moving objects. Those remain documentation-backed behaviors and suggested follow-up studies.

## Coverage and limitations

This report covers whole-object selection, additive/removal modifiers, window/crossing, dense-pick disambiguation, subobjects, filters, loops/rings, control-point presentation, locked/hidden state, Gumball transforms, numeric input, copying, relocation, alignment, handle appearance, dragging gain, and contextual geometry studies. Separate research should cover object snaps, SmartTrack, navigation, construction planes, cursor tooltip contents, and command feedback in equivalent depth.

Source summaries above deliberately remain concise; consult the linked primary pages for the complete command and modifier matrices. No claim is made that the proposed tuning values equal Rhino defaults unless the documentation explicitly provides that default.
