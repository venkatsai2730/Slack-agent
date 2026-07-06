const rts = require('../../services/rts');
const { runScan } = require('../../services/scan');

module.exports = (app) => {
  app.command('/scan-requests', async ({ command, ack, respond, client, logger, context }) => {
    await ack();

    // Slash command payloads never include an action_token (required for RTS with
    // a bot token) — fall back to the freshest one cached from recent events.
    const actionToken = rts.getCachedActionToken();
    if (!actionToken) {
      await respond({
        response_type: 'ephemeral',
        text: '⚠️ Real-Time Search needs a fresh token that Slack only sends with @mentions.\nPlease run `@Community Impact Agent scan` instead (or mention me first, then retry this command within 2 minutes).',
      });
      return;
    }

    const hoursBack = Math.min(parseInt(command.text.trim() || '24', 10) || 24, 168);
    try {
      await runScan({
        client,
        channelId: command.channel_id,
        hoursBack,
        actionToken,
        botUserId: context.botUserId,
        post: (msg) => client.chat.postMessage({ channel: command.channel_id, ...msg }),
      });
    } catch (err) {
      logger.error('Scan failed:', err);
      await respond({ response_type: 'ephemeral', text: `⚠️ Scan failed: \`${err.data?.error || err.message}\`` });
    }
  });
};
