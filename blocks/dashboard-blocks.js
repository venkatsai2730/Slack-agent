// Slack-native impact dashboard, rendered into the App Home tab. No separate
// web server — the app has zero HTTP surface by design (Socket Mode only).

const { SIGNAL_EMOJI, SIGNAL_LABEL } = require('./constants');

const SPARK_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/**
 * Renders a 7-value trend as a compact unicode sparkline.
 * @param {number[]} counts
 * @returns {string}
 */
function sparkline(counts) {
  const max = Math.max(1, ...counts);
  return counts.map((c) => SPARK_CHARS[Math.min(SPARK_CHARS.length - 1, Math.floor((c / max) * (SPARK_CHARS.length - 1)))]).join('');
}

/**
 * @param {ReturnType<import('../services/signalStore').statsSummary>} stats
 * @returns {any[]} Block Kit blocks for the App Home "home" view
 */
function dashboardBlocks(stats) {
  const topTypes = Object.entries(stats.by_type).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const typeLines =
    topTypes.map(([type, n]) => `${SIGNAL_EMOJI[type] || '📡'} ${SIGNAL_LABEL[type] || type}: *${n}*`).join('\n') ||
    '_No signals detected yet — try `@Community Beacon scan` in a channel._';
  const channelLines = stats.top_channels.map(([ch, n]) => `<#${ch}>: *${n}*`).join('\n') || '_No channel activity yet._';
  const memberLines = stats.top_members.map(([m, n]) => `${m}: *${n}*`).join('\n') || '_No member activity yet._';

  return [
    { type: 'header', text: { type: 'plain_text', text: '🤝 Community Beacon — Impact Dashboard' } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Total signals:*\n${stats.total_signals}` },
        { type: 'mrkdwn', text: `*Today:*\n${stats.signals_today}` },
        { type: 'mrkdwn', text: `*Last 7 days:*\n${stats.signals_last_7_days}` },
        { type: 'mrkdwn', text: `*Open (waiting for a helper):*\n${stats.open_signals}` },
      ],
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*🙋 Community needs:*\n${stats.community_needs}` },
        { type: 'mrkdwn', text: `*🙌 Offers of help:*\n${stats.offers_of_help}` },
        { type: 'mrkdwn', text: `*🚨 Urgent needs:*\n${stats.urgent_needs}` },
        { type: 'mrkdwn', text: `*✅ Claimed by helpers:*\n${stats.claimed_signals}` },
      ],
    },
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: `*7-day trend:* \`${sparkline(stats.trend_7d)}\`` } },
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: `*Top signal types:*\n${typeLines}` } },
    { type: 'section', text: { type: 'mrkdwn', text: `*Most active channels:*\n${channelLines}` } },
    { type: 'section', text: { type: 'mrkdwn', text: `*Most active members:*\n${memberLines}` } },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `Not-a-request reports: ${stats.false_positives} · Last updated ${new Date().toLocaleString()}` },
      ],
    },
  ];
}

module.exports = { dashboardBlocks };
