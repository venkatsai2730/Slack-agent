const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scorePriority } = require('../services/priorityScore');

test('scorePriority returns 0/routine for no signals', () => {
  const result = scorePriority([]);
  assert.equal(result.score, 0);
  assert.equal(result.tier, 'routine');
  assert.deepEqual(result.breakdown, []);
});

test('scorePriority marks combined medical + urgent need as critical', () => {
  const result = scorePriority([
    { type: 'medical_need', confidence: 1 },
    { type: 'urgent_need', confidence: 1 },
  ]);
  assert.equal(result.score, 60);
  assert.equal(result.tier, 'critical');
});

test('scorePriority marks a housing need as high on its own', () => {
  const result = scorePriority([{ type: 'housing_need', confidence: 1 }]);
  assert.equal(result.score, 25);
  assert.equal(result.tier, 'high');
});

test('scorePriority keeps offers of help routine (capacity, not urgency)', () => {
  const result = scorePriority([
    { type: 'volunteer_offer', confidence: 1 },
    { type: 'donation_offer', confidence: 1 },
    { type: 'skill_offer', confidence: 1 },
  ]);
  assert.equal(result.tier, 'routine');
});

test('scorePriority scales contribution by confidence', () => {
  const full = scorePriority([{ type: 'help_request', confidence: 1 }]);
  const half = scorePriority([{ type: 'help_request', confidence: 0.5 }]);
  assert.equal(full.score, 15);
  assert.equal(half.score, 8); // 15 * 0.5 = 7.5, rounded to 8
});

test('scorePriority ignores unknown signal types (weight 0)', () => {
  const result = scorePriority([{ type: 'not_a_real_type', confidence: 1 }]);
  assert.equal(result.score, 0);
});
