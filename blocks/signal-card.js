// Renders a detected community signal as a Block Kit alert card: signal type,
// confidence, priority, coordinator summary, AI coordinator reasoning
// (Feature 7), a branch-labeled match recommendation (Feature 3), and action
// buttons for Open Thread / View Case / View Timeline / I Can Help / Not a
// Request, plus branch-specific Confirm/Approve/Reject buttons.

const { SIGNAL_EMOJI, SIGNAL_LABEL, STATUS_LABEL, TIER_EMOJI, confidenceBar } = require('./constants');
const { scorePriority } = require('../services/priorityScore');

const BRANCH_LABEL = { high: '✅ High confidence — auto-recommended', medium: '🤔 Medium confidence — needs coordinator review', low: '📣 Low confidence — outreach posted' };

/** Encodes the pair a match action button needs to act on. */
function matchActionValue(signal, candidateSignalId) {
  return JSON.stringify({ signal_id: signal.signal_id, candidate_id: candidateSignalId });
}

/**
 * @param {import('../services/signalStore').Signal} signal
 * @returns {any[]} Block Kit blocks
 */
function signalCardBlocks(signal) {
  const primary = signal.types.find((t) => t.type === signal.primary_type) || signal.types[0];
  const emoji = SIGNAL_EMOJI[signal.primary_type] || '📡';
  const label = SIGNAL_LABEL[signal.primary_type] || signal.primary_type;
  const priority = scorePriority(signal.types);

  /** @type {any[]} */
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${emoji} ${label} detected` },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*Priority:* ${TIER_EMOJI[priority.tier]} ${priority.tier} (${priority.score}/100)\n` +
          `*Confidence:* ${confidenceBar(primary.confidence)} ${Math.round(primary.confidence * 100)}%\n` +
          `*Evidence:* _"${primary.evidence}"_`,
      },
    },
  ];

  const otherTypes = signal.types.filter((t) => t.type !== signal.primary_type);
  if (otherTypes.length) {
    const others = otherTypes
      .map((t) => `${SIGNAL_EMOJI[t.type] || '📡'} ${SIGNAL_LABEL[t.type] || t.type} (${Math.round(t.confidence * 100)}%)`)
      .join(', ');
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `Also detected: ${others}` }] });
  }

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text:
        `*Summary:* ${signal.summary.what_happened}\n` +
        `*Why it matters:* ${signal.summary.why_it_matters}\n` +
        `*Community impact:* ${signal.summary.community_impact}\n` +
        `*People involved:* ${signal.summary.people_involved}`,
    },
  });

  // Feature 7: AI Coordinator Reasoning — only shown when the summary carries
  // history-informed reasoning (recurrence, risk, a volunteer suggestion, etc.)
  // rather than cluttering a plain first-time signal with empty fields.
  const s = signal.summary;
  const hasReasoning = s.recurrence_summary || s.risk_assessment || s.volunteer_recommendation || s.reasoning;
  if (hasReasoning) {
    const lines = [];
    if (s.recurrence_summary) lines.push(`*Recurrence:* ${s.recurrence_summary}`);
    if (s.risk_assessment) lines.push(`*Risk if unaddressed:* ${s.risk_assessment}`);
    if (s.reasoning) lines.push(`*Reasoning:* ${s.reasoning}`);
    if (s.volunteer_recommendation) lines.push(`*Volunteer suggestion:* ${s.volunteer_recommendation}`);
    if (s.alternative_options) lines.push(`*Alternative:* ${s.alternative_options}`);
    if (s.expected_impact) lines.push(`*Expected impact:* ${s.expected_impact}`);
    lines.push(`*AI confidence:* ${s.confidence_score}/100${s.escalation_recommendation === 'yes' ? ' · ⚠️ escalation recommended' : ''}`);
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*🧠 AI Coordinator Reasoning*\n${lines.join('\n')}` },
    });
  }

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `*🎯 Recommended action:*\n${signal.summary.recommended_next_action}` },
  });

  // Feature 3: branch-labeled match recommendation, replacing the old flat list.
  const rec = signal.match_recommendation;
  if (rec && rec.branch) {
    const branchLabel = BRANCH_LABEL[rec.branch] || rec.branch;
    if (rec.candidate) {
      const cLabel = `${SIGNAL_EMOJI[rec.candidate.primary_type] || '📡'} ${SIGNAL_LABEL[rec.candidate.primary_type] || rec.candidate.primary_type}`;
      const cLink = rec.candidate.permalink ? `<${rec.candidate.permalink}|${cLabel}>` : cLabel;
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text:
            `*🤝 Match decision:* ${branchLabel} (${Math.round(rec.confidence * 100)}%)\n` +
            `${cLink} — ${rec.candidate.what_happened}\n` +
            `_${rec.explanation}_`,
        },
      });
      if (!signal.confirmed_match && signal.status !== 'false_positive') {
        if (rec.branch === 'high') {
          blocks.push({
            type: 'actions',
            elements: [
              {
                type: 'button',
                action_id: 'confirm_match',
                text: { type: 'plain_text', text: '✅ Confirm Match' },
                style: 'primary',
                value: matchActionValue(signal, rec.candidate.signal_id),
              },
            ],
          });
        } else if (rec.branch === 'medium') {
          blocks.push({
            type: 'actions',
            elements: [
              {
                type: 'button',
                action_id: 'approve_match',
                text: { type: 'plain_text', text: '👍 Approve Match' },
                style: 'primary',
                value: matchActionValue(signal, rec.candidate.signal_id),
              },
              {
                type: 'button',
                action_id: 'reject_match',
                text: { type: 'plain_text', text: '👎 Reject' },
                value: matchActionValue(signal, rec.candidate.signal_id),
              },
            ],
          });
        }
      }
    } else {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*🤝 Match decision:* ${branchLabel}\n_${rec.explanation}_` },
      });
    }
  }

  if (signal.status !== 'false_positive') {
    const actionElements = [];
    if (signal.message.permalink) {
      actionElements.push({
        type: 'button',
        action_id: 'open_thread',
        text: { type: 'plain_text', text: '🧵 Open Thread' },
        url: signal.message.permalink,
      });
    }
    actionElements.push({
      type: 'button',
      action_id: 'view_case',
      text: { type: 'plain_text', text: '📇 View Case History' },
      value: signal.signal_id,
    });
    actionElements.push({
      type: 'button',
      action_id: 'view_timeline',
      text: { type: 'plain_text', text: '🕒 View Timeline' },
      value: signal.signal_id,
    });
    // Once a signal is resolved (a match was confirmed, or it was manually
    // closed), claiming it or marking it a false positive no longer makes
    // sense — and marking it "not a request" here would overwrite
    // resolution.resolution_type from 'matched' to 'false_positive'. Keep the
    // informational buttons above; drop the state-changing ones.
    if (!signal.resolution?.resolved) {
      actionElements.push({
        type: 'button',
        action_id: 'claim_help',
        text: { type: 'plain_text', text: '🙋 I Can Help' },
        style: 'primary',
        value: signal.signal_id,
      });
      actionElements.push({
        type: 'button',
        action_id: 'not_a_request',
        text: { type: 'plain_text', text: '🚫 Not a Request' },
        style: 'danger',
        value: signal.signal_id,
      });
    }
    blocks.push({ type: 'actions', elements: actionElements });
  }

  const footer = [`Signal ID: \`${signal.signal_id}\``, `Status: ${STATUS_LABEL[signal.status] || signal.status}`];
  if (signal.owner) footer.push(`Helper: <@${signal.owner}>`);
  if (signal.crm_logged) footer.push('📇 Logged to case log');
  if (signal.confirmed_match) footer.push(`✅ Matched (${Math.round(signal.confirmed_match.confidence * 100)}%)`);
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: footer.join(' · ') }] });

  return blocks;
}

module.exports = { signalCardBlocks };
