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

  app.action('view_crm', async ({ ack, action, respond, logger }) => {
    await ack();
    try {
      const signal = signalStore.getSignal(action.value);
      if (!signal) {
        await respond({ response_type: 'ephemeral', text: '⚠️ Signal not found (the app may have restarted with a cleared store).' });
        return;
      }
      const identifier = signal.message.author_name || signal.message.author_user_id;
      const context = await crm.getProvider().getCustomerContext(identifier);
      const text = context
        ? `*CRM context for ${identifier}:*\n• Activities logged: ${context.total_activities}\n• Open follow-ups: ${context.open_followups}`
        : `No prior CRM activity found for *${identifier}*. This looks like their first logged signal.`;
      await respond({ response_type: 'ephemeral', text });
    } catch (err) {
      logger.error('view_crm failed:', err);
      await respond({ response_type: 'ephemeral', text: `⚠️ Could not load CRM context: \`${err.message}\`` });
    }
  });

  app.action('assign_owner', async ({ ack, body, action, client, logger, respond }) => {
    await ack();
    try {
      const signal = signalStore.assignOwner(action.value, body.user.id);
      if (!signal) {
        await respond({ response_type: 'ephemeral', text: '⚠️ Signal not found (the app may have restarted with a cleared store).' });
        return;
      }
      await updateSignalCard(client, body.channel.id, body.message.ts, signal);
    } catch (err) {
      logger.error('assign_owner failed:', err);
      await respond({ response_type: 'ephemeral', text: `⚠️ Could not assign owner: \`${err.message}\`` });
    }
  });

  app.action('mark_false_positive', async ({ ack, body, action, client, logger, respond }) => {
    await ack();
    try {
      const signal = signalStore.markFalsePositive(action.value, body.user.id);
      if (!signal) {
        await respond({ response_type: 'ephemeral', text: '⚠️ Signal not found (the app may have restarted with a cleared store).' });
        return;
      }
      await updateSignalCard(client, body.channel.id, body.message.ts, signal);
    } catch (err) {
      logger.error('mark_false_positive failed:', err);
      await respond({ response_type: 'ephemeral', text: `⚠️ Could not update signal: \`${err.message}\`` });
    }
  });
};
