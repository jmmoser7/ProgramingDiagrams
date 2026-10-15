'use strict';
// node test-preference-queue.js — isolates all queue/preset writes in OS temp.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {once} = require('node:events');
const http = require('node:http');
const {createPreferenceQueue, validateSnapshot, validateRuntimeCandidate, readAccepted, acceptedSource, fingerprint} = require('./interaction-lab/preference-queue.js');
const {createServer} = require('./serve-interaction-lab.js');
const Model = require('./interaction-lab/model.js');
const Catalog = require('./interaction-lab/catalog.js');
const rootDir = __dirname;
const directories = [];
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
const copy = value => JSON.parse(JSON.stringify(value));
function fixture(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'feel-preferences-'));
  directories.push(directory);
  return {rootDir, queueDir: path.join(directory, 'queue'), acceptedFile: path.join(directory, 'accepted-preferences.js'), resolutionsFile: path.join(directory, 'feedback-resolutions.json'), ...options};
}
function payload(caseId = 'selection-click', revision = 1, overrides = {}, workspaceId = 'test-workspace') {
  const study = Catalog.cases.find(item => item.id === caseId), state = Model.fresh();
  state.prototypes[caseId] = overrides;
  return {workspaceId, commits: {[caseId]: {snapshot: Model.preferenceSnapshot(state, study), revision, savedAt: new Date().toISOString()}}};
}
const observation = (id = 'note-one', text = 'The selection feedback should follow the hovered object.', source = 'saved') => ({id, text, verdict: 'Needs tuning', source});
function writeResolutions(options, items, caseId = 'selection-click') {
  fs.writeFileSync(options.resolutionsFile, JSON.stringify({version: 1, entries: items.map(item => ({caseId, feedbackHash: fingerprint(item), summary: 'Implemented the requested interaction behavior.', files: ['interaction-lab/stage.js'], checks: ['Targeted interaction regression passed.'], implementedAt: '2026-10-14T14:00:00.000Z'}))}));
}

test('strict setting and scene validation rejects unsupported data before queueing', async () => {
  const options = fixture({validateCandidate: async () => {}}), queue = createPreferenceQueue(options);
  try {
    const valid = payload(), entry = valid.commits['selection-click'];
    assert.equal(validateSnapshot('selection-click', entry.snapshot).snapshot.settings.hitRadius, Catalog.fields.hitRadius.default);
    assert.throws(() => validateSnapshot('not-a-case', entry.snapshot), /Unknown/);
    assert.throws(() => validateSnapshot('selection-click', {...entry.snapshot, settings: {...entry.snapshot.settings, hitRadius: Infinity}}), /Out-of-range/);
    assert.throws(() => validateSnapshot('selection-click', {...entry.snapshot, settings: {...entry.snapshot.settings, hoverCursor: 'url(https:\/\/bad.test)'}}), /Unsupported/);
    assert.throws(() => validateSnapshot('selection-click', {...entry.snapshot, feedback: 'execute me'}), /Unsupported/);
    const badGeometry = {...entry.snapshot, geometry: [{id:'bad', kind:'box', x:'execute()', y:0, width:100, height:100}]};
    assert.throws(() => validateSnapshot('selection-click', badGeometry), /Invalid scene x/);
    await assert.rejects(queue.enqueue({workspaceId: '../outside', commits: valid.commits}), /workspaceId/);
    const mixed = payload(); mixed.commits['not-a-case'] = copy(entry);
    await assert.rejects(queue.enqueue(mixed), /Unknown/);
    for (const feedback of [{text:'bad'}, [observation('__proto__')], [observation(), observation()], [observation('bad id')], [observation('blank', '  ')], [{...observation(), source:'execute'}]]) {
      const invalid = payload(); invalid.commits['selection-click'].feedback = feedback;
      await assert.rejects(queue.enqueue(invalid), /Feedback|feedback/);
    }
    assert.equal(queue.status(valid.workspaceId).jobs.length, 0, 'whole invalid batches are rejected without partial enqueue');
  } finally { queue.close(); await queue.idle(); }
});

test('immutable jobs deduplicate exact snapshots and distinguish same-revision edits', async () => {
  const entered = deferred(), release = deferred(); let checks = 0;
  const options = fixture({validateCandidate: async () => { if (++checks === 1) { entered.resolve(); await release.promise; } }});
  const queue = createPreferenceQueue(options);
  try {
    const first = payload('selection-click', 1, {hitRadius: 14});
    await queue.enqueue(first); await entered.promise;
    await queue.enqueue(copy(first));
    assert.equal(queue.status(first.workspaceId).jobs.length, 1, 'exact duplicate does not create new work');
    const second = payload('selection-click', 1, {hitRadius: 19});
    await queue.enqueue(second);
    second.commits['selection-click'].snapshot.settings.hitRadius = 23;
    let jobs = queue.status(first.workspaceId).jobs;
    assert.equal(jobs.length, 2);
    assert.notEqual(jobs[0].fingerprint, jobs[1].fingerprint);
    assert.equal(jobs[0].status, 'superseded');
    assert.equal(jobs[1].status, 'queued');
    assert.ok(jobs.every(job => !('snapshot' in job) && !('workspaceId' in job)), 'status does not expose snapshots');
    release.resolve(); await queue.idle();
    jobs = queue.status(first.workspaceId).jobs;
    assert.equal(jobs[1].status, 'applied');
    assert.equal(readAccepted(options.acceptedFile).cases['selection-click'].settings.hitRadius, 19, 'queued snapshot is immutable');
    assert.equal(queue.status('different-workspace').jobs.length, 0);
  } finally { release.resolve(); queue.close(); await queue.idle(); }
});

test('newer commits supersede queued work and stale revisions cannot cancel current work', async () => {
  const entered = deferred(), release = deferred(); let checks = 0;
  const options = fixture({validateCandidate: async () => { if (++checks === 1) { entered.resolve(); await release.promise; } }});
  const queue = createPreferenceQueue(options);
  try {
    await queue.enqueue(payload('gumball-move')); await entered.promise;
    await queue.enqueue(payload('selection-click', 1, {hitRadius: 11}));
    await queue.enqueue(payload('selection-click', 3, {hitRadius: 17}));
    await queue.enqueue(payload('selection-click', 2, {hitRadius: 13}));
    const jobs = queue.status('test-workspace').jobs.filter(job => job.caseId === 'selection-click');
    assert.equal(jobs.find(job => job.revision === 1).status, 'superseded');
    assert.equal(jobs.find(job => job.revision === 2).status, 'superseded');
    assert.equal(jobs.find(job => job.revision === 3).status, 'queued');
    release.resolve(); await queue.idle();
    assert.equal(readAccepted(options.acceptedFile).cases['selection-click'].settings.hitRadius, 17);
    assert.equal(queue.status('test-workspace').jobs.find(job => job.revision === 3).status, 'applied');
    assert.equal(checks, 2, 'superseded queued snapshots are never processed');
  } finally { release.resolve(); queue.close(); await queue.idle(); }
});

test('validation failures stay failed and preserve previously accepted parameters', async () => {
  const options = fixture({validateCandidate: async () => { throw new Error('Scene check intentionally failed.'); }});
  fs.writeFileSync(options.acceptedFile, acceptedSource({version:1,cases:{},updatedAt:null}));
  const before = fs.readFileSync(options.acceptedFile, 'utf8'), queue = createPreferenceQueue(options);
  try {
    await queue.enqueue(payload()); await queue.idle();
    const job = queue.status('test-workspace').jobs[0];
    assert.equal(job.status, 'failed'); assert.match(job.message, /intentionally failed/);
    assert.equal(fs.readFileSync(options.acceptedFile, 'utf8'), before);
    assert.ok(!job.addressedAt);
  } finally { queue.close(); }
});

test('restart recovers interrupted jobs and preserves identity and preference data', async () => {
  const options = fixture({validateCandidate: async () => {}});
  let queue = createPreferenceQueue(options);
  await queue.enqueue(payload('selection-click', 4, {hitRadius: 21})); await queue.idle(); queue.close();
  const saved = JSON.parse(fs.readFileSync(queue.paths.queueFile, 'utf8'));
  saved.jobs[0].status = 'working'; delete saved.jobs[0].addressedAt;
  fs.writeFileSync(queue.paths.queueFile, JSON.stringify(saved)); fs.unlinkSync(options.acceptedFile);
  queue = createPreferenceQueue(options);
  try {
    await queue.idle();
    assert.equal(queue.status('test-workspace').jobs[0].status, 'applied');
    assert.equal(queue.status('test-workspace').jobs[0].id, saved.jobs[0].id);
    assert.equal(readAccepted(options.acceptedFile).cases['selection-click'].settings.hitRadius, 21);
  } finally { queue.close(); }
});

test('corrupt persisted data produces an honest unavailable worker error', async () => {
  const options = fixture(); fs.mkdirSync(options.queueDir, {recursive: true});
  fs.writeFileSync(path.join(options.queueDir, 'queue.json'), '{broken');
  const queue = createPreferenceQueue(options);
  try {
    assert.match(queue.status('test-workspace').worker.error, /could not be restored/);
    await assert.rejects(queue.enqueue(payload()), /could not be restored/);
    assert.equal(fs.readFileSync(path.join(options.queueDir, 'queue.json'), 'utf8'), '{broken', 'broken evidence is not silently overwritten');
  } finally { queue.close(); }
});

test('runtime fixtures render all catalog families and preserve text as inert data', async () => {
  const cases = Object.fromEntries(Catalog.cases.map(study => [study.id, Model.preferenceSnapshot(Model.fresh(), study)]));
  const sample = cases['selection-click'];
  sample.geometry = [{id:'dummy', name:'</script>globalThis.shouldNeverRun=true', group:'dummy', kind:'box', x:0, y:0, width:100, height:80, depth:20, rotation:0, color:'#c7d8e4', locked:false}];
  validateRuntimeCandidate({version:1,cases});
  const options = fixture({validateCandidate: async candidate => validateRuntimeCandidate(candidate)}), queue = createPreferenceQueue(options);
  try {
    const batch = payload(); batch.commits['selection-click'].snapshot = sample;
    await queue.enqueue(batch); await queue.idle();
    assert.equal(queue.status('test-workspace').jobs[0].status, 'applied');
    assert.match(fs.readFileSync(options.acceptedFile, 'utf8'), /\\u003c\/script>/);
    const accepted = require(options.acceptedFile);
    assert.equal(accepted.cases['selection-click'].geometry[0].name, sample.geometry[0].name);
    assert.equal(global.shouldNeverRun, undefined);
  } finally { queue.close(); }
});

test('localhost server exposes asynchronous commits/status and keeps static protections', async () => {
  const entered = deferred(), release = deferred();
  const options = fixture({validateCandidate: async () => { entered.resolve(); await release.promise; }});
  const server = createServer(options); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    let response = await fetch(base + '/'); assert.equal(response.status, 200); assert.match(await response.text(), /Feel/);
    response = await fetch(base + '/.local/interaction-preferences/queue.json'); assert.equal(response.status, 403);
    response = await fetch(base + '/api/preferences/status'); assert.equal(response.status, 400);
    const reboundStatus = await new Promise((resolve, reject) => {
      const request = http.request(base + '/api/preferences/commits', {method:'POST',headers:{'Content-Type':'application/json',Host:'attacker.example'}}, result => { result.resume(); result.on('end', () => resolve(result.statusCode)); });
      request.on('error', reject); request.end(JSON.stringify(payload()));
    });
    assert.equal(reboundStatus, 403, 'DNS-rebinding hosts cannot write preferences');
    response = await fetch(base + '/api/preferences/commits', {method:'POST',headers:{'Content-Type':'application/json',Origin:'https://another-origin.test'},body:JSON.stringify(payload())}); assert.equal(response.status, 403);
    response = await fetch(base + '/api/preferences/commits', {method:'POST',headers:{'Content-Type':'application/json'},body:'{invalid'}); assert.equal(response.status, 400);
    response = await fetch(base + '/api/preferences/commits', {method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'}); assert.equal(response.status, 415);
    response = await fetch(base + '/api/preferences/commits', {method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify(payload())}); assert.equal(response.status, 202);
    await entered.promise;
    response = await fetch(base + '/api/preferences/status?workspaceId=test-workspace'); assert.equal(response.status, 200);
    const working = await response.json(); assert.equal(working.worker.mode, 'local'); assert.equal(working.jobs[0].status, 'working'); assert.ok(!('snapshot' in working.jobs[0]));
    release.resolve(); await server.preferenceQueue.idle();
    response = await fetch(base + '/api/preferences/status?workspaceId=test-workspace'); assert.equal((await response.json()).jobs[0].status, 'applied');
  } finally { release.resolve(); await server.preferenceQueue.idle(); await new Promise(resolve => server.close(resolve)); }
});

test('real worker runs fresh child process scene/model/stage validation before publish', async () => {
  const options = fixture(), queue = createPreferenceQueue(options);
  try {
    await queue.enqueue(payload('selection-click', 1, {hitRadius: 15})); await queue.idle();
    const job = queue.status('test-workspace').jobs[0];
    assert.equal(job.status, 'applied', job.message);
    assert.equal(readAccepted(options.acceptedFile).cases['selection-click'].settings.hitRadius, 15);
  } finally { queue.close(); }
});

test('saved and draft feedback stay pending after settings are applied', async () => {
  const options = fixture({validateCandidate: async () => {}}), queue = createPreferenceQueue(options);
  try {
    const batch = payload('selection-click', 1, {hitRadius: 16});
    const feedback = [observation(), observation('draft-selection-click', '  Do not ignore this draft.  ', 'draft')];
    batch.commits['selection-click'].feedback = feedback;
    await queue.enqueue(batch);
    feedback[0].text = 'Mutation after submission must not change the request.';
    await queue.idle();
    const result = queue.status('test-workspace'), job = result.jobs[0];
    assert.equal(job.status, 'needs-review');
    assert.ok(job.feedback.every(item => item.status === 'pending' && !item.resolution));
    assert.equal(job.feedback[0].text, observation().text);
    assert.equal(job.feedback[1].text, 'Do not ignore this draft.');
    assert.equal(job.feedbackFingerprint, fingerprint(job.feedback.map(({id,text,verdict,source}) => ({id,text,verdict,source}))));
    assert.equal(readAccepted(options.acceptedFile).cases['selection-click'].settings.hitRadius, 16);
    assert.ok(!('feedback' in readAccepted(options.acceptedFile).cases['selection-click']), 'accepted settings stay data-only and separate from written requests');
    assert.deepEqual(result.feedbackResolutions, []);
  } finally { queue.close(); await queue.idle(); }
});

test('changed comments receive distinct identities and cannot reuse another comment receipt', async () => {
  const options = fixture({validateCandidate: async () => {}}), queue = createPreferenceQueue(options);
  try {
    const first = payload(); first.commits['selection-click'].feedback = [observation()];
    await queue.enqueue(first); await queue.idle();
    const second = copy(first); second.commits['selection-click'].feedback[0].text = 'A different requested behavior.';
    await queue.enqueue(second); await queue.idle();
    writeResolutions(options, [observation()]);
    const jobs = queue.status('test-workspace').jobs;
    assert.equal(jobs.length, 2);
    assert.equal(jobs[0].fingerprint, jobs[1].fingerprint, 'parameter snapshots are identical');
    assert.notEqual(jobs[0].feedbackFingerprint, jobs[1].feedbackFingerprint);
    assert.notEqual(jobs[0].id, jobs[1].id);
    assert.equal(jobs[0].status, 'addressed');
    assert.equal(jobs[1].status, 'needs-review');
    assert.equal(jobs[1].feedback[0].status, 'pending');
    const third = copy(second); third.commits['selection-click'].feedback[0].source = 'draft';
    await queue.enqueue(third); await queue.idle();
    assert.equal(queue.status('test-workspace').jobs[2].status, 'needs-review', 'saved and draft identities differ even when text matches');
    const fourth = copy(first); fourth.commits['selection-click'].feedback[0].id = 'different-note';
    await queue.enqueue(fourth); await queue.idle();
    assert.equal(queue.status('test-workspace').jobs[3].status, 'needs-review', 'a receipt cannot resolve another note with identical text');
  } finally { queue.close(); await queue.idle(); }
});

test('exact implementation evidence is refreshed live and never approves failed or unfinished validation', async () => {
  const entered = deferred(), release = deferred();
  const options = fixture({validateCandidate: async () => { entered.resolve(); await release.promise; }}), queue = createPreferenceQueue(options);
  try {
    const notes = [observation(), observation('another-note', 'Use a different hover cursor.', 'draft')];
    const batch = payload(); batch.commits['selection-click'].feedback = notes;
    await queue.enqueue(batch); await entered.promise;
    writeResolutions(options, notes, 'gumball-move');
    assert.ok(queue.status('test-workspace').jobs[0].feedback.every(item => item.status === 'pending'), 'evidence for another prototype does not resolve this request');
    writeResolutions(options, notes);
    let status = queue.status('test-workspace');
    assert.equal(status.feedbackResolutions.length, 2, 'curated receipts are exposed for existing local feedback');
    assert.equal(status.jobs[0].status, 'working');
    assert.ok(status.jobs[0].feedback.every(item => item.status === 'pending'), 'receipt alone cannot bypass settings validation');
    release.resolve(); await queue.idle();
    let job = queue.status('test-workspace').jobs[0];
    assert.equal(job.status, 'addressed'); assert.ok(job.feedback.every(item => item.status === 'addressed' && item.resolution.files.length && item.resolution.checks.length));
    writeResolutions(options, notes.slice(0, 1));
    job = queue.status('test-workspace').jobs[0];
    assert.equal(job.status, 'needs-review', 'missing evidence downgrades completion without a restart');
    assert.equal(job.feedback[1].status, 'pending');
    const invalid = JSON.parse(fs.readFileSync(options.resolutionsFile, 'utf8')); invalid.entries[0].checks = [];
    fs.writeFileSync(options.resolutionsFile, JSON.stringify(invalid));
    status = queue.status('test-workspace'); assert.equal(status.feedbackResolutions.length, 0); assert.match(status.worker.feedbackError, /incomplete/);
    fs.writeFileSync(options.resolutionsFile, '{broken');
    status = queue.status('test-workspace'); assert.equal(status.jobs[0].status, 'needs-review'); assert.match(status.worker.feedbackError, /could not be read/);
  } finally { release.resolve(); queue.close(); await queue.idle(); }

  const failedOptions = fixture({validateCandidate: async () => { throw new Error('Unimplemented behavior check failed.'); }}), failedQueue = createPreferenceQueue(failedOptions);
  try {
    const note = observation(); writeResolutions(failedOptions, [note]);
    const batch = payload(); batch.commits['selection-click'].feedback = [note];
    await failedQueue.enqueue(batch); await failedQueue.idle();
    const job = failedQueue.status('test-workspace').jobs[0];
    assert.equal(job.status, 'failed'); assert.equal(job.feedback[0].status, 'pending'); assert.ok(!job.addressedAt);
  } finally { failedQueue.close(); await failedQueue.idle(); }
});

test('legacy addressed jobs migrate to settings applied without claiming feedback was handled', async () => {
  const options = fixture({validateCandidate: async () => {}});
  let queue = createPreferenceQueue(options);
  await queue.enqueue(payload()); await queue.idle(); queue.close();
  const saved = JSON.parse(fs.readFileSync(queue.paths.queueFile, 'utf8')), legacy = saved.jobs[0];
  legacy.status = 'addressed'; legacy.addressedAt = legacy.appliedAt;
  delete legacy.appliedAt; delete legacy.feedback; delete legacy.feedbackFingerprint;
  legacy.id = fingerprint([legacy.workspaceId, legacy.caseId, legacy.revision, legacy.fingerprint]);
  fs.writeFileSync(queue.paths.queueFile, JSON.stringify(saved));
  queue = createPreferenceQueue(options);
  try {
    await queue.ready;
    const job = queue.status('test-workspace').jobs[0];
    assert.equal(job.status, 'applied'); assert.deepEqual(job.feedback, []); assert.ok(!job.addressedAt); assert.ok(job.appliedAt);
    assert.equal(job.feedbackFingerprint, fingerprint([]));
    assert.notEqual(job.id, legacy.id, 'migration adds feedback identity to the persisted job ID');
  } finally { queue.close(); await queue.idle(); }
});

test('catalog additions migrate authenticated persisted snapshots and preserve exact feedback receipts', async () => {
  for (const legacy of [false,true]) {
    const options=fixture({validateCandidate:async()=>{}}),caseId='tracking-ortho',note=observation('ortho-angle','Use 45 degree intervals.');
    let queue=createPreferenceQueue(options);
    const batch=payload(caseId,3,{ortho:true});batch.commits[caseId].feedback=legacy?[]:[note];
    await queue.enqueue(batch);await queue.idle();queue.close();
    const saved=JSON.parse(fs.readFileSync(queue.paths.queueFile,'utf8')),old=saved.jobs[0];
    delete old.snapshot.settings.orthoAngle;
    old.fingerprint=fingerprint(old.snapshot);
    if(legacy){delete old.feedback;delete old.feedbackFingerprint;old.id=fingerprint([old.workspaceId,caseId,old.revision,old.fingerprint]);}
    else old.id=fingerprint([old.workspaceId,caseId,old.revision,old.fingerprint,old.feedbackFingerprint]);
    const oldId=old.id,appliedAt=old.appliedAt;
    fs.writeFileSync(queue.paths.queueFile,JSON.stringify(saved));
    if(!legacy)writeResolutions(options,[note],caseId);
    queue=createPreferenceQueue(options);
    try {
      await queue.ready;
      const status=queue.status(batch.workspaceId),job=status.jobs[0];
      assert.equal(status.worker.error,null);
      assert.equal(job.status,legacy?'applied':'addressed');
      assert.equal(job.appliedAt,appliedAt);
      assert.notEqual(job.id,oldId);
      const migrated=JSON.parse(fs.readFileSync(queue.paths.queueFile,'utf8')).jobs[0];
      assert.equal(migrated.snapshot.settings.orthoAngle,45);
      assert.equal(migrated.fingerprint,fingerprint(migrated.snapshot));
      assert.equal(migrated.id,fingerprint([migrated.workspaceId,caseId,migrated.revision,migrated.fingerprint,migrated.feedbackFingerprint]));
      await queue.enqueue(batch);
      assert.equal(queue.status(batch.workspaceId).jobs.length,1,'the normalized browser commit deduplicates against the migrated job');
    } finally {queue.close();await queue.idle();}
  }
});

test('catalog migration rejects changed raw snapshots before adding any default', async () => {
  const options=fixture({validateCandidate:async()=>{}}),caseId='tracking-ortho';
  let queue=createPreferenceQueue(options);
  await queue.enqueue(payload(caseId));await queue.idle();queue.close();
  const saved=JSON.parse(fs.readFileSync(queue.paths.queueFile,'utf8')),old=saved.jobs[0];
  delete old.snapshot.settings.orthoAngle;
  old.fingerprint=fingerprint(old.snapshot);
  old.id=fingerprint([old.workspaceId,caseId,old.revision,old.fingerprint,old.feedbackFingerprint]);
  old.snapshot.settings.hitRadius+=1;
  const corrupt=JSON.stringify(saved);fs.writeFileSync(queue.paths.queueFile,corrupt);
  queue=createPreferenceQueue(options);
  try {
    await queue.ready;
    assert.match(queue.status('test-workspace').worker.error,/identity mismatch/);
    assert.equal(queue.status('test-workspace').jobs.length,0);
    assert.equal(fs.readFileSync(queue.paths.queueFile,'utf8'),corrupt,'invalid original evidence cannot be silently migrated');
  } finally {queue.close();await queue.idle();}
});

(async () => {
  let failed = 0;
  try {
    for (const [name, run] of tests) {
      try { await run(); console.log('PASS ' + name); }
      catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
    }
  } finally {
    for (const directory of directories) {
      const resolved = path.resolve(directory);
      if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('feel-preferences-')) throw new Error('Unsafe test cleanup target.');
      fs.rmSync(resolved, {recursive:true,force:true});
    }
  }
  console.log((tests.length - failed) + '/' + tests.length + ' preference queue tests passed.');
  process.exitCode = failed ? 1 : 0;
})();
