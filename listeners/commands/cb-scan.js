const rts = require('../../services/rts');
const { runScan, parseHoursBack, makeChannelPoster } = require('../../services/scan');

module.exports = (app) => {
  app.command('/cb-scan', async ({ command, ack, respond, client, logger, context }) => {
    await ack();

    // Slash command payloads never include an action_token (required for RTS with a
    // bot token) — fall back to the freshest one cached from recent events. If none
    // is cached, runScan() still works via searchService's conversations.history fallback.
    const actionToken = rts.getCachedActionToken();
    const hoursBack = parseHoursBack(command.text.trim());

    try {
      await runScan({
        client,
        channelId: command.channel_id,
        hoursBack,
        actionToken,
        botUserId: context.botUserId,
        post: makeChannelPoster(client, command.channel_id),
      });
    } catch (err) {
      logger.error('Scan failed:', err);
      await respond({ response_type: 'ephemeral', text: `⚠️ Scan failed: \`${err.data?.error || err.message}\`` });
    }
  });
};
