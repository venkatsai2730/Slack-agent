// Shared scan pipeline: RTS search -> LLM summarization -> request cards.
const rts = require('./rts');
const { summarizeAsRequest } = require('./summarize');
const tasks = require('./tasks');
const { requestCardBlocks } = require('../blocks/request-card');

const MAX_REQUESTS_PER_SCAN = 5; // keep demo latency low

// post: async ({ text, blocks }) => void — posts a message into the target channel.
async function runScan({ client, channelId, hoursBack, actionToken, post, botUserId }) {
  await post({ text: `🔎 Scanning the last ${hoursBack}h for help requests (via Real-Time Search)...` });

  const messages = await rts.searchRecentMessages(client, channelId, hoursBack, actionToken);
  const candidates = messages
    .filter((m) => !botUserId || m.author_user_id !== botUserId)
    .filter((m) => !(m.content || '').toLowerCase().includes('scan')) // skip our own trigger mentions
    .slice(0, MAX_REQUESTS_PER_SCAN);

  const requests = [];
  for (const msg of candidates) {
    const request = await summarizeAsRequest(msg);
    if (request) requests.push(request);
  }

  tasks.logScan(requests.length);

  if (requests.length === 0) {
    await post({ text: `No open help requests found in the last ${hoursBack}h. All quiet 🎉` });
    return requests;
  }

  await post({ text: `Found ${requests.length} help request(s):` });
  for (const request of requests) {
    await post({
      text: `Help request: ${request.title}`,
      blocks: requestCardBlocks(request),
    });
  }
  return requests;
}

module.exports = { runScan };
