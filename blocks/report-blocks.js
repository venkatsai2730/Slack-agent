const { SIGNAL_EMOJI, SIGNAL_LABEL } = require('./constants');

/**
 * @param {{ stats: import('../services/signalStore').statsForToday extends (...args: any) => infer R ? R : never, analytics?: ReturnType<import('../services/analytics').buildAnalytics>, narrative: string }} params
 */
function reportBlocks({ stats, analytics, narrative }) {
  const typeLines =
    Object.entries(stats.by_type)
      .map(([type, n]) => `${SIGNAL_EMOJI[type] || '📡'} ${SIGNAL_LABEL[type] || type}: *${n}*`)
      .join('\n') || '_No new signals today_';

  /** @type {any[]} */
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🌟 Community Impact Report — ${stats.date}` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Signals found:*\n${stats.signals_found}` },
        { type: 'mrkdwn', text: `*Signals created:*\n${stats.signals_created}` },
        { type: 'mrkdwn', text: `*Still open:*\n${stats.open_signals}` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*By signal type:*\n${typeLines}` },
    },
  ];

  if (analytics) {
    blocks.push(
      { type: 'divider' },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Matches confirmed:*\n${analytics.successful_matches}` },
          { type: 'mrkdwn', text: `*Escalations sent:*\n${analytics.escalations.signals_escalated}` },
          { type: 'mrkdwn', text: `*Auto-triaged (HIGH):*\n${analytics.confidence_distribution.high}` },
          { type: 'mrkdwn', text: `*Est. coordinator hours saved:*\n${analytics.estimated_coordinator_hours_saved}h` },
        ],
      }
    );
  }

  blocks.push(
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `💬 ${narrative}` },
    }
  );

  return blocks;
}

module.exports = { reportBlocks };
