const signalStore = require('../../services/signalStore');
const crm = require('../../services/crm');
const { signalCardBlocks } = require('../../blocks/signal-card');

async function updateSignalCard(client, channel, ts, signal) {
  const text = signal.summary?.what_happened || signal.primary_type;
  await client.chat.update({ channel, ts, text, blocks: signalCardBlocks(signal) });
}

module.exports = (app) => {
  // "Open Thread" is a url button — Slack still sends an interaction payload for
  // it that must be acked, even though the link opens client-side regardless.
  app.action('open_thread', async ({ ack }) => {
    await ack();
  });

  app.action('view_case', async ({ ack, action, respond, logger }) => {
    await ack();
    try {
      const signal = signalStore.getSignal(action.value);
      if (!signal) {
        await respond({ response_type: 'ephemeral', text: '⚠️ Signal not found (the app may have restarted with a cleared store).' });
        return;
      }
      const identifier = signal.message.author_name || signal.message.author_user_id;
      const context = await crm.getProvider().getConstituentContext(identifier);
      const text = context
        ? `*Case history for ${identifier}:*\n• Prior signals logged: ${context.total_activities}\n• Open follow-ups: ${context.open_followups}`
        : `No prior case history found for *${identifier}*. This looks like their first logged signal.`;
      await respond({ response_type: 'ephemeral', text });
    } catch (err) {
      logger.error('view_case failed:', err);
      await respond({ response_type: 'ephemeral', text: `⚠️ Could not load case history: \`${err.message}\`` });
    }
  });

  // "I Can Help" — the clicking user claims the need as its helper.
  app.action('claim_help', async ({ ack, body, action, client, logger, respond }) => {
    await ack();
    try {
      const signal = signalStore.assignOwner(action.value, body.user.id);
      if (!signal) {
        await respond({ response_type: 'ephemeral', text: '⚠️ Signal not found (the app may have restarted with a cleared store).' });
        return;
      }
      await updateSignalCard(client, body.channel.id, body.message.ts, signal);
    } catch (err) {
      logger.error('claim_help failed:', err);
      await respond({ response_type: 'ephemeral', text: `⚠️ Could not claim this signal: \`${err.message}\`` });
    }
  });

  app.action('not_a_request', async ({ ack, body, action, client, logger, respond }) => {
    await ack();
    try {
      const signal = signalStore.markFalsePositive(action.value, body.user.id);
      if (!signal) {
        await respond({ response_type: 'ephemeral', text: '⚠️ Signal not found (the app may have restarted with a cleared store).' });
        return;
      }
      await updateSignalCard(client, body.channel.id, body.message.ts, signal);
    } catch (err) {
      logger.error('not_a_request failed:', err);
      await respond({ response_type: 'ephemeral', text: `⚠️ Could not update signal: \`${err.message}\`` });
    }
  });
};
