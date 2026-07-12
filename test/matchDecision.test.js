const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Isolated per-test temp path (never the real data/signals.json) so running
// the suite can never wipe production/demo data.
const DATA_FILE = path.join(os.tmpdir(), `matchDecision-test-${process.pid}.json`);
process.env.SIGNALS_DATA_FILE = DATA_FILE;
fs.rmSync(DATA_FILE, { force: true });
after(() => {
  fs.rmSync(DATA_FILE, { force: true });
  fs.rmSync(`${DATA_FILE}.tmp`, { force: true });
});

const signalStore = require('../services/signalStore');
const matchDecision = require('../services/matchDecision');

function makeSignal(type, overrides = {}) {
  return signalStore.createSignal({
    types: [{ type, confidence: 0.9, evidence: 'e', reasoning: 'r', recommended_action: 'a' }],
    summary: {
      what_happened: overrides.what_happened || `a ${type} came in`,
      why_it_matters: 'y',
      community_impact: 'medium',
      people_involved: 'unknown',
      recommended_next_action: 'follow up',
    },
    message: overrides.message || { channel_id: 'C1', ts: String(Math.random()), permalink: '', author_user_id: 'U1', author_name: 'Jane', text: 't' },
  });
}

test('textSimilarity is 1 for identical text and 0 for disjoint text', () => {
  assert.equal(matchDecision.textSimilarity('need a ride to the clinic', 'need a ride to the clinic'), 1);
  assert.equal(matchDecision.textSimilarity('need a ride to the clinic', 'zzz qqq xxx'), 0);
});

test('decide() returns the low branch and no recommendation when there are no candidates', () => {
  const signal = makeSignal('gratitude_report');
  const decision = matchDecision.decide(signal, []);
  assert.equal(decision.branch, 'low');
  assert.equal(decision.recommended, null);
});

test('decide() recommends HIGH for a same-channel, textually-similar, proven volunteer', () => {
  // Build up 5 confirmed matches for U_HIGH so volunteerHistoryScore saturates at 1.
  for (let i = 0; i < 5; i += 1) {
    const need = makeSignal('transport_need', { message: { channel_id: 'C1', ts: `n${i}`, permalink: '', author_user_id: `UNEED${i}`, author_name: 'Needer', text: 't' } });
    const offer = makeSignal('volunteer_offer', { message: { channel_id: 'C1', ts: `o${i}`, permalink: '', author_user_id: 'U_HIGH', author_name: 'Sarah', text: 't' } });
    signalStore.confirmMatch(need.signal_id, offer.signal_id, 0.9, 'U999');
  }

  const sameText = 'need a ride to the medical appointment downtown';
  const signal = makeSignal('medical_need', { what_happened: sameText, message: { channel_id: 'C1', ts: 'sig', permalink: '', author_user_id: 'U_NEW', author_name: 'New Requester', text: 't' } });
  const candidate = makeSignal('volunteer_offer', {
    what_happened: sameText,
    message: { channel_id: 'C1', ts: 'cand', permalink: '', author_user_id: 'U_HIGH', author_name: 'Sarah', text: 't' },
  });

  const decision = matchDecision.decide(signal, [candidate]);
  assert.equal(decision.branch, 'high');
  assert.equal(decision.recommended.signal_id, candidate.signal_id);
  assert.ok(decision.confidence >= matchDecision.HIGH_THRESHOLD);
  assert.match(decision.explanation, /Sarah/);
});

test('decide() falls back to MEDIUM or LOW for a first-time candidate with no shared history', () => {
  const signal = makeSignal('resource_request', { what_happened: 'need some canned food', message: { channel_id: 'C9', ts: '1', permalink: '', author_user_id: 'U1', author_name: 'A', text: 't' } });
  const candidate = makeSignal('resource_available', { what_happened: 'have a spare bicycle to give away', message: { channel_id: 'C10', ts: '2', permalink: '', author_user_id: 'U_STRANGER', author_name: 'Stranger', text: 't' } });

  const decision = matchDecision.decide(signal, [candidate]);
  assert.notEqual(decision.branch, 'high');
  assert.ok(decision.confidence < matchDecision.HIGH_THRESHOLD);
});

test('computeMatchConfidence\'s priority factor reflects the need side regardless of which side triggered the match', () => {
  // Before the fix, `priority` always read scorePriority(signal.types) — so an
  // offer arriving to match an already-open urgent need scored near-zero
  // priority (offers carry weight ~3), instead of reflecting the need's real
  // urgency (medical_need carries weight 60). Assert both directions agree.
  const need = makeSignal('medical_need', { message: { channel_id: 'C11', ts: '1', permalink: '', author_user_id: 'U_NEED', author_name: 'Needer', text: 't' } });
  const offer = makeSignal('volunteer_offer', { message: { channel_id: 'C11', ts: '2', permalink: '', author_user_id: 'U_OFFER', author_name: 'Offerer', text: 't' } });

  const needTriggers = matchDecision.computeMatchConfidence(need, offer);
  const offerTriggers = matchDecision.computeMatchConfidence(offer, need);

  assert.equal(needTriggers.factors.priority, offerTriggers.factors.priority);
  assert.ok(needTriggers.factors.priority > 0.4, 'a medical_need in the pair should dominate the priority factor regardless of trigger direction');
});

test('computeMatchConfidence\'s volunteerHistory factor credits the true offer author regardless of trigger direction', () => {
  // Before the fix, volunteerHistory always scored `candidate` — so when a
  // proven volunteer's own offer triggered detection (signal = offer,
  // candidate = need), their track record was silently dropped from the score.
  for (let i = 0; i < 5; i += 1) {
    const n = makeSignal('housing_need', { message: { channel_id: 'C12', ts: `n${i}`, permalink: '', author_user_id: `UNEED${i}`, author_name: 'Needer', text: 't' } });
    const o = makeSignal('donation_offer', { message: { channel_id: 'C12', ts: `o${i}`, permalink: '', author_user_id: 'U_PROVEN', author_name: 'Proven', text: 't' } });
    signalStore.confirmMatch(n.signal_id, o.signal_id, 0.9, 'U999');
  }
  const newNeed = makeSignal('housing_need', { message: { channel_id: 'C12', ts: 'new1', permalink: '', author_user_id: 'U_NEW', author_name: 'New Needer', text: 't' } });
  const newOffer = makeSignal('donation_offer', { message: { channel_id: 'C12', ts: 'new2', permalink: '', author_user_id: 'U_PROVEN', author_name: 'Proven', text: 't' } });

  const needTriggers = matchDecision.computeMatchConfidence(newNeed, newOffer);
  const offerTriggers = matchDecision.computeMatchConfidence(newOffer, newNeed);

  assert.equal(needTriggers.factors.volunteerHistory, offerTriggers.factors.volunteerHistory);
  assert.ok(needTriggers.factors.volunteerHistory > 0, 'the proven volunteer\'s track record should count regardless of who triggered the match');
});

test('decide()\'s explanation never credits a need-requester with the offer author\'s match history', () => {
  // Build up a proven-volunteer offer, then let the OFFER trigger detection
  // (signal = offer, candidate = need) — the explanation names `candidate`
  // (the need's requester), so it must never claim they've "completed N
  // matches" using the volunteer's history that scored the match.
  for (let i = 0; i < 5; i += 1) {
    const n = makeSignal('food_insecurity', { message: { channel_id: 'C13', ts: `n${i}`, permalink: '', author_user_id: `UNEED${i}`, author_name: 'Needer', text: 't' } });
    const o = makeSignal('donation_offer', { message: { channel_id: 'C13', ts: `o${i}`, permalink: '', author_user_id: 'U_PROVEN2', author_name: 'Proven Two', text: 't' } });
    signalStore.confirmMatch(n.signal_id, o.signal_id, 0.9, 'U999');
  }
  const offerTrigger = makeSignal('donation_offer', { message: { channel_id: 'C13', ts: 'trig', permalink: '', author_user_id: 'U_PROVEN2', author_name: 'Proven Two', text: 't' } });
  const needCandidate = makeSignal('food_insecurity', { message: { channel_id: 'C13', ts: 'cand', permalink: '', author_user_id: 'U_NEEDER_NEW', author_name: 'Needer New', text: 't' } });

  const decision = matchDecision.decide(offerTrigger, [needCandidate]);
  assert.doesNotMatch(decision.explanation, /Needer New.*completed/, 'must not attribute volunteer match history to the need-requester being named');
});
