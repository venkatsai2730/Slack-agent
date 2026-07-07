// Simple, explainable lead-scoring model: weighted sum of detected signal
// confidences, clamped to 0-100 with a hot/warm/cold tier. Intentionally not an
// LLM call — scoring should be fast, deterministic, and auditable.

/** @type {Record<string, number>} */
const SIGNAL_WEIGHTS = {
  enterprise_buying_intent: 30,
  budget_discussion: 20,
  decision_maker_involvement: 20,
  pricing_intent: 15,
  upgrade_intent: 15,
  expansion_opportunity: 15,
  timeline_discussion: 10,
  integration_request: 8,
  feature_request: 5,
  competitor_mention: 5,
  positive_sentiment: 3,
  security_concern: 0,
  negative_sentiment: -5,
  customer_frustration: -10,
  churn_risk: -20,
};

/**
 * Only reads `type` and `confidence`, so callers may pass either full
 * DetectedSignal objects or a minimal { type, confidence } shape (e.g. from an
 * MCP client that only knows the signal type and score, not the full evidence).
 * @param {{ type: string, confidence?: number }[]} signals
 * @returns {{ score: number, tier: 'hot'|'warm'|'cold', breakdown: { type: string, contribution: number }[] }}
 */
function scoreLead(signals = []) {
  const breakdown = signals.map((s) => ({
    type: s.type,
    contribution: Math.round((SIGNAL_WEIGHTS[s.type] ?? 0) * (s.confidence ?? 1) * 10) / 10,
  }));
  const rawScore = breakdown.reduce((sum, b) => sum + b.contribution, 0);
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const tier = score >= 70 ? 'hot' : score >= 40 ? 'warm' : 'cold';
  return { score, tier, breakdown };
}

module.exports = { scoreLead, SIGNAL_WEIGHTS };
