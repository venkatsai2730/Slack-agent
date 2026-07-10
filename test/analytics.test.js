const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Isolated per-test temp path (never the real data/signals.json) so running
// the suite can never wipe production/demo data.
const DATA_FILE = path.join(os.tmpdir(), `analytics-test-${process.pid}.json`);
process.env.SIGNALS_DATA_FILE = DATA_FILE;
fs.rmSync(DATA_FILE, { force: true });
after(() => {
  fs.rmSync(DATA_FILE, { force: true });
  fs.rmSync(`${DATA_FILE}.tmp`, { force: true });
});

const signalStore = require('../services/signalStore');
const analytics = require('../services/analytics');

function makeSignal(type, overrides = {}) {
  const signal = signalStore.createSignal({
    types: [{ type, confidence: 0.9, evidence: 'e', reasoning: 'r', recommended_action: 'a' }],
    summary: { what_happened: `a ${type}`, why_it_matters: 'y', community_impact: 'medium', people_involved: 'unknown', recommended_next_action: 'follow up' },
    message: { channel_id: 'C1', ts: String(Math.random()), permalink: '', author_user_id: 'U1', author_name: 'Jane', text: 't' },
    ...overrides,
  });
  return signalStore.getSignal(signal.signal_id);
}

test('timeToMatchStats reports a duration for confirmed matches', () => {
  // confirmMatch stores the match symmetrically on both signals (see
  // signalStore.confirmMatch), so the average includes each side's own wait
  // time: backdating only `need` by 30 min against an `offer` created "now"
  // yields an average of (30 + 0) / 2 = 15 minutes, not 30.
  const need = makeSignal('transport_need', { message: { channel_id: 'C1', ts: '1', permalink: '', author_user_id: 'U1', author_name: 'A', text: 't' } });
  const offer = makeSignal('volunteer_offer', { message: { channel_id: 'C1', ts: '2', permalink: '', author_user_id: 'U2', author_name: 'B', text: 't' } });
  signalStore.updateSignal(need.signal_id, { created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString() });
  signalStore.confirmMatch(need.signal_id, offer.signal_id, 0.9, 'U999');

  const stats = analytics.timeToMatchStats();
  assert.ok(stats.average_minutes >= 10 && stats.average_minutes <= 20, `expected ~15 min, got ${stats.average_minutes}`);
});

test('successfulMatchesCount counts unique pairs, not both sides of the symmetric record', () => {
  // Other tests in this file also create confirmed matches (signalStore is a
  // shared singleton for the whole file) — assert on the delta this test
  // itself introduces, not the absolute count.
  const before = analytics.successfulMatchesCount();
  const need = makeSignal('food_insecurity', { message: { channel_id: 'C2', ts: '1', permalink: '', author_user_id: 'U3', author_name: 'A', text: 't' } });
  const offer = makeSignal('donation_offer', { message: { channel_id: 'C2', ts: '2', permalink: '', author_user_id: 'U4', author_name: 'B', text: 't' } });
  signalStore.confirmMatch(need.signal_id, offer.signal_id, 0.9, 'U999');
  assert.equal(analytics.successfulMatchesCount() - before, 1);
});

test('escalationStats counts escalated signals and total reminders sent', () => {
  const signal = makeSignal('medical_need', { message: { channel_id: 'C3', ts: '1', permalink: '', author_user_id: 'U5', author_name: 'A', text: 't' } });
  signalStore.markEscalated(signal.signal_id);
  signalStore.markEscalated(signal.signal_id);
  const stats = analytics.escalationStats();
  assert.equal(stats.signals_escalated, 1);
  assert.equal(stats.total_reminders_sent, 2);
});

test('coordinatorInterventionsCount counts MEDIUM-branch signals a human acted on', () => {
  const approved = makeSignal('help_request', { message: { channel_id: 'C4', ts: '1', permalink: '', author_user_id: 'U6', author_name: 'A', text: 't' } });
  const otherSide = makeSignal('volunteer_offer', { message: { channel_id: 'C4', ts: '2', permalink: '', author_user_id: 'U7', author_name: 'B', text: 't' } });
  signalStore.updateSignal(approved.signal_id, { decision_branch: 'medium' });
  signalStore.confirmMatch(approved.signal_id, otherSide.signal_id, 0.5, 'UCOORD');

  const rejected = makeSignal('help_request', { message: { channel_id: 'C4', ts: '3', permalink: '', author_user_id: 'U8', author_name: 'C', text: 't' } });
  signalStore.updateSignal(rejected.signal_id, { decision_branch: 'medium' });
  signalStore.recordTimelineEvent(rejected.signal_id, 'match_rejected', 'rejected by coordinator');

  const untouchedHigh = makeSignal('help_request', { message: { channel_id: 'C4', ts: '4', permalink: '', author_user_id: 'U9', author_name: 'D', text: 't' } });
  signalStore.updateSignal(untouchedHigh.signal_id, { decision_branch: 'high' });

  assert.equal(analytics.coordinatorInterventionsCount(), 2);
});

test('volunteerUtilization reports active vs total offer-signal authors', () => {
  // Other tests in this file also create offer-type signals from other
  // authors (signalStore is a shared singleton for the whole file) — assert
  // on the delta this test's brand-new authors introduce, not absolute counts.
  const before = analytics.volunteerUtilization();
  const offerA = makeSignal('skill_offer', { message: { channel_id: 'C5', ts: '1', permalink: '', author_user_id: 'U_ACTIVE', author_name: 'A', text: 't' } });
  makeSignal('skill_offer', { message: { channel_id: 'C5', ts: '2', permalink: '', author_user_id: 'U_INACTIVE', author_name: 'B', text: 't' } });
  const need = makeSignal('resource_request', { message: { channel_id: 'C5', ts: '3', permalink: '', author_user_id: 'U_NEEDER', author_name: 'C', text: 't' } });
  signalStore.confirmMatch(offerA.signal_id, need.signal_id, 0.8, 'UCOORD');

  const after = analytics.volunteerUtilization();
  assert.equal(after.total_volunteers - before.total_volunteers, 2);
  assert.equal(after.active_volunteers - before.active_volunteers, 1);
});

test('districtHeatmap groups signal counts by channel (channel-as-district proxy)', () => {
  makeSignal('help_request', { message: { channel_id: 'C_HEAT_A', ts: '1', permalink: '', author_user_id: 'U1', author_name: 'A', text: 't' } });
  makeSignal('help_request', { message: { channel_id: 'C_HEAT_A', ts: '2', permalink: '', author_user_id: 'U1', author_name: 'A', text: 't' } });
  makeSignal('help_request', { message: { channel_id: 'C_HEAT_B', ts: '3', permalink: '', author_user_id: 'U1', author_name: 'A', text: 't' } });

  const heatmap = analytics.districtHeatmap();
  const a = heatmap.find((h) => h.channel_id === 'C_HEAT_A');
  const b = heatmap.find((h) => h.channel_id === 'C_HEAT_B');
  assert.equal(a.count, 2);
  assert.equal(b.count, 1);
});

test('buildAnalytics returns a complete, well-shaped snapshot', () => {
  const snapshot = analytics.buildAnalytics();
  for (const key of [
    'response_time',
    'time_to_match',
    'auto_triage_count',
    'confidence_distribution',
    'successful_matches',
    'false_positives',
    'escalations',
    'coordinator_interventions',
    'volunteer_utilization',
    'repeat_requesters',
    'repeat_volunteers',
    'district_heatmap',
    'trend_daily_14d',
    'trend_weekly_8w',
    'trend_monthly_6m',
    'oldest_unresolved',
    'estimated_coordinator_hours_saved',
  ]) {
    assert.ok(key in snapshot, `missing key: ${key}`);
  }
  assert.equal(snapshot.false_negatives, null); // documented as not computable from within the system
  assert.equal(snapshot.trend_daily_14d.length, 14);
  assert.equal(snapshot.trend_weekly_8w.length, 8);
  assert.equal(snapshot.trend_monthly_6m.length, 6);
});
