# Rhino precision interactions and Atlas interaction crosswalk

Research snapshot: 14 October 2026. Scope: Rhino 8 for Windows, mouse and keyboard, and the supplied AtlasFileExplorer interaction-language reports. The dashboard should make targeting, intent, constraints, previews, commit, and recovery separately testable. Reusing a shortcut without those surrounding behaviors does not reproduce the feel.

Evidence labels used here:

- **Rhino documented:** current McNeel Rhino 8 Windows help describes the behavior. This is a documentation study, not a measured recording of a running Rhino session.
- **Atlas audited:** the supplied inventory describes the current Slate working tree through a static code and contract audit. These findings have not been independently exercised here.
- **Registry only:** the command appendix advertises the action; its presence alone does not establish availability or implementation.
- **Prototype proposal:** a test, tuning control, inheritance rule, or comparison recommended for this repository. It is not presented as a Rhino default.

## Atlas source coverage

Both supplied reports were read systematically: the 432-line [Slate interaction inventory](C:/Users/jmoser/source/repos/AtlasFileExplorer/docs/interaction-language/01-slate-interactions.md) and the 617-line [registered command index](C:/Users/jmoser/source/repos/AtlasFileExplorer/docs/interaction-language/02-registered-command-index.md). The appendix contains 289 registered command records across nine registry categories, plus four secondary aliases. It is generated reference material; the source registry owns command identities and bindings.

The inventory covers seven primary node classes and 25 BoardTool variants. Its section numbering jumps from 13 to 20. The command appendix contains specialized portal and media interactions that are not developed into corresponding numbered chapters in the main inventory. Those actions should remain discoverable in a general-purpose repository even when the first working prototype focuses on scene interaction.

### Camera and world scale

**Atlas audited:** right-drag, middle-drag, Space plus primary-drag, and the persistent Hand tool pan. Shift-wheel pans horizontally. Arrow keys pan by 60 screen pixels, or 240 with Shift, when there is no selection; with selection they nudge authored geometry instead. Ctrl-right-drag can become turbo pan after four screen pixels, with dominant-axis locking after six. Return to its press origin stops the rate-driven pan. Drafts survive compatible navigation.

Wheel zoom is anchored at the pointer and bounded from 0.05 to 3.5. Home fits content; a minimap centers the camera. The Zoom tool supports click, Alt-click, and drag-window fitting. World geometry generally scales, but pointer ghosts and path grips can remain usable at screen size. Portal cameras, model cameras, and the board camera have separate ownership.

**Registry only:** outer-board pinch and plus/minus zoom are advertised, but the inventory found no corresponding outer-board consumer. File Atlas content supports pinch; that does not establish board support.

**Dashboard implication:** keep direct displacement pan, rate pan, zoom anchoring, camera boundaries, and navigation during a draft as separate cases. Do not call a generic left-drag inside a live model a complete Rhino navigation profile.

### Hover and target disclosure

**Atlas audited:** passive outlines can be switched per node class. Curve hit testing follows supported stroke geometry rather than filling its rectangular bounds. Selection has a separate silhouette treatment. Nearness to a grip changes the cursor and reveals an action; its hit area can exceed the painted mark. Connector ports disclose locally. Armed tool ghosts show future output. Video hover scrub, album hover preview, and asynchronous subject silhouettes are content-specific hover behaviors.

**Dashboard implication:** expose target radius, cursor, passive outline, delay, and reveal style independently. A cursor that says resize while the press will select is a precedence defect, not merely a styling issue.

### Whole-object selection and sub-selection

**Atlas audited:** primary-click replaces selection; clicking an already selected member preserves the set for dragging. Shift-click and Ctrl-click toggle members. A modified miss retains the current set. Flat groups select together. Ctrl+Shift-click bypasses group expansion and can force a one-off locked-object edit, but on a curve segment it has the more specific role of picking that segment and endpoints.

Ordinary picking uses three passes: regular objects, connectors, then frames; reverse scene order chooses within each pass. Explicit grips win over object bodies. Left-to-right sweeps contain; right-to-left sweeps cross. The direction can change during a live sweep. Hidden and locked objects do not participate ordinarily. Curves use stroke intersections. **Current exception:** connectors cross in both sweep directions. Frames are excluded from completed sweep results. An empty gap inside a multi-selection union belongs to moving that selection.

Direct Selection has its own anchor and segment sets; object, vertex, segment, raster, layer, spreadsheet, text, and portal-content selection are different scopes.

**Dashboard implication:** selection modifiers need profiles and scope labels. Never silently merge Slate's locked-object force selection with Rhino's sub-object route.

### Transform and property editing

**Atlas audited:** ordinary primary-drag moves; groups travel together; frames carry contained members. Alt duplication is latched at gesture start. Alt-duplicate movement keeps snaps suspended even after Alt release; Alt-scale suspension follows current Alt state. Corner resize preserves aspect by default, edge resize does not; Shift inverts those behaviors and Ctrl anchors at center. The opposite handle stays pinned even on rotated objects. Tiny objects retain a move region despite overlapping grip hit areas.

Rotation softly acquires within four degrees of 45-degree multiples; Alt suspends it. Multi-object scale normally affects member size and arrangement. Ctrl+Alt+Shift group scale changes positions without member sizes. Alignment needs two objects and distribution three; locked members supply bounds but stay fixed. Dimension entry and property scrubs have defined anchors and one undo unit. Fillet grips support drag or numeric entry; multi-selection applies a shared amount clamped per geometry.

Optional bumper interaction adds push, friction, glide, Alt pass-through, cancellation of the complete shove, and one undo unit. Its default is off.

**Dashboard implication:** test hover activation separately from selected activation; test rollback of copied objects as well as rollback of original geometry. Clamp feedback must identify which selected object reached its limit.

### Precision and drafting

**Atlas audited:** grid visibility, grid attraction, guides, and object snaps are independent. Grid attraction uses 20 world units and starts off. Object snap master plus End, Mid, Center start on; other shipped kinds start off. End, Mid, Center, Near, Intersection, Quadrant, Perpendicular, and Tangent are supported, with documented geometry limits. The object-snap acquisition radius is twelve screen pixels; guides acquire within nine. Kind order is End, Intersection, Center, Mid, Quadrant, Perpendicular, Tangent, Near, with distance resolving within a kind.

Point resolution checks Alt suspension, eligible ortho, object snaps, guides, grid, then raw position. Direction locking projects object snaps onto the locked direction in the current resolver. An older pattern passage saying snaps suspend under direction lock is stale. Moving under ortho keeps projected object and guide corrections while suspending grid; it is not identical to point-pick precedence.

F8 persistent ortho starts off. Held Shift inverts it for eligible segment gestures, using 45-degree steps. Tab locks direction; another Tab unlocks; placing a point clears the lock. Area tools use Shift for aspect and do not inherit F8 or Tab. Smart-guide feedback is a brief tapered fading ribbon. The preview and committed point share resolved geometry.

Lines support click-move-click and drag-release, plus exact length. Polyline points commit on press, not release; finishing appends no hover point. Bézier closure requires 350 ms dwell at its start. Draft undo precedes document undo. Numeric entry belongs to the tool and can suppress command search.

### Tool lifecycle and command discovery

**Atlas audited:** arm, draft, operation, commit, and disarm are separate states. Area-tool click versus drag uses more than four screen pixels of raw travel. Most creation tools are one-shot; Brush, Eraser, Smooth, Trim, Split, and Deck stay armed. Geometry tools use crosshairs; ink tools replace the ordinary cursor with a tip circle; frame and portal tools show tinted ghosts.

Command palette, type-to-command, object search, command history, repeat, and object cycling have distinct ownership. A bare tool letter waits roughly 700 ms before arming so a second letter can turn it into a palette query. Space repeat fires only on a short release under 250 ms with no pointer-button use; Space-drag pans. Active editors, crop, drafts, Trim, and Split own Enter before repeat. Idle Tab cycles reading order; draft Tab locks direction; a field owns focus traversal.

**Dashboard implication:** feedback should include current input owner and state. Tests should deliberately mix keyboard entry with a live pointer operation rather than only showing static shortcut cards.

### Editing scopes and specialized content

**Atlas audited:** Direct Selection, tangent knobs, and per-vertex properties form a specialized curve grammar. Alt breaks tangent symmetry; Shift holds direction; Ctrl scales coupled handle lengths; Ctrl+Shift combines; Alt wins over Ctrl. Click and drag can assign different meanings to the same modifier. Delete on picked segments differs from deleting vertices or the curve.

Brush, Eraser, Pen, Smooth, and their right-button HUDs form another grammar. A frozen target receives a continuous change, numeric entry, or cancellation. Ctrl-right color, Alt-right size, and Shift-right opacity/strength precede ordinary pan or context menus. Their priority and applicability depend on tool and target. A 4 px / 0.8 s short right chord can become numeric entry. Freehand and existing-curve edits have different authored-state boundaries.

Text, sticky words, image crop, paint layers, polygonal lasso, subject selection, and portal contents each own input locally. Text Escape can commit; crop Escape can finish an idle session; Polyline Escape can finish placed points. These are explicit finish behaviors. They must not inherit universal discard merely because another operation uses Escape to restore a press snapshot.

The command appendix adds File Atlas folder expansion, file selection and carry; web focus and browsing; agent cards, output handles, history rails and card disclosure; live-model orbit/pan/zoom, measure, and screenshots; presentation; and cross-window/source-file boundaries. Keep them as additional case families when expanding the repository.

### Menus, undo, and feedback

**Atlas audited:** a right-click does not immediately replace selection. Menu actions target an existing selected set when the hit is already selected; otherwise the hit object. Context recipes omit unsupported actions. Hovered menus own scrolling. Menu-local, editor-local, portal-local, and board-local Escape handling must not broadcast to all owners.

One continuous authored gesture ordinarily becomes one undo entry; camera exploration and selection are transient. An aborted manipulation restores press-time state and adds none. Preview, commit, duplicate, drop redirection, asynchronous completion, and linked-source writes have different boundaries. Hidden, locked, missing, loading, unsupported, and unbound are separate states.

The report recommends stable interaction records with surface, target, state, trigger, threshold, modifier phase, feedback, commit, undo, recovery, winning owner, measurable constants, and references. Its existing dimension registry D01–D40 and inherited pattern contracts should be reconciled with a future shared language rather than copied into a competing specification.

## Rhino precision and navigation findings

Each factual subsection below deliberately keeps its summary of the linked webpage below 200 words. Suggested tests later in this report are experimental design proposals.

### Raw cursor and resolved marker

**Rhino documented:** a drawing cursor has a black-and-white cursor and a marker colored by the current layer. The marker can snap independently of the pointer. A tracking line can connect the relevant locations during constraints such as elevator mode. This separation explains why copying only an OS cursor misses part of Rhino's targeting feedback. [Cursor and marker](https://docs.mcneel.com/rhino/8/help/en-us/popup_moreinformation/cursor_tracking_line.htm)

Official illustrations: [crosshair cursor](https://docs.mcneel.com/rhino/8/help/en-us/image/topic_illustrations/crosshaircursorenlarged.png), [colored marker](https://docs.mcneel.com/rhino/8/help/en-us/image/topic_illustrations/cursormarkerenlarged.png), and [cursor marker tracking diagram](https://docs.mcneel.com/rhino/8/help/en-us/image/topic_illustrations/marker.png).

### Persistent and one-shot object snaps

**Rhino documented:** snaps constrain the marker at geometric features. Persistent kinds include Cen, End, Int, Knot, Mid, Near, Perp, Point, Quad, Tan, Vertex. One-shot snaps replace the persistent combination for one pick; Shift-clicking a checkbox requests one. Right-clicking a kind temporarily isolates it and right-clicking again restores the prior combination. Disable preserves enabled choices. Alt inverts their effective state while point picking, including temporarily enabling checked snaps when Disable is on. Starting a drag near a snap needs a 0.25-second primary-button hold. Perp and Tan need an earlier point. Reference aids include Along, AlongParallel, Between, From, PerpendicularFrom, TangentFrom; OnCurve, OnSurface, OnPolysurface, and OnMesh restrict location to a chosen target. Percentage exposes positions along a curve. ProjectOsnap marks projected results with a tooltip prefix and tracking line. [Object snaps](https://docs.mcneel.com/rhino/8/help/en-us/user_interface/object_snaps.htm)

### Snap eligibility and screen tolerance

**Rhino documented:** object-snap acquisition radius is in screen pixels; digitizer radius is in model units. Object-snap highlighting can identify its owner. Separate options permit locked, occluded, filtered, or selected-only targets. Mesh-edge support has its own option. Apparent intersections allow view-space crossing without a true 3D intersection. Approximate circles, arcs, and ellipses can qualify for center snap. Construction planes can be independent or linked as a perpendicular system sharing one origin. [Modeling Aids options](https://docs.mcneel.com/rhino/8/help/en-us/options/modeling_aids.htm)

### Grid drawing and grid attraction

**Rhino documented:** F9 toggles Grid Snap. Snap spacing is in model units, can apply to the active viewport or all viewports, and differs from reference-grid visibility. Object snaps and coordinates override grid snapping; angle and distance constraints partially override it. [Snap and SnapSize](https://docs.mcneel.com/rhino/8/help/en-us/commands/snap.htm)

**Rhino documented:** reference-grid settings include minor-line spacing, major-line interval, extent, and independent visibility of lines, grid axes, and world-axis icon. They are document properties with active-viewport or all-viewport application. The visible grid covers only part of the infinite CPlane. [Grid properties](https://docs.mcneel.com/rhino/8/help/en-us/documentproperties/grid.htm)

### Ortho and temporary inversion

**Rhino documented:** Ortho limits movement to multiples of a configurable angle from the previous point; the documented default is 90 degrees. F8, the status pane, and Ortho command toggle it, while held Shift changes the mode temporarily. Hash marks show the angle. OrthoSnapToCPlaneZ extends tracking to CPlane Z. **Atlas difference:** its eligible drafting uses 45-degree steps, and its current implementation treats area tools separately. [Ortho](https://docs.mcneel.com/rhino/8/help/en-us/commands/ortho.htm)

### Direction, radius, coordinates, and elevator constraints

**Rhino documented:** the first Tab locks a direction from the previous point through the marker. A second Tab changes to a circle centered on the previous point with the radius set by the Tab location. This differs from Atlas's second-Tab unlock. Outside a direction-picking command, Tab toggles SubD box/smooth display. Typed distance and angle can combine, for example relative polar entry. Ctrl plus primary-click starts elevator mode, then movement changes distance perpendicular to the CPlane before a further pick. **Unresolved:** the cited passage establishes the first two Tab states but does not specify a third-tap release cycle; test that in Rhino before treating it as a contract. [Accurate drawing](https://docs.mcneel.com/rhino/8/help/en-us/user_interface/accurate_modeling.htm)

### Planar and projection

**Rhino documented:** Planar keeps successive picks at the prior point's elevation relative to the current viewport CPlane, including when moving between views. It is not simply restriction to world Z = 0. Elevator mode and object snaps can override Planar. **Atlas difference:** a 2D board has no equivalent elevation state, so a flat attraction demo cannot validate this interaction. [Planar](https://docs.mcneel.com/rhino/8/help/en-us/commands/planar.htm)

### SmartTrack and guides

**Rhino documented:** captured points and temporary tracking lines offer geometric references during a command. Dwell capture applies to End, Point, Mid, Cen, and Vertex. One Ctrl tap captures manually; two clear points. Inactive captured points and active points have different styles. Activation delay, capacity, colors, dotted lines, smart ortho, tangent/perpendicular, parallels, retention through picks, and a CPlane-origin reference are configurable. Tracking intersections can act as snap targets. Implied From lets numeric entry relate to an active smart point; Alt+Enter restores the distance constraint from the previous pick. AddGuide creates construction references visible while picking; Alt temporarily hides/disables them. **Atlas difference:** automatic nearby alignment guides with fading ribbons are not equivalent to captured SmartTrack memory. [SmartTrack and Guides](https://docs.mcneel.com/rhino/8/help/en-us/options/modeling_aids_smarttrack.htm)

### Cursor tooltips and command feedback

**Rhino documented:** cursor tooltips can show current snap, distance, CPlane coordinates, relative coordinates/angle, command prompt, and Gumball action. Autosuppress tries to retain the useful information; X and Y offsets are screen pixels. Enabling these tooltips turns off object-snap cursors. Therefore tooltip and osnap-cursor presentation should be compared as explicit modes, not assumed to be simultaneously active in the Rhino profile. [Cursor ToolTips](https://docs.mcneel.com/rhino/8/help/en-us/options/modeling_aids_cursor_tooltips.htm)

### Camera navigation by projection

**Rhino documented:** right-drag pans a parallel viewport and rotates a perspective viewport. View navigation can occur while a command remains active. Clicking a viewport title activates it; double-clicking maximizes/restores it. Camera rotation around a target differs from rotating the target about the camera. [Navigate in viewports](https://docs.mcneel.com/rhino/8/help/en-us/seealso/sak_navigate.htm)

**Rhino documented:** View options tune wheel step/direction, rotation coordinates, keyboard pan fraction, dynamic redraw target, target adjustment, linking, and cursor wrapping at viewport boundaries. Rotation around geometry under the pointer is an advanced option. Linked viewport behavior separates perspective and parallel projections. These options materially change navigation feel; no undocumented numeric wheel default is assumed here. [View options](https://docs.mcneel.com/rhino/8/help/en-us/options/view.htm)

### Click and drag thresholds and button ownership

**Rhino documented:** object and control-point drag thresholds are independently specified in screen pixels. Drag selected objects only can reduce accidental moves. Alt plus primary-drag forces box selection near existing geometry. Mouse selection can use Combo, Window Box, or Crossing Box. Middle-button action is configurable, including a popup, macro, or view manipulation with modifier options. Right-button held-context-menu delay is configurable; zero immediately opens the menu and stops command repeat. Disabling sub-object selection still permits Ctrl+Shift group-member selection. Control points can appear automatically on eligible single selections. [Mouse options](https://docs.mcneel.com/rhino/8/help/en-us/options/mouse.htm)

### Drag frame and motion strength

**Rhino documented:** DragMode chooses CPlane, view, world XY, surface UVN, or control-polygon movement. ControlPolygon can move along a control chord and Tab can extend its direction. Shift can make multiple points move an equal absolute amount rather than proportionally to chord length. DragStrength affects objects, control points, and Gumball; its control supports numeric entry, spinners, and slider, and closes back to 100% while remembering the session value for reopening. [DragMode and DragStrength](https://docs.mcneel.com/rhino/8/help/en-us/commands/dragmode.htm)

### Keyboard increments

**Rhino documented:** Nudge can use arrows or Alt-arrows and CPlane, world, view, UVN, or control-polygon directions. Plain, Ctrl, and Shift increments are independently configurable in model units. PageUp/PageDown provide the third-axis increment in the relevant binding. Remesh timing can be tuned for surface-control-point nudges. **Atlas difference:** its default 1 / 10 world-unit nudge and selection-sensitive arrow-pan ownership are application choices. [Nudge options](https://docs.mcneel.com/rhino/8/help/en-us/options/modeling_aids_nudge.htm)

## Proposed case studies

These are test designs. A source establishes the behavior to investigate; the dummy scene, comparison ranges, and evaluation criteria below are proposed for the laboratory.

### Targeting and cursor feedback

1. **Cursor versus resolved point.** Place a line endpoint beside a dense grid. Move slowly across it while drawing. Compare a raw crosshair, a colored resolved marker, and their connecting leader. Tune marker size, stroke, cursor glyph, and leader opacity. Confirm that the visibly resolved point is the committed point.
2. **Tooltip density.** Use the same line but show snap-only, snap plus distance, full coordinates, or prompt information. Tune offsets, delay, font, background, and suppression. Record whether the label covers the next target and whether users can distinguish a snap target from a selected object.
3. **Hover eligibility.** Use a circle, open Bézier, rectangle, mesh-like wire, and locked object. Compare painted-boundary hit tests and inflated bounds. Tune hover radius and passive highlight per object. A miss inside an open curve's empty bounds should not resemble a real hit.
4. **Competing controls.** Overlap an endpoint, transform grip, connector port, and body edge. Display the winning owner. Tune individual hit zones and precedence profile. The hover cursor must predict the action on press.

### Snap acquisition and constraints

5. **Endpoint, midpoint, center.** Use two lines, an arc, and an ellipse. Draw between features while zooming. Tune screen acquisition radius, marker appearance, label offset, and per-kind enablement. Repeat at three zoom scales to separate screen tolerance from model spacing.
6. **Intersection and ambiguity.** Put a true crossing, near miss, and two features close together. Compare priority by feature and by distance. Tune candidate radius and tie strategy. Feedback should name the winning object and kind.
7. **Near versus discrete feature.** Put an endpoint close to a smooth curve. Drag around both. Compare whether a continuous Near candidate prevents reaching the discrete target. Tune kind order and an experimental release radius; label the latter as a laboratory feature, not a documented Rhino constant.
8. **Tangent and perpendicular construction.** Use a circle and a start point outside it. Try the aid before and after setting a basepoint. Tune feature colors and applicability feedback. An unavailable constraint must be distinguishable from a failed hit.
9. **Persistent versus one-shot.** Enable several features, choose one temporary override, pick twice. Tune the one-shot indicator and restoration animation. Confirm the second pick uses the original enabled combination.
10. **Alt inversion.** Compare checked snaps enabled and globally disabled, then hold Alt. Tune cursor badge and status text. Record whether temporary inversion is understandable in both starting states; compare Slate-style unconditional suspension as a separate profile.
11. **Drag basepoint dwell.** Use a circle with center and a line with midpoint. Press near a feature, pause, then drag. Tune hold time and object/control-point thresholds separately. Display whether the selected basepoint came from a snap or the raw press.
12. **Snap eligibility flags.** Use visible, locked, filtered, selected-only, and occluded references. Tune eligibility flags independently from selection flags. Capture the reason a target was excluded.
13. **Grid visibility versus snap spacing.** Draw with hidden grid / active attraction and visible grid / inactive attraction. Tune minor spacing, major interval, snap spacing, and reference opacity. Verify users can identify the active aid without inferring it from line visibility.
14. **Ortho inversion and angle.** Draw with 90°, 45°, and 30° increments and invert with Shift. Tune angle, hash-mark presentation, and temporary-state badge. Confirm entering a field does not also trigger viewport constraints.
15. **Tab direction and radius.** Draw through a reference and beyond it, then compare direction locking with circle-radius tracking. Tune locked-line/radius display. Provide an explicit laboratory unlock control; do not imply the unverified third Tab state is Rhino behavior.
16. **Numeric length and angle.** Start a line, enter an exact dimension, change angle, then accept or cancel. Tune entry placement, preview precision, units, and editing ownership. Check that numbers do not also open command search.
17. **Planar and projected elevation.** Use two view panels with a raised point and two separated planes. Keep a simple 3D readout. Tune projection and elevation badge. Record actual target, projected target, and last-point plane separately.
18. **Apparent versus true intersection.** Use two screen-crossing segments at different heights and an alternate camera. Tune apparent-intersection permission and warning treatment. The user should be able to identify which geometric interpretation was chosen.

### Tracking and reference memory

19. **Dwell capture.** Hover eligible features in succession, then construct at their inferred intersection. Tune capture delay, capacity, active/inactive color, and line pattern. Record false captures during ordinary transit.
20. **Manual capture and clear.** Place references in empty space and clear them. Compare explicit buttons with Ctrl tap/double-tap. Tune tap timing and captured-point badge. Verify the same chord does not accidentally invoke the current tool's drag modifier.
21. **Tracking persistence.** Place several points with and without retaining captured references. Tune clear-on-pick, maximum capacity, and oldest-point removal feedback. Ask whether the next inferred point used the intended reference.
22. **Implied reference numeric entry.** Use a previous authored point and a different active tracking point. Enter one distance. Tune explicit basepoint labels. The preview should identify which point owns that number before commit.
23. **Guides versus transient alignment.** Compare an authored guide, a captured reference, and a nearby-object alignment ribbon. Tune lifetime, fade, thickness, and visibility. The same appearance should not hide different persistence rules.

### Navigation and manipulation

24. **Parallel pan and perspective orbit.** Use a box, sphere-like ellipse, and floor grid in side-by-side view panels. Compare projection-sensitive right-drag with a constant-pan board profile. Tune gain and pivot. Preserve an unfinished line while navigating.
25. **Wheel anchor.** Put a small feature under the pointer near a viewport edge. Compare pointer, view-center, and selected-object anchors. Tune zoom step and reversal. Track the feature's screen drift after each wheel notch.
26. **Orbit target recovery.** Pan and zoom far from a model, then orbit. Compare fixed target, object-under-pointer, and target adjustment profiles. Tune transition gain and pivot feedback. Avoid claiming an experimental recovery easing as Rhino's documented curve.
27. **Threshold and strength.** Move a large body and a tiny control point with independent thresholds. Compare 100%, 50%, and 10% experimental gains. Tune drag strength at object and group scope. Check for jumps at press, threshold crossing, and release.
28. **Move, copy, and cancellation.** Use a three-object group with one locked snap reference. Start duplicate, release Alt, snap, then cancel. Compare Atlas and Rhino-oriented modifier profiles without combining their contracts. Verify temporary copies disappear and the whole gesture is one undo unit when accepted.

### Ownership and recovery

29. **Nested input focus.** Put an editable text card over a navigable scene. Type, scroll, Tab, press arrows and Escape. Tune focus border and input-owner readout. No canvas action should steal an editor-owned input.
30. **Right-click versus right-drag.** Test quick click, hold, near-threshold travel, full navigation drag, and modified HUD. Tune menu delay, travel threshold, and owner precedence. Opening a menu should not also repeat a command.
31. **Escape stack.** Build a live manipulation, a draft, an armed tool, a selection, and a menu in deliberate combinations. Tune cancellation feedback, not semantic ambiguity. Confirm each Escape resolves one owner and show whether that owner committed, restored, dismissed, or disarmed.
32. **Undo boundary.** Move multiple objects, scrub a shared value, cancel another scrub, and navigate. Tune continuous-update coalescing where appropriate. Accepted authored changes should have clear journal units; camera and selection should not produce false authored history.

## Proposed tuning hierarchy

Use explicit inherited settings from **document → category → prototype → geometry group → individual object**. A selected prototype is a laboratory case; an object selection is geometry inside that case. The interface should expose the current editing scope so those two meanings of selection cannot be confused.

The hierarchy is a laboratory design, not a claim that Rhino stores all preferences this way. Rhino distinguishes global Options, document Grid properties, viewport state, object state, and command-transient state. Keep a setting's source domain in its metadata even when the laboratory allows local overrides for experiments.

### Shared property filtering

For any batch, calculate the intersection of supported property keys and semantic types across the target set. Matching labels alone are insufficient: a model-unit radius is not interchangeable with a screen-pixel radius, and a tooltip delay is not a drag threshold. Show only safe common controls by default; offer a separate list of excluded properties and their incompatible targets. Display a mixed-value state without replacing it until the user edits that field.

Changing a common field should apply one patch to all compatible targets while preserving their unrelated overrides. Clearing an override restores the inherited value; it should not replace the whole object record. Show effective value, inherited source, and override status. Batch edits should be undoable together. Scope switches should not silently commit an unfinished numeric entry.

### Common fields by semantic family

- **Feedback:** normal/hover/selected/active/disabled colors, outline width in screen pixels, opacity, marker size, label visibility and offset, tooltip delay, transition duration, cursor kind, action badge.
- **Targeting:** eligibility flags, hit radius, drag threshold, tolerance unit, precedence rank, occlusion rule, selection scope.
- **Precision:** enabled feature kinds, acquisition radius, projection rule, angle step, grid spacing, constraint origin, candidate priority, temporary override binding.
- **Tracking:** dwell time, capture capacity, persistence rule, active/inactive presentation, reference-line lifetime, manual capture binding.
- **Manipulation:** gain, anchor, motion frame, numeric units, duplicate latch policy, snapped preview, commit boundary, cancellation action.
- **Navigation:** projection, pan/orbit bindings, zoom gain and anchor, reversal, target policy, viewport linking, border behavior.
- **Lifecycle:** click/drag boundary, current owner, sticky/one-shot tool, repeat eligibility, finish trigger, Escape owner, undo grouping.

Only Feedback fields that are supported everywhere should appear in document-wide common-property editing. A frame that cannot rotate must not acquire rotation settings merely because a mixed batch contains a rotatable path. Per-object style tuning should not change the document's semantic modifier profile.

### Feedback capture

Each case should include a written-feedback box and save its text with case ID, document/profile revision, active scope, effective settings, dummy-scene seed, cursor mode, camera, and relevant input state. Offer a short rating or tags only as supplements to written notes. Feedback should survive refresh and be exportable with settings; it should not require sending data externally.

Useful prompts include: What did you expect before pressing? What told you which object or feature would win? Did the action start too early? Did the cursor match the operation? Did a tooltip cover the target? Did the committed result match the preview? What should Escape have done?

## Decisions that must stay explicit

- Rhino's documented default Ortho angle is 90°; Atlas's eligible segment profile uses 45°.
- Rhino's second Tab enters radius tracking; Atlas's second Tab unlocks direction. The cited Rhino passage does not establish the third state.
- Rhino Alt inverts persistent snap disable state during point picking; Atlas's snap resolver treats Alt as suspension in eligible contexts.
- Rhino captured SmartTrack references and Atlas nearby smart guides have different memory and lifetime.
- Atlas hover controls can act before selection. Rhino's exact hover cursor matrix should be measured by operation and display configuration rather than inferred from generic CSS cursor names.
- Atlas's locked-object force selection, connector crossing exception, delayed tool letters, and Escape-finish behaviors are application choices requiring deliberate acceptance.
- Registered commands are discovery evidence. They do not override the inventory's implementation qualifications, input ownership, or current chrome.
- Experimental release hysteresis, animation curves, and chosen tuning ranges need laboratory labels until measured against Rhino.

## Primary source directory

All McNeel links above target Rhino 8 Windows help. The principal source pages are Object snaps, Modeling Aids options, Snap/SnapSize, Grid properties, Ortho, Accurate drawing, Planar, SmartTrack and Guides, Cursor ToolTips, Cursor and marker, Navigate in viewports, View options, Mouse options, DragMode/DragStrength, and Nudge options. Each is linked beside its supported findings rather than cited as a blanket authority for the proposed dashboard design.

Atlas source material remains in the supplied project and is linked at the start of this report. The current repository can use the records and experiments described here without modifying those original reports or treating their generated command appendix as an implementation contract.
