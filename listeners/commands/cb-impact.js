const { buildDailyReport } = require('../../services/report');
const { reportBlocks } = require('../../blocks/report-blocks');

module.exports = (app) => {
  app.command('/cb-impact', async ({ command, ack, respond, client, logger }) => {
    await ack();
    await respond({ response_type: 'ephemeral', text: '📝 Writing today\'s community impact report...' });

    try {
      const report = await buildDailyReport();
      const message = { blocks: reportBlocks(report), text: `Community Impact Report — ${report.stats.date}` };

      const target = process.env.COMMUNITY_ALERTS_CHANNEL;
      try {
        await client.chat.postMessage({ channel: target || command.channel_id, ...message });
      } catch (err) {
        if (target) {
          // Bot not in COMMUNITY_ALERTS_CHANNEL (or bad name) — try the current channel instead.
          logger.warn(`Could not post to ${target} (${err.data?.error || err.message}); posting in current channel.`);
        }
        try {
          await client.chat.postMessage({ channel: command.channel_id, ...message });
        } catch (err2) {
          // Bot isn't a member of the current channel either (not_in_channel) — fall back to
          // the slash command's response_url, which works without channel membership, so a
          // forgotten `/invite @Community Beacon` doesn't hard-fail the report.
          logger.warn(`Could not post to current channel (${err2.data?.error || err2.message}); using response_url.`);
          await respond({ response_type: 'in_channel', ...message });
        }
      }
    } catch (err) {
      logger.error('Report failed:', err);
      await respond({ response_type: 'ephemeral', text: `⚠️ Report failed: \`${err.data?.error || err.message}\`` });
    }
  });
};
