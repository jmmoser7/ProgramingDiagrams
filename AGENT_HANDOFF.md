# Program board: handoff for a fork

This guide is for a person or coding agent taking over or adapting the repository.
Read [README.md](README.md) for the product behavior and
[KEY_MODIFIERS.md](KEY_MODIFIERS.md) for the interaction contract before changing input handling.
The guides describe the repository as of **16 October 2026**; source and tests take
precedence if the fork changes later.

## What this project does

Program board turns a spreadsheet program into editable spatial diagrams. A row
represents a space; its area drives a sticky's footprint. The main views are:

- **Board**, `index.html`: freely arrange stickies, groups, walls/lines, text,
  frames, labels, and subdivisions.
- **Pack**, `pack.html`: arrange the same program as packed tiles. Its packing
  order, placement, aspect, and camera belong to this view.
- **Isometric**, `iso.html`: edit the authored geometry as cells with height,
  elevation, materials, contact, gravity, and stacking.

These views share one canonical program. Pack's tile coordinates must not replace
the authored Board/Isometric positions. Data, stable identities, metadata,
appearance, and grouping must survive mode switches and save/restore.

Two standalone experiments also live in the repository:

- `drag-feel.html` and `drag-feel/`: a small bench for grip picking, collision,
  pressure climbing, snapping, and release feel.
- `interaction-lab.html` and `interaction-lab/`: a larger collection of interaction
  studies, preferences, and written feedback. Research is in
  [docs/interaction-language/README.md](docs/interaction-language/README.md).

The experiments have separate state. Their controls and accepted preferences do
not automatically change the production board. They are no longer navigation tabs
in the main board UI, but remain available at their own URLs.

## Run it locally

There is no `package.json`, npm installation, framework build, or production
application server. Runtime code is plain JavaScript, HTML, and CSS. The Node
scripts use built-in modules. The latest build here used Node **24.21.0**.

Open `index.html` directly in Chrome or Edge, or serve the repository locally:

```sh
python -m http.server 5173 --bind 127.0.0.1
```

Then open `http://127.0.0.1:5173/index.html`. Use another available port if needed.
For isolated experiments, use `index.html?fresh`, `pack.html?fresh`, or
`iso.html?fresh`; these sessions do not overwrite the normal saved board.
Load [fixtures/program.csv](fixtures/program.csv) for synthetic test data.

For the interaction lab's optional local preference worker:

```sh
node serve-interaction-lab.js
```

It serves the lab at `http://127.0.0.1:8787/interaction-lab.html`; `/index.html`
still opens the board. The server's `/` opens the lab. Static hosting does not
provide the worker API. The worker validates and applies supported lab parameters;
it does not implement written feedback or edit the board's interaction code.

## Where to make changes

- [engine.js](engine.js): canonical model, parsing, geometry, row edits, stable
  identities, column roles, modules, collisions, groups, capture/restore, and
  save/import. Exposes `ProgramBoard` in the browser and a Node module for tests.
- [app.js](app.js): Board rendering, gestures, menus, editors, undo, persistence,
  exports, and orchestration. Keep geometry rules in the engine where practical.
- [pack.js](pack.js) and [pack-engine.js](pack-engine.js): Pack's UI and packing
  algorithms; maintain the boundary between packed placement and authored layout.
- [iso.js](iso.js): Isometric orchestration, editing, gestures, and state.
  [iso-geometry.js](iso-geometry.js), [iso-physics.js](iso-physics.js),
  [iso-renderer.js](iso-renderer.js), and [iso-ui.js](iso-ui.js) provide its geometry,
  contact/support behavior, rendering, and contextual menus.
- [mode-state.js](mode-state.js): cross-mode transport, persistence subscription,
  and reconciliation of independent edits. [display-mode.js](display-mode.js)
  handles mode navigation.
- [board-data-ui.js](board-data-ui.js) and [board-data-ui.css](board-data-ui.css):
  shared floating data editor. The three view controllers provide mutation,
  validation, undo, persistence, and Commit callbacks.
- [board-bookmarks.js](board-bookmarks.js), [board-transition.js](board-transition.js),
  and [board-group-bundle.js](board-group-bundle.js): snapshot catalog, eased
  restore, and group-aware bundling.
- [leaders.js](leaders.js), [appearance.js](appearance.js), and [blob.js](blob.js):
  outside label layout, shared appearance, and category envelopes.
- [chrome.css](chrome.css) and the three HTML entry points: capsule chrome,
  toolbar arrangement, and mode-specific shells. Follow their existing sizing,
  spacing, separators, nested controls, and focus feedback.
- [cad.js](cad.js) and `vendor/`: local Rhino 3DM export support.
- [build-netlify.js](build-netlify.js): explicit deploy file allowlist, empty
  starters, cache headers, data leak checks, ZIP creation, and ZIP verification.

## Recent decisions to preserve

**CSV editor.** Edit data lives inside the CSV/source capsule in all three modes.
Area and Group are visible column tags; multiple columns can be Group tags.
Submodules tags a count column; Module width and Module depth tag dimensions in
feet. Use engine setters rather than directly changing row arrays or geometry.
Category/group tags interpret metadata; authored rigid groups use separate group
identities. Do not collapse these into one kind of grouping.

**Module locks.** Hard/Loose is an inline toggle inside each dimension tag capsule.
Both controls edit one shared `columnRoles.moduleLock` setting. Hard keeps module
dimensions exact and lets the displayed footprint area adjust. Loose keeps exact
modules with the global grid off; with the grid on, the complete sticky footprint
scales to whole primary-grid increments. The source area remains in the data and
exports. Do not reinterpret Loose as an unconditional exact-area constraint.
Count subdivisions stay bounded by their sticky. Their linework is drawn in Board
and its PNG/SVG exports; do not assume identical subdivision rendering in every view.

**Commit.** Table changes currently apply live and participate in Undo. Commit
finishes pending input, persists the program on this device, and closes the editor
only on success. It is not a separate draft transaction or a disk export. Invalid
values remain editable and block actions that would discard them. Mode switches,
Save, and incoming updates from another open view must respect pending edits.
`commitActive()` flushes edits; `commit()` also invokes the host's Commit callback.
Do not call `commit()` from that callback and create a recursive save path.

**Zero-area rows.** These remain in the table and CSV but are not drawn. Reactivating
a row must preserve its identity and existing authored properties. A program with
no drawable cells is still a valid current program; never silently reload a sample.

**Bundle and leaders.** These belong in contextual capsules rather than the primary
Board toolbar. Bundle offers All and By group. By group temporarily ignores other
groups while compacting siblings, then restores collisions to place the clusters.
Rigid groups retain their internal offsets. Leaders is inside the Text menu; labels
and leader paths remain inside the frame, including export layouts.

The alignment widget also sorts by source area in either direction along the
selection's longer axis. Rigid groups rank by summed member area and remain intact;
spreadsheet row order is unchanged. Group bundling first assigns spaced independent
centers, compacts each cloud, and only then gathers the clouds with collisions on.

**Bookmarks.** The Board toolbar opens a named snapshot capsule stack with a circular
add control at its right. Clicking a capsule restores it; Delete is a separate
subcapsule. Rename uses the pencil, name double-click, or F2. Snapshots include data,
roles, layout, appearance, camera, grid, and selection. Restores preserve the current
bookmark catalog and ease between arrangements; reduced-motion preferences skip
animation. The catalog travels with saved layouts/ZIPs. Creation is capped at 30;
imported catalogs are retained. This is a Board feature, not a promise of identical
bookmark UI in every mode.

## Persistence and compatibility

The main shared local-storage key is `program-board-v4`; Board also keeps a saved
snapshot at `program-board-v4:saved`. Existing legacy-state readers are intentional.
HTTP views on the same origin share storage. For `file://` navigation, mode state
can travel in the destination's `#pb-mode=` fragment because browsers may isolate
storage by file. Fragments also support HTTP handoff when storage is blocked.
The fragment contains program data; use a Save ZIP to share a
board, rather than assuming a fragment URL is an empty application link.

Pack's placement and camera live in `view.pack`; Isometric uses `view.isoCamera`
and direction settings, plus its own UI cache. Undo history is in memory in each
page; shared program state does not imply a shared cross-tab undo stack.

Rows and cells have stable IDs. Do not substitute an array index or a displayed
name for identity. `mode-state.js` reconciles changes against the incoming baseline;
on a direct conflict the committing local edit wins. Unfinished/invalid table edits
defer incoming application of state. Keep the incoming baseline separate from the
merged result or a later persist can overwrite the local correction.

Save creates a ZIP containing CSV, layout JSON, and a manifest. Matching data
restores exactly; edited CSV is reconciled with the saved layout. The spreadsheet
opened by the user is not modified in place. Inspect `engine.js` and the README's
Save file section before changing schema or matching rules.

## Verify a change

Choose tests for the area changed. Useful focused commands are:

```sh
node test-board-modules.js
node test-mode-state.js
node test-board-bookmarks.js
node test-board-transition.js
node test-board-group-bundle.js
node test-board-area-sort.js
node test-pack.js
node test-iso.js
node test-iso-physics.js
node test-leaders.js
node test-appearance.js
node test-cad.js
```

For lab or grip changes, use `test-interaction-lab.js`, `test-drag-feel.js`,
`test-drag-feel-grip.js`, `test-tracking-guides.js`, and the tests under
`interaction-lab/`. Worker changes have `test-preference-queue.js` and
`test-feedback-inbox.js`. Run each with `node` and its repository-relative path.

`node test.js` is the broader engine/self-test/performance/stress entry point;
`node test-stress.js` runs the collision repro/stress suite separately. Previous
local verification reported a failing `crowd16ms` performance gate. Treat that
timing issue as unresolved; passing focused suites is not a claim that the broad
suite is fully green. Record machine and timing context when investigating it.

Current guardrails include 200 drawable stickies, up to 10,000 rendered subdivision
cells per sticky,
30 newly created bookmarks, and a 16 MiB mode-fragment decode limit. Check the
implementation before relaxing a limit; imported bookmark catalogs have different
retention rules from new creation.

Browser checks matter for gesture timing, focus, rendering, and CSS. At minimum,
load synthetic data, exercise the modified gesture with modifiers pressed before
and during it, undo/redo, save/restore, and switch through all three modes. For data
editor work, also test an invalid value, correction followed by Commit, zero-area
reactivation, and an update from another open view while a draft is unfinished.

## Build, share, and fork

```sh
node build-netlify.js
```

This produces `dist/` and `program-board-netlify.zip`. Upload the ZIP to Netlify
Drop or a site's Deploys tab. New visitors start empty; existing saved browser state
still restores. The build empties both starters,
checks for private-data strings, verifies ZIP contents byte for byte, and includes
the root MIT license and vendor notices. When adding runtime files, update its
allowlist and every applicable HTML entry point. Keep asset cache tokens consistent
across modes when refreshing deployed assets.

The upstream repository is
[jmmoser7/ProgramingDiagrams](https://github.com/jmmoser7/ProgramingDiagrams), with
`main` as its primary branch. The code/features and MIT license were published in
commit `c5153df`; this handoff is a later documentation addition. A fork may change
the product for its own purposes. Preserve the MIT notice and the existing
[Rhino notices](vendor/rhino3dm-LICENSE.txt). There is no required cloud service or
account connection for the main app.

The deploy allowlist currently includes both standalone labs and selected research
docs. The handoff and modifier guides stay in the repository rather than the site
bundle. Removing a navigation tab does not remove its files from the deploy.

Keep client spreadsheets out of commits: `sample.csv`, `.local/`, `.env` files,
saved `*.layout.json`, generated ZIPs, `dist/`, and `node_modules/` are ignored.
The tracked fixture is synthetic. Share portable, relative file links in new docs.

For a shared feel across forks, agree on [KEY_MODIFIERS.md](KEY_MODIFIERS.md) first,
then carry changes with a concrete gesture repro and the corresponding test. Keep
experimental lab behavior identified as experimental instead of silently replacing
the production input contract.
