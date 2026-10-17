// Real cloud Chromium checks. Run CHROMIUM_EXECUTABLE=/path/to/chromium node modeling-lab/test-browser.cjs
const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, ".."),
  mime = {
    ".js": "text/javascript",
    ".css": "text/css",
    ".html": "text/html",
    ".json": "application/json",
  };
const server = http.createServer((req, res) => {
  const file = path.resolve(
    root,
    "." + decodeURIComponent(req.url.split("?")[0]),
  );
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (e, data) => {
    if (e) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader("Content-Type", mime[path.extname(file)] || "text/plain");
    res.end(data);
  });
});
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port,
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--no-proxy-server",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    });
  let checks = 0;
  const p = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    }),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  const pause = () => p.waitForTimeout(90),
    check = (name, fn) => {
      fn();
      checks++;
      console.log("PASS " + name);
    };
  try {
    await p.goto(`http://127.0.0.1:${port}/modeling-lab.html`);
    await p.waitForFunction(
      () => window.modelingLab?.rendererInfo.triangles > 0,
    );
    await pause();
    let info = await p.evaluate(() => modelingLab.rendererInfo);
    check("real WebGL meshes rendered", () =>
      assert.ok(info.webgl && info.triangles >= 300),
    );
    await p.screenshot({
      path: process.env.SCREENSHOT_DIR
        ? path.join(process.env.SCREENSHOT_DIR, "modeling-sample.png")
        : "/tmp/modeling-sample.png",
    });
    const enter = async (text) => {
        await p.locator("#command").fill(text);
        await p.locator("#command").press("Enter");
        await pause();
      },
      doc = () => p.evaluate(() => modelingLab.document),
      state = () => p.evaluate(() => modelingLab.command),
      project = (point) => p.evaluate((p) => modelingLab.project(p), point),
      localClick = async (q, options = {}) => {
        const box = await p.locator("canvas").boundingBox();
        await p.mouse.click(box.x + q.x, box.y + q.y, options);
        await pause();
      },
      localDrag = async (a, b, options = {}) => {
        const box = await p.locator("canvas").boundingBox();
        await p.mouse.move(box.x + a.x, box.y + a.y);
        await p.mouse.down(options);
        await p.mouse.move(box.x + b.x, box.y + b.y, { steps: 8 });
        await p.mouse.up(options);
        await pause();
      };
    await p.locator("#new").click();
    await p.locator('[data-command="Box"]').click();
    await enter("0,0,0");
    await enter("4,3,0");
    await enter("5");
    let d = await doc();
    check("actual toolbar + numeric Box creates XYZ volume", () => {
      assert.equal(d.objects.length, 1);
      assert.equal(d.objects[0].points[4][2], 5);
    });
    await p.locator("#extents").click();
    await pause();
    // Pick using actual rendered surface ray.
    await p.locator("canvas").click({ position: { x: 30, y: 150 } });
    await localClick(await project([2, 0, 2]));
    let sel = await p.evaluate(() => modelingLab.selection);
    check("ray picking selects rendered box", () =>
      assert.equal(sel.length, 1),
    );
    await p.locator("#axis").selectOption("Z");
    await p.locator("#transform-value").fill("2");
    await p.locator("#apply-transform").click();
    d = await doc();
    check("numeric Gumball transform moves real geometry", () =>
      assert.equal(d.objects[0].points[0][2], 2),
    );
    await p.locator("#undo").click();
    d = await doc();
    assert.equal(d.objects[0].points[0][2], 0);
    await p.locator("#redo").click();
    d = await doc();
    check("UI undo and redo", () => assert.equal(d.objects[0].points[0][2], 2));
    const downloadPromise = p.waitForEvent("download");
    await p.locator("#save").click();
    const download = await downloadPromise,
      saved = await fs.promises.readFile(await download.path(), "utf8");
    assert.equal(JSON.parse(saved).objects[0].points[0][2], 2);
    await p.locator("#new").click();
    await p
      .locator("#file")
      .setInputFiles({
        name: "roundtrip.json",
        mimeType: "application/json",
        buffer: Buffer.from(saved),
      });
    await pause();
    d = await doc();
    check("real download + file upload validates and restores", () =>
      assert.equal(d.objects[0].points[4][2], 7),
    );
    await p
      .locator("#file")
      .setInputFiles({
        name: "invalid.json",
        mimeType: "application/json",
        buffer: Buffer.from('{"version":99}'),
      });
    await pause();
    assert.equal(JSON.stringify(await doc()), JSON.stringify(d));
    const importError = await p.locator("#error").textContent();
    check("invalid upload leaves current document intact", () =>
      assert.match(importError, /version/),
    );
    // Creation + nav ownership during an active command.
    await p.locator('[data-command="Polyline"]').click();
    await enter("w-4,0,1");
    const before = await p.evaluate(() => modelingLab.camera),
      points = await state();
    await localDrag(
      { x: 420, y: 240 },
      { x: 500, y: 270 },
      { button: "right" },
    );
    const after = await p.evaluate(() => modelingLab.camera);
    check("RMB perspective orbit preserves target and draft points", () => {
      assert.deepEqual(after.target, before.target);
      assert.notDeepEqual(after.direction, before.direction);
    });
    assert.deepEqual((await state()).points, points.points);
    await enter("w-2,1,3");
    await enter("w-1,3,5");
    await enter("");
    d = await doc();
    check("Polyline finish adds only placed vertices", () =>
      assert.equal(d.objects.at(-1).points.length, 3),
    );
    await p.locator("#view").selectOption("Front");
    await pause();
    const front = await p.evaluate(() => modelingLab.camera);
    await localDrag(
      { x: 400, y: 220 },
      { x: 450, y: 250 },
      { button: "right" },
    );
    const panned = await p.evaluate(() => modelingLab.camera);
    check("Front is orthographic and RMB pans target", () => {
      assert.equal(panned.view, "Front");
      assert.deepEqual(panned.direction, front.direction);
      assert.notDeepEqual(panned.target, front.target);
    });
    await p.locator("#cplane").selectOption("XZ");
    await p.locator("#elevation").fill("3");
    await p.locator("#elevation").dispatchEvent("change");
    await p.locator('[data-command="Line"]').click();
    await enter("1,2,4");
    await enter("@2,3,1");
    d = await doc();
    check("CPlane elevation and relative coordinates in actual UI", () => {
      assert.deepEqual(d.objects.at(-1).points, [
        [1, -7, 2],
        [3, -8, 5],
      ]);
    });
    await p.locator("#view").selectOption("Perspective");
    await p.locator("#cplane").selectOption("XY");
    await p.locator("#elevation").fill("0");
    await p.locator("#elevation").dispatchEvent("change");
    await p.locator('[data-command="SrfPt"]').click();
    for (const v of ["w-4,4,0", "w0,4,1", "w0,7,5", "w-4,7,2"]) await enter(v);
    d = await doc();
    check("noncoplanar SrfPt has true depth", () =>
      assert.equal(new Set(d.objects.at(-1).points.map((p) => p[2])).size, 4),
    );
    // Escape rolls back draft and camera movement creates no geometry transaction.
    const count = d.objects.length;
    await p.locator('[data-command="Box"]').click();
    await enter("20,20,3");
    await p.locator("canvas").press("Escape");
    const escaped = await state(),
      escapedCount = (await doc()).objects.length;
    check("Escape cancels command and preview", () => {
      assert.equal(escaped, null);
      assert.equal(escapedCount, count);
    });
    // Whole object block -> shared definition -> instance.
    const id = (await doc()).objects[0].id;
    await p.evaluate((id) => modelingLab.select([id]), id);
    await p.locator("#block").click();
    await p.locator("#insert").click();
    await enter("w12,0,2");
    d = await doc();
    check("Block + Insert share a reusable definition", () => {
      assert.equal(d.definitions.length, 1);
      assert.equal(d.objects.filter((o) => o.kind === "instance").length, 2);
      assert.equal(
        new Set(
          d.objects
            .filter((o) => o.kind === "instance")
            .map((o) => o.definition),
        ).size,
        1,
      );
    });
    // Isolated component scene: no parent selection highlight.
    await p.locator("#new").click();
    await p.locator('[data-command="Polyline"]').click();
    for (const v of ["-4,0,0", "0,0,2", "4,0,0"]) await enter(v);
    await enter("");
    await p.locator("#extents").click();
    await pause();
    const a = await project([-2, 0, 1]);
    await p.keyboard.down("Control");
    await p.keyboard.down("Shift");
    await localClick(a);
    await p.keyboard.up("Shift");
    await p.keyboard.up("Control");
    sel = await p.evaluate(() => modelingLab.selection);
    check("Ctrl+Shift picks only a polyline segment", () => {
      assert.ok(sel.some((s) => s.type === "edge" && s.index === 0));
    });
    await p.locator("#axis").selectOption("Y");
    await p.locator("#transform-value").fill("3");
    await p.locator("#apply-transform").click();
    d = await doc();
    check("component transform affects segment endpoints only", () => {
      assert.equal(d.objects[0].points[0][1], 3);
      assert.equal(d.objects[0].points[1][1], 3);
      assert.equal(d.objects[0].points[2][1], 0);
    });
    // Elevator is owned by point acquisition, not Ctrl deselection.
    await p.locator("#new").click();
    await p.locator("#view").selectOption("Top");
    await p.locator('[data-command="Line"]').click();
    const base = await project([0, 0, 0]);
    await p.keyboard.down("Control");
    await localClick(base);
    await p.keyboard.up("Control");
    assert.equal((await state()).elevator, true);
    await enter("5");
    await enter("w4,0,7");
    d = await doc();
    check("Ctrl+LMB Elevator accepts signed normal height", () => {
      assert.ok(Math.abs(d.objects[0].points[0][2] - 5) < 1e-7);
      assert.equal(d.objects[0].points[1][2], 7);
    });
    await p.locator('[data-command="Polyline"]').click();
    await enter("w0,0,0");
    await p.locator("#viewport").focus();
    const aim = await project([2, 3, 0]),
      vp = await p.locator("canvas").boundingBox();
    await p.mouse.move(vp.x + aim.x, vp.y + aim.y);
    await p.keyboard.press("Tab");
    assert.equal((await state()).locked, true);
    await enter("w2,3,0");
    await enter("w4,6,0");
    const lockedAfter = (await state()).locked;
    check("Tab direction lock remains after successive point picks", () =>
      assert.equal(lockedAfter, true),
    );
    await p.locator("#cancel").click();
    // Actual Gumball drag, cancellation and one-step history.
    await p.locator("#new").click();
    await p.locator('[data-command="Cube"]').click();
    await enter("0,0,0");
    await enter("4,4,0");
    await p.locator("#view").selectOption("Perspective");
    await p.locator("#extents").click();
    await pause();
    const beforeDrag = await doc(),
      handle = await p
        .locator("#gumball circle")
        .first()
        .evaluate((e) => ({
          x: Number(e.getAttribute("cx")),
          y: Number(e.getAttribute("cy")),
        }));
    await localDrag(handle, { x: handle.x + 45, y: handle.y + 12 });
    const movedDoc = await doc();
    check("Gumball axis drag changes geometry", () =>
      assert.notDeepEqual(
        movedDoc.objects[0].points,
        beforeDrag.objects[0].points,
      ),
    );
    await p.locator("#undo").click();
    assert.deepEqual(
      (await doc()).objects[0].points,
      beforeDrag.objects[0].points,
    );
    const handle2 = await p
        .locator("#gumball circle")
        .first()
        .evaluate((e) => ({
          x: Number(e.getAttribute("cx")),
          y: Number(e.getAttribute("cy")),
        })),
      canvasBox = await p.locator("canvas").boundingBox();
    await p.mouse.move(canvasBox.x + handle2.x, canvasBox.y + handle2.y);
    await p.mouse.down();
    await p.mouse.move(
      canvasBox.x + handle2.x + 45,
      canvasBox.y + handle2.y + 12,
      { steps: 5 },
    );
    await p.keyboard.press("Escape");
    await p.mouse.up();
    const canceledDoc = await doc();
    check("Escape restores the entire live Gumball transaction", () =>
      assert.deepEqual(
        canceledDoc.objects[0].points,
        beforeDrag.objects[0].points,
      ),
    );
    // No pointer / camera work when idle.
    await p.mouse.move(10, 10);
    await p.waitForTimeout(700);
    const idle = await p.evaluate(() => modelingLab.framesRendered);
    await p.waitForTimeout(600);
    const idle2 = await p.evaluate(() => modelingLab.framesRendered);
    check("render on demand has no idle redraw loop", () =>
      assert.equal(idle2, idle),
    );
    await p.locator("#sample").click();
    await p.locator("#tree .object-name").first().click();
    await pause();
    await p.screenshot({
      path: process.env.SCREENSHOT_DIR
        ? path.join(process.env.SCREENSHOT_DIR, "modeling-selected.png")
        : "/tmp/modeling-selected.png",
    });
    check("browser has no uncaught errors", () => assert.deepEqual(errors, []));
    console.log(
      JSON.stringify({
        checks,
        errors,
        webgl: info,
        chromium: await browser.version(),
      }),
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
  server.close();
});
