# Cloud verification · 17 October 2026

All implementation, dependency installation, builds, automated tests, HTTP serving and Chromium/WebGL checks ran in the remote Linux workspace. No connected Windows executor or local checkout was used. The paused feedback automation was never queried or changed.

## Base and isolation

`git ls-remote` confirmed main at `d798c0d77d51180c2cd230e708b1b1bff4f5cb1f`. A fresh cloud clone was used, with branch `codex/modeling-lab-3d`. Only the isolated modeling entry/source and a README pointer were added. Existing product sources, interaction-lab accepted preferences and its worker remain unchanged. No merge or public deployment was performed.

## Passed checks

- 15 node:test core tests: camera modifier mappings; stable orbit target, pan delta and FOV; cursor zoom invariance in four views; tiny/large clipping; CPlane/world/relative coordinates; free-plane/Elevator acquisition; lifecycle, preview, finish/close/segment undo; Box/Cube and noncoplanar surfaces; persistent direction lock; real-depth intersections; pixel snaps and Project; directional marquee/components; vertex-only transforms; group overrides; pivot rotation/scale; definitions/instances; atomic history and validation.
- 22 real Chromium integration checks: WebGL mesh rendering; toolbar/numeric XYZ creation; ray selection; numeric transform; undo/redo; actual downloaded JSON and file-input reload; rejection of invalid imports; orbit preserving active points; Polyline finish; Front parallel pan; CPlane elevation/relative input; warped SrfPt; command Escape; Block/Insert; Ctrl+Shift segment picking; endpoint-only component movement; Ctrl+LMB Elevator; Tab lock after multiple picks; live Gumball axis drag; complete Escape rollback; no idle redraw loop; no uncaught browser errors.
- 12 existing suites passed: `test-interaction-lab.js`, `test-tracking-guides.js`, `interaction-lab/test-component-marquee.js`, `interaction-lab/test-precision-stage.js`, `interaction-lab/test-direction-constraint.js`, `test-board-modules.js`, `test-mode-state.js`, `test-pack.js`, `test-iso.js`, `test-iso-physics.js`, `test-drag-feel.js`, `test-drag-feel-grip.js`.
- Isolated static build verifies copied assets byte-for-byte. Runtime dependencies are vendored unmodified Three.js 0.180.0 ESM minified builds with MIT notice. The test-only Playwright dependency is pinned at 1.62.1.

Browser: Chromium 138.0.7204.0, headless Linux, ANGLE/SwiftShader software WebGL. Initial scene produced 316 triangles and 132 draw calls. Screenshots of the sample and cyan-selected state were captured and visually inspected at 1440×1000. Software rendering establishes real WebGL behavior, not a hardware-GPU performance benchmark. Playwright's normal browser download returned truncated archives; a Chromium package was installed/extracted in cloud scratch instead. That workaround is not an application runtime dependency.

The broad legacy `test.js` performance/stress gate was not rerun: the handoff identifies an existing machine-sensitive crowd16ms issue, and this isolated change does not modify its engine. Passing focused suites is not a claim of native Rhino parity or a full production-engine performance pass.

## Reproduce

```
npm ci --prefix modeling-lab
npm --prefix modeling-lab test
npm --prefix modeling-lab run build
# Install a compatible Chromium for Playwright, or set its executable explicitly:
CHROMIUM_EXECUTABLE=/absolute/path/to/chromium npm --prefix modeling-lab run test:browser
```

The browser script starts and closes its own HTTP server, checks live UI input, and captures internal QA screenshots under `/tmp` by default. `SCREENSHOT_DIR` can point at an existing directory. It does not contact the feedback worker, modify account state or depend on a local Windows browser.
