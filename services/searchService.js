// Community-Beacon-specific search: builds on services/rts.js (Real-Time Search)
// and adds thread/context lookups the signal engine and MCP tools need. Also provides
// a fallback path for callers with no cached RTS action_token (e.g. the MCP server,
// which runs as a separate process with no Slack event stream to harvest one from).

const rts = require('./rts');

const COMMUNITY_SIGNAL_QUERY =
  'help OR need OR volunteer OR donate OR donation OR urgent OR emergency OR support ' +
  'OR food OR meal OR groceries OR shelter OR housing OR rent OR ride OR transport ' +
  'OR medicine OR prescription OR supplies OR childcare OR "looking for" OR "can anyone"';

// Cheap, dependency-free keyword filter used by the non-RTS fallback path below.
const KEYWORD_FILTER =
  /help|need|volunteer|donat|urgent|emergency|support|assist|food|meal|grocer|shelter|housing|rent|evict|ride|transport|medicine|prescription|clinic|supplies|clothes|furniture|childcare|babysit|elderly|senior|accessib|looking for|can anyone/i;

/**
 * @typedef {import('./rts').RtsMessage} SearchResultMessage
 */

/**
 * Searches recent messages in a channel for community-signal language via Real-Time
 * Search. Requires a fresh RTS action_token; use searchWithFallback() when one
 * may not be available.
 * @param {import('@slack/bolt').webApi.WebClient} client
 * @param {{ channelId?: string, hoursBack: number, actionToken: string, query?: string }} opts
 * @returns {Promise<SearchResultMessage[]>}
 */
async function searchCommunitySignals(client, { channelId, hoursBack, actionToken, query = COMMUNITY_SIGNAL_QUERY }) {
  return rts.searchMessages(client, { channelId, hoursBack, actionToken, query });
}

/**
 * Falls back to conversations.history + a keyword filter when no RTS action_token
 * is available (Real-Time Search cannot be called without one). Loses RTS's
 * relevance ranking but keeps search usable for the MCP server and cold-start UX.
 * @param {import('@slack/bolt').webApi.WebClient} client
 * @param {{ channelId: string, hoursBack: number, query?: string }} opts
 * @returns {Promise<SearchResultMessage[]>}
 */
async function searchChannelHistoryFallback(client, { channelId, hoursBack, query }) {
  const oldest = String(Math.floor(Date.now() / 1000) - hoursBack * 3600);
  const res = await client.conversations.history({ channel: channelId, oldest, limit: 100 });
  const messages = res.messages || [];
  // A caller-supplied query (Slack RTS syntax, e.g. "foo OR bar") is honored as a
  // plain OR-of-substrings match; otherwise fall back to the built-in keyword filter.
  const matcher = query
    ? (text) => query.split(/\s+OR\s+/i).some((term) => text.toLowerCase().includes(term.replace(/"/g, '').toLowerCase()))
    : (text) => KEYWORD_FILTER.test(text);
  return messages
    .filter((m) => !m.bot_id && m.text && matcher(m.text))
    .map((m) => ({
      content: m.text,
      channel_id: channelId,
      author_user_id: m.user,
      ts: m.ts,
      is_author_bot: Boolean(m.bot_id),
    }));
}

/**
 * Preferred entry point for search: uses Real-Time Search when an action_token is
 * available, otherwise degrades to the conversations.history fallback.
 * @param {import('@slack/bolt').webApi.WebClient} client
 * @param {{ channelId: string, hoursBack: number, actionToken?: string | null, query?: string }} opts
 * @returns {Promise<SearchResultMessage[]>}
 */
async function searchWithFallback(client, { channelId, hoursBack, actionToken, query }) {
  if (actionToken) {
    try {
      return await searchCommunitySignals(client, { channelId, hoursBack, actionToken, query });
    } catch (err) {
      console.error('Real-Time Search failed, falling back to conversations.history:', err.message);
    }
  }
  return searchChannelHistoryFallback(client, { channelId, hoursBack });
}

/**
 * Fetches the full message list of a thread, used to give the intent engine and
 * summary service surrounding context beyond a single message.
 * @param {import('@slack/bolt').webApi.WebClient} client
 * @param {{ channelId: string, threadTs: string }} opts
 * @returns {Promise<any[]>}
 */
async function getThreadContext(client, { channelId, threadTs }) {
  if (!threadTs) return [];
  const res = await client.conversations.replies({ channel: channelId, ts: threadTs, limit: 50 });
  return res.messages || [];
}

/**
 * Extracts unique Slack user IDs mentioned (`<@U123>`) in a message's text.
 * @param {string} [text]
 * @returns {string[]}
 */
function extractMentionedUserIds(text = '') {
  const matches = text.match(/<@([A-Z0-9]+)>/g) || [];
  return [...new Set(matches.map((m) => m.slice(2, -1)))];
}

module.exports = {
  COMMUNITY_SIGNAL_QUERY,
  searchCommunitySignals,
  searchChannelHistoryFallback,
  searchWithFallback,
  getThreadContext,
  extractMentionedUserIds,
};
