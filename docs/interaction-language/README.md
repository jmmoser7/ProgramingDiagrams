# Feel: an interaction language and laboratory

Research and implementation baseline: **14 October 2026 · Windows · Rhino 8 · Atlas / Slate**.

This repository now contains a reusable interaction laboratory alongside the existing Program board. Open [the dashboard](../../interaction-lab.html) directly in Chrome or Edge, or run `node serve-interaction-lab.js` and visit `http://127.0.0.1:8787/interaction-lab.html`. No package installation or external service is required.

The first collection contains **48 categorized studies**. Each has a task, expected feedback, source, fidelity qualification, dummy geometry, editable properties, and written observations. This report synthesizes the two detailed research files; those files contain the source-by-source findings and further case suggestions:

- [Rhino selection, subobjects, Gumball, and direct native observation](../research/rhino-selection-gumball.md).
- [Atlas crosswalk, Rhino precision, tracking, navigation, and input ownership](../research/atlas-and-precision.md).
- [Coverage matrix: live studies, analogies, and extension backlog](coverage.md).

## Evidence and method

Three kinds of evidence are deliberately separate. **Documented** means a current McNeel primary help page or official guide supports the behavior. **Native observed** means the running Rhino instance was inspected directly. **Experiment** means a browser interaction or tunable proposal designed here. An implemented study is not a claim of identical native timing, topology, rendering, or cursor assets.

Both supplied Atlas reports were reviewed: the 432-line interaction inventory and the 617-line registered-command appendix containing 289 commands. The inventory is the more reliable source for audited behavior. A command's presence in the registry establishes discovery and intent, while the inventory sometimes explicitly identifies missing consumers or unavailable implementations. The source project was read without modification.

The native pass used the existing box and polyline in an Untitled Shaded Perspective scene. About identified **Rhino 8 SR30, build 8.30.26103.11001**. The pass inspected selection, handle hover, numeric-input presentation, and options. It created no geometry, committed no option changes, and saved no Rhino document. A transient command autocomplete was dismissed; the model's selection was cleared at the end. About caused a window resize. See the native-observation section of the detailed report for the exact scope and current configuration.

## 1. Selection: identify, collect, disambiguate

Selection should feel like an explicit commitment to a target. The laboratory separates that commitment from a temporary candidate preview. Its selection collection tests ordinary picks, additive/removal modifiers, directional marquee, overlapping candidates, type filters, assemblies, and locked references.

The design questions are practical: can the user anticipate which geometry wins, retain a useful set while adding objects, and resolve an overlap without repeatedly undoing wrong picks? Window and crossing should remain visibly distinguishable during the gesture. Ambiguity-menu hover should preview an object without silently committing it. Locks should communicate edit eligibility rather than simply produce an unexplained failed click.

See [selection and ambiguity evidence](../research/rhino-selection-gumball.md#1-selection-whole-objects-additive-selection-and-enclosure) and the [selection-menu options](https://docs.mcneel.com/rhino/8/help/en-us/options/selection_menu.htm).

## 2. Sub-selection: whole object versus component

The lab contains projected box faces, edges, and vertices, plus individually targetable polyline segments and vertices. Ctrl+Shift hover and selection paint only the targeted component; the rest of its parent keeps its ordinary appearance. Polyline segments are targetable in every sub-selection study, including the face, edge, vertex, and filter studies. Repeating a component pick toggles that component; selecting another component adds it to the set.

With the Sub-objects type filter enabled, plain click targets components. Ctrl+Shift still reverses a solid pick to its parent, while a Ctrl+Shift polyline pick retains individual segment/vertex targeting. This curve behavior is a laboratory choice requested through feedback. The ordinary whole-object studies retain Shift-add and Ctrl-remove selection.

Ctrl+Shift dragging from empty scene space collects components across multiple objects. Left-to-right window selection requires the whole component inside the rectangle; right-to-left crossing selection accepts components the rectangle touches. The gesture adds to the existing component set. Face and edge studies collect polyline segments alongside the relevant solid components; the vertex study collects vertices. The Sub-objects filter supports plain component marquee as well, while its Ctrl+Shift point-pick inversion remains a click behavior.

A narrow component needs a usable hit region without taking every nearby body click. The component highlight should show exactly what will be acted on. Native topology-sensitive behaviors—mesh/SubD loops and rings, tangent chains, block restrictions, and control-point rows—remain documented extensions rather than simulated topology.

See [subobject and filter findings](../research/rhino-selection-gumball.md#3-subobjects-and-selection-filters) and [McNeel SelectionFilter](https://docs.mcneel.com/rhino/8/help/en-us/commands/selectionfilter.htm).

## 3. Gumball: controls with distinct meanings

Nine studies cover axis and plane translation, pivot rotation, scaling, numeric input, copying, widget relocation, snapping, and drag gain. A shared manipulator acts on a multi-object selection. Handle shapes make the intended operation visible before movement begins.

The native observation provided an especially useful correction to generic browser conventions. In the inspected scene, a selectable face and the inspected Gumball handles retained the ordinary arrow cursor. The selected box gained yellow edges. A hovered movement arrow, scale square, or rotation arc turned black, and contextual instructions appeared nearby. The blue halo in the computer-use capture was excluded from the Rhino findings.

The dashboard's **Apply observed Rhino baseline** button uses the inspected installation's 12 px drag threshold, 80 px Gumball radius, yellow selection, no passive body prehighlight, and native-style cursor policy as base settings. These are this computer's settings and observed cues, not a declaration of factory defaults. Child overrides remain explicit and take precedence.

Full Gumball alignment frames, uniform 3D scaling, extrusion/extension/cutting, absolute handles, and negative-scale mirroring need a richer geometry engine. See [Gumball findings](../research/rhino-selection-gumball.md#5-gumball-as-one-contextual-manipulator) and the [native pass](../research/rhino-selection-gumball.md#10-native-observation-rhino-8-sr30-on-this-computer).

## 4. Snaps: raw pointer and resolved position

The precision collection uses dummy polylines, a crossing pair of segments, circular geometry, and box vertices. It includes endpoint, midpoint, center, intersection, nearest-point, grid, projection cue, tangent, perpendicular, quadrant, and vertex studies.

The central feedback contract is that the raw pointer and the point that will be accepted are different things. Acquisition should identify the feature and its owning geometry; release should be understandable when the pointer moves away. Acquisition/release radii are editable in screen pixels. Separate release hysteresis is an experimental lab mechanism, not a reported Rhino preference.

The center study can acquire a circular or elliptical profile's center by hovering near its boundary, as well as near the center itself. The accepted point and marker remain at the true profile center; a leader connects the raw pointer to that position. It does not substitute a box bounding-box center for a geometric center.

Intersection candidates must agree in the fixtures' modeled XYZ coordinates. A crossing caused only by the projected extrusion offset is rejected. This check supports finite polyline and box edges; circular profiles use their 64-segment display approximation. It is a depth-aware check for these dummy fixtures, not a general curve/surface intersection kernel.

Analytical 2D circular tangency and perpendicular constructions are sufficient for comparing attraction and marker presentation. Arbitrary CPlane projection, exact curved intersections, mesh knot targets, occlusion eligibility, persistent/one-shot snap policy, and on-surface solving require additional studies. See [precision research](../research/atlas-and-precision.md#rhino-precision-and-navigation-findings) and [McNeel object snaps](https://docs.mcneel.com/rhino/8/help/en-us/user_interface/object_snaps.htm).

## 5. Constraints and tracking: temporary relationships

SmartTrack, Ortho, direction/radius locking, and a planar cue form a separate collection. Their feedback should show the relationship currently constraining the next pick rather than merely changing the final coordinate.

SmartTrack dwell captures up to three references. A point on a polyline inherits its segment direction; a corner can retain both incident directions. A circular or elliptical boundary point inherits its analytic tangent, including profile rotation. A profile center keeps ordinary XY guides because no boundary tangent exists there. Dotted guides show the captured relationship, and a nearby intersection between a guide and another eligible finite fixture edge receives a distinct tracking-intersection marker. Source geometry is excluded from that intersection search, and modeled elevations must agree; the search does not accept a raised edge merely because it crosses in projection.

The Ortho study starts with 45° direction intervals. **Ortho angle increment** can be tuned from 1° to 90°, including 90° for the earlier horizontal/vertical behavior. Held Shift still inverts the enabled constraint. This starting angle is a requested laboratory preference, not a claim about Rhino's default.

The comparison with Atlas is valuable because familiar keys can encode different state machines. The research records differences in Tab behavior, Ortho angle, Alt snap inversion, and captured-reference lifetime. Those contracts should be chosen deliberately when this project adopts them. Combining similar-looking tools without choosing their modifier semantics would produce inconsistent feel.

The lab's extra Tab transition back to free movement is explicitly experimental. Its planar study is a 2D analogy. Full native SmartTrack inference, manual capture, guide-to-guide solving across references, circle-radius constraints in a full 3D point picker, and elevator mode remain richer native comparisons. See [tracking and constraint findings](../research/atlas-and-precision.md#direction-radius-coordinates-and-elevator-constraints).

## 6. Navigation: camera ownership

Pan, pointer-anchored wheel zoom, and a projected orbit cue are independent from authored object transforms. The lab preserves a draft during temporary camera movement and exposes zoom response for comparison.

Projection matters. Rhino perspective navigation and an infinite board need not share the same right-drag contract. The lab uses the project's board pan convention in its pan study and a separate orbit study. The orbit is an affine 2.5D analogy, with no depth solver or perspective camera. This distinction is visible in the case's fidelity description.

See [navigation and ownership findings](../research/atlas-and-precision.md#camera-navigation-by-projection).

## 7. Hover, cursor, and delayed feedback

The feedback collection compares body hover, selected grips, locked references, delayed tooltips, and passive highlighting. Cursor policy, explicit hover cursor, crosshair size, hover delay, tooltip delay, colors, labels, and outline weight can be tuned through the same hierarchy as other properties.

The research does not support presenting a universal hover tint as a Rhino default. Atlas documents passive outlines by eligible content kind; the inspected Rhino box had none. A cursor can advertise intent, but the native pass shows that handle highlighting and instruction text can carry that information while the pointer remains an arrow.

Native cursor glyphs, DPI hotspots, cursor tracking at multiple display scales, measured latency, and the complete matrix of tool/state combinations are open measurements. See [hover evidence boundaries](../research/rhino-selection-gumball.md#7-hover-and-cursor-presentation-evidence-boundaries) and [Cursor ToolTips](https://docs.mcneel.com/rhino/8/help/en-us/options/modeling_aids_cursor_tooltips.htm).

## 8. Command lifecycle: draft, commit, cancel, recover

Point-pick polyline creation and a cancellation/undo study make temporary state visible. Escape should restore a live transform or discard a draft; a committed gesture becomes a recoverable authored change. Text fields and menus own their input so ordinary typing does not become a scene shortcut.

The current geometry journal supports Undo/Redo. Tuning overrides are saved settings, with per-property and per-scope clearing; they are not part of that geometry journal. That distinction is visible in the inspector and is an extension opportunity if preset-edit history becomes important.

See [Atlas lifecycle and ownership research](../research/atlas-and-precision.md#tool-lifecycle-and-command-discovery).

## 9. Atlas crossover studies

Resize, corner-radius grips, inline renaming, and contextual menus test portable patterns found in the supplied report. They use synthetic geometry rather than private program data.

These are focused comparison studies. Free resize in the lab does not replace the Program board's constant-area rule. Neither do the experiments import Slate's entire command registry, content portals, media tools, wire graph, workbook editing, or specialized content focus. Those domains are retained in the research crosswalk and coverage backlog.

## Tuning and common-property filtering

Inheritance is **document → category → prototype → geometry group → individual object**. This is the lab's experimental schema. Rhino itself divides preferences between application options, document properties, viewport state, object state, and command-transient state.

The inspector shows only keys supported by every target. Document scope intersects all studies. Category scope intersects its children. Marking multiple prototypes edits their common controls together; marked studies are separate from selected scene geometry. Geometry-group scope expands to every member of the selected groups before calculating compatibility. An individual geometry selection can also be edited in bulk.

Mixed effective values are shown as mixed until changed. A patch changes only its named property. Clearing an override reveals its parent value. Geometry dimensions are authored scene edits and can be undone or reset with the scene; clearing a tuning override alone does not reverse an authored transform.

### Explicit preference commits and capsule states

Tweaks preview immediately and save locally as drafts. They do not replace accepted preferences until a capsule's **Commit / Update** button or the sidebar's batch commit is clicked. Neutral capsules are **Unaltered**. Amber distinguishes uncommitted **Altered** work from committed **Feedback pending**. Green indicates **Locked in** preferences or successfully verified **Settings applied**. Purple **Addressed** requires a matching implementation receipt for the written feedback. Successful preset validation alone cannot resolve a comment.

Changing a preference or written note after committing returns the capsule to **Altered**. Selection and camera movement do not change preference status. A pending written request remains amber even when its associated numeric/style settings have been applied.

Commit captures effective inherited settings, case-local group/object overrides, authored dummy geometry, saved observations, and the current written draft as an independent revision. Changes to a parent scope can make multiple capsules altered without overwriting their accepted revisions. **Revert to locked-in preferences** restores the accepted settings for the selected interfaces. Existing workspaces receive a persisted initial baseline before edits, so their current preferences remain unaltered until changed. Baselines, accepted revisions, and working drafts all survive reload and export/import.

Shift-click capsule bodies selects a visible range from the last selection anchor; Ctrl-click toggles individual studies. Checkboxes and Select all remain available. The sidebar commit applies to the marked batch; an individual capsule's button commits only that interface.

### Background application: laboratory prototypes only

The user selected the interaction-lab prototypes as the background target. The Program board, Pack, and Isometric implementations are outside this worker's scope.

With `node serve-interaction-lab.js` running, an explicit commit submits an immutable preference revision and its written feedback to a local durable queue. The settings worker validates parameter types and geometry, renders a scene fixture, and runs fresh processes for the model and stage regression suites. It publishes successful settings snapshots to `interaction-lab/accepted-preferences.js`, which supplies starting presets for new lab workspaces. Existing local working data is preserved. Successful validation reports **Settings applied**.

Written feedback has a separate completion requirement. The worker preserves it as **Feedback pending** for implementation; it does not interpret a comment and autonomously write code. A reviewed receipt in `interaction-lab/feedback-resolutions.json` must match the feedback's exact content and identify the implementation summary, changed files, validation checks, and date before **Addressed** is available. New or changed notes do not inherit an earlier receipt. This keeps a successful settings check from implying that a behavioral request was implemented.

The **Implement interaction lab feedback** scheduled follow-up in the originating Codex chat is **paused at the user’s request** (14 Oct 2026). When active, it checks this local queue every five minutes. It picks up existing and future committed comments, groups repeated batch requests, implements clear requests within the lab, and records verified implementation receipts. The local settings worker and this coding follow-up are separate. Keep the computer on and Codex running for local scheduled work. Uncommitted drafts are not picked up. The follow-up stays quiet when nothing changes and reports completed changes, failures, or a specific question that needs the user. Manage or pause it through Codex Scheduled. Run `node interaction-lab/feedback-inbox.js` to inspect exactly which committed requests are awaiting implementation without modifying the workspace.

The UI polls the local worker and matches workspace, interface, revision, commit timestamp, and SHA-256 snapshot fingerprint before recognizing completion, with no newer uncommitted tweaks. A previous completion cannot approve a changed snapshot. Newer revisions supersede stale queued work. Failed checks retain the prior accepted presets and display a failure; clicking Update creates a new attempt. Interrupted jobs resume after the local server restarts. Explicitly requested submissions remain marked in exported workspaces and retry when the worker becomes available; legacy commits are not silently submitted.

Queue state lives under ignored `.local/interaction-preferences/`. Accepted prototype presets and feedback implementation receipts are ordinary repository source and are included in the next packaged build. The worker runs alongside the local preview, requires no model credentials, and uses no external service. A directly opened file or static deployment can still save/commit/export preferences, but background settings application requires the local server. The sidebar reports availability instead of claiming offline completion.

Run `node test-preference-queue.js` for the queue and API checks. The automated suite uses isolated queue directories and accepted files. A settings publication check establishes that a supported preset was applied; it does not establish that written feedback was implemented. Component regression tests additionally inspect the painted paths, so a selected face or polyline segment cannot pass by merely retaining a component ID while painting its whole parent.

### Cursor and hover icon menus

The Cursor inspector includes searchable SVG icon menus for **Cursor presentation** and **Hover presentation**, covering all 36 standard CSS cursor values: automatic/default/hidden, contextual help and pointer, progress/wait, cell/crosshair, text/vertical text, alias/copy/move, unavailable/no-drop, grab/grabbing, scrolling, every directional resize form, row/column resize, and zoom in/out. Hovering an option updates a cursor preview area. Arrow keys navigate options and Escape closes the menu. Scaled cursor artwork remains a browser approximation; unsupported custom scaling falls back to the native cursor keyword.

**Geometry hover style** provides none, outline, fill, outline plus fill, bounding box, corner brackets, and halo. Choosing a visible style enables passive highlight for that editing scope; choosing none turns it off. Fill opacity is independently tunable. These controls participate in common-property filtering, mixed values, inheritance, and preference commits.

## Feedback and portability

Written observations save their study ID, timestamp, verdict, editing scope, marked prototypes, geometry selection, effective settings, overrides, and scene snapshot. Draft notes save while typing. Commit includes both saved observations and the current draft, so a written request does not have to be saved as a separate observation to enter the feedback queue. Scene geometry, camera state, settings, and observations persist in browser-local storage; exports bundle them into a versioned JSON workspace. Imports validate supported data before applying it. Storage failures are reported and exporting remains available.

The library lives in `interaction-lab/`: `catalog.js` owns case metadata and property capabilities, `model.js` owns inheritance and validation, `stage.js` owns interaction state and dummy geometry, and `app.js` owns the dashboard. Adding a case requires a stable ID, category, task, source, expected behavior, and an honest fidelity note. New behavior belongs in the stage engine or a future engine adapter, not just in a title.

This page is separate from the Program board and its private data. The existing build includes the dashboard and research documents. The preview server binds only to localhost. No publication or external data transmission is required to use the lab.

Run `node test-interaction-lab.js` for the catalog, inheritance, compatibility, and import checks; `node interaction-lab/test-lab-stage.js` for the main scene and gesture checks; `node interaction-lab/test-component-marquee.js` for multi-object component sweeps; `node test-tracking-guides.js` and `node interaction-lab/test-precision-stage.js` for inherited guides, depth-aware intersections, and boundary center acquisition; `node interaction-lab/test-direction-constraint.js` for configurable angle constraints; and `node build-netlify.js` to package the board and lab together. These checks supplement the browser exercises and do not establish native Rhino parity.

## Verification on 14 October 2026

- The catalog/model checks passed, including inheritance, common-property filtering, import validation, feedback metadata, and unsafe dictionary-key handling.
- The stage suite passed selection, marquee, filters, groups, subobjects, overlap, locked references, cursor overrides, numeric transforms, relocation, resize, cancellation, history, duplication, temporary pan, drafting, Ortho, Tab constraints, scene persistence, and snap/rendering checks. Component regressions verify one-face, one-edge, and one-vertex paint paths, polyline segment hover/picks in all four sub-selection studies, toggling, persistence, and preservation of whole-object Shift-add/Ctrl-remove behavior.
- The feedback implementation checks passed multi-object component window/crossing selection, additive deduplication, locks/filters and unchanged authored preferences; boundary center acquisition/release and scoped snap disable; modeled XYZ intersection rejection; inherited tangent dwell and guide intersections; and 45°/90° constraints with Shift inversion. Eleven pure tracking-geometry checks additionally passed rotated ellipse tangents, finite target capture, source exclusion, pointer-radius limits, and elevation mismatch rejection.
- The browser pass exercised axis drag and undo, multi-prototype tuning, mixed geometry dimensions and undo, mixed-kind group filtering, ambiguity selection, center snapping, category scope, saved observations, reload persistence, and a complete export/import round trip. No browser console errors were captured.
- The build produced the board/lab archive with 35 entries and no private-data scan hits. Existing mode-state and appearance checks passed.
- The existing `node test.js` board self-test failed only its 200-object crowd-drag timing check: the repeat run measured 33.7917 ms against a 16 ms limit. Its engine and test code were not changed for this work. This performance result is separate from the passing laboratory checks; no unrelated engine optimization was attempted.
