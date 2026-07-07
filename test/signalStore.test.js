const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'signals.json');

// signalStore persists to a fixed file (data/signals.json) and loads it at
// require() time — clean the slate here, synchronously, BEFORE requiring the
// module (a before() hook would run too late, after load() already ran).
fs.rmSync(DATA_FILE, { force: true });
after(() => {
  fs.rmSync(DATA_FILE, { force: true });
  fs.rmSync(`${DATA_FILE}.tmp`, { force: true });
});

const signalStore = require('../services/signalStore');

function makeSignal(overrides = {}) {
  return signalStore.createSignal({
    types: [{ type: 'help_request', confidence: 0.9, evidence: 'e', reasoning: 'r', recommended_action: 'a' }],
    summary: {
      what_happened: 'x',
      why_it_matters: 'y',
      community_impact: 'medium',
      people_involved: 'unknown',
      recommended_next_action: 'follow up',
    },
    message: {
      channel_id: 'C1',
      ts: '123.456',
      permalink: 'https://slack.com/x',
      author_user_id: 'U1',
      author_name: 'Jane',
      text: 'can anyone help me move a couch this weekend?',
    },
    ...overrides,
  });
}

test('createSignal assigns an id, primary_type, and default status', () => {
  const signal = makeSignal();
  assert.ok(signal.signal_id.startsWith('signal_'));
  assert.equal(signal.primary_type, 'help_request');
  assert.equal(signal.status, 'new');
  assert.equal(signal.crm_logged, false);
});

test('getSignal retrieves a previously created signal', () => {
  const created = makeSignal();
  const fetched = signalStore.getSignal(created.signal_id);
  assert.equal(fetched.signal_id, created.signal_id);
});

test('getSignal returns null for an unknown id', () => {
  assert.equal(signalStore.getSignal('does_not_exist'), null);
});

test('assignOwner sets the helper and moves status to reviewed (claimed)', () => {
  const signal = makeSignal();
  const updated = signalStore.assignOwner(signal.signal_id, 'U999');
  assert.equal(updated.owner, 'U999');
  assert.equal(updated.status, 'reviewed');
});

test('markFalsePositive sets status without clobbering an existing helper', () => {
  const signal = makeSignal();
  signalStore.assignOwner(signal.signal_id, 'U999');
  const updated = signalStore.markFalsePositive(signal.signal_id, 'U888');
  assert.equal(updated.status, 'false_positive');
  assert.equal(updated.owner, 'U999'); // kept the original helper, not the marker
});

test('markCrmLogged records the case record id', () => {
  const signal = makeSignal();
  const updated = signalStore.markCrmLogged(signal.signal_id, 'case_123');
  assert.equal(updated.crm_logged, true);
  assert.equal(updated.crm_record_id, 'case_123');
});

test('listRecent returns newest signals first, capped at the given limit', () => {
  makeSignal();
  makeSignal();
  makeSignal();
  const recent = signalStore.listRecent(2);
  assert.equal(recent.length, 2);
});

test('listByStatus filters correctly', () => {
  const signal = makeSignal();
  signalStore.markFalsePositive(signal.signal_id, 'U1');
  const falsePositives = signalStore.listByStatus('false_positive');
  assert.ok(falsePositives.some((s) => s.signal_id === signal.signal_id));
});

test('statsSummary counts community needs, offers of help, and urgent needs', () => {
  signalStore.createSignal({
    types: [{ type: 'medical_need', confidence: 0.8, evidence: 'e', reasoning: 'r', recommended_action: 'a' }],
    summary: { what_happened: '', why_it_matters: '', community_impact: 'high', people_involved: '', recommended_next_action: '' },
    message: { channel_id: 'C2', ts: '1', permalink: '', author_user_id: 'U2', author_name: 'Bob', text: 'need a ride to my dialysis appointment' },
  });
  signalStore.createSignal({
    types: [{ type: 'volunteer_offer', confidence: 0.7, evidence: 'e', reasoning: 'r', recommended_action: 'a' }],
    summary: { what_happened: '', why_it_matters: '', community_impact: 'medium', people_involved: '', recommended_next_action: '' },
    message: { channel_id: 'C2', ts: '2', permalink: '', author_user_id: 'U3', author_name: 'Sam', text: 'happy to drive anyone who needs it' },
  });
  const stats = signalStore.statsSummary();
  assert.ok(stats.community_needs >= 1);
  assert.ok(stats.offers_of_help >= 1);
  assert.ok(stats.urgent_needs >= 1); // medical_need counts as urgent
  assert.equal(stats.trend_7d.length, 7);
});
