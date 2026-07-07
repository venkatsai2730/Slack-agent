// Intent Intelligence Engine: classifies a Slack message (plus optional thread
// context) into zero or more business growth signals, each with a confidence
// score, supporting evidence, AI reasoning, and a recommended next action.

const { complete, extractJson } = require('./llm');

/** Fixed vocabulary of signal types the engine is allowed to emit. */
const SIGNAL_TYPES = [
  'pricing_intent',
  'upgrade_intent',
  'expansion_opportunity',
  'feature_request',
  'competitor_mention',
  'integration_request',
  'churn_risk',
  'customer_frustration',
  'positive_sentiment',
  'negative_sentiment',
  'enterprise_buying_intent',
  'decision_maker_involvement',
  'budget_discussion',
  'timeline_discussion',
  'security_concern',
];

// Cheap pre-filter so a plain "lol" or "thanks!" message never reaches the LLM.
const KEYWORD_HINTS =
  /pricing|price|cost|upgrade|downgrade|cancel|churn|competitor|enterprise|security|compliance|integrat|budget|contract|renew|feature request|roadmap|frustrat|not working|slow|bug|urgent|decision.?maker|procurement|timeline|deadline|quote|proposal|CFO|CTO|VP |director/i;

const SYSTEM_PROMPT = `You are a B2B SaaS growth intelligence analyst reviewing a single Slack message (and optional thread context) for a product-led-growth company.

Identify every business signal present, using ONLY these exact type strings: ${SIGNAL_TYPES.join(', ')}.

For each signal you detect, include:
- "type": one of the exact strings above
- "confidence": a number from 0 to 1 reflecting how certain you are
- "evidence": the exact quoted phrase from the message that supports this signal
- "reasoning": one sentence explaining why this text indicates the signal
- "recommended_action": one concrete next step for a Growth, Sales, Customer Success, or Product team member

Respond with ONLY a JSON object, no other text:
{ "signals": [ { "type": "...", "confidence": 0.0, "evidence": "...", "reasoning": "...", "recommended_action": "..." } ] }

If no meaningful business signal is present (e.g. small talk, a bot command, an unrelated question), respond with { "signals": [] }. Never invent a signal the text doesn't support.`;

/**
 * @typedef {Object} DetectedSignal
 * @property {string} type
 * @property {number} confidence
 * @property {string} evidence
 * @property {string} reasoning
 * @property {string} recommended_action
 */

/**
 * Fast, dependency-free check for whether a message is worth sending to the LLM.
 * @param {string} [text]
 * @returns {boolean}
 */
function hasKeywordHint(text = '') {
  return KEYWORD_HINTS.test(text);
}

/**
 * Detects growth signals in a message using the LLM, gated by a keyword
 * pre-filter to avoid spending an LLM call on every single Slack message.
 * @param {string} text
 * @param {{ threadContext?: string }} [opts]
 * @returns {Promise<DetectedSignal[]>}
 */
async function detectSignals(text, { threadContext = '' } = {}) {
  if (!text || !text.trim()) return [];
  if (!hasKeywordHint(text) && !hasKeywordHint(threadContext)) return [];

  const userPrompt = threadContext
    ? `Message:\n"""${text}"""\n\nThread context (earlier messages, oldest first):\n"""${threadContext}"""`
    : `Message:\n"""${text}"""`;

  let parsed = { signals: [] };
  try {
    const raw = await complete(SYSTEM_PROMPT, userPrompt);
    parsed = extractJson(raw, { signals: [] });
  } catch (err) {
    console.error('Intent detection failed:', err.message);
    return [];
  }

  const rawSignals = Array.isArray(parsed.signals) ? parsed.signals : [];
  return rawSignals
    .filter((s) => SIGNAL_TYPES.includes(s.type))
    .map((s) => ({
      type: s.type,
      confidence: Math.max(0, Math.min(1, Number(s.confidence) || 0)),
      evidence: String(s.evidence || '').slice(0, 300),
      reasoning: String(s.reasoning || '').slice(0, 300),
      recommended_action: String(s.recommended_action || '').slice(0, 200),
    }));
}

module.exports = { SIGNAL_TYPES, detectSignals, hasKeywordHint };
