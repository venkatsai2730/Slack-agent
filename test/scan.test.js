const { test } = require('node:test');
const assert = require('node:assert/strict');
const scan = require('../services/scan');
const { parseHoursBack } = scan;
const intentEngine = require('../services/intentEngine');

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
