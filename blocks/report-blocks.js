const { CATEGORY_EMOJI } = require('./request-card');

function reportBlocks({ stats, narrative }) {
  const categoryLines =
    Object.entries(stats.by_category)
      .map(([cat, n]) => `${CATEGORY_EMOJI[cat] || '🤝'} ${cat}: *${n}*`)
      .join('\n') || '_No new tasks today_';

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🌟 Daily Impact Report — ${stats.date}` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Requests found:*\n${stats.requests_found}` },
        { type: 'mrkdwn', text: `*Tasks created:*\n${stats.tasks_created}` },
        { type: 'mrkdwn', text: `*Tasks completed:*\n${stats.tasks_completed}` },
        { type: 'mrkdwn', text: `*Still open:*\n${stats.open_tasks}` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*By category:*\n${categoryLines}` },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `💬 ${narrative}` },
    },
  ];
}

module.exports = { reportBlocks };
