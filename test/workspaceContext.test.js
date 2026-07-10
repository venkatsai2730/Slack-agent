const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'signals.json');

// Same pattern as test/signalStore.test.js: signalStore loads its data file at
// require() time, so the slate must be cleared synchronously before requiring it.
fs.rmSync(DATA_FILE, { force: true });
after(() => {
  fs.rmSync(DATA_FILE, { force: true });
  fs.rmSync(`${DATA_FILE}.tmp`, { force: true });
});

const signalStore = require('../services/signalStore');
const workspaceContext = require('../services/workspaceContext');

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

test('getRequesterHistory reports repeat requesters and excludes a given signal', () => {
  const first = makeSignal('transport_need', { message: { channel_id: 'C1', ts: '1', permalink: '', author_user_id: 'U1', author_name: 'Jane', text: 't' } });
  makeSignal('transport_need', { message: { channel_id: 'C1', ts: '2', permalink: '', author_user_id: 'U1', author_name: 'Jane', text: 't' } });

  const history = workspaceContext.getRequesterHistory('U1');
  assert.equal(history.total_signals, 2);
  assert.equal(history.is_repeat, true);

  const excluding = workspaceContext.getRequesterHistory('U1', { excludeSignalId: first.signal_id });
  assert.equal(excluding.total_signals, 1);
});

test('getChannelTrends counts signal types within the window', () => {
  makeSignal('food_insecurity', { message: { channel_id: 'C2', ts: '1', permalink: '', author_user_id: 'U9', author_name: 'X', text: 't' } });
  makeSignal('food_insecurity', { message: { channel_id: 'C2', ts: '2', permalink: '', author_user_id: 'U9', author_name: 'X', text: 't' } });

  const trends = workspaceContext.getChannelTrends('C2');
  assert.equal(trends.total, 2);
  assert.equal(trends.by_type.food_insecurity, 2);
});

test('getRecurringByType flags recurrence at 3+ occurrences and computes a span', () => {
  const channel = 'C3';
  for (let i = 0; i < 3; i += 1) {
    makeSignal('transport_need', { message: { channel_id: channel, ts: String(i), permalink: '', author_user_id: 'U5', author_name: 'A', text: 't' } });
  }
  const recurring = workspaceContext.getRecurringByType('transport_need', channel);
  assert.equal(recurring.count, 3);
  assert.equal(recurring.is_recurring, true);
});

test('getUnresolvedSimilar finds open signals of the same type, excluding self and resolved ones', () => {
  const a = makeSignal('housing_need', { message: { channel_id: 'C4', ts: '1', permalink: '', author_user_id: 'U1', author_name: 'A', text: 't' } });
  const b = makeSignal('housing_need', { message: { channel_id: 'C4', ts: '2', permalink: '', author_user_id: 'U2', author_name: 'B', text: 't' } });
  signalStore.resolveSignal(b.signal_id, 'manual');

  const similar = workspaceContext.getUnresolvedSimilar({ signal_id: a.signal_id, primary_type: 'housing_need' });
  assert.ok(!similar.some((s) => s.signal_id === a.signal_id));
  assert.ok(!similar.some((s) => s.signal_id === b.signal_id), 'resolved signals should be excluded');
});

test('getRepeatVolunteers only counts offer signals with a confirmed match', () => {
  const need = makeSignal('transport_need', { message: { channel_id: 'C5', ts: '1', permalink: '', author_user_id: 'U1', author_name: 'Requester', text: 't' } });
  const offer = makeSignal('volunteer_offer', { message: { channel_id: 'C5', ts: '2', permalink: '', author_user_id: 'U6', author_name: 'Sarah', text: 't' } });
  const unmatchedOffer = makeSignal('volunteer_offer', { message: { channel_id: 'C5', ts: '3', permalink: '', author_user_id: 'U7', author_name: 'Unmatched', text: 't' } });

  signalStore.confirmMatch(need.signal_id, offer.signal_id, 0.9, 'U999');

  const volunteers = workspaceContext.getRepeatVolunteers({ limit: 10 });
  assert.ok(volunteers.some((v) => v.author_id === 'U6' && v.completed_matches === 1));
  assert.ok(!volunteers.some((v) => v.author_id === 'U7'), 'unmatched offers should not appear');
  void unmatchedOffer;
});

test('getRecentConfirmedMatches / getSuccessfulOutcomes surface confirmed pairs symmetrically', () => {
  const need = makeSignal('food_insecurity', { message: { channel_id: 'C6', ts: '1', permalink: '', author_user_id: 'U1', author_name: 'A', text: 't' } });
  const offer = makeSignal('donation_offer', { message: { channel_id: 'C6', ts: '2', permalink: '', author_user_id: 'U8', author_name: 'B', text: 't' } });
  signalStore.confirmMatch(need.signal_id, offer.signal_id, 0.8, 'U999');

  const outcomes = workspaceContext.getSuccessfulOutcomes({ limit: 50 });
  assert.ok(outcomes.some((o) => o.signal_id === need.signal_id));
  assert.ok(outcomes.some((o) => o.signal_id === offer.signal_id), 'confirmed_match should be recorded on both sides');
});

test('buildContext works without a Slack client (no live RTS search) and reports recurrence', async () => {
  const channel = 'C7';
  for (let i = 0; i < 3; i += 1) {
    makeSignal('medical_need', { message: { channel_id: channel, ts: String(i), permalink: '', author_user_id: 'U1', author_name: 'A', text: 't' } });
  }
  const context = await workspaceContext.buildContext({ channelId: channel, authorId: 'U1', primaryType: 'medical_need', text: 'need a ride' });
  assert.equal(context.related_messages.length, 0, 'no client => no live search attempted');
  assert.equal(context.is_recurring, true);
  assert.ok(context.summary_text.length > 0);
});

test('withCache returns a cached value within the TTL window', async () => {
  workspaceContext._clearCache();
  let calls = 0;
  const fn = async () => {
    calls += 1;
    return calls;
  };
  const first = await workspaceContext.withCache('test-key', 60_000, fn);
  const second = await workspaceContext.withCache('test-key', 60_000, fn);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
});
