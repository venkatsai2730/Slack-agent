// Tests the MCP tool handler functions exported by mcp/server.js directly
// (no stdio transport needed — see that file's module docblock). Only covers
// handlers that need neither a live Slack client nor a real LLM call,
// matching this suite's existing convention of never hitting the network.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SIGNALS_FILE = path.join(__dirname, '..', 'data', 'signals.json');
const CRM_FILE = path.join(__dirname, '..', 'data', 'crm-mock.json');
fs.rmSync(SIGNALS_FILE, { force: true });
fs.rmSync(CRM_FILE, { force: true });
after(() => {
  for (const f of [SIGNALS_FILE, `${SIGNALS_FILE}.tmp`, CRM_FILE, `${CRM_FILE}.tmp`]) fs.rmSync(f, { force: true });
});

const signalStore = require('../services/signalStore');
const intentEngine = require('../services/intentEngine');
const summaryService = require('../services/summaryService');
const mcp = require('../mcp/server');

function makeSignal(type, overrides = {}) {
  const signal = signalStore.createSignal({
    types: [{ type, confidence: 0.9, evidence: 'e', reasoning: 'r', recommended_action: 'a' }],
    summary: { what_happened: `a ${type}`, why_it_matters: 'y', community_impact: 'medium', people_involved: 'unknown', recommended_next_action: 'follow up' },
    message: { channel_id: 'C1', ts: String(Math.random()), permalink: '', author_user_id: 'U1', author_name: 'Jane', text: 't' },
    ...overrides,
  });
  return signalStore.getSignal(signal.signal_id);
}

/** Parses an MCP textResult's JSON payload back out. */
function payload(result) {
  return JSON.parse(result.content[0].text);
}

test('handleScorePriority scores an explicitly-provided signals array without calling the LLM', async () => {
  const result = await mcp.handleScorePriority({ signals: [{ type: 'medical_need', confidence: 1 }] });
  const body = payload(result);
  assert.equal(body.tier, 'high');
  assert.ok(body.score > 0);
});

test('handleFindMatches returns complementary open signals for a logged signal', async () => {
  const need = makeSignal('transport_need', { message: { channel_id: 'C1', ts: '1', permalink: '', author_user_id: 'U1', author_name: 'A', text: 't' } });
  const offer = makeSignal('volunteer_offer', { message: { channel_id: 'C1', ts: '2', permalink: '', author_user_id: 'U2', author_name: 'B', text: 't' } });
  const result = await mcp.handleFindMatches({ signal_id: offer.signal_id, limit: 3 });
  const body = payload(result);
  assert.ok(body.matches.some((m) => m.signal_id === need.signal_id));
});

test('handleFindMatches returns an error result for an unknown signal_id', async () => {
  const result = await mcp.handleFindMatches({ signal_id: 'does_not_exist', limit: 3 });
  assert.equal(/** @type {any} */ (result).isError, true);
});

test('handleLogCase runs the match-decision engine, not just candidate lookup', async () => {
  // Stub out the LLM-calling paths so this test never hits the network — same
  // technique as escalation.test.js's llm.complete stub, applied here to
  // intentEngine.detectSignals/summaryService.summarizeConversation since
  // mcp/server.js calls both via property access (not destructured).
  const realDetect = intentEngine.detectSignals;
  const realSummarize = summaryService.summarizeConversation;
  intentEngine.detectSignals = async () => [{ type: 'transport_need', confidence: 0.9, evidence: 'e', reasoning: 'r', recommended_action: 'a' }];
  summaryService.summarizeConversation = async () => ({
    what_happened: 'needs a ride',
    why_it_matters: 'y',
    community_impact: 'medium',
    people_involved: 'unknown',
    recommended_next_action: 'follow up',
  });

  try {
    const offer = makeSignal('volunteer_offer', { message: { channel_id: 'C_LOGCASE', ts: '1', permalink: '', author_user_id: 'U_VOL', author_name: 'Vol', text: 't' } });
    const result = await mcp.handleLogCase({ text: 'need a ride to a medical appointment', channel: undefined, author: 'U_REQ' });
    const body = payload(result);

    assert.ok('match_decision' in body, 'log_case response must include a match decision, not just signal_id/case_record_id');
    assert.ok(['high', 'medium', 'low'].includes(body.match_decision.branch));

    const stored = signalStore.getSignal(body.signal_id);
    assert.notEqual(stored.decision_branch, null, 'the persisted signal must carry a decision_branch, not leave it null forever');
    assert.ok(stored.timeline.some((e) => e.stage === 'match_decision'));
    void offer;
  } finally {
    intentEngine.detectSignals = realDetect;
    summaryService.summarizeConversation = realSummarize;
  }
});

test('handleCreateFollowup logs a followup and optionally assigns an owner', async () => {
  const signal = makeSignal('housing_need');
  const result = await mcp.handleCreateFollowup({ signal_id: signal.signal_id, owner: 'U777' });
  const body = payload(result);
  assert.ok(body.followup_id);
  assert.equal(signalStore.getSignal(signal.signal_id).owner, 'U777');
});

test('handleGetConstituentContext merges CRM context with workspace signal history', async () => {
  makeSignal('help_request', { message: { channel_id: 'C1', ts: '1', permalink: '', author_user_id: 'U_REPEAT', author_name: 'Repeat Person', text: 't' } });
  makeSignal('help_request', { message: { channel_id: 'C1', ts: '2', permalink: '', author_user_id: 'U_REPEAT', author_name: 'Repeat Person', text: 't' } });

  const result = await mcp.handleGetConstituentContext({ identifier: 'Repeat Person' });
  const body = payload(result);
  assert.equal(body.found, true);
  assert.equal(body.workspace_history.total_signals, 2);
});

test('handleGetConstituentContext reports not-found for a stranger', async () => {
  const result = await mcp.handleGetConstituentContext({ identifier: 'Nobody Ever Logged' });
  const body = payload(result);
  assert.equal(body.found, false);
});

test('handleSearchWorkspaceHistory (no channel) filters structured signals by query, using only local data', async () => {
  makeSignal('medical_need', { message: { channel_id: 'C1', ts: '1', permalink: '', author_user_id: 'U1', author_name: 'A', text: 'need a ride to dialysis' } });
  const result = await mcp.handleSearchWorkspaceHistory({ query: 'medical', hours_back: 168 });
  const body = payload(result);
  assert.equal(body.live_messages.length, 0, 'no channel given => no live search attempted');
  assert.ok(body.structured_signals.some((s) => s.primary_type === 'medical_need'));
});

test('handleGetLocationPatterns (no channel) returns the workspace-wide heatmap', async () => {
  makeSignal('help_request', { message: { channel_id: 'C_LOC', ts: '1', permalink: '', author_user_id: 'U1', author_name: 'A', text: 't' } });
  const result = await mcp.handleGetLocationPatterns({});
  const body = payload(result);
  assert.ok(Array.isArray(body.district_heatmap));
  assert.ok(body.district_heatmap.some((h) => h.channel_id === 'C_LOC'));
});

test('handleGetRepeatRequesters / handleGetRepeatVolunteers return arrays', async () => {
  const requesters = payload(await mcp.handleGetRepeatRequesters({ limit: 5 }));
  const volunteers = payload(await mcp.handleGetRepeatVolunteers({ limit: 5 }));
  assert.ok(Array.isArray(requesters.requesters));
  assert.ok(Array.isArray(volunteers.volunteers));
});

test('handleGetUnresolvedSimilar finds other open signals of the same type', async () => {
  const a = makeSignal('food_insecurity', { message: { channel_id: 'C1', ts: '1', permalink: '', author_user_id: 'U1', author_name: 'A', text: 't' } });
  const b = makeSignal('food_insecurity', { message: { channel_id: 'C1', ts: '2', permalink: '', author_user_id: 'U2', author_name: 'B', text: 't' } });
  const result = await mcp.handleGetUnresolvedSimilar({ signal_id: a.signal_id, limit: 10 });
  const body = payload(result);
  assert.ok(body.similar.some((s) => s.signal_id === b.signal_id));
});

test('handleGetRecentMatches / handleGetSuccessfulOutcomes reflect confirmed matches', async () => {
  const need = makeSignal('donation_offer', { message: { channel_id: 'C1', ts: '1', permalink: '', author_user_id: 'U1', author_name: 'A', text: 't' } });
  const offer = makeSignal('food_insecurity', { message: { channel_id: 'C1', ts: '2', permalink: '', author_user_id: 'U2', author_name: 'B', text: 't' } });
  signalStore.confirmMatch(need.signal_id, offer.signal_id, 0.9, 'UCOORD');

  const matches = payload(await mcp.handleGetRecentMatches({ limit: 10 }));
  const outcomes = payload(await mcp.handleGetSuccessfulOutcomes({ limit: 10 }));
  assert.ok(matches.matches.some((m) => m.signal_id === need.signal_id));
  assert.ok(outcomes.outcomes.some((o) => o.signal_id === offer.signal_id));
});

test('handleGetPriorityStatistics returns tier and confidence-branch breakdowns', async () => {
  const result = await mcp.handleGetPriorityStatistics({});
  const body = payload(result);
  assert.ok('by_tier' in body);
  assert.ok('confidence_distribution' in body);
});

test('handleSummarizeWorkspaceContext (no identifier) returns workspace-wide analytics only', async () => {
  const result = await mcp.handleSummarizeWorkspaceContext({});
  const body = payload(result);
  assert.equal(body.requester, null);
  assert.ok('successful_matches' in body.analytics);
});
