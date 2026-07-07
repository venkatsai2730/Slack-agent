const rts = require('../../services/rts');
const { processMessageForSignals } = require('../../services/scan');

// Continuous monitoring: every genuine new message is opportunistically checked
// for growth signals (gated by intentEngine's cheap keyword pre-filter and the
// SIGNAL_CONFIDENCE_THRESHOLD, so most messages never reach the LLM and most
// LLM calls that do run don't result in a posted alert).
module.exports = (app) => {
  app.event('message', async ({ event, body, client, context, logger }) => {
    rts.captureFromEvent(event, body);

    // Skip edits, deletions, joins/leaves, bot messages, and the bot's own posts.
    if (event.subtype || event.bot_id || !event.text || event.user === context.botUserId) return;

    try {
      const target = process.env.GROWTH_ALERTS_CHANNEL;
      let permalink = '';
      try {
        const res = await client.chat.getPermalink({ channel: event.channel, message_ts: event.ts });
        permalink = res.permalink || '';
      } catch (err) {
        logger.warn(`Could not fetch permalink for ${event.channel}/${event.ts}: ${err.data?.error || err.message}`);
      }

      const post = target
        ? (msg) => client.chat.postMessage({ channel: target, ...msg })
        : (msg) => client.chat.postMessage({ channel: event.channel, thread_ts: event.ts, ...msg });

      await processMessageForSignals({
        channelId: event.channel,
        ts: event.ts,
        text: event.text,
        authorId: event.user,
        permalink,
        post,
      });
    } catch (err) {
      logger.error('Real-time signal detection failed:', err);
    }
  });
};
