const { SIGNAL_EMOJI, SIGNAL_LABEL } = require('./constants');

/**
 * @param {{ stats: import('../services/signalStore').statsForToday extends (...args: any) => infer R ? R : never, narrative: string }} params
 */
function reportBlocks({ stats, narrative }) {
  const typeLines =
    Object.entries(stats.by_type)
      .map(([type, n]) => `${SIGNAL_EMOJI[type] || '📡'} ${SIGNAL_LABEL[type] || type}: *${n}*`)
      .join('\n') || '_No new signals today_';

  return [
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
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `💬 ${narrative}` },
    },
  ];
}

module.exports = { reportBlocks };
