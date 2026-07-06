// Real-Time Search API (assistant.search.context) wrapper.
//
// With a bot token this method REQUIRES a short-lived action_token, which Slack
// only delivers inside app_mention / message event payloads — never in slash
// command payloads. We cache the freshest one so slash commands can piggyback.

const MAX_TOKEN_AGE_MS = 2 * 60 * 1000;
let cached = { token: null, receivedAt: 0 };

function cacheActionToken(token) {
  if (token) cached = { token, receivedAt: Date.now() };
}

function getCachedActionToken() {
  if (cached.token && Date.now() - cached.receivedAt < MAX_TOKEN_AGE_MS) return cached.token;
  return null;
}

// The action_token field path is under-documented; check the likely spots.
function extractActionToken(event, body) {
  return (
    (event && event.action_token) ||
    (body && body.action_token) ||
    (body && body.event && body.event.action_token) ||
    null
  );
}

const HELP_QUERY = 'help OR need OR "looking for" OR volunteer OR donate OR urgent OR support';

async function searchRecentMessages(client, channelId, hoursBack, actionToken) {
  const after = Math.floor(Date.now() / 1000) - hoursBack * 3600;
  const res = await client.apiCall('assistant.search.context', {
    query: HELP_QUERY,
    action_token: actionToken,
    after,
    sort: 'timestamp',
    sort_dir: 'desc',
    limit: 20,
    include_bots: false,
    content_types: ['messages'],
    channel_types: ['public_channel'],
  });
  const messages = res.results?.messages || res.messages || [];
  return messages.filter(
    (m) => (!channelId || m.channel_id === channelId) && !m.is_author_bot
  );
}

module.exports = { cacheActionToken, getCachedActionToken, extractActionToken, searchRecentMessages };
