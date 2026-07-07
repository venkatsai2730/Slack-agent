const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hasKeywordHint, detectSignals, SIGNAL_TYPES } = require('../services/intentEngine');

test('hasKeywordHint matches growth-signal language', () => {
  assert.equal(hasKeywordHint('what is your enterprise pricing?'), true);
  assert.equal(hasKeywordHint('we might churn if this bug persists'), true);
  assert.equal(hasKeywordHint('thanks, have a great weekend!'), false);
});

test('detectSignals short-circuits (no LLM call) when no keyword hint is present', async () => {
  const signals = await detectSignals('lol nice one 😂');
  assert.deepEqual(signals, []);
});

test('detectSignals returns [] for empty/whitespace text without calling the LLM', async () => {
  assert.deepEqual(await detectSignals(''), []);
  assert.deepEqual(await detectSignals('   '), []);
});

test('SIGNAL_TYPES is a fixed, non-empty vocabulary of strings', () => {
  assert.ok(Array.isArray(SIGNAL_TYPES));
  assert.ok(SIGNAL_TYPES.length > 0);
  for (const t of SIGNAL_TYPES) assert.equal(typeof t, 'string');
  assert.ok(SIGNAL_TYPES.includes('churn_risk'));
  assert.ok(SIGNAL_TYPES.includes('enterprise_buying_intent'));
});
