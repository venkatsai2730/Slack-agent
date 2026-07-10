const { test, after } = require('node:test');
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
const matchService = require('../services/matchService');
const matchDecision = require('../services/matchDecision');
const registerSignalActions = require('../listeners/actions/signal-actions');

/** Captures every app.action(name, handler) registration so tests can invoke handlers directly. */
function makeFakeApp() {
  const handlers = {};
  return { app: { action: (name, fn) => { handlers[name] = fn; } }, handlers };
}

function makeSignal(type, overrides = {}) {
  const signal = signalStore.createSignal({
    types: [{ type, confidence: 0.9, evidence: 'e', reasoning: 'r', recommended_action: 'a' }],
    summary: { what_happened: `a ${type}`, why_it_matters: 'y', community_impact: 'medium', people_involved: 'unknown', recommended_next_action: 'follow up' },
    message: { channel_id: 'C1', ts: String(Math.random()), permalink: '', author_user_id: 'U1', author_name: 'Jane', text: 't' },
    ...overrides,
  });
  return signalStore.getSignal(signal.signal_id);
}

const noop = async () => {};

test('claim_help refuses to claim an already-resolved signal', async () => {
  const { app, handlers } = makeFakeApp();
  registerSignalActions(app);

  const need = makeSignal('help_request', { message: { channel_id: 'C1', ts: '1', permalink: '', author_user_id: 'U1', author_name: 'A', text: 't' } });
  const offer = makeSignal('volunteer_offer', { message: { channel_id: 'C1', ts: '2', permalink: '', author_user_id: 'U2', author_name: 'B', text: 't' } });
  signalStore.confirmMatch(need.signal_id, offer.signal_id, 0.9, 'UCOORD');

  const respondCalls = [];
  await handlers.claim_help({
    ack: noop,
    body: { user: { id: 'U999' }, channel: { id: 'C1' }, message: { ts: '1' } },
    action: { value: need.signal_id },
    client: { chat: { update: noop } },
    logger: console,
    respond: async (msg) => respondCalls.push(msg),
  });

  assert.equal(signalStore.getSignal(need.signal_id).owner, null, 'owner must not be set on an already-resolved signal');
  assert.ok(respondCalls[0].text.includes('already been resolved'));
});

test('not_a_request refuses to overwrite an already-resolved signal', async () => {
  const { app, handlers } = makeFakeApp();
  registerSignalActions(app);

  const need = makeSignal('help_request', { message: { channel_id: 'C1', ts: '3', permalink: '', author_user_id: 'U1', author_name: 'A', text: 't' } });
  const offer = makeSignal('volunteer_offer', { message: { channel_id: 'C1', ts: '4', permalink: '', author_user_id: 'U2', author_name: 'B', text: 't' } });
  signalStore.confirmMatch(need.signal_id, offer.signal_id, 0.9, 'UCOORD');

  const respondCalls = [];
  await handlers.not_a_request({
    ack: noop,
    body: { user: { id: 'U999' }, channel: { id: 'C1' }, message: { ts: '3' } },
    action: { value: need.signal_id },
    client: { chat: { update: noop } },
    logger: console,
    respond: async (msg) => respondCalls.push(msg),
  });

  const stillResolved = signalStore.getSignal(need.signal_id);
  assert.equal(stillResolved.status, 'new', 'status must not flip to false_positive on an already-resolved signal');
  assert.equal(stillResolved.resolution.resolution_type, 'matched', 'resolution_type must not be overwritten');
  assert.ok(respondCalls[0].text.includes('already been resolved'));
});

test('reject_match excludes the rejected candidate and re-decides against the rest', async () => {
  const { app, handlers } = makeFakeApp();
  registerSignalActions(app);

  const channel = 'C_REJECT_TEST';
  // offerA: a proven volunteer (5 confirmed matches elsewhere) in the same
  // channel as the need — scores solidly into MEDIUM/HIGH range.
  for (let i = 0; i < 5; i += 1) {
    const n = makeSignal('transport_need', { message: { channel_id: channel, ts: `n${i}`, permalink: '', author_user_id: `UNEED${i}`, author_name: 'Needer', text: 't' } });
    const o = makeSignal('volunteer_offer', { message: { channel_id: channel, ts: `o${i}`, permalink: '', author_user_id: 'U_PROVEN', author_name: 'Proven Volunteer', text: 't' } });
    signalStore.confirmMatch(n.signal_id, o.signal_id, 0.9, 'UCOORD');
  }
  // offerB: a first-time volunteer in a different channel — scores low.
  const offerB = makeSignal('volunteer_offer', { message: { channel_id: 'C_OTHER', ts: 'b1', permalink: '', author_user_id: 'U_STRANGER', author_name: 'Stranger', text: 't' } });
  const offerA = makeSignal('volunteer_offer', { message: { channel_id: channel, ts: 'a1', permalink: '', author_user_id: 'U_PROVEN', author_name: 'Proven Volunteer', text: 't' } });
  const need = makeSignal('transport_need', { message: { channel_id: channel, ts: 'need1', permalink: '', author_user_id: 'U_NEW', author_name: 'New Requester', text: 't' } });

  // Seed the initial decision the way scan.js would have.
  const initialCandidates = matchService.findMatches(need);
  const initialDecision = matchDecision.decide(need, initialCandidates);
  signalStore.updateSignal(need.signal_id, { decision_branch: initialDecision.branch, match_recommendation: matchDecision.toMatchRecommendation(initialDecision) });
  assert.equal(initialDecision.recommended.signal_id, offerA.signal_id, 'sanity check: offerA should be the initial top pick');

  const posted = [];
  await handlers.reject_match({
    ack: noop,
    body: { user: { id: 'UCOORD2' }, channel: { id: channel }, message: { ts: 'need1' } },
    action: { value: JSON.stringify({ signal_id: need.signal_id, candidate_id: offerA.signal_id }) },
    client: { chat: { update: noop, postMessage: async (msg) => { posted.push(msg); return {}; } } },
    logger: console,
    respond: noop,
  });

  const updated = signalStore.getSignal(need.signal_id);
  assert.ok(updated.rejected_candidates.includes(offerA.signal_id));
  assert.notEqual(updated.match_recommendation?.candidate?.signal_id, offerA.signal_id, 'must never re-recommend the just-rejected candidate');
  // offerB scores well under the MEDIUM threshold (different channel, no track record) -> LOW branch, no recommendation, outreach posted.
  assert.equal(updated.decision_branch, 'low');
  assert.equal(updated.match_recommendation.candidate, null);
  assert.ok(posted.some((m) => m.text?.includes('Volunteers needed')), 'LOW branch after rejection should trigger the same outreach post as a fresh LOW decision');
  assert.ok(updated.timeline.some((e) => e.stage === 'match_rejected'));
  assert.ok(updated.timeline.some((e) => e.stage === 'match_decision' && e.detail.includes('Re-decided')));
  void offerB;
});
