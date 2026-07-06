const rts = require('../../services/rts');
const { runScan } = require('../../services/scan');

const HELP_TEXT =
  'Hi! I turn community help requests into trackable tasks. Try:\n' +
  '• `@Community Impact Agent scan` — find help requests from the last 24h\n' +
  '• `@Community Impact Agent scan 48` — look back 48 hours\n' +
  '• `/list-tasks` — see open tasks\n' +
  '• `/daily-report` — post today\'s impact report';

module.exports = (app) => {
  app.event('app_mention', async ({ event, body, client, say, logger, context }) => {
    const actionToken = rts.extractActionToken(event, body);
    rts.cacheActionToken(actionToken);

    const scanMatch = event.text.match(/scan(?:\s+(\d{1,3}))?/i);
    if (!scanMatch) {
      await say(HELP_TEXT);
      return;
    }

    if (!actionToken) {
      // Under-documented payload path — log what we actually received.
      logger.warn(`No action_token in app_mention payload. Event keys: ${Object.keys(event).join(', ')}`);
      await say('⚠️ Slack did not include a search token in that mention, so I can\'t run Real-Time Search right now. Please try mentioning me again.');
      return;
    }

    const hoursBack = Math.min(parseInt(scanMatch[1] || '24', 10), 168);
    try {
      await runScan({
        client,
        channelId: event.channel,
        hoursBack,
        actionToken,
        botUserId: context.botUserId,
        post: (msg) => client.chat.postMessage({ channel: event.channel, ...msg }),
      });
    } catch (err) {
      logger.error('Scan failed:', err);
      await say(`⚠️ Scan failed: \`${err.data?.error || err.message}\``);
    }
  });
};
