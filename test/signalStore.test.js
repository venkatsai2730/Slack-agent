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
    types: [{ type: 'pricing_intent', confidence: 0.9, evidence: 'e', reasoning: 'r', recommended_action: 'a' }],
    summary: {
      what_happened: 'x',
      why_it_matters: 'y',
      business_impact: 'medium',
      people_involved: 'unknown',
      recommended_next_action: 'follow up',
    },
    message: {
      channel_id: 'C1',
      ts: '123.456',
      permalink: 'https://slack.com/x',
      author_user_id: 'U1',
      author_name: 'Jane',
      text: 'what does enterprise pricing look like?',
    },
    ...overrides,
  });
}

test('createSignal assigns an id, primary_type, and default status', () => {
  const signal = makeSignal();
  assert.ok(signal.signal_id.startsWith('signal_'));
  assert.equal(signal.primary_type, 'pricing_intent');
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

test('assignOwner sets owner and moves status to reviewed', () => {
  const signal = makeSignal();
  const updated = signalStore.assignOwner(signal.signal_id, 'U999');
  assert.equal(updated.owner, 'U999');
  assert.equal(updated.status, 'reviewed');
});

test('markFalsePositive sets status without clobbering an existing owner', () => {
  const signal = makeSignal();
  signalStore.assignOwner(signal.signal_id, 'U999');
  const updated = signalStore.markFalsePositive(signal.signal_id, 'U888');
  assert.equal(updated.status, 'false_positive');
  assert.equal(updated.owner, 'U999'); // kept the original assignee, not the marker
});

test('markCrmLogged records the CRM record id', () => {
  const signal = makeSignal();
  const updated = signalStore.markCrmLogged(signal.signal_id, 'crm_123');
  assert.equal(updated.crm_logged, true);
  assert.equal(updated.crm_record_id, 'crm_123');
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

test('statsSummary counts revenue opportunities and churn risks', () => {
  signalStore.createSignal({
    types: [{ type: 'expansion_opportunity', confidence: 0.8, evidence: 'e', reasoning: 'r', recommended_action: 'a' }],
    summary: { what_happened: '', why_it_matters: '', business_impact: 'high', people_involved: '', recommended_next_action: '' },
    message: { channel_id: 'C2', ts: '1', permalink: '', author_user_id: 'U2', author_name: 'Bob', text: 'we want to expand seats' },
  });
  signalStore.createSignal({
    types: [{ type: 'churn_risk', confidence: 0.7, evidence: 'e', reasoning: 'r', recommended_action: 'a' }],
    summary: { what_happened: '', why_it_matters: '', business_impact: 'high', people_involved: '', recommended_next_action: '' },
    message: { channel_id: 'C2', ts: '2', permalink: '', author_user_id: 'U3', author_name: 'Sam', text: 'thinking of cancelling' },
  });
  const stats = signalStore.statsSummary();
  assert.ok(stats.revenue_opportunities >= 1);
  assert.ok(stats.churn_risks >= 1);
  assert.equal(stats.trend_7d.length, 7);
});
