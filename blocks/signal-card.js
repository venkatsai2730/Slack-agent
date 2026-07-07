// Renders a detected growth signal as a Block Kit alert card: intent type,
// confidence, executive summary, and recommended action, with action buttons
// for Open Thread / View CRM / Assign Owner / Mark False Positive.

const { SIGNAL_EMOJI, SIGNAL_LABEL, STATUS_LABEL, confidenceBar } = require('./constants');

/**
 * @param {import('../services/signalStore').Signal} signal
 * @returns {any[]} Block Kit blocks
 */
function signalCardBlocks(signal) {
  const primary = signal.types.find((t) => t.type === signal.primary_type) || signal.types[0];
  const emoji = SIGNAL_EMOJI[signal.primary_type] || '📡';
  const label = SIGNAL_LABEL[signal.primary_type] || signal.primary_type;

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
        `*Business impact:* ${signal.summary.business_impact}\n` +
        `*People involved:* ${signal.summary.people_involved}`,
    },
  });

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `*🎯 Recommended action:*\n${signal.summary.recommended_next_action}` },
  });

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
      action_id: 'view_crm',
      text: { type: 'plain_text', text: '📇 View CRM' },
      value: signal.signal_id,
    });
    actionElements.push({
      type: 'button',
      action_id: 'assign_owner',
      text: { type: 'plain_text', text: '👤 Assign Owner' },
      value: signal.signal_id,
    });
    actionElements.push({
      type: 'button',
      action_id: 'mark_false_positive',
      text: { type: 'plain_text', text: '🚫 Mark False Positive' },
      style: 'danger',
      value: signal.signal_id,
    });
    blocks.push({ type: 'actions', elements: actionElements });
  }

  const footer = [`Signal ID: \`${signal.signal_id}\``, `Status: ${STATUS_LABEL[signal.status] || signal.status}`];
  if (signal.owner) footer.push(`Owner: <@${signal.owner}>`);
  if (signal.crm_logged) footer.push('📇 Logged to CRM');
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: footer.join(' · ') }] });

  return blocks;
}

module.exports = { signalCardBlocks };
