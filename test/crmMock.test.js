const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'crm-mock.json');

// mockProvider persists to a fixed file (data/crm-mock.json) and loads it at
// require() time — clean the slate synchronously before requiring the module.
fs.rmSync(DATA_FILE, { force: true });
after(() => {
  fs.rmSync(DATA_FILE, { force: true });
  fs.rmSync(`${DATA_FILE}.tmp`, { force: true });
});

const mockCrm = require('../services/crm/mockProvider');

// mockProvider only reads these fields — a partial fixture is intentional here.
/** @type {import('../services/signalStore').Signal} */
const sampleSignal = /** @type {any} */ ({
  signal_id: 'signal_test_1',
  primary_type: 'pricing_intent',
  summary: { what_happened: 'Customer asked about enterprise pricing.' },
  message: { author_name: 'Jane Doe', author_user_id: 'U1' },
});

test('logSignal records an activity and returns a recordId', async () => {
  const { recordId } = await mockCrm.logSignal(sampleSignal);
  assert.ok(recordId.startsWith('mockcrm_activity_'));
});

test('createFollowup records a followup tied to the signal', async () => {
  const { followupId } = await mockCrm.createFollowup(sampleSignal, 'U999');
  assert.ok(followupId.startsWith('mockcrm_followup_'));
});

test('getCustomerContext returns null for an unknown customer', async () => {
  const context = await mockCrm.getCustomerContext('Nobody Ever Logged');
  assert.equal(context, null);
});

test('getCustomerContext aggregates prior activity and open follow-ups', async () => {
  const context = await mockCrm.getCustomerContext('Jane Doe');
  assert.ok(context);
  assert.equal(context.total_activities, 1);
  assert.equal(context.open_followups, 1);
  assert.equal(context.recent_activities[0].signal_id, 'signal_test_1');
});
