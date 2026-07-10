// Generates coordinator-ready summaries of a signal-bearing conversation, for
// display in Slack alert cards and the /cb-impact digest.

const { complete, extractJson, sanitizeForPrompt } = require('./llm');

const SYSTEM_PROMPT = `You are a community-impact analyst writing a short summary of a Slack conversation for mutual-aid coordinators, nonprofit staff, and volunteers.

You will be given the message, optional thread context, the community signals already detected, and (when available) a JSON "workspace_history" object describing prior related activity in this workspace — repeat requesters, recurring signals in this channel, unresolved similar signals elsewhere, and volunteers with a track record of completed matches. Treat workspace_history as ground truth about the past; never invent history it doesn't contain, and omit any reasoning about recurrence/volunteers if workspace_history is absent or shows no prior activity.

Respond with ONLY a JSON object:
{
  "what_happened": "1-2 factual sentences describing the conversation",
  "why_it_matters": "1-2 sentences on why this matters for the community",
  "community_impact": "high, medium, or low, followed by a short reason, e.g. \\"high — elderly resident without transport to a medical appointment\\"",
  "people_involved": "names, roles, or Slack handles mentioned, or \\"unknown\\" if none",
  "recommended_next_action": "one concrete, specific next step a coordinator or volunteer can take",
  "recurrence_summary": "1 sentence naming any recurrence pattern from workspace_history (e.g. \\"fourth transport request from this channel in 9 days\\"), or \\"\\" if none",
  "risk_assessment": "1 sentence on risk if this goes unaddressed, informed by priority and recurrence",
  "volunteer_recommendation": "name a specific repeat volunteer from workspace_history if one fits, else \\"\\"",
  "confidence_score": "integer 0-100, your confidence in this overall assessment",
  "reasoning": "1-2 sentences explaining the recommendation, referencing workspace_history when used",
  "alternative_options": "one alternative next step besides the primary recommendation, or \\"\\"",
  "escalation_recommendation": "\\"yes\\" or \\"no\\", whether this should be escalated to a human coordinator now",
  "expected_impact": "1 short sentence on the expected outcome if the recommended action is taken"
}

Be warm but factual. Never exaggerate distress, and never minimize it.`;

/**
 * @typedef {Object} ImpactSummary
 * @property {string} what_happened
 * @property {string} why_it_matters
 * @property {string} community_impact
 * @property {string} people_involved
 * @property {string} recommended_next_action
 * @property {string} [recurrence_summary] present when produced via summarizeConversation(); absent from hand-built summaries (e.g. test fixtures)
 * @property {string} [risk_assessment]
 * @property {string} [volunteer_recommendation]
 * @property {number} [confidence_score]
 * @property {string} [reasoning]
 * @property {string} [alternative_options]
 * @property {'yes'|'no'} [escalation_recommendation]
 * @property {string} [expected_impact]
 */

/**
 * @param {{ text: string, threadContext?: string, signals?: import('./intentEngine').DetectedSignal[], history?: Awaited<ReturnType<import('./workspaceContext').buildContext>>|null }} opts
 * @returns {Promise<ImpactSummary>}
 */
async function summarizeConversation({ text, threadContext = '', signals = [], history = null }) {
  const fallback = {
    what_happened: text.slice(0, 200),
    why_it_matters: signals.length ? 'Contains a detected community signal.' : 'No strong signal detected.',
    community_impact: signals.length ? 'medium' : 'low',
    people_involved: 'unknown',
    recommended_next_action: signals[0]?.recommended_action || 'Review the thread for context.',
    recurrence_summary: history?.is_recurring ? history.summary_text : '',
    risk_assessment: history?.is_recurring ? 'Recurring pattern detected — a one-off response may not address the underlying need.' : 'No recurrence detected.',
    volunteer_recommendation: history?.repeat_volunteers?.[0]?.author_name || '',
    confidence_score: signals.length ? Math.round(Math.max(...signals.map((s) => s.confidence)) * 100) : 0,
    reasoning: history?.summary_text || 'No workspace history available.',
    alternative_options: '',
    escalation_recommendation: history?.is_recurring ? 'yes' : 'no',
    expected_impact: 'Connects this need with a helper or logs it for coordinator follow-up.',
  };

  const userPrompt =
    `Message:\n"""${sanitizeForPrompt(text)}"""\n\n` +
    `Thread context:\n"""${sanitizeForPrompt(threadContext) || 'none'}"""\n\n` +
    `Detected signals:\n${JSON.stringify(signals)}\n\n` +
    `workspace_history:\n${JSON.stringify(history || { note: 'no workspace history available' })}`;

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
    recurrence_summary: String(parsed.recurrence_summary ?? fallback.recurrence_summary).slice(0, 300),
    risk_assessment: String(parsed.risk_assessment ?? fallback.risk_assessment).slice(0, 300),
    volunteer_recommendation: String(parsed.volunteer_recommendation ?? fallback.volunteer_recommendation).slice(0, 200),
    confidence_score: Math.max(0, Math.min(100, Number(parsed.confidence_score ?? fallback.confidence_score) || 0)),
    reasoning: String(parsed.reasoning ?? fallback.reasoning).slice(0, 400),
    alternative_options: String(parsed.alternative_options ?? fallback.alternative_options).slice(0, 300),
    escalation_recommendation: /** @type {'yes'|'no'} */ (
      parsed.escalation_recommendation === 'yes' ? 'yes' : parsed.escalation_recommendation === 'no' ? 'no' : fallback.escalation_recommendation
    ),
    expected_impact: String(parsed.expected_impact ?? fallback.expected_impact).slice(0, 300),
  };
}

module.exports = { summarizeConversation };
