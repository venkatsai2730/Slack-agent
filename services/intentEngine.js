// Community Signal Engine: classifies a Slack message (plus optional thread
// context) into zero or more community-impact signals — calls for help, offers
// of help, and coordination moments — each with a confidence score, supporting
// evidence, AI reasoning, and a recommended next action.

const { complete, extractJson, sanitizeForPrompt } = require('./llm');

/** Fixed vocabulary of signal types the engine is allowed to emit. */
const SIGNAL_TYPES = [
  // Needs — someone requires help
  'help_request',
  'urgent_need',
  'transport_need',
  'food_insecurity',
  'housing_need',
  'medical_need',
  'emotional_support_need',
  'resource_request',
  // Offers — someone has capacity to help
  'volunteer_offer',
  'donation_offer',
  'skill_offer',
  'resource_available',
  // Coordination & outcomes
  'event_coordination',
  'gratitude_report',
  'follow_up_needed',
];

// Cheap pre-filter so a plain "lol" or "see you at standup" message never reaches the LLM.
const KEYWORD_HINTS =
  /help|need|volunteer|donat|urgent|emergency|support|assist|struggling|food|meal|grocer|hungry|pantry|shelter|housing|homeless|evict|rent|ride|drive|transport|pick.?up|medicine|prescription|doctor|medical|clinic|pharmacy|lonely|anxious|overwhelmed|crisis|supplies|clothes|clothing|furniture|blanket|fundrais|collect|spare|drop.?off|can anyone|anyone able|looking for|available to|happy to|offer|thank you so much|childcare|babysit|elderly|senior|disabled|wheelchair|accessib/i;

const SYSTEM_PROMPT = `You are a community-impact analyst reviewing a single Slack message (and optional thread context) for a mutual-aid / nonprofit community workspace. Your job is to make sure no call for help — and no offer of help — goes unnoticed.

Identify every community signal present, using ONLY these exact type strings: ${SIGNAL_TYPES.join(', ')}.

For each signal you detect, include:
- "type": one of the exact strings above
- "confidence": a number from 0 to 1 reflecting how certain you are
- "evidence": the exact quoted phrase from the message that supports this signal
- "reasoning": one sentence explaining why this text indicates the signal
- "recommended_action": one concrete next step for a community coordinator or volunteer

Respond with ONLY a JSON object, no other text:
{ "signals": [ { "type": "...", "confidence": 0.0, "evidence": "...", "reasoning": "...", "recommended_action": "..." } ] }

If no meaningful community signal is present (e.g. small talk, a bot command, an unrelated question), respond with { "signals": [] }. Never invent a signal the text doesn't support. Treat mentions of medical distress, housing loss, or food insecurity as high-confidence needs even when phrased indirectly or with embarrassment.`;

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
 * Detects community signals in a message using the LLM, gated by a keyword
 * pre-filter to avoid spending an LLM call on every single Slack message.
 * @param {string} text
 * @param {{ threadContext?: string }} [opts]
 * @returns {Promise<DetectedSignal[]>}
 */
async function detectSignals(text, { threadContext = '' } = {}) {
  if (!text || !text.trim()) return [];
  if (!hasKeywordHint(text) && !hasKeywordHint(threadContext)) return [];

  const userPrompt = threadContext
    ? `Message:\n"""${sanitizeForPrompt(text)}"""\n\nThread context (earlier messages, oldest first):\n"""${sanitizeForPrompt(threadContext)}"""`
    : `Message:\n"""${sanitizeForPrompt(text)}"""`;

  let parsed = { signals: [] };
  try {
    const raw = await complete(SYSTEM_PROMPT, userPrompt);
    parsed = extractJson(raw, { signals: [] });
  } catch (err) {
    console.error('Signal detection failed:', err.message);
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
