const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scoreLead } = require('../services/leadScore');

test('scoreLead returns 0/cold for no signals', () => {
  const result = scoreLead([]);
  assert.equal(result.score, 0);
  assert.equal(result.tier, 'cold');
  assert.deepEqual(result.breakdown, []);
});

test('scoreLead weights enterprise buying intent as hot', () => {
  const result = scoreLead([
    { type: 'enterprise_buying_intent', confidence: 1 },
    { type: 'budget_discussion', confidence: 1 },
    { type: 'decision_maker_involvement', confidence: 1 },
  ]);
  assert.equal(result.score, 70);
  assert.equal(result.tier, 'hot');
});

test('scoreLead applies negative weight for churn risk', () => {
  const result = scoreLead([{ type: 'churn_risk', confidence: 1 }]);
  assert.equal(result.score, 0); // clamped at 0, not negative
  assert.equal(result.tier, 'cold');
});

test('scoreLead scales contribution by confidence', () => {
  const full = scoreLead([{ type: 'pricing_intent', confidence: 1 }]);
  const half = scoreLead([{ type: 'pricing_intent', confidence: 0.5 }]);
  assert.equal(full.score, 15);
  assert.equal(half.score, 8); // 15 * 0.5 = 7.5, rounded to 8
});

test('scoreLead ignores unknown signal types (weight 0)', () => {
  const result = scoreLead([{ type: 'not_a_real_type', confidence: 1 }]);
  assert.equal(result.score, 0);
});
