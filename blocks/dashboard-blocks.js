// Slack-native impact dashboard, rendered into the App Home tab. No separate
// web server — the app has zero HTTP surface by design (Socket Mode only).

const { SIGNAL_EMOJI, SIGNAL_LABEL, TIER_EMOJI } = require('./constants');

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
 * @param {ReturnType<import('../services/analytics').buildAnalytics>} [analytics]
 * @returns {any[]} Block Kit blocks for the App Home "home" view
 */
function dashboardBlocks(stats, analytics) {
  const topTypes = Object.entries(stats.by_type).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const typeLines =
    topTypes.map(([type, n]) => `${SIGNAL_EMOJI[type] || '📡'} ${SIGNAL_LABEL[type] || type}: *${n}*`).join('\n') ||
    '_No signals detected yet — try `@Community Beacon scan` in a channel._';
  const channelLines = stats.top_channels.map(([ch, n]) => `<#${ch}>: *${n}*`).join('\n') || '_No channel activity yet._';
  const memberLines = stats.top_members.map(([m, n]) => `${m}: *${n}*`).join('\n') || '_No member activity yet._';

  /** @type {any[]} */
  const blocks = [
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
  ];

  if (analytics) blocks.push(...analyticsWidgetBlocks(analytics));

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `Not-a-request reports: ${stats.false_positives} · Last updated ${new Date().toLocaleString()}` }],
  });

  return blocks;
}

/**
 * Feature 4/8 widgets: workspace trends, recurring requests, heatmap,
 * volunteer performance, signal aging, escalation queue, confidence
 * distribution, and impact metrics — all sourced from services/analytics.js.
 * @param {ReturnType<import('../services/analytics').buildAnalytics>} analytics
 */
function analyticsWidgetBlocks(analytics) {
  const heatmapLines =
    analytics.district_heatmap.slice(0, 5).map(({ channel_id, count }) => `<#${channel_id}>: *${count}*`).join('\n') || '_No channel activity yet._';
  const requesterLines =
    analytics.repeat_requesters.map((r) => `${r.author_name}: *${r.signal_count}* signals`).join('\n') || '_No repeat requesters yet._';
  const volunteerLines =
    analytics.repeat_volunteers.map((v) => `${v.author_name}: *${v.completed_matches}* completed match(es)`).join('\n') || '_No confirmed matches yet._';
  const agingLines =
    analytics.oldest_unresolved.map((s) => `${TIER_EMOJI[s.tier] || ''} ${s.primary_type} — *${s.age_hours}h* old (<#${s.channel_id}>)`).join('\n') ||
    '_Nothing unresolved right now._';
  const confidence = analytics.confidence_distribution;

  return [
    { type: 'divider' },
    { type: 'header', text: { type: 'plain_text', text: '🧭 Agentic reasoning & impact' } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Median response time:*\n${analytics.response_time.median_minutes} min` },
        { type: 'mrkdwn', text: `*Median time-to-match:*\n${analytics.time_to_match.median_minutes} min` },
        { type: 'mrkdwn', text: `*Critical avg response:*\n${analytics.response_time.critical_average_minutes} min` },
        { type: 'mrkdwn', text: `*Routine avg response:*\n${analytics.response_time.routine_average_minutes} min` },
      ],
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Auto-triaged (HIGH):*\n${confidence.high}` },
        { type: 'mrkdwn', text: `*Needs review (MEDIUM):*\n${confidence.medium}` },
        { type: 'mrkdwn', text: `*Outreach posted (LOW):*\n${confidence.low}` },
        { type: 'mrkdwn', text: `*Successful matches:*\n${analytics.successful_matches}` },
      ],
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Escalations sent:*\n${analytics.escalations.signals_escalated}` },
        { type: 'mrkdwn', text: `*Coordinator interventions:*\n${analytics.coordinator_interventions}` },
        { type: 'mrkdwn', text: `*Volunteer utilization:*\n${Math.round(analytics.volunteer_utilization.utilization_rate * 100)}%` },
        { type: 'mrkdwn', text: `*Est. coordinator hours saved:*\n${analytics.estimated_coordinator_hours_saved}h` },
      ],
    },
    { type: 'section', text: { type: 'mrkdwn', text: `*📈 14-day trend:* \`${sparkline(analytics.trend_daily_14d)}\`` } },
    { type: 'section', text: { type: 'mrkdwn', text: `*🗺️ District demand heatmap (by channel):*\n${heatmapLines}` } },
    { type: 'section', text: { type: 'mrkdwn', text: `*🔁 Repeat requesters:*\n${requesterLines}` } },
    { type: 'section', text: { type: 'mrkdwn', text: `*🙌 Repeat volunteers:*\n${volunteerLines}` } },
    { type: 'section', text: { type: 'mrkdwn', text: `*⏳ Signal aging (oldest unresolved):*\n${agingLines}` } },
  ];
}

module.exports = { dashboardBlocks };
