const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// scan.js's full pipeline persists through signalStore.js/crm's mock provider,
// both file-backed — point them at isolated per-test temp paths (never the
// real data/*.json) so this suite can never touch production/demo data.
const SIGNALS_FILE = path.join(os.tmpdir(), `scan-signals-test-${process.pid}.json`);
const CRM_FILE = path.join(os.tmpdir(), `scan-crm-test-${process.pid}.json`);
process.env.SIGNALS_DATA_FILE = SIGNALS_FILE;
process.env.CRM_MOCK_DATA_FILE = CRM_FILE;
fs.rmSync(SIGNALS_FILE, { force: true });
fs.rmSync(CRM_FILE, { force: true });
after(() => {
  for (const f of [SIGNALS_FILE, `${SIGNALS_FILE}.tmp`, CRM_FILE, `${CRM_FILE}.tmp`]) fs.rmSync(f, { force: true });
});

const scan = require('../services/scan');
const { parseHoursBack } = scan;
const intentEngine = require('../services/intentEngine');
const summaryService = require('../services/summaryService');
const signalStore = require('../services/signalStore');

test('parseHoursBack defaults to 24 when no value given', () => {
  assert.equal(parseHoursBack(undefined), 24);
  assert.equal(parseHoursBack(''), 24);
});

test('parseHoursBack defaults on non-numeric input', () => {
  assert.equal(parseHoursBack('abc'), 24);
});

test('parseHoursBack parses a valid numeric string', () => {
  assert.equal(parseHoursBack('48'), 48);
});

test('parseHoursBack clamps to the max lookback window', () => {
  assert.equal(parseHoursBack('9999'), 168);
});

test('parseHoursBack respects custom defaultHours/maxHours', () => {
  assert.equal(parseHoursBack(undefined, { defaultHours: 12, maxHours: 48 }), 12);
  assert.equal(parseHoursBack('100', { defaultHours: 12, maxHours: 48 }), 48);
});

test('processMessageForSignals rate-limits keyword-hinted messages, not every message', async () => {
  const keywordChannel = `C_RATE_KEY_${Date.now()}`;
  const realDetect = intentEngine.detectSignals;
  // Stub out the LLM call entirely — this test is only exercising the rate-limit
  // gate (services/scan.js's `wouldReachLlm` check), not signal detection itself.
  intentEngine.detectSignals = async () => [];
  try {
    for (let i = 0; i < 20; i += 1) {
      await scan.processMessageForSignals({ channelId: keywordChannel, ts: `k${i}`, text: 'need urgent help with groceries', post: async () => {} });
    }
    // The 21st keyword-hinted message in the same minute should be past the default budget (20/min).
    assert.equal(scan._rateLimiter.allow(keywordChannel), false);
  } finally {
    intentEngine.detectSignals = realDetect;
  }
});

test('processMessageForSignals never consumes the rate-limit budget for non-keyword-hinted messages', async () => {
  const chattyChannel = `C_RATE_NOKEY_${Date.now()}`;
  for (let i = 0; i < 30; i += 1) {
    await scan.processMessageForSignals({ channelId: chattyChannel, ts: `n${i}`, text: 'lol nice one 😂', post: async () => {} });
  }
  // 30 non-keyword messages (well over the default 20/min budget) must not have
  // touched this channel's bucket at all — first-ever probe should still be allowed.
  assert.equal(scan._rateLimiter.allow(chattyChannel), true);
});

test('processMessageForSignals never creates a duplicate signal for a message already signaled', async () => {
  // Real-time monitoring and /cb-scan's lookback window both cover the same
  // messages — reprocessing one that was already signaled (by either path)
  // must be a no-op, not a fresh duplicate signal_id.
  const channelId = `C_DEDUP_${Date.now()}`;
  const realDetect = intentEngine.detectSignals;
  const realSummarize = summaryService.summarizeConversation;
  intentEngine.detectSignals = async () => [{ type: 'help_request', confidence: 0.9, evidence: 'e', reasoning: 'r', recommended_action: 'a' }];
  summaryService.summarizeConversation = async () => ({
    what_happened: 'needs help',
    why_it_matters: 'y',
    community_impact: 'medium',
    people_involved: 'unknown',
    recommended_next_action: 'follow up',
  });

  try {
    const first = await scan.processMessageForSignals({ channelId, ts: 'dedup-1', text: 'I need help with groceries', post: async () => {} });
    assert.ok(first, 'first pass over a new message must create a signal');
    assert.equal(signalStore.getSignalsByChannel(channelId).length, 1);

    const second = await scan.processMessageForSignals({ channelId, ts: 'dedup-1', text: 'I need help with groceries', post: async () => {} });
    assert.equal(second, null, 're-processing the same channel+ts must return null, not a new signal');
    assert.equal(signalStore.getSignalsByChannel(channelId).length, 1, 'signal count for this channel must not grow on a re-scan');
  } finally {
    intentEngine.detectSignals = realDetect;
    summaryService.summarizeConversation = realSummarize;
  }
});
