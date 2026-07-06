const tasks = require('../../services/tasks');
const { CATEGORY_EMOJI } = require('../../blocks/request-card');
const { STATUS_LABEL } = require('../../blocks/task-card');

module.exports = (app) => {
  app.command('/list-tasks', async ({ ack, respond }) => {
    await ack();

    const open = tasks.listOpen();
    if (open.length === 0) {
      await respond({ response_type: 'ephemeral', text: 'No open tasks. Run `@Community Impact Agent scan` to find help requests! 🎉' });
      return;
    }

    const lines = open.map(
      (t) =>
        `${CATEGORY_EMOJI[t.category] || '🤝'} *${t.title}* — ${STATUS_LABEL[t.status] || t.status}` +
        ` · assignee: ${t.assignee ? `<@${t.assignee}>` : '_unassigned_'}`
    );

    await respond({
      response_type: 'ephemeral',
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: `📋 Open tasks (${open.length})` } },
        { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
      ],
      text: `${open.length} open task(s)`,
    });
  });
};
