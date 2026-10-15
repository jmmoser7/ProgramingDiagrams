'use strict';

// Builds the published copy: dist/ and program-board-netlify.zip, with
// index.html at the zip root so a Netlify drag-and-drop deploy serves it
// at /. The published page carries no program data: its seed is emptied,
// so it opens on an empty board and visitors drop their own spreadsheet.
// Plain node, no npm. Run: node build-netlify.js

const fs = require('fs');
const path = require('path');
const engine = require('./engine.js');

const HERE = __dirname;
const DIST = path.join(HERE, 'dist');
const ZIP = path.join(HERE, 'program-board-netlify.zip');

const RUNTIME = [
  'LICENSE',
  'drag-feel.html',
  'drag-feel/style.css',
  'drag-feel/physics.js',
  'drag-feel/grip.js',
  'drag-feel/app.js',
  'interaction-lab.html',
  'interaction-lab/app.js',
  'interaction-lab/catalog.js',
  'interaction-lab/accepted-preferences.js',
  'interaction-lab/feedback-resolutions.json',
  'interaction-lab/model.js',
  'interaction-lab/tracking-guides.js',
  'interaction-lab/direction-constraint.js',
  'interaction-lab/scene-precision.js',
  'interaction-lab/stage.js',
  'interaction-lab/style.css',
  'docs/interaction-language/README.md',
  'docs/interaction-language/coverage.md',
  'docs/research/rhino-selection-gumball.md',
  'docs/research/atlas-and-precision.md',
  'index.html',
  'app.js',
  'board-data-ui.js',
  'board-data-ui.css',
  'board-bookmarks.js',
  'board-group-bundle.js',
  'board-transition.js',
  'blob.js',
  'engine.js',
  'appearance.js',
  'leaders.js',
  'mode-state.js',
  'program-seed.js',
  'chrome.css',
  'chrome.js',
  'cad.js',
  'pack.html',
  'pack.js',
  'pack-engine.js',
  'display-mode.js',
  'iso.html',
  'iso.js',
  'iso-geometry.js',
  'iso-physics.js',
  'iso-renderer.js',
  'iso-ui.js',
  'vendor/rhino3dm.min.js',
  'vendor/rhino3dm.wasm.js',
  'vendor/rhino3dm-LICENSE.txt',
];

// app.js, blob.js, engine.js, and cad.js keep their names across deploys,
// so they revalidate like the page (Netlify answers 304 from its ETag);
// only the vendored rhino3dm build, which changes rarely, is cached for a
// week.
const HEADERS = [
  '/*',
  '  X-Content-Type-Options: nosniff',
  '',
  ...['/', ...RUNTIME.filter(p => !p.startsWith('vendor/')).map(p => '/' + p)].flatMap((p) => [p, '  Cache-Control: public, max-age=0, must-revalidate', '']),
  '/vendor/*',
  '  Cache-Control: public, max-age=604800',
  '',
].join('\n');

// Strings that only the client's program contains. Any hit fails the build.
const LEAKS = ['Guggenheim', 'Grad Assistants', 'NARA', 'AE_Program', 'AE Program', '_tidy'];

function fail(message) {
  console.error('build-netlify: ' + message);
  process.exit(1);
}

function blankSeed(html) {
  const seed = /<script id="seed"[^>]*>[\s\S]*?<\/script>/;
  if (!seed.test(html)) fail('index.html has no <script id="seed">');
  return html.replace(seed, '<script id="seed" type="text/plain"></script>');
}

function blankPack(html) {
  if (!html.includes('<body>')) fail('pack.html has no plain body tag');
  return html.replace('<body>', '<body data-sample="off">')
    .replace('<button id="src-sample"', '<button hidden id="src-sample"');
}

// The fixed list, plus every phrase of eight or more characters from the
// local sample (room names, departments, comments) when it is present.
function leakNeedles() {
  const needles = new Set(LEAKS);
  const sample = path.join(HERE, 'sample.csv');
  if (fs.existsSync(sample)) {
    engine.parseCsv(fs.readFileSync(sample, 'utf8')).slice(1).forEach((row) => {
      row.forEach((cell) => {
        const text = String(cell || '').trim();
        if (text.length >= 8 && !/^[\d.,\s]+$/.test(text)) needles.add(text);
      });
    });
  }
  return Array.from(needles);
}

function leakCheck(files) {
  const needles = leakNeedles();
  const hits = [];
  files.forEach((rel) => {
    const text = fs.readFileSync(path.join(DIST, rel), 'latin1');
    needles.forEach((needle) => {
      const at = text.indexOf(needle);
      if (at >= 0) hits.push(rel + ': "' + needle + '" at ' + at);
    });
  });
  return { needles: needles.length, hits: hits };
}

async function main() {
  // Never recursively remove an output directory redirected outside this project.
  if (path.resolve(DIST) !== path.join(fs.realpathSync(HERE), 'dist') ||
      (fs.existsSync(DIST) && fs.lstatSync(DIST).isSymbolicLink())) fail('unsafe dist path');
  fs.rmSync(DIST, { recursive: true, force: true });
  RUNTIME.forEach((rel) => {
    const from = path.join(HERE, rel);
    if (!fs.existsSync(from)) fail('missing runtime file ' + rel);
    const to = path.join(DIST, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (rel === 'index.html') fs.writeFileSync(to, blankSeed(fs.readFileSync(from, 'utf8')));
    else if (rel === 'pack.html') fs.writeFileSync(to, blankPack(fs.readFileSync(from, 'utf8')));
    else if (rel === 'program-seed.js') fs.writeFileSync(to, "'use strict'; window.ProgramBoardSeed = window.ProgramSeed = { name: '', csv: '' };\n");
    else fs.copyFileSync(from, to);
  });
  fs.writeFileSync(path.join(DIST, '_headers'), HEADERS);
  const files = RUNTIME.concat(['_headers']);

  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const seed = /<script id="seed"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!seed || seed[1].trim()) fail('the published seed is not empty');
  const packHtml = fs.readFileSync(path.join(DIST, 'pack.html'), 'utf8');
  if (!packHtml.includes('data-sample="off"')) fail('published Pack must not load the local sample');
  const leaks = leakCheck(files);
  if (leaks.hits.length) fail('client data found in dist/:\n  ' + leaks.hits.join('\n  '));

  const entries = files.map((rel) => ({ name: rel, data: new Uint8Array(fs.readFileSync(path.join(DIST, rel))) }));
  const bytes = await engine.zip(entries);
  fs.writeFileSync(ZIP, bytes);

  // Read it back with the board's own reader: every entry, byte for byte.
  const back = await engine.unzip(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'a zip');
  entries.forEach((e) => {
    const got = back[e.name];
    if (!got || Buffer.compare(Buffer.from(got), Buffer.from(e.data)) !== 0) fail('zip read-back differs for ' + e.name);
  });
  if (Object.keys(back).length !== entries.length) fail('zip holds unexpected entries');

  console.log(JSON.stringify({
    dist: DIST,
    zip: ZIP,
    zipBytes: bytes.length,
    entries: entries.map((e) => ({ name: e.name, bytes: e.data.length })),
    leakCheck: { needles: leaks.needles, files: files.length, hits: 0 },
  }, null, 2));
}

main().catch((err) => fail(err && err.stack ? err.stack : String(err)));
