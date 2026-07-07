// Generates coordinator-ready summaries of a signal-bearing conversation, for
// display in Slack alert cards and the /cb-impact digest.

const { complete, extractJson } = require('./llm');

const SYSTEM_PROMPT = `You are a community-impact analyst writing a short summary of a Slack conversation for mutual-aid coordinators, nonprofit staff, and volunteers.

Given the message, optional thread context, and the community signals already detected, respond with ONLY a JSON object:
{
  "what_happened": "1-2 factual sentences describing the conversation",
  "why_it_matters": "1-2 sentences on why this matters for the community",
  "community_impact": "high, medium, or low, followed by a short reason, e.g. \\"high — elderly resident without transport to a medical appointment\\"",
  "people_involved": "names, roles, or Slack handles mentioned, or \\"unknown\\" if none",
  "recommended_next_action": "one concrete, specific next step a coordinator or volunteer can take"
}

Be warm but factual. Never exaggerate distress, and never minimize it.`;

/**
 * @typedef {Object} ImpactSummary
 * @property {string} what_happened
 * @property {string} why_it_matters
 * @property {string} community_impact
 * @property {string} people_involved
 * @property {string} recommended_next_action
 */

/**
 * @param {{ text: string, threadContext?: string, signals?: import('./intentEngine').DetectedSignal[] }} opts
 * @returns {Promise<ImpactSummary>}
 */
async function summarizeConversation({ text, threadContext = '', signals = [] }) {
  const fallback = {
    what_happened: text.slice(0, 200),
    why_it_matters: signals.length ? 'Contains a detected community signal.' : 'No strong signal detected.',
    community_impact: signals.length ? 'medium' : 'low',
    people_involved: 'unknown',
    recommended_next_action: signals[0]?.recommended_action || 'Review the thread for context.',
  };

  const userPrompt =
    `Message:\n"""${text}"""\n\n` +
    `Thread context:\n"""${threadContext || 'none'}"""\n\n` +
    `Detected signals:\n${JSON.stringify(signals)}`;

  let parsed = fallback;
  try {
    const raw = await complete(SYSTEM_PROMPT, userPrompt);
    parsed = extractJson(raw, fallback);
  } catch (err) {
    console.error('Summary generation failed, using fallback:', err.message);
  }

  return {
    what_happened: String(parsed.what_happened || fallback.what_happened).slice(0, 400),
    why_it_matters: String(parsed.why_it_matters || fallback.why_it_matters).slice(0, 400),
    community_impact: String(parsed.community_impact || fallback.community_impact).slice(0, 200),
    people_involved: String(parsed.people_involved || fallback.people_involved).slice(0, 200),
    recommended_next_action: String(parsed.recommended_next_action || fallback.recommended_next_action).slice(0, 300),
  };
}

module.exports = { summarizeConversation };
