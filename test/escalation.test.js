const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'signals.json');
fs.rmSync(DATA_FILE, { force: true });
after(() => {
  fs.rmSync(DATA_FILE, { force: true });
  fs.rmSync(`${DATA_FILE}.tmp`, { force: true });
});

const signalStore = require('../services/signalStore');
const escalation = require('../services/escalation');
const llm = require('../services/llm');

// escalation.js calls llm.complete() to word the AI explanation. Stub it so
// these tests never make a real network call — matching this suite's existing
// convention of only exercising the LLM's error/fallback paths, never the
// network path itself.
const realComplete = llm.complete;
llm.complete = async () => 'stubbed escalation explanation';
after(() => {
  llm.complete = realComplete;
});

const ENV_KEYS = [
  'ESCALATION_ENABLED',
  'ESCALATION_CHECK_MINUTES',
  'ESCALATION_AGE_HOURS_CRITICAL',
  'ESCALATION_AGE_HOURS_HIGH',
  'ESCALATION_AGE_HOURS_ROUTINE',
  'ESCALATION_MAX_REMINDERS',
  'ESCALATION_QUIET_HOURS_START',
  'ESCALATION_QUIET_HOURS_END',
  'COORDINATOR_USER_IDS',
  'COMMUNITY_ALERTS_CHANNEL',
];
const savedEnv = {};
for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
after(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

function makeSignal(type, hoursAgo = 0, overrides = {}) {
  const signal = signalStore.createSignal({
    types: [{ type, confidence: 0.9, evidence: 'e', reasoning: 'r', recommended_action: 'a' }],
    summary: { what_happened: `a ${type}`, why_it_matters: 'y', community_impact: 'high', people_involved: 'unknown', recommended_next_action: 'follow up' },
    message: { channel_id: 'C1', ts: String(Math.random()), permalink: 'https://slack.com/x', author_user_id: 'U1', author_name: 'Jane', text: 't' },
    ...overrides,
  });
  if (hoursAgo > 0) {
    signalStore.updateSignal(signal.signal_id, { created_at: new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString() });
  }
  return signalStore.getSignal(signal.signal_id);
}

test('isQuietHours handles a wrapping window (e.g. 22 -> 7)', () => {
  const cfg = { quietStart: 22, quietEnd: 7 };
  assert.equal(escalation.isQuietHours(new Date(2024, 0, 1, 23), cfg), true);
  assert.equal(escalation.isQuietHours(new Date(2024, 0, 1, 3), cfg), true);
  assert.equal(escalation.isQuietHours(new Date(2024, 0, 1, 12), cfg), false);
});

test('isQuietHours handles a same-day window (e.g. 1 -> 5)', () => {
  const cfg = { quietStart: 1, quietEnd: 5 };
  assert.equal(escalation.isQuietHours(new Date(2024, 0, 1, 3), cfg), true);
  assert.equal(escalation.isQuietHours(new Date(2024, 0, 1, 12), cfg), false);
});

test('ageThresholdHours reads per-tier config with a routine fallback', () => {
  const cfg = { ageHours: { critical: 1, high: 4, routine: 24 } };
  assert.equal(escalation.ageThresholdHours('critical', cfg), 1);
  assert.equal(escalation.ageThresholdHours('high', cfg), 4);
  assert.equal(escalation.ageThresholdHours('unknown_tier', cfg), 24);
});

test('selectEscalationCandidates finds only unresolved signals past their tier threshold', () => {
  // A single medical_need at confidence 0.9 scores 27/100 — 'high' tier (25-54),
  // not 'critical' (55+) — so it needs to clear the default 4h "high" threshold.
  const highTier = makeSignal('medical_need', 5);
  makeSignal('help_request', 0.5); // low priority, recent — should not qualify
  const resolvedOld = makeSignal('housing_need', 30);
  signalStore.resolveSignal(resolvedOld.signal_id, 'manual');

  const cfg = escalation.config();
  const candidates = escalation.selectEscalationCandidates(cfg);
  assert.ok(candidates.some((c) => c.signal.signal_id === highTier.signal_id));
  assert.ok(!candidates.some((c) => c.signal.signal_id === resolvedOld.signal_id), 'resolved signals must be excluded');

  signalStore.resolveSignal(highTier.signal_id, 'manual'); // keep later tests in this file unaffected by this fixture
});

test('selectEscalationCandidates respects the max-reminders cap', () => {
  process.env.ESCALATION_MAX_REMINDERS = '1';
  const signal = makeSignal('medical_need', 5);
  signalStore.markEscalated(signal.signal_id); // reminder_count now 1, at the cap

  const cfg = escalation.config();
  const candidates = escalation.selectEscalationCandidates(cfg);
  assert.ok(!candidates.some((c) => c.signal.signal_id === signal.signal_id));
  signalStore.resolveSignal(signal.signal_id, 'manual'); // keep later tests in this file unaffected by this fixture
});

test('runEscalationSweep is a no-op during quiet hours', async () => {
  process.env.ESCALATION_QUIET_HOURS_START = '0';
  process.env.ESCALATION_QUIET_HOURS_END = '23'; // quiet nearly all day, guaranteed to hit "now"
  const result = await escalation.runEscalationSweep({ client: null });
  assert.equal(result.skipped_quiet_hours, true);
  assert.equal(result.escalated, 0);
});

test('runEscalationSweep DMs coordinators and posts to the alerts channel for a qualifying signal', async () => {
  process.env.ESCALATION_QUIET_HOURS_START = '0';
  process.env.ESCALATION_QUIET_HOURS_END = '0'; // quietStart === quietEnd => never quiet
  process.env.COORDINATOR_USER_IDS = 'UCOORD1,UCOORD2';
  process.env.COMMUNITY_ALERTS_CHANNEL = '#alerts';

  const signal = makeSignal('medical_need', 5);

  const opened = [];
  const posted = [];
  const stubClient = {
    conversations: { open: async ({ users }) => { opened.push(users); return { channel: { id: `dm-${users}` } }; } },
    chat: { postMessage: async ({ channel }) => { posted.push(channel); return {}; } },
  };

  const result = await escalation.runEscalationSweep({ client: stubClient });
  assert.ok(result.escalated >= 1);
  assert.ok(opened.includes('UCOORD1'));
  assert.ok(opened.includes('UCOORD2'));
  assert.ok(posted.includes('#alerts'));
  assert.ok(posted.includes('dm-UCOORD1'));

  const updated = signalStore.getSignal(signal.signal_id);
  assert.equal(updated.escalation.escalated, true);
  assert.equal(updated.escalation.reminder_count, 1);
});

test('runEscalationSweep does not mark signals escalated when no notification destination is configured', async () => {
  process.env.ESCALATION_QUIET_HOURS_START = '0';
  process.env.ESCALATION_QUIET_HOURS_END = '0'; // never quiet
  // Deliberately leave COORDINATOR_USER_IDS and COMMUNITY_ALERTS_CHANNEL unset.
  const signal = makeSignal('medical_need', 5);

  const result = await escalation.runEscalationSweep({ client: { conversations: {}, chat: {} } });
  assert.equal(result.escalated, 0);
  assert.equal(result.skipped_no_destination, true);

  const updated = signalStore.getSignal(signal.signal_id);
  assert.equal(updated.escalation.escalated, false, 'must not burn the reminder budget when nobody was actually notified');
  assert.equal(updated.escalation.reminder_count, 0);
});

test('runEscalationSweep is a no-op when no Slack client is available', async () => {
  process.env.ESCALATION_QUIET_HOURS_START = '0';
  process.env.ESCALATION_QUIET_HOURS_END = '0';
  process.env.COORDINATOR_USER_IDS = 'UCOORD1';
  const result = await escalation.runEscalationSweep({ client: null });
  assert.equal(result.escalated, 0);
  assert.equal(result.skipped_no_destination, true);
});
