// Growth-Beacon-specific search: builds on services/rts.js (Real-Time Search) and
// adds thread/context lookups the intent engine and MCP tools need. Also provides
// a fallback path for callers with no cached RTS action_token (e.g. the MCP server,
// which runs as a separate process with no Slack event stream to harvest one from).

const rts = require('./rts');

const GROWTH_SIGNAL_QUERY =
  'pricing OR upgrade OR enterprise OR competitor OR integrate OR integration OR cancel OR downgrade ' +
  'OR expensive OR budget OR contract OR renew OR churn OR frustrated OR frustrating OR "not working" ' +
  'OR security OR compliance OR "feature request" OR roadmap';

// Cheap, dependency-free keyword filter used by the non-RTS fallback path below.
const KEYWORD_FILTER =
  /pricing|price|cost|upgrade|downgrade|cancel|churn|competitor|enterprise|security|compliance|integrat|budget|contract|renew|feature request|roadmap|frustrat|not working|urgent|decision.?maker|procurement|timeline|deadline/i;

/**
 * @typedef {import('./rts').RtsMessage} SearchResultMessage
 */

/**
 * Searches recent messages in a channel for growth-signal language via Real-Time
 * Search. Requires a fresh RTS action_token; use searchWithFallback() when one
 * may not be available.
 * @param {import('@slack/bolt').webApi.WebClient} client
 * @param {{ channelId?: string, hoursBack: number, actionToken: string, query?: string }} opts
 * @returns {Promise<SearchResultMessage[]>}
 */
async function searchGrowthSignals(client, { channelId, hoursBack, actionToken, query = GROWTH_SIGNAL_QUERY }) {
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
      return await searchGrowthSignals(client, { channelId, hoursBack, actionToken, query });
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
  GROWTH_SIGNAL_QUERY,
  searchGrowthSignals,
  searchChannelHistoryFallback,
  searchWithFallback,
  getThreadContext,
  extractMentionedUserIds,
};
