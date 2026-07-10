const { test } = require('node:test');
const assert = require('node:assert/strict');
const { signalCardBlocks } = require('../blocks/signal-card');

/**
 * @param {Partial<import('../services/signalStore').Signal>} [overrides]
 * @returns {import('../services/signalStore').Signal}
 */
function baseSignal(overrides = {}) {
  return /** @type {import('../services/signalStore').Signal} */ ({
    signal_id: 'signal_test_1',
    types: [{ type: 'help_request', confidence: 0.9, evidence: 'e', reasoning: 'r', recommended_action: 'a' }],
    primary_type: 'help_request',
    summary: { what_happened: 'x', why_it_matters: 'y', community_impact: 'medium', people_involved: 'unknown', recommended_next_action: 'follow up' },
    message: { channel_id: 'C1', ts: '1', permalink: '', author_user_id: 'U1', author_name: 'Jane', text: 't' },
    used_thread_context: false,
    status: 'new',
    owner: null,
    crm_logged: false,
    crm_record_id: null,
    timeline: [],
    escalation: { escalated: false, escalated_at: null, reminder_count: 0, last_reminder_at: null },
    resolution: { resolved: false, resolved_at: null, resolution_type: null },
    confirmed_match: null,
    decision_branch: null,
    match_recommendation: null,
    rejected_candidates: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });
}

function actionIds(blocks) {
  return blocks.filter((b) => b.type === 'actions').flatMap((b) => b.elements.map((e) => e.action_id));
}

test('claim_help and not_a_request are offered on an unresolved signal', () => {
  const ids = actionIds(signalCardBlocks(baseSignal()));
  assert.ok(ids.includes('claim_help'));
  assert.ok(ids.includes('not_a_request'));
});

test('claim_help and not_a_request disappear once a signal is resolved (e.g. a confirmed match)', () => {
  const resolved = baseSignal({
    resolution: { resolved: true, resolved_at: new Date().toISOString(), resolution_type: 'matched' },
    confirmed_match: { signal_id: 'signal_other', confidence: 0.8, decided_by: 'U9', decided_at: new Date().toISOString() },
  });
  const ids = actionIds(signalCardBlocks(resolved));
  assert.ok(!ids.includes('claim_help'));
  assert.ok(!ids.includes('not_a_request'));
  // Informational buttons remain available even after resolution.
  assert.ok(ids.includes('view_case'));
  assert.ok(ids.includes('view_timeline'));
});

test('the whole actions row is absent for a false_positive signal (unchanged prior behavior)', () => {
  const blocks = signalCardBlocks(baseSignal({ status: 'false_positive' }));
  assert.equal(actionIds(blocks).length, 0);
});
