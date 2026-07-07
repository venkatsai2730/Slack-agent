// Renders a detected community signal as a Block Kit alert card: signal type,
// confidence, priority, coordinator summary, recommended action, and possible
// need ↔ offer matches, with action buttons for Open Thread / View Case /
// I Can Help / Not a Request.

const { SIGNAL_EMOJI, SIGNAL_LABEL, STATUS_LABEL, TIER_EMOJI, confidenceBar } = require('./constants');
const { scorePriority } = require('../services/priorityScore');

/**
 * @param {import('../services/signalStore').Signal} signal
 * @param {{ matches?: import('../services/signalStore').Signal[] }} [opts] complementary
 *   open signals (needs for an offer, offers for a need), from services/matchService.js
 * @returns {any[]} Block Kit blocks
 */
function signalCardBlocks(signal, { matches = [] } = {}) {
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

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `*🎯 Recommended action:*\n${signal.summary.recommended_next_action}` },
  });

  if (matches.length) {
    const matchLines = matches.map((m) => {
      const mLabel = `${SIGNAL_EMOJI[m.primary_type] || '📡'} ${SIGNAL_LABEL[m.primary_type] || m.primary_type}`;
      const what = m.summary?.what_happened || '';
      return m.message?.permalink ? `• <${m.message.permalink}|${mLabel}> — ${what}` : `• ${mLabel} — ${what}`;
    });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*🤝 Possible matches (open right now):*\n${matchLines.join('\n')}` },
    });
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
    blocks.push({ type: 'actions', elements: actionElements });
  }

  const footer = [`Signal ID: \`${signal.signal_id}\``, `Status: ${STATUS_LABEL[signal.status] || signal.status}`];
  if (signal.owner) footer.push(`Helper: <@${signal.owner}>`);
  if (signal.crm_logged) footer.push('📇 Logged to case log');
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: footer.join(' · ') }] });

  return blocks;
}

module.exports = { signalCardBlocks };
