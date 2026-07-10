const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// signalStore persists to a file and loads it at require() time. Point it at
// an isolated per-test temp path (never the real data/signals.json) so
// running the suite can never wipe production/demo data.
const DATA_FILE = path.join(os.tmpdir(), `matchService-test-${process.pid}.json`);
process.env.SIGNALS_DATA_FILE = DATA_FILE;
fs.rmSync(DATA_FILE, { force: true });
after(() => {
  fs.rmSync(DATA_FILE, { force: true });
  fs.rmSync(`${DATA_FILE}.tmp`, { force: true });
});

const signalStore = require('../services/signalStore');
const { findMatches } = require('../services/matchService');

function makeSignal(type, overrides = {}) {
  return signalStore.createSignal({
    types: [{ type, confidence: 0.9, evidence: 'e', reasoning: 'r', recommended_action: 'a' }],
    summary: {
      what_happened: `a ${type} came in`,
      why_it_matters: 'y',
      community_impact: 'medium',
      people_involved: 'unknown',
      recommended_next_action: 'follow up',
    },
    message: {
      channel_id: 'C1',
      ts: String(Math.random()),
      permalink: 'https://slack.com/x',
      author_user_id: 'U1',
      author_name: 'Jane',
      text: 'text',
    },
    ...overrides,
  });
}

test('a volunteer offer matches an open transport need', () => {
  const need = makeSignal('transport_need');
  const offer = makeSignal('volunteer_offer');
  const matches = findMatches(offer);
  assert.ok(matches.some((m) => m.signal_id === need.signal_id));
});

test('a need matches back to an open complementary offer', () => {
  const offer = makeSignal('resource_available');
  const need = makeSignal('resource_request');
  const matches = findMatches(need);
  assert.ok(matches.some((m) => m.signal_id === offer.signal_id));
});

test('claimed (reviewed) signals are excluded from matching', () => {
  const need = makeSignal('food_insecurity');
  signalStore.assignOwner(need.signal_id, 'U999'); // someone already claimed it
  const offer = makeSignal('donation_offer');
  const matches = findMatches(offer);
  assert.ok(!matches.some((m) => m.signal_id === need.signal_id));
});

test('a signal never matches itself', () => {
  const offer = makeSignal('volunteer_offer');
  const matches = findMatches(offer);
  assert.ok(!matches.some((m) => m.signal_id === offer.signal_id));
});

test('signal types with no affinity (gratitude) return no matches', () => {
  const gratitude = makeSignal('gratitude_report');
  assert.deepEqual(findMatches(gratitude), []);
});

test('matches are capped at the given limit and ranked by priority', () => {
  makeSignal('medical_need'); // weight 30 — should outrank the others
  makeSignal('transport_need');
  makeSignal('help_request');
  const offer = makeSignal('volunteer_offer');
  const matches = findMatches(offer, { limit: 2 });
  assert.equal(matches.length, 2);
  assert.equal(matches[0].primary_type, 'medical_need');
});
