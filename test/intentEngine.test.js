const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hasKeywordHint, detectSignals, SIGNAL_TYPES } = require('../services/intentEngine');

test('hasKeywordHint matches community-signal language', () => {
  assert.equal(hasKeywordHint('can anyone give me a ride to the clinic tomorrow?'), true);
  assert.equal(hasKeywordHint('we are collecting winter coats to donate this weekend'), true);
  assert.equal(hasKeywordHint('struggling to cover rent this month'), true);
  assert.equal(hasKeywordHint('see you at the game tonight!'), false);
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
  assert.ok(SIGNAL_TYPES.includes('urgent_need'));
  assert.ok(SIGNAL_TYPES.includes('volunteer_offer'));
  assert.ok(SIGNAL_TYPES.includes('food_insecurity'));
});
