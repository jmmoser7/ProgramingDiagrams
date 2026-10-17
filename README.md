# Program board

Licensed under the [MIT License](LICENSE). Vendored Rhino assets retain their
[third-party license notices](vendor/rhino3dm-LICENSE.txt).

For another person or coding agent taking over a fork, start with
[AGENT_HANDOFF.md](AGENT_HANDOFF.md). The shared interaction contract and current
mode differences are documented in [KEY_MODIFIERS.md](KEY_MODIFIERS.md).

## True 3D modeling lab

Open [modeling-lab.html](modeling-lab.html) over HTTP for the isolated WebGL XYZ modeler: Box/Cube, Line/Polyline, Plane/SrfPt, CPlanes, snapping, component selection, Gumball transforms, blocks and JSON documents. See [launch instructions and limitations](modeling-lab/README.md) and [cloud verification](modeling-lab/VERIFICATION.md). Its mesh/bilinear geometry and state are separate from the existing interaction lab and Program Board. Build it separately with `npm --prefix modeling-lab run build`.

## Drag feel bench

Open [drag-feel.html](drag-feel.html) for a focused four-block bench using the board's solid collision engine. Tune the block buffer, smoothness, friction, inertia, magnetic grid and neighbor snapping, contact response, and the resistance and release of pressure climbing while dragging. Presets and an A/B comparison help find a firmer, tactile feel. Settings save independently on this device and can be imported or exported for comparison; the bench does not change the program board's settings or data.

Scroll over a block to zoom around the pointer, or use the **− / + / Fit** controls (50–600%). Middle-drag, right-drag, or Space-drag pans. With the canvas focused, `+` / `−` zoom and `0` fits the playground. Dragging off a support drops the held block to the next lower support or ground during the same drag; releasing is not required.

**Minimum climb pressure** gates climbing: staying below it cannot eventually trigger a jump. After **Pressure dead travel**, pulling farther into a neighboring block toward center alignment increases live push pressure and builds the give progress faster. The pressure meter marks the minimum and shows give progress separately; easing off drains that progress.

Hold **Ctrl** while dragging to keep neighboring blocks fixed, matching sticky-note isolation. Press or release Ctrl during a drag to switch immediately between isolated motion and pushing. Solid contact, buffer spacing, pressure climbing, and support carriage still apply.

Mouse grabs clamp firmly to the exact picked surface point, including side faces. The visible cursor stays on that point through snapping, zoom, climbing, and falling. Further physical mouse travel into a blocked surface becomes bounded pressure, so it cannot accumulate a large jump when the block gives way. Held mouse motion uses direct swept contact; response/damping tune the arrow-key spring experiment, while friction and inertia tune release. Contact feedback flashes without deforming the blocks.

Hover vertices and edge midpoints to preview a precise grip; square and triangle markers identify the accepted feature. **Grip capture radius** stays in screen pixels through zoom. Hold **Alt** when grabbing to choose any surface point, even near a feature, or turn off **Feature grips**. **Grab-side bias** favors snapping features near the held point over features across the block. Object features take priority over grid magnets, and blocks also align to corners and midpoints on the support beneath them. These cues follow the interaction study’s explicit feature/owner feedback contract.

## Interaction laboratory

Open [interaction-lab.html](interaction-lab.html) for **Feel**, a reusable Rhino / Atlas interaction workbench with 48 studies, synthetic geometry, cursor and timing controls, inherited document/category/prototype/group/object tuning, multiselect editing, written observations, and workspace import/export. It opens directly in Chrome or Edge without installation. For an optional localhost preview, run `node serve-interaction-lab.js` and open `http://127.0.0.1:8787/interaction-lab.html`.

Read the [categorized research report](docs/interaction-language/README.md) and [coverage matrix](docs/interaction-language/coverage.md). Research includes McNeel primary documentation, both supplied Atlas reports, and read-only observations of the running Rhino 8 SR30 instance. Browser studies and native behavior are explicitly distinguished. The lab has its own local workspace and does not use the board's program data.

Use capsule **Commit / Update** buttons or the sidebar batch commit to accept preferences and submit saved observations plus the current written draft. Neutral means **Unaltered**; amber means **Altered** or **Feedback pending**; green means **Locked in** or **Settings applied**. The local background worker validates and publishes numeric/style presets. Written feedback stays pending until an implementation receipt matching its exact content records the change, files, checks, and date; only then can the capsule show purple **Addressed**. Further tweaks or note changes return it to Altered. The worker applies supported settings; it does not author code from comments. Shift-click selects a range; Ctrl-click toggles studies. The Cursor section includes searchable icon menus for all 36 standard cursor presentations and seven geometry hover styles.

The originating Codex chat has a configured **Implement interaction lab feedback** follow-up, now **paused at the user’s request** (14 Oct 2026). When active, it checks every five minutes. It reads committed requests, implements clear changes within the lab, and records verified results. Keep Codex running and the computer on; manage the follow-up in Codex Scheduled. `node interaction-lab/feedback-inbox.js` prints the current pending requests without changing any data. See [the feedback workflow](docs/interaction-language/README.md#background-application-laboratory-prototypes-only).

In the sub-selection studies, Ctrl+Shift hover and selection highlight only the targeted face, edge, or vertex. Every sub-selection study also supports individual polyline segments, including the Sub-objects filter study.

A portable infinite-canvas diagram for building programs.

Open `index.html` in Chrome or Edge. No install and no server. Drop a CSV, Excel spreadsheet, or saved board onto the empty canvas to begin. The repository includes a synthetic example at `fixtures/program.csv` for trying the tools.

## Outside labels, gradients, and isometric cells

Board, Pack, and Isometric now edit one canonical program, with stable cell IDs, spreadsheet rows, metadata, areas, groups, and appearance. Pack keeps its packing placement and camera as view settings and never substitutes its tile coordinates for the authored Board/Isometric layout. Mode changes commit active editors first. Other open views reconcile saved edits by cell ID, retaining independent field changes. An empty or zero-area program stays current instead of reverting to a sample.

All three views use the same bottom capsule datum. Isometric uses Select/Face tools, a compact view-direction popover, and contextual capsule menus opened by right-click or Enter; there is no permanent inspector taking up the canvas.

In Isometric, cells collide as 3D volumes: they push movable neighbors, stop at locked cells, frame edges and drawn walls, and carry supported stacks and rigid groups. Sustained pressure against a blocked cell builds for about half a second, then animates a climb onto it. Releasing or withdrawing cancels pressure. Walls cannot become stairs. Gravity settles unsupported stacks without bouncing. Shift locks the drag axis, Ctrl isolates, Ctrl+Shift ghosts, Alt duplicates, and Shift-click adjusts selection. Right-drag, middle-drag and Space-drag pan; the wheel zooms at the pointer. Selected roof grips stretch the footprint at constant area. Face mode exposes the vertical extrusion control. Double-click edits the name; Shift-double-click edits area. These behaviors have deterministic collision and support regression tests.

Leader labels and their paths are hosted **inside each view's frame**, including Pack and PNG/SVG exports. Packed clusters use nearby vertical label columns, with constant45° elbows and horizontal landings. Labels without a feasible slot retain their in-cell text. The Leaders threshold is shared across modes. New 3D rendering uses studio reflections, white clay for unpainted matte cells, colored glass/jelly, soft contact shadows and stack shading. Explicit colors remain colored. Translucency uses layered rendering rather than physical refraction.

- **Outside labels:** right-click the board, expand **Text**, and adjust **Leaders**. The value is the cell's short side in screen pixels; 0 turns callouts off. Small cells receive a thin 45° segment and a horizontal segment into an in-frame side column. Each column follows its hosts' screen Y order and stacks labels without overlap. Labels recalculate inside the frame as you move or zoom; an overfull column leaves excess labels inside their cells. The same layout is included in PNG and SVG exports.
- **Area gradients:** select rectangles or a group, right-click a cell, and choose **Color mode → By size**. Choose the small/large endpoint colors or a preset palette. The smallest area gets the first color, the largest gets the second, and equal areas get the midpoint. Area edits and duplicates update the ramp automatically. Choose **Solid** or a solid swatch to clear the ramp. Gradients support undo and survive local storage, layouts, save ZIPs, and CAD colors.
- **Isometric:** choose **Display mode → Isometric**. Board and Isometric share the same spreadsheet and geometry. Choose NW, NE, SE, or SW for an animated quarter-turn with a locked isometric elevation. Drag a cell on the ground plane; push it against a blocked cell until it climbs, or use **Stack**. **Face** selects the upper face: drag the blue Z arrow to change height. In **Object** mode, the Z arrow changes the whole cell's elevation. Height and elevation also accept numeric values. Alt+click or the overlap list digs through stacked cells.
- **3D appearance:** **Round all edges** applies a uniform radius to all twelve edges and eight spherical corners, including the underside; its maximum is half the shortest box dimension. Choose **Matte**, **Glossy**, **Jelly**, or frosted translucent **Beach glass**. Material, height, elevation, radius, and gradient settings follow the cells through save/restore and duplication.

The isometric renderer uses local WebGL with a canvas fallback and has no external runtime dependencies. Its material shading is a lightweight studio rendering approximation. The selection interaction follows Rhino's [sub-object selection](https://docs.mcneel.com/rhino/8/help/en-us/popup_actions/select_objects.htm) and [Gumball](https://docs.mcneel.com/rhino/8/help/en-us/commands/gumball.htm) controls.

Each sticky is one spreadsheet row. Its width times its height is that row's area in square feet (`SubTotal`). Rows at 0 sf stay in the export and are not drawn.

Each sticky's name is fitted to that sticky, in feet: wrapped, centred, and sized from the sticky's width. The name is set at 13% of the width and wraps to fit inside the inset, so a wide room gets big type and a tall, narrow room keeps its width-based size and wraps into more lines. Height only limits the size on a short, wide sticky, where the name would not otherwise fit. The area line sits under the name when it fits without shrinking the name much; otherwise the area line goes first. The 3DM scene carries each sticky's fitted size and lines as `label`. With Leaders off, text stays inside its sticky, and it scales with the board exactly as the sticky does, so it keeps drawing at every zoom, however small. Zoom in to read the small ones. PNG and SVG exports use the same fitted text, or automatic callouts when Leaders is enabled. A sticky can carry its own text size, colour, and typeface (see *Text*), which override the board's for that sticky alone.

The spreadsheet you load is never modified. Export and Save make new files. Outside labels override the fitted in-cell name only when the Leaders threshold is enabled and a side-column slot is available.

## Data

In Board, Pack, and Isometric modes, **Edit data** in the CSV capsule opens **Program data**, a floating editable table. Search rows, edit cells, and use **+ Column** to add fields. Header pills show the detected **Area** and **Group** tags. Click a header's tag control to change these choices, tag several grouping columns, or choose **None** to clear that column's interpretation. Table edits update the program and participate in Undo; zero-area rows remain editable. **Commit** finishes the current edit, saves the program state on this device, and closes the editor. Invalid values stay highlighted for correction.

Tag a count column as **Submodules** to divide each sticky into that exact number of bounded cells. Tag two columns as **Module width** and **Module depth** (feet) for a base module. The lock toggle sits inside each module tag capsule; both dimensions share the same setting. **Hard** keeps every module dimension exact and lets the displayed footprint area adjust. **Loose** also uses exact modules with the global grid off; with it on, the full footprint scales to whole primary-grid increments. The source area remains recorded in the table and exports. Subdivisions follow resizing and are included in Board PNG/SVG exports.

The context menu's **Bundle** capsule offers **All** and **By group**. By group gives sibling sets separate, spaced centers using the tagged group columns and their footprints. Each cloud compacts toward its own center while temporarily ignoring other groups; only after compaction do the finished clouds move together with collisions restored. Authored rigid groups retain their offsets. Outside labels are controlled by **Leaders** in the board's Text menu.

**Bookmarks** opens a capsule stack of named complete Board snapshots, including data, column tags, layout, appearance, camera, grid, and selection. The circular **+** at its right saves an arrangement. Click anywhere on a named capsule to restore it with an eased transition; **Delete** remains a separate inset capsule. Use the pencil, double-click the name, or press F2 to rename. Reduced-motion preferences skip the animation. The current bookmark catalog survives a restore and travels with saved layouts/ZIPs. Creation is limited to 30 bookmarks; imported catalogs are retained in full.

The repository starts with empty seeds and contains no client spreadsheet. Private local data belongs in ignored `sample.csv` or `.local/`; do not embed it in tracked source. `fixtures/program.csv` contains synthetic data used by the regression tests. `node build-netlify.js` also empties both runtime seeds in `dist/` and checks the published files for client data.

## Mouse

- **Drag a sticky** to move it. The whole selection moves if the sticky is selected, and the whole group moves if it is grouped. Neighbours slide aside; what you placed stays where you dropped it. Contacts are frictionless and without momentum: a pushed sticky moves only along the push's normal and slides freely along whatever it rests on, and a push travels down a chain (the third, fourth, and fifth sticky move as one at the buffer) until it reaches something that cannot move, a line or the frame, where the chain packs and the drag stops. A long move is pushed in slices, so nothing hops a neighbour, and a pointer that ran ahead while blocked is caught up gradually rather than all at once. Pressing into a crowd that resists for a moment liquefies it over about 180 ms: neighbours may close to touching (never overlapping) and flow around the dragged sticky; easing off firms it back up, and the drop settles everything back to the full buffer. When a line blocks the way, a multi-selection crowds up against it: the leaders stop one buffer short and the rest pile in behind them, and nothing crosses.
- **Drag modifiers** work in any order: hold them before you press, or press and release them during the drag, and the mode switches at once. The cursor changes as soon as a modifier goes down, whether you are dragging or just hovering a sticky, and the status pill names the mode.
  - **Shift** locks to one axis, chosen from the first 4 px of movement (the cursor becomes a horizontal or vertical arrow).
  - **Ctrl** isolates: only the dragged stickies move, and they stop at their neighbours instead of pushing them.
  - **Ctrl + Shift** ghosts: the dragged stickies pass straight through everything, drawn at half strength. On release the others ease out of the way.
  - **Alt** duplicates: the original stays put and you drag a copy (the cursor shows a plus). Each copy is a new spreadsheet row with every column of its original, inserted right after its original's row, so the CSV export lists it there. Copies of a group form a new group. Alt counts only if it is down before the drag passes 4 px; pressing it later does not spawn copies mid-flight.
  - **Shift-click** without moving adds a sticky to the selection or removes it. The toggle happens on release, so holding Shift (or Ctrl + Shift) and dragging a selected sticky moves it instead of deselecting it.
- **Drag empty board** to select with a marquee. It picks up stickies, lines, and text. Shift-click adds or removes.
- **Grab a blob** by its fill or outline, wherever no sticky is on top: the cursor turns into a hand (the blob itself does not highlight). A press selects every sticky in the blob (with their groups), and a drag moves them together through the normal drag, with every modifier above (Alt drags copies, Ctrl isolates, and so on). A click on a blob inside a larger selection narrows the selection to that blob's stickies. A press on a sticky inside a blob still takes just that sticky. Where blobs overlap or nest, the smallest one under the pointer wins, so an inner Group blob stays grabbable inside its Department blob.
- **Right-drag**, middle-drag, or Space + drag pans. The wheel zooms at the cursor, out until the frame is a speck (2% of the window) and in to 60 pixels per foot.
- **Right-click** without moving opens the menu, a stack of slim capsules. The capsules that open a dropdown always come first, in the same order (Metadata, Blobs, Text), and the rest follow. On a sticky: Metadata, Text, Duplicate, Bundle, Group or Ungroup, Color, Stroke, Shadow, Corner, and Delete. On a line: Width, Color, and Ends (see *Draw*); there is no Delete capsule, since Delete or Backspace removes a selected line. On text: Text (open), Edit text, and Delete. On the frame's title: Rename, Frame color, Buffer, and Fit viewport. On the frame's empty plate: Blobs, Text (the board's type), Bundle all, Rename frame, Frame and Background colours (next to each other), Grid, Fudge to grid, Buffer, and Fit viewport. Outside the frame: the same without Rename frame and Frame. A blob's menu has no dropdowns and is unchanged. Right-clicking the name of a sticky that is already selected opens its Text section at once.
- **Dropdowns.** Metadata, Blobs, and Text are dropdowns: a darker capsule with a small chevron. Click it and its own capsules open right beneath it, slightly indented, and the chevron turns; click again to fold them away. The menu grows downward and rises only as far as it must to stay on screen. Metadata opens the same fields as the floating column (Enter still opens that), docked in the menu.
- **Edges and corners** of a single selected sticky stretch it at constant area. Point at an edge (a 6 px band along its whole length) or a corner (9 px) and the cursor turns into a resize arrow. An edge drag changes that side, and the other side follows so width × height stays the same, centred on the untouched axis. A corner drag keeps the opposite corner fixed. Sides stop at 4 ft. With the grid on, the dragged edge snaps; with Fudge to grid on, it snaps to whole cells. The only way to change a sticky's area is its Area field in the metadata.
- **The fillet grip** is a 7 px square on the sticky's top edge, the same size as the resize handles, shown on hover and on selection. It sits where the rounded corner meets the straight edge, so its distance from the corner is the radius, and never closer than 10 px so it stays clear of the corner handle. Drag it along the edge to set the radius; it stops at half the shorter side. It hides on stickies under 40 px on screen, where it would collide with the resize handles. It applies to the whole selection. Rounded corners are part of the sticky everywhere: painting, clicking (a click in the cut-away corner misses), PNG, SVG, and 3DM.
- **Double-click a sticky** to rename it in place (see *Renaming a sticky*), or double-click its area readout (the *2,500 sf* line) to type a new area (see *Editing the area*). Double-click a text to edit it, or the frame's title to rename the frame. A double-click on a sticky's resize handle or fillet grip still opens its metadata.

### Renaming a sticky

Double-click a sticky, or edit the **Name** field in its metadata (Enter, or **Metadata** in its menu). On a double-click the name turns into a text box right on the label, in the label's own typeface, size, wrapping, and centring, with all of it selected. There's no box behind it, just a hairline accent ring. The painted name is hidden while you type, and the area readout stays. The label refits on every keystroke, exactly as it will look when you finish.

- **Enter** or a click anywhere else keeps the name, as one undo step. **Esc** puts the old name back and records nothing. **Shift+Enter** does nothing, because labels have no line breaks; pasted line breaks become spaces.
- A blank name is allowed, as it is in the metadata. The sticky then shows no label, and the box shows a grey *Name* until you type.
- The name is the row's cell in the name column (on the sample, **Space**), so the CSV export and the save zip carry it. A rename never moves the row. A sheet with no name-like column gains a **Name** column the first time you rename a sticky.
- Board keys (B, G, Delete, `[` `]`, Ctrl D, and the rest) type into the box instead of acting on the board. Ctrl S still saves.
- The box stays on its sticky while you pan (middle or right drag), zoom (the wheel works over the box too), or while neighbours settle. It keeps the label's size at every zoom, with no minimum, so zoom in to read a small name. A left click on the board commits, like any click away.
- In a group, the sticky you double-clicked is the one renamed. The first click of a double-click selects that sticky. To rename without changing the selection, type in the metadata's **Name** field; with several stickies selected, that name goes to all of them.
- If the metadata is open, its Name field follows as you type. With several stickies selected it switches to *Mixed* as soon as the names differ. Both editors share one setter, so a rename typed in the metadata relabels the sticky live too.
- **Tab** keeps the name and moves to the area editor on the same sticky; **Shift+Tab** there comes back to the name.

### Editing the area

Double-click the area readout under the name (a double-click anywhere else on the sticky still renames it). The readout becomes a box exactly over it, in the same typeface and size, holding the bare number without the comma (*2400*), all selected. The *sf* unit stays beside the box, not in it. The painted readout is hidden while you type.

- Type **2500**, **2,500**, or **2500 sf**; the value is rounded to whole square feet.
- **Enter** or a click anywhere else sets the area, as one undo step. **Esc** puts it back and records nothing. An unchanged value records nothing either.
- Zero, a negative number, or something that isn't a number turns the ring red as you type. Enter then shakes the box, puts the old number back selected, and keeps you in it; a click away with a bad value just reverts. There is no alert.
- The sticky changes exactly as it does from the metadata's Area field, because both use the same setter: it keeps its proportions and centre (and the fudge grid, when one is set), the row's area cell gets the new whole number, and neighbours then settle out of the way. The row does not move.
- If the metadata is open, its Area row (or Total and Each, with several stickies selected) updates at once.
- **Tab** keeps the area; **Shift+Tab** keeps it and moves to the name editor. Board keys type into the box, as in the name editor, and the box stays on its sticky through pan and zoom.

## Tools

The toolbar starts with **Select**, **Draw**, and **Type** (keys V, D or L, Y or T). Draw and Type work like the Line and Text tools on a Slate board.

**Draw** (D or L) draws a straight stroke, 2 ft wide by default, with square caps.

- **Colour and ends.** A line's right-click menu has Width, then a **Color** swatch row (the shared one: *Auto* follows the board's ink, custom colours are added with +, and right-clicking a custom swatch offers Delete), then **Ends**. Ends is a Start / End / Both switch and a row of seven icons: none, arrow, open arrow, square, dot, tick, and bar. Pick the target, then an icon; the current choice is highlighted, and a selection whose ends differ reads *Mixed*. An end is sized from the line's width (3 × width, never under 2 ft) and scales with zoom like the line. Caps are drawing only: collision still uses the centreline or stroke rule below, so a cap never pushes a sticky. Each change is one undo step and is kept in local storage, the save zip, and a `.layout.json`; older layouts open with no colour of their own and no ends. PNG, SVG (explicit `line-end` circles, polygons, and polylines), and 3DM all draw the same caps in the line's colour.

- Press and drag, then release; or click, move, and click again. A press that moves less than 4 px counts as a click.
- Shift snaps to the nearest 45°. With the grid on, both ends snap to it.
- While drawing, Tab locks the current direction, and typing digits sets the length in feet. Enter commits. The status pill shows the length and angle.
- Esc backs out one layer at a time: first the typed length, then the first point, then the tool.
- The tool is one-shot: after a line is committed you are back in Select, with the new line selected.
- Lines are walls, and they win over everything else. Stickies never cross one and keep one buffer away from it, whether they are dragged, nudged, thrown in one frame, shoved through a chain of neighbours, bundled, aligned, or contained by a shrinking frame. Every sticky's movement is swept against the lines, so no push, however fast, can hop one. When a drag would squeeze a sticky against a line, the drag stops there instead: nothing gets pressed through. Only a ghost drag (Ctrl + Shift) may carry a sticky to the other side. A line is picked within 4 px of its stroke. Selected lines show grips at their ends only; drag a grip to swing that end (Shift snaps to 45°). The swinging end herds what it meets, and a sticky pinned against a wall stops it one buffer short.
- **How thick a line collides** depends on its width against the grid step (whether the grid is shown or not). A stroke narrower than half a grid step collides at its centreline, so stickies rest one buffer from the centre. A stroke half a grid step or wider collides at its edges, so stickies rest one buffer from the edge. Changing the grid step or a line's width (`[` / `]`, or the Width slider) re-reads the rule at once: stickies inside the new envelope step out, and the line stays where it is.
- **Drag a line's body to herd stickies.** The line moves as an immovable pusher: every sticky in its path is pushed ahead of it, those push their neighbours, groups move as one, and the frame walls still hold everything. A sticky pinned against a wall, or a row pinned there, stops the line one buffer short; the line never passes over it. The drag modifiers work as they do for stickies: Ctrl stops the line against the first sticky it meets instead of pushing, Ctrl + Shift ghosts it through everything, Shift locks the axis, and Alt drags a copy of the line. This also works when lines and stickies are dragged together. On release the line stays exactly where you dropped it and only the stickies settle. The whole drag is one undo step. Nothing else ever moves a line.
- `[` and `]` step the width of the selected lines (or, with none selected, the width of the next line) in Slate's screen-pixel tiers: 1 px steps below 10 px on screen, 5 px below 50, 10 px below 100, then 25 px. Widths stay between 0.5 and 400 ft.

**Type** (Y or T) places a free label.

- Click to place a single line, or drag to set a wrapping width. Type, then click away or press Esc to commit. Enter makes a new line.
- An empty text is discarded without an undo step, and Type stays armed. After a commit you are back in Select.
- Double-click a text to edit it in place. Text is 12 ft tall by default; its menu's Text section has Size (in feet), Color, and Typeface. Text is not an obstacle.

## Style

Every slider is the same part, in the menus and the Grid strip alike, and it works the way Slate's rails do. At rest it is only the row's name and a white pill nested in the capsule, with a soft grey rail and a pill-shaped teal thumb. No number shows.

- **Drag to set.** Press anywhere on the pill and move more than 3 px to scrub. While the slider is held, its value rides above the thumb in a small capsule (*3.25 ft*, *40%*, *None*). It stays for about half a second after release, then fades.
- **Click to type.** A press that moves 3 px or less is a click. The pill becomes a field in its place, holding the current number with every digit selected and the unit beside it.
  - Type a number (*1.75*, *1.75 ft*, *40%*). Enter or a click anywhere else commits it, clamped to the slider's range, as one undo step. **Esc** cancels.
  - Percent sliders take percents.
  - The blob offset and the grid step keep any decimal you type. Sliders that move in whole steps round to them.
  - A bad number shakes the ring red, puts the old number back selected, and keeps you in the field. A click away with a bad number just reverts.
  - With a mixed selection the field starts empty with a *Mixed* placeholder.
  - Board keys type into the field instead of acting.
- **Keyboard.** Tab onto a slider, then use the arrows to step it (Shift for ten steps), Home and End for its ends, and Enter to type. A burst of keys is one undo step.

The sticky menu has three slider rows, each reading *None* at zero:

- **Stroke** draws a darker edge, in a shade of the sticky's own colour, inside the sticky. It goes up to 8 ft.
- **Shadow** is a soft drop shadow (blur up to 30 ft). Shadows are drawn from cached sprites, so 200 shadowed stickies still paint in about 2 ms.
- **Corner** is the fillet radius, the same value the grip sets.

Each slider drag or typed value is one undo step. They apply to the whole selection. When the selected stickies differ, the thumb is hollow and the readout says *Mixed* until you touch it. All three reach PNG and SVG exports (SVG uses `rx`, an inset stroke, and `feDropShadow`).

### Text

The **Text** dropdown in a sticky's menu sets that sticky's own type. Anything set here overrides the board's type for the selected stickies only; everything else keeps following the board.

- **Size** scales the fitted label from 50% to 200%. The label still fits width-first inside the sticky's inset, so a larger size may wrap into more lines. Where nothing is set it reads the board's size; any value you set, 100% included, is this sticky's own.
- **Color** sets the name's ink (the area line takes a lighter tint of it). The first dot, split light and dark, is *Auto*: the ink follows the sticky's fill, as it does by default. Custom colours work as in every swatch row.
- **Typeface** picks Std, Mono, or Sans for this sticky. Where nothing is set, the board's typeface shows as a ring; a set one is filled teal.
- A small ↺ mark beside a row's name appears only while that row is overridden on some selected sticky; click it to return them to the board's setting. With several stickies selected, rows that differ read *Mixed* (a hollow thumb, no swatch or face marked).

Every change is one undo step and is kept in local storage, the save zip, and a `.layout.json`; older layouts load with no overrides. The spreadsheet is never touched. The rename and area boxes, PNG, SVG (a per-label `font-family` and `fill`), and 3DM (text height and object colour) all follow the override. A free text block has the same section, with Size in feet.

The **Text** dropdown in the board's own menu (right-click the frame's plate or the canvas) is the same component, but it sets the board's type: **Size** (the multiplier on every sticky's width-first fit, 100% by default), **Color** (*Auto*, ink that follows each fill, by default), and **Typeface** (Std, Mono, or Sans; this is the one typeface control, which used to be its own row). Every sticky without its own setting follows at once; a sticky with an override keeps it. While any sticky has its own type, a **Clear overrides** capsule at the bottom (*3 stickies*) returns them all to the board's. Each change is one undo step, and the board's type is kept in local storage, the save zip, and a `.layout.json`; an older layout opens at Std, 100%, and Auto. The rename box, PNG, SVG, and 3DM (label text heights and colours) all follow it. Free text blocks follow the board's typeface only.

**Custom colours.** The colour dot at the end of each swatch row opens the system picker. The colour you pick joins that row (stickies, text, frame, background, or blob), newest last. The same colour is never added twice, and the row keeps the last six. The custom colours persist, and a loaded layout keeps your own.

**Deleting custom colours.** Right-click a custom colour and a small capsule opens under it with its hex and a quiet red **Delete**. Click **Delete** and the swatch shrinks away. A click anywhere else, a right-click elsewhere, or **Esc** dismisses the capsule and keeps the colour. Esc closes only the capsule, and the colour menu stays open. Right-clicking a built-in colour does nothing, so a row is never empty. Hovering a custom colour shows *right-click to delete*. Removing a swatch only takes it off the row: stickies, frames, and blobs already wearing that colour keep it. The removal is saved, every open row of that kind updates, and **Ctrl+Z** brings the swatch back (undo covers the custom swatch lists along with the board and grid).

## Buffer

The buffer is the clear space kept between stickies, between a sticky and a line, and between a sticky and the frame walls. It holds between groups too.

**At rest means clear.** After every edit the board settles gently, with no bounce, and it only counts as at rest once every pair of stickies keeps the buffer (to within 0.05 ft) and everything is inside the frame. Low motion alone is not rest. What you just placed is held while its neighbours make room; if they cannot, it yields too. A sticky wedged between neighbours that push it equally from both sides is eased out by a local bundle around it, and after a frame shrink everything bundles inside the new walls. If there really is not enough room (a frame shrunk narrower than the program, or a pocket between lines smaller than a sticky), the board says so in a toast, for example *Not enough room: 3 spaces outside the frame*, instead of resting inside the buffer. With Fudge on, stickies then land on whole cells, but a snap never puts a sticky inside the buffer or across a line. It is also the spacing when an align fans stickies out. Set it with the **Buffer** stepper on the board or frame menu. It is a whole multiple of the grid step (0 to 10 ×) and shows the distance in feet, for example `2× · 20 ft`. The default is 1 × the 10 ft grid step. Change the grid step and the buffer keeps its multiple. A larger buffer relaxes everything apart right away. The buffer change is one undo step, and undo restores the grid step and buffer together.

## Align

Select two or more stickies and a thin glyph strip appears under the selection: align left, centres, right, top, middles, bottom, distribute horizontally and vertically, then **Sort by area, small to large** and **Sort by area, large to small**. Alignment uses the bounding box of the whole selection. Distribute keeps the first and last in place and spaces the rest evenly; it needs three or more, so its glyphs are dimmed with two. A group aligns as one rigid block. Each press is one undo step.

Area sorting arranges a buffered row or column along the selection's longer direction. It ranks source areas, including the summed area of each rigid group, and preserves the order of ties. Grid/module changes to displayed footprints do not change the ranking. It moves the layout without reordering spreadsheet rows. A row/column that cannot fit inside the frame is refused; walls still constrain movement.

Stickies never overlap, so when an align would stack them (align left, then align top), they fan out along the free axis in their existing order, one buffer apart. The aligned edge stays exact.

## Frame

Every board has one frame, sized around the program when it loads and titled from the file name. A sticky belongs to the frame when its centre is inside.

- **Drag the title** to move the frame with everything in it. Click the title to select the frame; Esc clears it.
- **Double-click the title** to rename it (Enter keeps, Esc cancels, an empty title keeps the old one).
- **The edges are walls.** Drags, nudges, resizes, bundles, and aligns all stay one buffer inside.
- **The stringers** below and to the right give the frame's width and height. Click a number to type a new size: Enter or a click elsewhere applies it, Esc cancels, and anything that is not a positive number turns red. The frame resizes about its centre. It will not shrink below what the program needs (every sticky fits across, and the program fills at most a third of the frame); asking for less stops at that size and says so. Stickies left outside glide back in, and if they still overlap they bundle inside the new walls, all in the same undo step.
- **Title and stringers are part of the drawing.** Like the stickies, they scale with zoom and have no minimum size: title and stringer numbers are 12 ft tall, the stringers sit 24 ft out, and their lines are 0.7 ft thick. Zoomed far out they get small, but they stay clickable, because their click targets never shrink below 16 px. The rename and resize boxes open at a readable size.
- **Frame color** is on the frame's menu. The plate gets a hairline edge only when it is the same shade as the background.

## Keys

| Key | Action |
| --- | --- |
| V / D or L / Y or T | Select / Draw / Type tool |
| `[` / `]` | Thinner / thicker line (the selected lines, or the next one) |
| Tab, digits, Enter | While drawing a line: lock the direction, type a length in feet, commit |
| Enter | Metadata for the selection |
| Double-click a sticky | Rename it in place: Enter or a click away keeps the name, Esc cancels |
| Double-click a sticky's area | Type a new area in place; Tab / Shift+Tab move between name and area |
| B | Bundle the selection, or everything when nothing is selected |
| Ctrl D | Duplicate the selection (see *Duplicates and row order*) |
| Ctrl G | Group the selection; if it is exactly one group, ungroup it |
| Ctrl Shift G | Ungroup |
| G | Grid on or off |
| F | Fit viewport |
| Arrows | Nudge the selection (stickies, lines, text) by one grid step (8 ft without the grid); Shift for 5 |
| Delete | Delete the selection |
| Ctrl Z / Ctrl Shift Z / Ctrl Y | Undo / redo |
| Ctrl A | Select all (stickies, lines, text) |
| Ctrl S | Save the board (`.zip`) |
| Esc | Back out of the line being drawn, then disarm Draw or Type; otherwise close the menu, then the metadata, then clear the selection, then the frame selection |

The menu labels its Group item **Ungroup** with the Ctrl G hint when the selection is one group.

## Toolbar

The capsule at the bottom centre holds the **Select / Draw / Type** tools, then **Grid**, **Fit viewport**, **Save**, and **Export**. There is no Undo button: **Ctrl+Z** undoes, and **Ctrl+Y** or **Ctrl+Shift+Z** redoes. The chevron tucks it into a small pill; click the pill to bring it back.

- **Grid** opens a strip with on/off and a step slider: dragging it runs through 1–100 ft stops, and a click types any step from 0.1 to 1,000 ft. With the grid on, a moved sticky's nearest left-or-right and top-or-bottom edges land on grid lines, and resized edges snap. Snapping never changes area. Dragging the frame snaps its nearest edges to the grid. Line ends snap to the grid too. The board's right-click menu carries the same controls in compact form: a **Grid** capsule with the step slider and an on/off toggle, then **Fudge to grid**. It is the same slider and the same settings as the strip, so a change in either shows in the other; the strip has no separate snap switch (snapping follows the grid), and Buffer is its own row just below.
- **Fudge to grid**, in the same strip, draws every sticky in whole grid cells: its width and height are rounded to the cell counts whose product comes closest to its true area, and at rest its corners sit on grid lines. The true area is kept: labels, the Area field, the status pill, and the CSV all still read the spreadsheet's number, and turning Fudge off restores every sticky's exact size. Turning Fudge on turns the grid on.
- **Save** writes one `.zip` holding the spreadsheet and the layout together (see *Save file* below). The first save asks where; later saves, and Ctrl S, overwrite that file without asking. A small grey dot beside Save means the board has changed since the last save; the button reads **Saved** for a moment after each save. Browsers without the file picker (Firefox, Safari, some `file://` pages) download `<name>.zip` instead.
- **Export** downloads a `.clone.csv` with your edits, a PNG, an SVG, or a **3DM** (Rhino). Images are cropped to the frame and include its plate and title, lines, text, strokes, shadows, and rounded corners, but not the stringers or the canvas background. The PNG is 12,288 px on its long side (every line and letter drawn at that size, not enlarged), rendered in tiles so no browser canvas limit applies; a browser without `CompressionStream` gets the largest size one canvas can hold, and the toast names the scale.

The pill at the bottom left names the loaded spreadsheet. Click it (you can pick several files at once), or drop files anywhere on the board:

- a saved **`.zip`** brings the board back exactly;
- a **`.csv` and a `.layout.json` together**, in one drop or one pick, do the same;
- a `.csv` or `.xlsx` alone starts a fresh, packed board;
- a `.layout.json` alone still loads as before.

**Ctrl+Z** brings back the board you had open. **Sample** is available only in local copies configured with an embedded starter; it is hidden in this repository and the published build.

## Save file

`<name>.zip` is a standard zip (Explorer, 7-Zip, `Expand-Archive`) with three entries:

| Entry | Contents |
|---|---|
| `<name>.csv` | The spreadsheet, byte for byte what **Export → CSV** writes (UTF-8 BOM, CRLF). No extra columns. |
| `<name>.layout.json` | The whole board: frame, stickies, groups, lines, text, styles, view settings, and the camera. |
| `manifest.json` | `kind`, `version`, `app`, `savedAt`, the two entry names, and `csvSha256`, the SHA-256 of the CSV bytes. |

Entries are DEFLATE-compressed with the browser's `CompressionStream` when that is smaller, and stored otherwise (or when the browser has no `CompressionStream`). The writer, CRC-32, and SHA-256 are plain JavaScript in `engine.js`.

**The CSV is the data; the layout is geometry and style.** On restore:

1. If the manifest's hash matches the CSV, or the CSV's rows are identical to the layout's, the layout is restored exactly.
2. Otherwise each CSV row is matched to a sticky: first by the exact row (every cell), then by name + department + group (trimmed, case-insensitive), then by position among the layout's rows. Ties go in order.
3. A matched sticky keeps its id, position, and style, and takes the CSV's values. If its area changed, it resizes about its centre at the same aspect.
4. Rows with no sticky become new stickies, placed in free space inside the frame near their department (the frame grows if there is no room). Stickies whose row is gone are dropped.
5. A toast reports it, for example *Restored 68 · 1 new · 1 removed · 1 area updated*.

Because the third pass matches by position, a row whose name was edited keeps its sticky. An added row sitting exactly where a removed row was is treated the same way, as a rename.

## Publishing

The page is a static site: no server code, no CDN. Everything loads by relative path, so it runs from `file://` or any static host (https included). On https the file picker is available, so Save overwrites in place in Chromium browsers.

The published copy carries **no program data**. To build it:

```
node build-netlify.js
```

This writes `dist/` and `program-board-netlify.zip`, then drag the zip onto [app.netlify.com/drop](https://app.netlify.com/drop), or onto the site's **Deploys** tab. `index.html` sits at the zip root, so the site serves it at `/`.

- **Copied:** the Board, Pack, and Isometric runtime files listed in `build-netlify.js`, shared chrome, appearance and data helpers, vendored Rhino assets and license notices, the standalone interaction and drag-feel labs, and selected research docs. Tests, synthetic fixtures, private local data, vendor build tools, this README, and the handoff/modifier guides remain outside the deploy bundle.
- **Emptied:** the embedded seed (`<script id="seed">`) and `program-seed.js`, including starter file names. The page opens on an empty board with a centred drop box and **Browse**. It accepts CSV, XLSX, saved ZIPs, and CSV/layout pairs. The repository also ships empty seeds; previously saved browser data still restores normally.
- **Modes:** Board, Pack, and Isometric share the loaded program. Visitors start empty until they open their own spreadsheet or saved board. Pack uses the same shared seed module and never fetches a private local spreadsheet.
- **Headers:** a `_headers` file tells Netlify to revalidate the page, `app.js`, `engine.js`, and `cad.js` on every load, because their names never change between deploys. The vendored rhino3dm files are cached for a week. Netlify already serves `.js` with the right content type.
- **Leak check:** the build fails if any file in `dist/` contains a client string, either one of `Guggenheim`, `Grad Assistants`, `NARA`, `AE_Program`, `AE Program`, `_tidy`, or any phrase of eight or more characters from `sample.csv`. It also reads the zip back and checks every entry byte for byte.

Local storage is per origin, so the published site never sees a board kept by the local copy. A visitor's own last board comes back on their next visit.

## Metadata

A column of fields beside the selection (Enter), or the same fields docked inside the sticky menu's **Metadata** dropdown: name, area, every spreadsheet column, then the dashed **+**, which adds a column. The Name field and the rename box on the sticky write through the same setter and follow each other live (see *Renaming a sticky*). The Area field and the area box on the sticky (see *Editing the area*) are the two places a sticky's area changes, and they share one setter; the sticky keeps its proportions and its centre. Both accept *2500*, *2,500*, or *2500 sf*. With several stickies selected, fields that differ read *Mixed*, and typing writes the value to all of them. Area becomes two rows:

- **Total** is the read-only sum, and it updates live.
- **Each** shows the area they share (when every one is within 0.5 sf of the others), or is empty with *Mixed*. Type a size and press Enter, or click away, and every selected sticky becomes exactly that many square feet (whole sf). Each keeps its proportions and centre, each spreadsheet row gets the value, and the whole change is one undo step. Neighbours then settle out of the way. Select three rooms that should match, type the size once, and they unify.

A value that is not a positive number turns the field red and is refused; Enter keeps you in the field, and clicking away puts the area back. In a group, every member gets the area. A group is rigid, so members that grow into each other step apart, half each, until each pair has its clearance back (what it was, up to one buffer), and then the group settles as one block. The same goes for every menu control: colour, stroke, shadow, corner, line width, and text size all apply to the whole selection and read *Mixed* when it differs.

A field with no value is drawn grey (label, box, and text) but stays editable; typing a value turns it back to normal at once. With several stickies selected it is grey only when the value is empty on every one of them; *Mixed* is never grey.

## Duplicates and row order

The spreadsheet's row order is the board's too: the CSV export, the save zip, and the restore all use it, and no column is added to hold it.

- **Every duplicate is a new row.** Alt+drag, **Ctrl D**, and **Duplicate** in the sticky menu all copy every column of each selected sticky (a group duplicates as a new group) and insert each copy's row directly after its source row. Each duplicate is one undo step.
- **Ctrl D and the menu place the copies for you.** The copies move as one block to the nearest free spot: first one buffer beside the selection (right, below, left, above, nearest first), then outward on a grid of one buffer step, until every copy is a buffer clear of every sticky and line and inside the frame. A spread-out selection that fits nowhere as one block is placed body by body (a group stays whole); anything still without room shifts one width right and the board settles around it. The copies are selected, and the view pans to them if they landed off screen.
- **Editing a grouping value moves the row.** The hierarchy is the category columns (see *Blobs*) other than the name column, in column order, that actually cluster the sheet: a column counts as a level only if its values, read together with the levels before it, sit in nearly contiguous runs (at most 10% more runs than distinct values) and average at least two rows per cluster. On the sample that is Department, then Group. When an edit changes a level's value, the row moves to the end of the deepest cluster whose leading values it matches:
  - a Department change lands it at the end of that department's block;
  - a Group change lands it at the end of that group inside its department;
  - a value new at some level starts a new cluster at the end of its parent's block (a new group goes after the department's last row); a new top-level value goes after the last row of the sheet;
  - a bulk edit moves every changed row, and they land together in their previous order.

  Every other row keeps its order. Name, area, and plain column edits never move a row, and neither does typing the value a row already has.

## Blobs

A blob is a soft shape drawn around every sticky that shares one value of a category column, like a Grasshopper group. Turn one on with the small circle check at the right end of a category row in the metadata column (hover it for *Blob by Department · 7 groups*), or from the **Blobs** dropdown at the top of the board's right-click menu, which opens one capsule per key with the same check and the number of groups (clicking the key's name toggles it too). Several keys can be on at once; they draw in column order, the later key on top, and each later key's default offset is a quarter buffer smaller, so its blobs nest inside the earlier ones instead of tracing the same line. Blobs are decoration only: they never push, stop, or move anything.

- **Which columns count as categories:** text-like values (fewer than 60% look like numbers), filled on at least half the stickies, at least one value shared by two or more stickies, and no more than max(12, 40% of the stickies) distinct values. The area column never counts. On the sample, Department (7 groups) and Group (14) qualify; Space, Qty, SF, SubTotal and the other numeric columns do not.
- **Shape:** each member's box grown by the offset (half the buffer by default), then closed with a smoothing radius of 0.6 buffers (at least 2 ft). Members closer than about 2 × (offset + smoothing) merge into one outline with soft fillets in the notches; members further apart form separate islands with no bridge. The outline is traced on a grid of at most 220 cells across the blob: the exact distance to the nearest member gives the offset, a Euclidean distance transform gives the closing, marching squares traces the edge, and one Douglas–Peucker pass plus one Chaikin pass softens it. An outline is rebuilt only when a member moves or resizes, the membership changes, or the offset or buffer changes. Colour, opacity, and the label never rebuild it. While something moves, outlines rebuild on every other frame, at most three per frame, longest-waiting first.
- **Drawing:** beneath lines and stickies, above the frame plate: a translucent fill (18% by default), an outline in the same hue (0.8 ft by default, see Stroke), and the value as a title just above the outline's top-left, 7 ft tall and at world size like every canvas object. A title that would overprint another steps right past it. Default colours come from a muted, cool palette of twelve, stable per key and value.
- **Right-click a blob** (its fill or outline, where no sticky is on top; the smallest blob under the pointer) for its menu. **Apply to** switches between *This group* and *All <key>*. In *All <key>*, the capsules that switch reaches (Offset, Color, Opacity, Stroke, and Label) take a light cast of the blob's colour, fading in over a moment, so you can see which edits will land on every group before you make them; *Single stickies* is always key-wide and stays white. **Offset** drags in 0.05 ft steps, never snapped to the grid; click it to type any decimal (*1.75*, *1.75 ft*) up to 100 ft. **Color** has swatches plus a custom picker whose picks join the row. Then **Opacity**; **Stroke**, the outline width in feet, on its own and independent of opacity and colour (0.8 ft by default, dragged 0 to 4 ft in 0.05 ft steps, typed up to 8 ft; 0 reads *None* and draws no outline, though the hover outline still shows where a blob can be grabbed); **Label**; and **Single stickies** (show or hide one-sticky blobs for the key; they show by default). To select a blob's stickies, grab the blob (see *Mouse*); to turn a key off, use its circle check. There is no per-group hide; a key's blobs go on and off with its circle check in the Metadata capsule or the board menu's Blobs list. Boards saved by builds that had *Hide this group* load with those groups visible again. *All <key>* sets the key's default and clears each group's own setting of that property.

Blob settings belong to the board: every change is one undo step, and they are kept in local storage and in the saved zip's layout. PNG and SVG exports include the blobs (fill, outline at its stroke, title) beneath the stickies; the SVG writes `stroke-width` per blob and no stroke at all at 0, and the image grows to fit a blob that reaches past the frame. The 3DM scene carries them as closed polylines (below).

## 3DM export

**Export → 3DM** loads `cad.js` from this folder the first time it is used (a plain `<script>` tag, so it works from `file://`), then calls `window.ProgramBoardCad.export3dm(scene)`, which returns a promise of the file's bytes, and downloads `<name>.3dm`. The item reads *Preparing 3DM…* meanwhile. If `cad.js` is missing or throws, a toast says `3DM export failed:` and why.

The scene is built by `buildCadScene(model, view)` in `engine.js`:

```
{ units: 'feet', title,
  frame: { x, y, w, h, radius, title, fill } | null,
  stickies: [{ id, x, y, w, h, radius, fill, stroke, name, area, department, group, meta }],
  lines: [{ id, points: [[x, y], ...], width, color, start, end, caps }],
  texts: [{ id, x, y, text, size, font, color }],
  blobs: [{ key, value, points: [[x, y], ...], closed: true, color, hole }] }
```

Coordinates are feet with y pointing down, as on the board. A sticky's `x, y, w, h` are the box as drawn (fudged, when Fudge is on); `area` is its true area; `meta` is its whole spreadsheet row. A text's `x, y` is its top-left corner, `size` is its height in feet, and `color` is its own ink or `null` (the layer colour). The app adds each sticky's fitted `label` (size, lines, and `color`, its own ink or `null` to follow the fill) and each text's own typeface as `font`. `blobs` has one entry per island (or hole) of every visible blob: `key` and `value` name the group, `points` is the outline (not repeating the first point), `color` is its `#rrggbb`, `stroke` is its outline width in feet, and `hole` is true for an inner loop that is cut out of the island around it. In the 3DM each outline carries a `Stroke` user string; a blob at stroke 0 still exports its outline (it bounds the hatch) but with plot weight *No Plot*, so it does not print. The array is empty when no blobs are on. A line's `color` is its own `#rrggbb` or `null` (the layer colour), `start` and `end` name its end types when set, and `caps` is the cap geometry from `engine.lineShape` (`fill` or `stroke` polygons, or a `dot` centre and radius). In the 3DM the centreline stays a polyline; filled caps (arrow, square, dot) become closed curves with a solid hatch, and open arrows, ticks, and bars become polylines with a `Width` user string. Every cap carries `End` and `Kind` user strings and sits on the Lines layer in the line's object colour.

## Storage

The browser keeps the last board, groups, frame, lines, text, per-sticky and per-text type overrides, blob settings, the view, the grid, Fudge, the buffer, the background, the board's type (typeface, size, and ink), your custom colours, the line width, each line's colour and ends, and the toolbar state in local storage (`program-board-v4`). A board saved by the previous version (`program-board-v3`) is read once and carried over. Each Save also writes the layout part of the zip to `program-board-v4:saved`. Saved `.layout.json` files from earlier versions still load. Add `?fresh` to start an isolated session without changing the saved board. Local copies configured with a starter also support `?perf` for a 200-sticky stress board; it does not write to local storage.

Every change is one undo step: moves, stretches, fillets, styles, colours, text overrides, the buffer, the grid and Fudge, groups, duplicates, lines, text, blob toggles and blob settings, and deletions.

`node test.js` runs the engine self-test and timings. The self-test covers the align and distribute math (including a rigid group and the fan-out), frame containment after a drag, a bundle, and a shrink, the layout save/load round trip, label fitting (every label stays inside its sticky's inset at sizes from 160 ft down to under a foot, including wide, tall, and flat stickies, and scales in proportion to its sticky; a wide sticky gets type sized to its width, a tall, narrow one keeps its width-based size and wraps past four lines, and an extreme flat one is held to its height), Fudge (whole cells, true area kept, exact restore), constant-area stretching, the buffer, lines as walls (a sticky stops one buffer short; a dragged row piles up without crossing), the line collision radius at 0.49, 0.5, and 0.51 grid steps, resting distance from a thin line's centreline and a thick line's edge, a grid change re-settling stickies around a line, a dragged line herding a row (plus Ctrl stopping it, Ctrl + Shift ghosting it, a wall stopping it, and a group riding rigidly), the isolate and ghost drag modes, duplication, and the 3DM scene. Row order is checked too: a duplicate's row (single, and a group's) lands right after its source and nothing else moves, Ctrl D placement leaves the copy a buffer clear inside the frame, and the re-sort rules each land where described (a department change, a group change, a new group, a department change that brings a group new there, a new department, bulk group and bulk department edits that stay together and in order, and name, area, and plain column edits that move nothing), the re-sorted board restores exactly from its zip and from separate files and through the fuzzy merge after outside edits, a second sheet's hierarchy skips a scattered column, and the empty or mixed reading behind grey fields. It also checks the zip writer (a deflated and a stored round trip, including a non-ASCII name and an empty file, with every CRC-32 checked against Node's `zlib.crc32` and the SHA-256 against Node's `crypto`), an exact restore from the save zip, the same restore from a separate CSV and layout, and a merge with an edited CSV (one area changed, two rows swapped, one removed, one added): the summary, the resized sticky's centre and aspect, kept ids, unmoved neighbours, and the new sticky inside the frame one buffer clear. It also times a 30-sticky crowd drag at 200 stickies against 6 lines and a line herding through 200 stickies, and fails if either takes more than 16 ms in one step. The blob tests check which sample columns count as categories. On a board laid out by hand, they check that every member corner lies inside its blob, that no other sticky reaches into it, that a far member splits into its own island, and that a close pair merges with its notch filled and the outline one offset out. They also check that the cache rebuilds only the blob whose member moved (and never for a colour change), that a limited rebuild starves no blob, that single blobs drop out when single stickies are off, that a legacy hidden flag is dropped on load so the group draws again, that settings survive capture and restore and bad settings are cleaned, and that the 3DM scene carries one closed polyline per island. Blob settings also ride through the save-zip merge test. A press between two members grabs their blob (and a group spanning two blobs comes along), and a press on the open board grabs nothing; the engine self-test also checks that the smallest of nested blobs wins, that a hole or open board misses, and the outline tolerance. Finally, they time building every blob at 200 stickies with two keys on, and one sticky moving.

Text overrides are checked in the engine self-test and the save test. A sticky's own face, size, and colour beat the board's and reset back to it. A scaled label still fits its inset, capture writes only the keys that are set, and bad values are cleaned. Overrides survive duplication, the layout round trip, and the save zip. An old layout opens with none, and the CSV is byte for byte the same with or without them. `node test-cad.js` checks that a label's own ink and scaled size, and a text block's own colour, reach the 3DM, while a label without one still follows its fill. Line colour and ends survive the save zip (a plain line gains neither), and `node test-cad.js` checks that each end type reaches the 3DM as the right object (hatched closed curve or polyline) on the Lines layer in the line's colour.

The collision repro lives in `test-stress.js` (dev-only; `test.js` runs it). It drives the engine the way the app does and checks two things: after every settle, the closest pair of stickies (and of groups) must keep the buffer less 0.05 ft unless a jam was reported; and after every single step, no sticky may change sides of a line or enter its stroke. It runs eleven line cases (a hard two-frame chain shove and a selection shove into a line, a 1000 ft one-frame jump and a jump that rams a thin neighbour, a bundle straddling a line, a frame shrink with a line inside, the same shrink made impossible, which must report a jam, a line jumped 1000 ft into a sticky pinned at the wall, a line dragged into a pinned row, which must stop one reach short, and a grip swing that herds a free sticky and stops at a pinned one), then eight contact cases driven frame by frame with a wobbling hand: a sideways glide along a row of 8 (no stall, the row not carried), a diagonal push through a 4 × 4 cluster (no stall, no interpenetration), a pushed sticky sliding along the long one it rests on, with and without a floor line (tracking above 0.9, no stall, not lifted off), a five-sticky chain pushed along a surface, free and pressed (the whole chain translates with every gap at the buffer), and the same chain pushed into the frame wall and into a line (it packs and stops, nothing crosses or buckles, and it rests at the buffer). `node test-stress.js [engine.js]` runs the line and contact cases on their own. Then 60 random edits (drags in all three modes, throws, line drags, bundles, aligns, groups, and frame shrinks) on a 200-sticky board with lines, for two seeds, with and without Fudge.
