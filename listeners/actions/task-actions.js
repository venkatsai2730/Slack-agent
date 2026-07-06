const tasks = require('../../services/tasks');
const { taskCardBlocks, taskFallbackBlocks } = require('../../blocks/task-card');

// task_card surface support is not fully documented — try native, fall back to sections.
async function postTaskCard(client, channel, task) {
  const text = `Task: ${task.title} (${task.status})`;
  try {
    return await client.chat.postMessage({ channel, text, blocks: taskCardBlocks(task) });
  } catch (err) {
    if (err.data?.error !== 'invalid_blocks') throw err;
    return await client.chat.postMessage({ channel, text, blocks: taskFallbackBlocks(task) });
  }
}

async function updateTaskCard(client, channel, ts, task) {
  const text = `Task: ${task.title} (${task.status})`;
  try {
    await client.chat.update({ channel, ts, text, blocks: taskCardBlocks(task) });
  } catch (err) {
    if (err.data?.error !== 'invalid_blocks') throw err;
    await client.chat.update({ channel, ts, text, blocks: taskFallbackBlocks(task) });
  }
}

module.exports = (app) => {
  app.action('create_task', async ({ ack, body, action, client, respond, logger }) => {
    await ack();
    try {
      const request = JSON.parse(action.value);
      const task = tasks.createTask(request);
      await postTaskCard(client, body.channel.id, task);

      // Swap the button on the original request card for a confirmation line.
      const originalBlocks = (body.message.blocks || []).filter((b) => b.type !== 'actions');
      originalBlocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `✅ Task created by <@${body.user.id}>` }],
      });
      await respond({ replace_original: true, text: body.message.text, blocks: originalBlocks });
    } catch (err) {
      logger.error('create_task failed:', err);
      await respond({ replace_original: false, response_type: 'ephemeral', text: `⚠️ Could not create task: \`${err.data?.error || err.message}\`` });
    }
  });

  const statusTransitions = [
    { actionId: 'task_start', status: 'in_progress' },
    { actionId: 'task_complete', status: 'complete' },
  ];

  for (const { actionId, status } of statusTransitions) {
    app.action(actionId, async ({ ack, body, action, client, respond, logger }) => {
      await ack();
      try {
        const task = tasks.updateStatus(action.value, status, body.user.id);
        if (!task) {
          await respond({ replace_original: false, response_type: 'ephemeral', text: '⚠️ Task not found (the app may have restarted with a cleared store).' });
          return;
        }
        await updateTaskCard(client, body.channel.id, body.message.ts, task);
        if (status === 'complete') {
          await client.chat.postMessage({
            channel: body.channel.id,
            thread_ts: body.message.ts,
            text: `🎉 <@${body.user.id}> completed *${task.title}* — thank you!`,
          });
        }
      } catch (err) {
        logger.error(`${actionId} failed:`, err);
        await respond({ replace_original: false, response_type: 'ephemeral', text: `⚠️ Could not update task: \`${err.data?.error || err.message}\`` });
      }
    });
  }
};
