'use strict';
// node test-feedback-inbox.js — all file fixtures stay in an OS temp directory.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const {summarizeFeedbackInbox, readFeedbackInbox} = require('./interaction-lab/feedback-inbox.js');
const {fingerprint} = require('./interaction-lab/preference-queue.js');
const Model = require('./interaction-lab/model.js');
const Catalog = require('./interaction-lab/catalog.js');
const tests = [];
const test = (name, run) => tests.push([name, run]);
const observation = (id = 'batch-note', text = 'Select sub-objects across several geometries.') => ({id, text, verdict: 'Needs tuning', source: 'saved'});
function job(caseId = 'selection-click', revision = 1, feedback = [observation()], extra = {}) {
  const study = Catalog.cases.find(item => item.id === caseId);
  const snapshot = Model.preferenceSnapshot(Model.fresh(), study), workspaceId = extra.workspaceId || 'inbox-test';
  const hash = fingerprint(snapshot), feedbackHash = fingerprint(feedback);
  return {workspaceId, caseId, revision, snapshot, feedback, fingerprint: hash, feedbackFingerprint: feedbackHash, id: fingerprint([workspaceId, caseId, revision, hash, feedbackHash]), commitSavedAt: '2026-10-14T17:00:00.000Z', status: 'applied', ...extra};
}
const queue = (...jobs) => ({version: 1, jobs});

test('shared batch observations group across cases and preserve exact references', () => {
  const report = summarizeFeedbackInbox(queue(job(), job('selection-window')));
  assert.equal(report.counts.pendingGroups, 1);
  assert.equal(report.counts.pendingObservations, 2);
  assert.deepEqual(report.parameterValidation, {passed: 2, pending: 0, failed: 0});
  assert.deepEqual(report.pendingGroups[0].cases.map(item => item.caseId), ['selection-click', 'selection-window']);
  assert.ok(report.pendingGroups[0].cases.every(item => item.feedbackHash === fingerprint(observation()) && item.revision === 1 && item.jobId.length === 64));
});

test('distinct observation IDs do not merge even when text matches', () => {
  const report = summarizeFeedbackInbox(queue(job('selection-click', 1, [observation('first'), observation('second')])));
  assert.equal(report.counts.pendingGroups, 2);
});

test('only highest latest non-superseded revision is actionable', () => {
  const report = summarizeFeedbackInbox(queue(job('selection-click', 1, [observation('old')]), job('selection-click', 4, [observation('latest')]), job('selection-click', 2, [observation('stale')]), job('selection-click', 5, [observation('superseded')], {status: 'superseded'})));
  assert.equal(report.counts.latestPrototypes, 1);
  assert.equal(report.counts.staleJobs, 2);
  assert.equal(report.counts.supersededJobs, 1);
  assert.equal(report.pendingGroups[0].observation.id, 'latest');
  const equalRevision = summarizeFeedbackInbox(queue(job('selection-click', 4, [observation('before')]), job('selection-click', 4, [observation('after')])));
  assert.equal(equalRevision.pendingGroups[0].observation.id, 'after');
});

test('receipts match exact case and full canonical observation, independent of status labels', () => {
  const feedback = observation(), hash = fingerprint(feedback);
  const report = summarizeFeedbackInbox(queue(job(), job('selection-window'), job('selection-crossing', 1, [observation('changed', 'Changed request.')], {status: 'addressed'})), {entries: [{caseId: 'selection-click', feedbackHash: hash}, {caseId: 'selection-crossing', feedbackHash: hash}], error: null});
  assert.equal(report.counts.resolvedObservations, 1);
  assert.equal(report.counts.pendingObservations, 2);
  assert.ok(report.pendingGroups.some(group => group.observation.id === 'changed'));
});

test('parameter states remain separate from pending comments and receipt warnings are visible', () => {
  const report = summarizeFeedbackInbox(queue(job('selection-click', 1, [observation()], {status: 'queued'}), job('selection-window', 1, [observation()], {status: 'failed'})), {entries: [], error: 'Receipt evidence was incomplete.'});
  assert.deepEqual(report.parameterValidation, {passed: 0, pending: 1, failed: 1});
  assert.equal(report.counts.pendingObservations, 2);
  assert.deepEqual(report.warnings, ['Receipt evidence was incomplete.']);
});

test('malformed queue structure or job identity fails explicitly', () => {
  for (const invalid of [{version: 2, jobs: []}, {version: 1}, queue({...job(), feedbackFingerprint: 'changed'}), queue({...job(), workspaceId: '../escape'}), queue({...job(), status: 'fiction'})]) assert.throws(() => summarizeFeedbackInbox(invalid), /queue|workspace|status|identity/i);
});

test('older authenticated catalog snapshots normalize without losing receipts or changing source data', () => {
  const old=job('tracking-ortho'),note=old.feedback[0];
  delete old.snapshot.settings.orthoAngle;
  old.fingerprint=fingerprint(old.snapshot);
  old.id=fingerprint([old.workspaceId,old.caseId,old.revision,old.fingerprint,old.feedbackFingerprint]);
  const source=queue(old),before=JSON.stringify(source),normalized=job('tracking-ortho');
  const report=summarizeFeedbackInbox(source,{entries:[{caseId:old.caseId,feedbackHash:fingerprint(note)}],error:null});
  assert.equal(report.counts.resolvedObservations,1);
  assert.equal(report.counts.pendingObservations,0);
  assert.equal(report.prototypes[0].snapshotHash,normalized.fingerprint);
  assert.equal(report.prototypes[0].jobId,normalized.id);
  assert.equal(JSON.stringify(source),before,'read-only migration does not alter the durable inbox');
  const legacy=JSON.parse(JSON.stringify(old));delete legacy.feedback;delete legacy.feedbackFingerprint;
  legacy.id=fingerprint([legacy.workspaceId,legacy.caseId,legacy.revision,legacy.fingerprint]);
  assert.equal(summarizeFeedbackInbox(queue(legacy)).prototypes[0].snapshotHash,normalized.fingerprint);
  const changed=JSON.parse(before);changed.jobs[0].snapshot.settings.hitRadius+=1;
  assert.throws(()=>summarizeFeedbackInbox(changed),/identity mismatch/);
  const wrongId=JSON.parse(before);wrongId.jobs[0].id=normalized.id;
  assert.throws(()=>summarizeFeedbackInbox(wrongId),/identity mismatch/,'a new identity cannot authenticate an older raw snapshot');
});

test('reader and CLI are read-only; missing queue is empty and corruption exits nonzero', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'feel-feedback-inbox-'));
  try {
    const queueFile = path.join(directory, 'queue.json'), resolutionsFile = path.join(directory, 'receipts.json');
    assert.equal(readFeedbackInbox({queueFile, resolutionsFile}).counts.jobs, 0);
    assert.equal(fs.existsSync(queueFile), false, 'missing input stays missing');
    const item = observation();
    const source = JSON.stringify(queue(job()));
    fs.writeFileSync(queueFile, source);
    fs.writeFileSync(resolutionsFile, JSON.stringify({version: 1, entries: [{caseId: 'selection-click', feedbackHash: fingerprint(item), summary: 'Implemented requested behavior.', files: ['interaction-lab/stage.js'], checks: ['Targeted checks pass.'], implementedAt: '2026-10-14T18:00:00.000Z'}]}));
    const receiptSource = fs.readFileSync(resolutionsFile, 'utf8');
    const command = ['interaction-lab/feedback-inbox.js', '--queue', queueFile, '--resolutions', resolutionsFile];
    const result = spawnSync(process.execPath, command, {cwd: __dirname, encoding: 'utf8', windowsHide: true});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).counts.resolvedObservations, 1);
    assert.equal(fs.readFileSync(queueFile, 'utf8'), source);
    assert.equal(fs.readFileSync(resolutionsFile, 'utf8'), receiptSource);
    fs.writeFileSync(queueFile, '{broken');
    const broken = spawnSync(process.execPath, command, {cwd: __dirname, encoding: 'utf8', windowsHide: true});
    assert.equal(broken.status, 1);
    assert.match(broken.stderr, /Feedback inbox error: Cannot read feedback inbox/);
    assert.equal(broken.stdout, '', 'corruption must not look like an empty inbox');
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()), 'cleanup stays inside the explicit OS temporary directory');
    assert.ok(path.basename(directory).startsWith('feel-feedback-inbox-'));
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

let failures = 0;
for (const [name, run] of tests) {
  try { run(); process.stdout.write('PASS ' + name + '\n'); }
  catch (error) { failures++; process.stderr.write('FAIL ' + name + '\n' + error.stack + '\n'); }
}
process.stdout.write((tests.length - failures) + '/' + tests.length + ' feedback inbox checks passed.\n');
if (failures) process.exitCode = 1;
