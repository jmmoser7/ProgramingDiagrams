'use strict';

// Run with Node. Exercise the actual file-opening handlers with the same
// archive bytes under .zip and .pboard names, without touching browser storage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Engine = require('./engine.js');

const copy = value => JSON.parse(JSON.stringify(value));
const buffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
function handler(fileName, start, end) {
  const source = fs.readFileSync(require.resolve('./' + fileName), 'utf8');
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, 'Locate actual ' + fileName + ' import handler');
  return source.slice(from, to);
}

const common = () => ({
  Engine, engine: Engine, TextDecoder, Uint8Array, console,
  errors: [], toast(message) { this.errors.push(message); },
});

function board() {
  const sandbox = common();
  sandbox.dataDashboard = null;
  sandbox.opened = result => { sandbox.result = copy({
    board: Engine.capture(result.model), view: result.view, camera: result.camera,
  }); };
  sandbox.toast = message => sandbox.errors.push(message);
  vm.runInNewContext(handler('app.js', '  function fileKind(file)', '  function opened(res, label)'), sandbox);
  return { sandbox, open: file => sandbox.loadFiles([file]), result: () => sandbox.result };
}

function pack() {
  const sandbox = common();
  Object.assign(sandbox, {
    dataDashboard: null, persist() {}, syncChrome() {}, requestDraw() {},
    applySaved(saved) { sandbox.result = copy(saved); },
    openCsv() { throw Error('An archive must not be parsed as CSV'); },
  });
  sandbox.toast = message => sandbox.errors.push(message);
  vm.runInNewContext(handler('pack.js', '  async function openFile(file)', '  function openCsvAwait(next)'), sandbox);
  return { sandbox, open: sandbox.openFile, result: () => sandbox.result };
}

function iso() {
  const sandbox = common();
  Object.assign(sandbox, {
    fileBusy: false, dataDashboard: null, flushEdits: async () => true,
    snapshot: () => null, remember() {}, changed() {}, fit() {}, sync() {}, requestDraw() {},
    shared: {}, view: {}, selected: new Set(), lastHits: [],
    validCamera: () => true, DIRECTIONS: ['NW', 'NE', 'SE', 'SW'], ANGLES: [0, 1, 2, 3],
    $: () => ({ value: '' }),
  });
  sandbox.live = () => Engine.alive(sandbox.model);
  sandbox.toast = message => sandbox.errors.push(message);
  vm.runInNewContext(handler('iso.js', '  async function openFile(file)', '  async function save()'), sandbox);
  return { sandbox, open: sandbox.openFile, result: () => copy({
    board: Engine.capture(sandbox.model), view: sandbox.view, camera: sandbox.shared.camera,
  }) };
}

function file(name, bytes) {
  return {
    name,
    arrayBuffer: async () => buffer(bytes),
    text: async () => { throw Error('ZIP-backed projects must be read as binary'); },
  };
}

async function main() {
  const model = Engine.modelFromCsv('Space,Area,Group\nOffice,120,A\nMeeting,60,B\nFuture,0,A\n', 'portable.csv');
  Engine.pack(model);
  Object.assign(model.stickies[0], { color: '#c7ddce', z: 12, height: 9, material: 'jelly' });
  assert.equal(Engine.baseName('Demo.PBOARD'), 'Demo', 'Project extension is stripped case-insensitively');
  const view = {
    background: '#faf9f6', grid: true, gridStep: 10, leaderThreshold: 120,
    pack: { aspect: 1.5, algorithm: 'dice' },
    isoCamera: { x: 2, y: 3, z: 4, scale: 2, direction: 'NW' },
  };
  const camera = { x: 10, y: 20, z: 2 };
  const archive = await Engine.buildSave(model, view, camera, { store: true });
  const expected = Engine.openSave(await Engine.readSaveZip(buffer(archive.bytes)));
  const expectedState = copy({ board: Engine.capture(expected.model), view: expected.view, camera: expected.camera });

  for (const [label, create] of [['Board', board], ['Pack', pack], ['Isometric', iso]]) {
    let baseline;
    for (const extension of ['zip', 'pboard', 'PBOARD']) {
      const test = create();
      await test.open(file('portable.' + extension, archive.bytes));
      assert.equal(test.sandbox.errors.filter(message => /could not|must|not a program/i.test(message)).length, 0, label + ' opens ' + extension);
      const result = test.result();
      assert(result, label + ' imported ' + extension);
      assert.deepEqual(result, expectedState, label + ' preserves data, dormant rows, geometry, style, and view');
      assert.equal(result.board.stickies[0].color, '#c7ddce', label + ' retains the restored sticky color');
      if (baseline) assert.deepEqual(result, baseline, label + ' .pboard and .zip are identical');
      baseline = result;
    }
  }

  // Pack also opens its earlier dedicated archive format through either name.
  const legacy = { kind: 'pack-board', csv: 'Space,Area\nOne,30\n', fileName: 'legacy.csv', aspect: 2, order: [0] };
  const legacyBytes = await Engine.zip([{ name: 'legacy.pack.json', data: JSON.stringify(legacy) }], { store: true });
  for (const extension of ['zip', 'pboard']) {
    const test = pack();
    await test.open(file('legacy.' + extension, legacyBytes));
    assert.deepEqual(test.result(), legacy, 'Pack legacy archive stays compatible as .' + extension);
  }

  for (const fileName of ['index.html', 'pack.html', 'iso.html']) {
    const html = fs.readFileSync(require.resolve('./' + fileName), 'utf8');
    const input = html.match(/<input\b[^>]*\bid="file"[^>]*>/);
    assert(input, fileName + ' has a file picker');
    const accepted = input[0].match(/\baccept="([^"]+)"/)[1].split(',');
    assert(accepted.includes('.pboard') && accepted.includes('.zip'), fileName + ' picker allows both project formats');
  }
  console.log('Board, Pack, and Isometric .pboard/.zip import parity passed; uppercase extension, legacy Pack archives, and file pickers passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
