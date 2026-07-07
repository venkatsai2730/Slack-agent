const rts = require('../../services/rts');
const { runScan, parseHoursBack, makeChannelPoster } = require('../../services/scan');

const HELP_TEXT =
  'Hi! I monitor Slack for growth signals — buying intent, expansion opportunities, churn risk, and more. Try:\n' +
  '• `@Growth Beacon scan` — find growth signals from the last 24h\n' +
  '• `@Growth Beacon scan 48` — look back 48 hours\n' +
  '• `/gb-signals` — see recently detected signals\n' +
  '• `/gb-report` — post today\'s growth intelligence report';

module.exports = (app) => {
  app.event('app_mention', async ({ event, body, client, say, logger, context }) => {
    // Opportunistically captures a Real-Time Search token if this payload has one;
    // runScan() degrades gracefully via services/searchService.js's fallback if not.
    const actionToken = rts.captureFromEvent(event, body);

    const scanMatch = event.text.match(/scan(?:\s+(\d{1,3}))?/i);
    if (!scanMatch) {
      await say(HELP_TEXT);
      return;
    }

    const hoursBack = parseHoursBack(scanMatch[1]);
    try {
      await runScan({
        client,
        channelId: event.channel,
        hoursBack,
        actionToken,
        botUserId: context.botUserId,
        post: makeChannelPoster(client, event.channel),
      });
    } catch (err) {
      logger.error('Scan failed:', err);
      await say(`⚠️ Scan failed: \`${err.data?.error || err.message}\``);
    }
  });
};
