'use strict';
// Read-only handoff for the scheduled feedback review. Never starts the queue.
const fs = require('node:fs');
const path = require('node:path');
const {validateSnapshot, validateFeedback, readFeedbackResolutions, fingerprint} = require('./preference-queue.js');
const statuses = new Set(['queued', 'working', 'applied', 'needs-review', 'addressed', 'failed', 'superseded']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);

function validateQueue(data) {
  if (!object(data) || data.version !== 1 || !Array.isArray(data.jobs) || data.jobs.length > 20000) throw new Error('Expected preference queue version 1 and a jobs array (at most 20000 jobs).');
  return data.jobs.map((job, index) => {
    try {
      if (!object(job) || !safeId(job.workspaceId)) throw new Error('Invalid workspaceId.');
      if (!statuses.has(job.status)) throw new Error('Invalid job status.');
      const feedback = validateFeedback(job.feedback);
      const persistedHash = fingerprint(job.snapshot), feedbackHash = fingerprint(feedback);
      const persistedId = fingerprint([job.workspaceId, job.caseId, job.revision, persistedHash, feedbackHash]);
      const legacy = job.feedback === undefined && job.feedbackFingerprint === undefined && job.id === fingerprint([job.workspaceId, job.caseId, job.revision, persistedHash]);
      // The inbox stays read-only, but reports the same normalized identity the
      // worker will use after authenticating an older catalog snapshot.
      if ((!legacy && (job.id !== persistedId || job.feedbackFingerprint !== feedbackHash)) || job.fingerprint !== persistedHash) throw new Error('Persisted job identity mismatch.');
      const clean = validateSnapshot(job.caseId, job.snapshot, job.revision, job.commitSavedAt);
      const snapshotHash = fingerprint(clean.snapshot), id = fingerprint([job.workspaceId, job.caseId, clean.revision, snapshotHash, feedbackHash]);
      return {...job, id, fingerprint: snapshotHash, feedbackFingerprint: feedbackHash, feedback, snapshot: clean.snapshot};
    } catch (error) { throw new Error('Preference queue job ' + index + ': ' + error.message); }
  });
}

function parameterState(status) {
  if (['applied', 'needs-review', 'addressed'].includes(status)) return 'passed';
  if (status === 'failed') return 'failed';
  return 'pending';
}

function summarizeFeedbackInbox(data, resolutionResult = {entries: [], error: null}) {
  const jobs = validateQueue(data);
  if (!object(resolutionResult) || !Array.isArray(resolutionResult.entries)) throw new Error('Invalid feedback resolution result.');
  const latest = new Map();
  for (const job of jobs) {
    if (job.status === 'superseded') continue;
    const key = JSON.stringify([job.workspaceId, job.caseId]), previous = latest.get(key);
    // Revisions are authoritative; the last equal revision is a later tweak.
    if (!previous || job.revision >= previous.revision) latest.set(key, job);
  }
  const receipts = new Set(resolutionResult.entries.map(item => JSON.stringify([item.caseId, item.feedbackHash])));
  const grouped = new Map(), prototypes = [];
  let resolvedObservations = 0, pendingObservations = 0;
  const parameterValidation = {passed: 0, pending: 0, failed: 0};
  for (const job of latest.values()) {
    const validation = parameterState(job.status);
    parameterValidation[validation]++;
    const reference = {workspaceId: job.workspaceId, caseId: job.caseId, revision: job.revision, commitSavedAt: job.commitSavedAt, jobId: job.id, snapshotHash: job.fingerprint, parameterValidation: validation, jobStatus: job.status};
    prototypes.push({...reference, message: typeof job.message === 'string' ? job.message : ''});
    for (const feedback of job.feedback) {
      const hash = fingerprint(feedback);
      if (receipts.has(JSON.stringify([job.caseId, hash]))) { resolvedObservations++; continue; }
      pendingObservations++;
      let group = grouped.get(hash);
      if (!group) {
        group = {feedbackHash: hash, observation: feedback, cases: []};
        grouped.set(hash, group);
      }
      group.cases.push({...reference, feedbackHash: hash});
    }
  }
  return {
    version: 1,
    counts: {jobs: jobs.length, latestPrototypes: latest.size, supersededJobs: jobs.filter(job => job.status === 'superseded').length, staleJobs: jobs.filter(job => job.status !== 'superseded').length - latest.size, pendingObservations, pendingGroups: grouped.size, resolvedObservations},
    parameterValidation,
    warnings: resolutionResult.error ? [resolutionResult.error] : [],
    pendingGroups: [...grouped.values()],
    prototypes
  };
}

function readFeedbackInbox(options = {}) {
  const rootDir = path.resolve(options.rootDir || path.join(__dirname, '..'));
  const queueFile = path.resolve(options.queueFile || path.join(rootDir, '.local', 'interaction-preferences', 'queue.json'));
  const resolutionsFile = path.resolve(options.resolutionsFile || path.join(rootDir, 'interaction-lab', 'feedback-resolutions.json'));
  let data;
  try { data = JSON.parse(fs.readFileSync(queueFile, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') data = {version: 1, jobs: []};
    else throw new Error('Cannot read feedback inbox at ' + queueFile + ': ' + error.message);
  }
  const result = summarizeFeedbackInbox(data, readFeedbackResolutions(resolutionsFile));
  return {queueFile, resolutionsFile, ...result};
}

function main(args) {
  const options = {}, flags = {'--root': 'rootDir', '--queue': 'queueFile', '--resolutions': 'resolutionsFile'};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--help') {
      process.stdout.write('Usage: node interaction-lab/feedback-inbox.js [--root PATH] [--queue PATH] [--resolutions PATH]\nRead-only JSON report of committed feedback still awaiting exact implementation receipts.\n');
      return;
    }
    if (!flags[flag] || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Unknown option or missing path: ' + flag + '. Use --help.');
    options[flags[flag]] = args[++index];
  }
  process.stdout.write(JSON.stringify(readFeedbackInbox(options), null, 2) + '\n');
}

module.exports = {summarizeFeedbackInbox, readFeedbackInbox};
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { process.stderr.write('Feedback inbox error: ' + error.message + '\n'); process.exitCode = 1; }
}
