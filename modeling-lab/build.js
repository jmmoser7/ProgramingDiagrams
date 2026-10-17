// Isolated static build; no production Board assets are rewritten.
import { mkdir, rm, copyFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const here = path.dirname(fileURLToPath(import.meta.url)),
  root = path.dirname(here),
  out = path.join(here, "dist");
const files = [
  "modeling-lab.html",
  "LICENSE",
  "interaction-lab/accepted-preferences.js",
  ...[
    "app.js",
    "model.js",
    "camera.js",
    "precision.js",
    "commands.js",
    "render.js",
    "style.css",
    "README.md",
    "VERIFICATION.md",
    "vendor/three.module.min.js",
    "vendor/three.core.min.js",
    "vendor/three-LICENSE.txt",
  ].map((p) => "modeling-lab/" + p),
];
await rm(out, { recursive: true, force: true });
for (const file of files) {
  await mkdir(path.dirname(path.join(out, file)), { recursive: true });
  await copyFile(path.join(root, file), path.join(out, file));
}
await copyFile(
  path.join(root, "modeling-lab.html"),
  path.join(out, "index.html"),
);
for (const file of files) {
  const a = await readFile(path.join(root, file)),
    b = await readFile(path.join(out, file));
  if (!a.equals(b)) throw Error("Build mismatch: " + file);
}
console.log(`Verified ${files.length} static assets plus index.html in ${out}`);
