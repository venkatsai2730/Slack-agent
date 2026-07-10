const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Isolated per-test temp path (never the real data/crm-mock.json) so running
// the suite can never wipe production/demo data.
const DATA_FILE = path.join(os.tmpdir(), `crmMock-test-${process.pid}.json`);
process.env.CRM_MOCK_DATA_FILE = DATA_FILE;
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
  primary_type: 'help_request',
  summary: { what_happened: 'A neighbor asked for help getting groceries this week.' },
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

test('getConstituentContext returns null for an unknown member', async () => {
  const context = await mockCrm.getConstituentContext('Nobody Ever Logged');
  assert.equal(context, null);
});

test('getConstituentContext aggregates prior activity and open follow-ups', async () => {
  const context = await mockCrm.getConstituentContext('Jane Doe');
  assert.ok(context);
  assert.equal(context.total_activities, 1);
  assert.equal(context.open_followups, 1);
  assert.equal(context.recent_activities[0].signal_id, 'signal_test_1');
});
