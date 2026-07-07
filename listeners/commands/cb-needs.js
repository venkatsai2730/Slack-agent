const signalStore = require('../../services/signalStore');
const { SIGNAL_EMOJI, SIGNAL_LABEL, STATUS_LABEL } = require('../../blocks/constants');

module.exports = (app) => {
  app.command('/cb-needs', async ({ ack, respond }) => {
    await ack();

    const recent = signalStore.listRecent(10);
    if (recent.length === 0) {
      await respond({
        response_type: 'ephemeral',
        text: 'No community signals detected yet. Run `@Community Beacon scan` to find some! 🎉',
      });
      return;
    }

    const lines = recent.map((s) => {
      const emoji = SIGNAL_EMOJI[s.primary_type] || '📡';
      const label = SIGNAL_LABEL[s.primary_type] || s.primary_type;
      const status = STATUS_LABEL[s.status] || s.status;
      const helper = s.owner ? ` · helper: <@${s.owner}>` : '';
      return `${emoji} *${label}* — ${status}${helper}\n_${s.summary?.what_happened || ''}_`;
    });

    await respond({
      response_type: 'ephemeral',
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: `📋 Recent community signals (${recent.length})` } },
        { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n\n') } },
      ],
      text: `${recent.length} recent signal(s)`,
    });
  });
};
