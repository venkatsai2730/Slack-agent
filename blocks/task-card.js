// Renders a task using Slack's native task_card block, with status-appropriate buttons.
// taskFallbackBlocks() covers the case where a surface rejects task_card.

function statusButtons(task) {
  const buttons = [];
  if (task.status === 'pending') {
    buttons.push({
      type: 'button',
      action_id: 'task_start',
      text: { type: 'plain_text', text: '▶️ Start' },
      value: task.task_id,
    });
  }
  if (task.status === 'pending' || task.status === 'in_progress') {
    buttons.push({
      type: 'button',
      action_id: 'task_complete',
      style: 'primary',
      text: { type: 'plain_text', text: '✔️ Complete' },
      value: task.task_id,
    });
  }
  return buttons;
}

function taskCardBlocks(task) {
  const card = {
    type: 'task_card',
    task_id: task.task_id,
    title: task.title,
    status: task.status,
    details: {
      type: 'rich_text',
      elements: [
        {
          type: 'rich_text_section',
          elements: [{ type: 'text', text: task.details || task.title }],
        },
      ],
    },
  };
  if (task.source_request?.permalink) {
    card.sources = [
      { type: 'url', url: task.source_request.permalink, text: 'Original request' },
    ];
  }

  const blocks = [card];
  const buttons = statusButtons(task);
  if (buttons.length) blocks.push({ type: 'actions', elements: buttons });
  return blocks;
}

const STATUS_LABEL = {
  pending: '⏳ Pending',
  in_progress: '🔄 In progress',
  complete: '✅ Complete',
  error: '⚠️ Error',
};

function taskFallbackBlocks(task) {
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${task.title}*\n${task.details || ''}\n*Status:* ${STATUS_LABEL[task.status] || task.status}`,
      },
    },
  ];
  if (task.source_request?.permalink) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `<${task.source_request.permalink}|Original request>` }],
    });
  }
  const buttons = statusButtons(task);
  if (buttons.length) blocks.push({ type: 'actions', elements: buttons });
  return blocks;
}

module.exports = { taskCardBlocks, taskFallbackBlocks, STATUS_LABEL };
