// Simple, explainable priority-scoring model: weighted sum of detected signal
// confidences, clamped to 0-100 with a critical/high/routine tier. Intentionally
// not an LLM call — triage should be fast, deterministic, and auditable, because
// it decides which neighbor's need gets looked at first.

/** @type {Record<string, number>} */
const SIGNAL_WEIGHTS = {
  // Needs (drive urgency). medical_need/urgent_need are weighted so a single
  // high-confidence signal of either type reaches 'critical' on its own
  // (score >= 55) — a lone "someone collapsed, needs help now" message must
  // not depend on the LLM also co-tagging a second signal type to get the
  // fastest (1h) escalation SLA instead of the 4h one.
  medical_need: 60,
  urgent_need: 60,
  housing_need: 25,
  food_insecurity: 25,
  emotional_support_need: 20,
  transport_need: 15,
  help_request: 15,
  resource_request: 10,
  follow_up_needed: 10,
  // Coordination
  event_coordination: 5,
  // Offers (capacity, worth routing but never "critical")
  volunteer_offer: 3,
  donation_offer: 3,
  skill_offer: 3,
  resource_available: 3,
  // Outcomes
  gratitude_report: 0,
};

/**
 * Only reads `type` and `confidence`, so callers may pass either full
 * DetectedSignal objects or a minimal { type, confidence } shape (e.g. from an
 * MCP client that only knows the signal type and score, not the full evidence).
 * @param {{ type: string, confidence?: number }[]} signals
 * @returns {{ score: number, tier: 'critical'|'high'|'routine', breakdown: { type: string, contribution: number }[] }}
 */
function scorePriority(signals = []) {
  const breakdown = signals.map((s) => ({
    type: s.type,
    contribution: Math.round((SIGNAL_WEIGHTS[s.type] ?? 0) * (s.confidence ?? 1) * 10) / 10,
  }));
  const rawScore = breakdown.reduce((sum, b) => sum + b.contribution, 0);
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const tier = score >= 55 ? 'critical' : score >= 25 ? 'high' : 'routine';
  return { score, tier, breakdown };
}

module.exports = { scorePriority, SIGNAL_WEIGHTS };
