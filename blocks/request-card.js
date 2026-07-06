const CATEGORY_EMOJI = {
  education: '📚',
  health: '🏥',
  finance: '💰',
  environment: '🌱',
  other: '🤝',
};

const URGENCY_EMOJI = { low: '🟢', medium: '🟠', high: '🔴' };

function requestCardBlocks(request) {
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${CATEGORY_EMOJI[request.category]} ${request.title}*\n${request.description}`,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Category:*\n${request.category}` },
        { type: 'mrkdwn', text: `*Urgency:*\n${URGENCY_EMOJI[request.urgency]} ${request.urgency}` },
        { type: 'mrkdwn', text: `*Requested by:*\n${request.requester}` },
      ],
    },
  ];

  if (request.message_permalink) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `<${request.message_permalink}|View original message>` }],
    });
  }

  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        action_id: 'create_task',
        style: 'primary',
        text: { type: 'plain_text', text: '✅ Create Task' },
        value: JSON.stringify(request),
      },
    ],
  });

  return blocks;
}

module.exports = { requestCardBlocks, CATEGORY_EMOJI, URGENCY_EMOJI };
