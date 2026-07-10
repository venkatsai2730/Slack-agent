// Real-Time Search API (assistant.search.context) wrapper.
//
// With a bot token this method REQUIRES a short-lived action_token, which Slack
// only delivers inside app_mention / message event payloads — never in slash
// command payloads. We cache the freshest one so slash commands can piggyback.
//
// This module is intentionally domain-agnostic (no domain-specific query strings
// live here) — see services/searchService.js for the Community Beacon search
// queries built on top of searchMessages().

const telemetry = require('./telemetry');

const MAX_TOKEN_AGE_MS = 2 * 60 * 1000;
let cached = { token: null, receivedAt: 0 };

/** @param {string | null | undefined} token */
function cacheActionToken(token) {
  if (token) cached = { token, receivedAt: Date.now() };
}

/** @returns {string | null} */
function getCachedActionToken() {
  if (cached.token && Date.now() - cached.receivedAt < MAX_TOKEN_AGE_MS) return cached.token;
  return null;
}

// The action_token field path is under-documented; check the likely spots.
/**
 * @param {Record<string, any> | undefined} event
 * @param {Record<string, any> | undefined} body
 * @returns {string | null}
 */
function extractActionToken(event, body) {
  return (
    (event && event.action_token) ||
    (body && body.action_token) ||
    (body && body.event && body.event.action_token) ||
    null
  );
}

// Convenience for listeners that only need to opportunistically capture a token
// from an incoming payload — combines extractActionToken + cacheActionToken.
// Returns the freshly extracted token (may be null), not the cache lookup, so
// callers that need "did *this* payload carry a token" still get the right answer.
/**
 * @param {Record<string, any> | undefined} eventOrMessage
 * @param {Record<string, any> | undefined} body
 * @returns {string | null}
 */
function captureFromEvent(eventOrMessage, body) {
  const token = extractActionToken(eventOrMessage, body);
  cacheActionToken(token);
  return token;
}

/**
 * @typedef {Object} RtsMessage
 * @property {string} content
 * @property {string} channel_id
 * @property {string} [channel_name]
 * @property {string} [author_user_id]
 * @property {string} [author_name]
 * @property {boolean} [is_author_bot]
 * @property {string} [permalink]
 * @property {string} [ts]
 */

/**
 * Runs a Real-Time Search query scoped to a channel and lookback window.
 * Requires a fresh action_token (see module docblock).
 * @param {import('@slack/bolt').webApi.WebClient} client
 * @param {{ channelId?: string, hoursBack: number, actionToken: string, query: string, limit?: number }} opts
 * @returns {Promise<RtsMessage[]>}
 */
async function searchMessages(client, { channelId, hoursBack, actionToken, query, limit = 20 }) {
  return telemetry.time(
    'rts_search',
    async () => {
      const after = Math.floor(Date.now() / 1000) - hoursBack * 3600;
      const res = await client.apiCall('assistant.search.context', {
        query,
        action_token: actionToken,
        after,
        sort: 'timestamp',
        sort_dir: 'desc',
        limit,
        include_bots: false,
        content_types: ['messages'],
        channel_types: ['public_channel'],
      });
      // assistant.search.context's response shape isn't part of @slack/bolt's typed
      // WebAPICallResult — this is an untyped Slack API method, hence the cast.
      const data = /** @type {any} */ (res);
      const messages = data.results?.messages || data.messages || [];
      return messages.filter((m) => (!channelId || m.channel_id === channelId) && !m.is_author_bot);
    },
    { channel_id: channelId, hours_back: hoursBack }
  );
}

module.exports = {
  cacheActionToken,
  getCachedActionToken,
  extractActionToken,
  captureFromEvent,
  searchMessages,
};
