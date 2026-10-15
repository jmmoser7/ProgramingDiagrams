# Key modifiers and interaction feel

This guide records the current interaction contract for people and agents extending or forking Program Board. Preserve the meaning and timing of a gesture, not just its key binding. The production modes share navigation and editing conventions, but they do not all use the same movement model.

In the production modes, **Ctrl** also accepts **Command/Meta**. The Interaction Lab's geometry selection modifiers specifically check Ctrl; its history shortcuts also accept Command/Meta.

## Shared feel to preserve

- Keep the point grabbed under the pointer. Do not jump to the object's centre when a drag starts.
- Separate a click from a drag with a small screen-space threshold. Selecting an object or releasing a modifier must not accidentally create a copy.
- Apply temporary drag modifiers while the pointer is held. On Board and Isometric, Ctrl and Shift changes take effect immediately, even without another pointer movement.
- Show the active intent through the cursor and available guides/status. A copy should feel like a copy before release.
- Treat a completed drag, including its duplication and collision effects, as one geometry undo step. Do not record every pointer frame.
- Keep selection operations distinct from geometry edits. Shift-click changes membership; Shift-drag moves the normal drag selection.
- Preserve groups when moving them. A selection and a rigid group are different concepts, and category/CSV tags do not automatically create a rigid group.
- Protect text entry: letters, Delete, arrows, and native text undo belong to the focused input. **Ctrl+S** is the intentional save exception in production modes.
- Keep camera navigation separate from authored geometry. Pan and zoom must not rearrange the program.

These are maintenance goals grounded in the existing implementation. Mode-specific limits below are part of the current behavior; do not assume an unimplemented binding is already shared.

## Board: sticky movement

Entry point: `index.html`.

- **Plain drag:** move the grabbed sticky/group or the existing selection. Neighbours push aside; walls and the frame remain constraints.
- **Ctrl-drag:** isolate. Other stickies hold still; the dragged selection stops at contact instead of pushing them.
- **Ctrl+Shift-drag:** ghost. The dragged stickies pass through obstacles at reduced opacity. On release, neighbours settle out of the way.
- **Shift-drag:** lock to the dominant X or Y axis once movement starts. Releasing Shift restores free motion. Ctrl+Shift selects ghost mode instead of ordinary Shift axis locking.
- **Alt-drag:** move copies of stickies and lines, leaving originals in place. The decision follows Alt until the drag passes **4 screen pixels**, then stays fixed for that gesture. Pressing Alt after that does not spawn copies mid-drag.
- **Shift-click:** add/remove the hit object or group on release when there was no drag. A held Shift press is not an early deselection.
- **Empty-space drag:** marquee selection. Shift retains the previous selection as its base.
- **Blob drag:** move its member stickies, including their rigid groups, using the same movement modifiers. Sticky hits take priority; the smallest overlapping blob is picked where exposed.

Alt duplication creates real CSV rows, retaining source fields. Each copy follows its source row in row order; copied groups become new groups. Text-only selections do not use Alt-copy. Lines can be copied and moved alongside stickies.

A line body is an immovable pusher during normal dragging. Ctrl makes it stop at the first sticky; Ctrl+Shift lets it ghost through; Shift locks its translation axis; Alt copies it. A line endpoint is a different gesture: Shift snaps its angle to 45-degree increments.

### Board shortcuts

- **Right-drag / middle-drag / Space+left-drag:** pan. A right-click without movement opens the capsule menu.
- **Wheel:** zoom at the pointer. **F:** fit the view.
- **Ctrl+Z:** undo. **Ctrl+Shift+Z / Ctrl+Y:** redo.
- **Ctrl+A:** select all. **Ctrl+D:** duplicate the selection.
- **Ctrl+G:** group/ungroup toggle. **Ctrl+Shift+G:** ungroup.
- **Delete / Backspace:** delete selected objects. **Enter:** open selection metadata.
- **Arrow keys:** nudge by the grid step, or 8 feet with grid off. **Shift+arrows:** multiply that step by 5. A held repeat run shares its initial undo checkpoint.
- **G:** toggle grid. **B:** bundle. **V:** selection tool.
- **L / D:** line tool. **T / Y:** text tool. **[ / ]:** decrease/increase line brush width, including selected lines.
- **Ctrl+S:** save, including while an edit field has focus.
- **Escape:** dismiss the current editor/popover/tool/selection according to context. Do not describe this as a universal rollback of a Board drag.

### Board drawing and inline editing

- In the line tool, click two endpoints or drag out a line. **Shift** snaps direction to 45-degree increments.
- During a line draft, **Tab** toggles the current direction lock. Type a numeric length and press **Enter** to commit; **Backspace** edits that number.
- **Escape** clears a typed draft length first, then cancels the draft, then exits the line tool on a subsequent press.
- Double-click a sticky's name to rename; double-click its area readout to edit area. Double-clicking a resize/fillet handle opens metadata.
- Inline name/area editors use **Enter** to accept and **Escape** to cancel. **Tab** moves from name to area; **Shift+Tab** moves back. Name **Shift+Enter** does not insert a line break.

## Isometric: volume movement

Entry point: `iso.html`.

- In **Object** mode, plain drag moves the selection through the 3D contact solver. It pushes movable neighbours, respects locked cells, walls and frame, and carries supported stacks/rigid groups.
- **Ctrl** isolates and **Ctrl+Shift** ghosts. These change live while held. Isolation still retains solid contact, support carriage and pressure climbing; it does not freeze all physics.
- **Shift** locks horizontal movement to a world X/Y axis in normal mode. An explicit axis gizmo is its own constraint.
- **Alt-drag** duplicates. Alt can change before the **3 screen pixel** threshold; the copy decision stays fixed once motion begins.
- **Shift-click** toggles group-aware selection if the press did not become a move. **Shift-marquee** retains the previous selection.
- On ghost/copy release, the solver separates overlaps. If it cannot make a legal placement, the entire gesture restores its pre-drag state and shows a message.
- Sustained contact can climb onto a block after roughly half a second. Withdrawal/release cancels pressure; drawn walls do not become stairs. Unsupported stacks settle with gravity.
- In **Face** mode, selecting the top surface exposes height editing rather than the normal body drag. **Shift** on a vertical gizmo drag quantizes its change by the configured grid step.

### Isometric shortcuts

- **Right-drag / middle-drag / Space+left-drag:** pan. Right-click without motion opens the capsule menu. **Wheel:** pointer-centred zoom. **F:** fit.
- **Ctrl+Z:** undo. **Ctrl+Shift+Z / Ctrl+Y:** redo.
- **Ctrl+A:** select all live cells. **Ctrl+D:** duplicate. **Ctrl+G:** group/ungroup toggle; **Ctrl+Shift+G:** ungroup.
- **Delete / Backspace:** delete. **Enter:** open metadata. **G:** toggle grid. **V:** return to Object mode. **N:** new cell.
- **Arrow keys:** nudge by the grid step, or 1 foot with grid off. **Shift+arrows:** multiply by 10. These currently record individual key events, unlike Board's held-repeat checkpoint.
- **[ / ]:** rotate the camera one step. These are not Board's brush-width keys here.
- Double-click a cell to rename; **Shift-double-click** or **Alt-double-click** edits its area.
- **Ctrl+S:** save, including inside the CSV editor. Invalid table entries remain open for correction.
- **Escape:** restore an active drag's pre-gesture snapshot, close the menu, clear selection, and return to Object mode.

## Pack: packing and reordering

Entry point: `pack.html`.

Pack rearranges a packed layout; it is not a free-motion collision canvas. **Ctrl-isolate, Ctrl+Shift-ghost, Shift-axis locking and arrow nudging are not implemented in Pack.** Preserve that distinction in help and future changes.

- **Drag a tile:** preview a new packed order/placement, then commit it on release. A selected tile carries the selected IDs. Department nesting can also update the moved rows' department.
- **Shift-click:** toggle the hit tile on release without moving. A Shift-drag can include an unselected hit tile in the drag without first replacing the existing selection.
- **Alt-drag:** duplicate at the first move beyond **4 screen pixels**. Current Pack behavior copies if Alt was held at the initial press **or** at that first move; releasing Alt before the threshold does not disarm an Alt press already recorded. Late Alt after dragging begins does not create copies.
- **Empty-space marquee:** left-to-right selects fully enclosed tiles; right-to-left selects intersecting tiles. Shift retains the prior selection.
- A committed reordering/duplication drag is one undo step. An invalid preview restores its pre-drag snapshot.

### Pack shortcuts

- **Right-drag / middle-drag / Space+left-drag:** pan. Right-click without motion opens the menu. **Wheel:** pointer-centred zoom.
- **F:** fit view. **Shift+F:** fit area.
- **Ctrl+Z:** undo. **Ctrl+Shift+Z / Ctrl+Y:** redo. **Ctrl+D:** duplicate selected tiles.
- **Ctrl+G:** group selected tiles. **Ctrl+Shift+G** currently has no ungroup action.
- **Delete / Backspace:** delete. **Enter:** open metadata for a selected tile.
- **[ / ]:** step the packing aspect setting.
- Double-click a tile name or area readout to edit that field. **Ctrl+S:** save, including from the CSV editor.
- **Escape:** close/cancel the current UI/drag and clear selection; an active inline name editor has its own Escape handling.

## CSV module locks are settings, not modifier keys

The CSV capsule's **Edit data** opens the shared editor in all three production modes. Module width/depth tag capsules contain a synchronized **Hard/Loose** toggle. It persists with the program; holding Ctrl or Shift does not change it.

- **Hard:** exact module dimensions take priority over the primary grid; displayed footprint area may adjust. Source area remains recorded.
- **Loose:** exact modules with global grid off; with global grid on, scale the full sticky footprint to exact primary-grid increments.
- **Submodules** specifies a bounded cell count. It is distinct from the width/depth module tags.
- **Commit** validates pending entries, saves on this device and closes the editor. Invalid entries stay open. Live edits are already applied; Commit is not a draft-transaction boundary or a Git commit.

## Research pages have different contracts

The standalone `drag-feel.html` and `interaction-lab.html` pages remain in the repository, but are absent from the production mode selector. They are useful references and test benches, not shortcut parity guarantees.

### Drag Feel bench

- **Ctrl/Command-drag:** keep neighbours fixed; pressing/releasing it changes isolation immediately. Solid collisions, climbing and support carriage still apply.
- **Alt:** bypass edge/vertex feature picking so a surface grip can be grabbed. It does **not** duplicate. Ctrl+Shift does **not** select production ghost mode.
- **Right/middle/Space-drag:** pan. **Wheel / + / -:** zoom. **0:** fit.
- **Arrow keys:** drive the selected block through the controller while held. **Escape:** cancel the active grip.
- The bench does not provide production geometry undo/redo. Its purpose is evaluating contact and grip feel.

### Interaction Lab

- **Shift-click:** add selection. **Ctrl-click:** remove selection. This differs from production isolate-drag semantics.
- In group selection studies, **Ctrl+Shift-click** targets one group member. In component studies, it targets faces/edges/vertices rather than ghosting geometry.
- With the **Sub-objects** filter active, plain picking targets components and Ctrl+Shift picks a solid's parent. Polyline segments/vertices retain individual Ctrl+Shift targeting. Keep the filter context visible.
- In tracking studies, **Shift** temporarily inverts persistent Ortho. The configured angle can be 45 degrees; do not replace this with production X/Y drag locking.
- Tracking **Tab** cycles direction lock, radius lock, then unlocked. This differs from Board's two-state line direction lock.
- **Alt-drag** requests a copy in gumball/feedback studies, with geometry created only after the drag threshold. **Alt+D** duplicates selected geometry.
- **Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y:** history. **Escape:** cancel/restore the active interaction. **F2:** rename. **Home:** fit. **Delete:** remove unlocked selected geometry.
- Navigation and transform bindings depend on the selected study. Numeric inputs keep their own keyboard handling.

## Implementation pointers and preservation checks

- `app.js`: `dragMode`, `startMove`, `armDuplicate`, `remodDrag`, `moveTo`, `onKeyDown`, `nudge`, `draftKey`, and inline editors. `engine.js` owns Board collision/duplication behavior.
- `iso.js`: `dragMode`, `beginPointer`, `movePointer`, `endPointer`, and keyboard handlers. `iso-physics.js` owns contact, isolation, ghost separation, pressure and support.
- `pack.js`: `onDown`, `onMove`, `onUp`, `onKey`, and `cancelDrag`; packing previews use the packing engine.
- `board-data-ui.js` and `mode-state.js`: editor validation, module settings, persistence and shared program reconciliation.
- `drag-feel/app.js`, `drag-feel/physics.js`, `drag-feel/grip.js`: bench input, controller and visible grip features.
- `interaction-lab/stage.js`, `direction-constraint.js`, `scene-precision.js`: study-specific selection and constraints. Accepted study preferences do not automatically change production bindings.

Before changing shared feel, run the relevant existing tests and manually check these cases:

1. Start a normal Board/Isometric drag, press Ctrl without moving the pointer, then release it. Neighbours switch between holding still and pushing immediately.
2. Shift-click a selected object; then repeat as a Shift-drag. Only the click toggles membership. Ctrl+Shift-drag enters ghost instead of removing selection.
3. Press/release Alt before the threshold, then try Alt after motion begins. Check each mode's documented timing, source rows, copy IDs and one-step undo.
4. Sweep a fast drag/nudge into a wall. Normal and isolate motion must not tunnel through; a deliberate ghost drag is the exception.
5. Pan/zoom while a selection exists; geometry stays fixed. Type shortcut letters, arrows and Delete inside fields; text editing wins. Ctrl+S validates/saves instead of discarding an invalid draft.
6. Undo a completed drag that moved neighbours or copied a group. Restore the whole gesture, including new rows and group membership, rather than its last pointer frame.
7. Compare Lab Ctrl+Shift component picking and bench Alt surface picking with production ghost/copy gestures. Help text must not imply they are identical.

Useful suites: `node test.js`, `node test-mode-state.js`, `node test-board-modules.js`, `node test-pack.js`, `node test-iso.js`, `node test-iso-physics.js`, `node test-drag-feel.js`, `node test-drag-feel-grip.js`, `node test-interaction-lab.js`, and the targeted `interaction-lab/test-*.js` files. `test.js` also includes timing thresholds, so investigate functional failures separately from machine-dependent performance results.
