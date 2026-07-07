const { buildDailyReport } = require('../../services/report');
const { reportBlocks } = require('../../blocks/report-blocks');

module.exports = (app) => {
  app.command('/gb-report', async ({ command, ack, respond, client, logger }) => {
    await ack();
    await respond({ response_type: 'ephemeral', text: '📝 Writing today\'s growth intelligence report...' });

    try {
      const report = await buildDailyReport();
      const message = { blocks: reportBlocks(report), text: `Growth Intelligence Report — ${report.stats.date}` };

      const target = process.env.GROWTH_ALERTS_CHANNEL;
      try {
        await client.chat.postMessage({ channel: target || command.channel_id, ...message });
      } catch (err) {
        if (!target) throw err;
        // Bot not in GROWTH_ALERTS_CHANNEL (or bad name) — post here instead so the demo never stalls.
        logger.warn(`Could not post to ${target} (${err.data?.error || err.message}); posting in current channel.`);
        await client.chat.postMessage({ channel: command.channel_id, ...message });
      }
    } catch (err) {
      logger.error('Report failed:', err);
      await respond({ response_type: 'ephemeral', text: `⚠️ Report failed: \`${err.data?.error || err.message}\`` });
    }
  });
};
