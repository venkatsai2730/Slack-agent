// Workspace history & context aggregation — the layer that turns Real-Time
// Search + the local signal history into the structured "memory" the agent
// reasons over. This is what makes buildContext()'s output ("fourth
// transportation request from this district in nine days") impossible to
// produce from a single message alone: it combines
//   1. structured aggregation over every signal ever detected (signalStore),
//      which is already durable and in-memory, so this half is essentially free, with
//   2. a live Real-Time Search sweep (services/searchService.js, reusing the
//      existing RTS wrapper — no new search path) for related conversational
//      evidence the structured store doesn't capture (exact wording, threads).
//
// "District" is modeled as the Slack channel a signal was posted in — the only
// location signal actually present in the data, rather than an LLM guess at a
// place name most messages never mention.

const signalStore = require('./signalStore');
const searchService = require('./searchService');
const { OFFER_TYPES } = require('./matchService');
const telemetry = require('./telemetry');

const CACHE_TTL_MS = 60 * 1000;
/** @type {Map<string, { at: number, value: any }>} */
const cache = new Map();

/**
 * Generic async memoize-with-TTL. Exported so MCP tool handlers (Feature 6)
 * can share the same cache discipline for expensive lookups, satisfying the
 * "no duplicate searches" performance requirement.
 * @template T
 * @param {string} key
 * @param {number} ttlMs
 * @param {() => Promise<T> | T} fn
 * @returns {Promise<{ value: T, cached: boolean }>}
 */
async function withCache(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return { value: hit.value, cached: true };
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return { value, cached: false };
}

/** Clears the shared cache — exposed for tests only. */
function _clearCache() {
  cache.clear();
}

/**
 * @param {import('./signalStore').Signal} s
 */
function toHistoryEntry(s) {
  return {
    signal_id: s.signal_id,
    primary_type: s.primary_type,
    created_at: s.created_at,
    status: s.status,
    channel_id: s.message?.channel_id || 'unknown',
    author_name: s.message?.author_name || s.message?.author_user_id || 'unknown',
    permalink: s.message?.permalink || '',
    what_happened: s.summary?.what_happened || '',
  };
}

/**
 * Has this person asked for (or offered) help before? The MCP-facing
 * `get_repeat_requesters` / `get_constituent_context` tools and the coordinator
 * summary both need this.
 * @param {string} authorId Slack user ID
 * @param {{ excludeSignalId?: string }} [opts]
 */
function getRequesterHistory(authorId, { excludeSignalId } = {}) {
  const signals = signalStore
    .getSignalsByAuthor(authorId)
    .filter((s) => s.signal_id !== excludeSignalId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return {
    author_id: authorId,
    total_signals: signals.length,
    is_repeat: signals.length > 0,
    recent: signals.slice(0, 5).map(toHistoryEntry),
  };
}

/**
 * Like getRequesterHistory, but accepts a Slack user ID OR a plain display
 * name — used by MCP tools where the caller may only know a member's name.
 * @param {string} identifier
 */
function getRequesterHistoryByIdentifier(identifier) {
  if (/^U[A-Z0-9]+$/.test(identifier)) return getRequesterHistory(identifier);
  const signals = signalStore
    .listAll()
    .filter((s) => (s.message?.author_name || '') === identifier)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { author_id: identifier, total_signals: signals.length, is_repeat: signals.length > 0, recent: signals.slice(0, 5).map(toHistoryEntry) };
}

/**
 * Signal volume for a channel (= district proxy) over a lookback window —
 * feeds the demand heatmap (Feature 4/8) and "this district has generated N
 * requests this week" reasoning.
 * @param {string} channelId
 * @param {{ days?: number }} [opts]
 */
function getChannelTrends(channelId, { days = 30 } = {}) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const signals = signalStore.getSignalsByChannel(channelId).filter((s) => new Date(s.created_at).getTime() >= cutoff);
  const byType = {};
  for (const s of signals) byType[s.primary_type] = (byType[s.primary_type] || 0) + 1;
  return { channel_id: channelId, window_days: days, total: signals.length, by_type: byType };
}

/**
 * How many times has this exact signal type recurred in this channel, and
 * over what actual span of days? Drives "this appears to be the Nth X in the
 * last Y days" reasoning (Feature 1/7's headline example).
 * @param {string} primaryType
 * @param {string} channelId
 * @param {{ days?: number }} [opts]
 */
function getRecurringByType(primaryType, channelId, { days = 30 } = {}) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const matches = signalStore
    .getSignalsByChannel(channelId)
    .filter((s) => s.primary_type === primaryType && new Date(s.created_at).getTime() >= cutoff)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const count = matches.length;
  const spanDays =
    count > 1
      ? Math.max(1, Math.ceil((new Date(matches[matches.length - 1].created_at).getTime() - new Date(matches[0].created_at).getTime()) / (24 * 60 * 60 * 1000)))
      : 0;
  return { primary_type: primaryType, channel_id: channelId, window_days: days, count, span_days: spanDays, is_recurring: count >= 3 };
}

/**
 * Open (or claimed-but-unresolved) signals of the same type, anywhere in the
 * workspace — "has anyone else asked for this and not been helped yet?"
 * Accepts a minimal shape (not a full Signal) since buildContext() calls this
 * before a signal has been persisted, with only an id/type to compare against.
 * @param {{ signal_id: string, primary_type: string }} signal
 * @param {{ limit?: number }} [opts]
 */
function getUnresolvedSimilar(signal, { limit = 10 } = {}) {
  const candidates = signalStore
    .listAll()
    .filter(
      (s) =>
        s.signal_id !== signal.signal_id &&
        s.primary_type === signal.primary_type &&
        s.status !== 'false_positive' &&
        !s.resolution?.resolved
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return candidates.slice(0, limit).map(toHistoryEntry);
}

/**
 * Offer-signal authors with one or more confirmed matches — "volunteer Sarah
 * has completed five transport requests nearby."
 * @param {{ limit?: number }} [opts]
 */
function getRepeatVolunteers({ limit = 5 } = {}) {
  const counts = new Map();
  for (const s of signalStore.listAll()) {
    if (!OFFER_TYPES.has(s.primary_type) || !s.confirmed_match) continue;
    const key = s.message?.author_user_id || 'unknown';
    const entry = counts.get(key) || { author_id: key, author_name: s.message?.author_name || key, completed_matches: 0, types: new Set() };
    entry.completed_matches += 1;
    entry.types.add(s.primary_type);
    counts.set(key, entry);
  }
  return [...counts.values()]
    .filter((e) => e.completed_matches > 0)
    .sort((a, b) => b.completed_matches - a.completed_matches)
    .slice(0, limit)
    .map((e) => ({ ...e, types: [...e.types] }));
}

/**
 * Requesters with more than one need signal — the "asked for transportation 3
 * times this month" pattern.
 * @param {{ limit?: number }} [opts]
 */
function getRepeatRequesters({ limit = 5 } = {}) {
  const counts = new Map();
  for (const s of signalStore.listAll()) {
    if (OFFER_TYPES.has(s.primary_type)) continue;
    const key = s.message?.author_user_id || 'unknown';
    const entry = counts.get(key) || { author_id: key, author_name: s.message?.author_name || key, signal_count: 0 };
    entry.signal_count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()]
    .filter((e) => e.signal_count > 1)
    .sort((a, b) => b.signal_count - a.signal_count)
    .slice(0, limit);
}

/** @param {{ limit?: number }} [opts] */
function getRecentConfirmedMatches({ limit = 10 } = {}) {
  return signalStore
    .listAll()
    .filter((s) => s.confirmed_match)
    .sort((a, b) => b.confirmed_match.decided_at.localeCompare(a.confirmed_match.decided_at))
    .slice(0, limit)
    .map((s) => ({ ...toHistoryEntry(s), confirmed_match: s.confirmed_match }));
}

/** Alias over confirmed matches, framed as outcomes for MCP's get_successful_outcomes tool. */
function getSuccessfulOutcomes({ limit = 10 } = {}) {
  return getRecentConfirmedMatches({ limit });
}

/** Workspace-wide priority tier breakdown, for the analytics/MCP layer. */
function getPriorityStatistics() {
  const { scorePriority } = require('./priorityScore');
  const tiers = { critical: 0, high: 0, routine: 0 };
  for (const s of signalStore.listAll()) {
    tiers[scorePriority(s.types).tier] += 1;
  }
  return { total: signalStore.listAll().length, by_tier: tiers };
}

/**
 * The Feature 1 centerpiece: builds the full historical-context object a new
 * signal should be reasoned about alongside. Combines every aggregation above
 * (structured, in-memory, effectively free) with one cached live RTS/history
 * search for conversational evidence.
 * @param {{ channelId: string, authorId: string, primaryType: string, text: string, excludeSignalId?: string }} draft
 * @param {{ client?: any, actionToken?: string|null }} [opts]
 */
async function buildContext({ channelId, authorId, primaryType, text, excludeSignalId }, { client, actionToken } = {}) {
  const start = Date.now();
  const requester = getRequesterHistory(authorId, { excludeSignalId });
  const channel = getChannelTrends(channelId);
  const recurring = getRecurringByType(primaryType, channelId);
  const unresolvedSimilar = getUnresolvedSimilar({ signal_id: excludeSignalId || '', primary_type: primaryType }, { limit: 5 });
  const repeatVolunteers = getRepeatVolunteers({ limit: 3 });

  let relatedMessages = [];
  let cached = false;
  if (client) {
    const cacheKey = `related:${channelId}:${primaryType}`;
    const { value, cached: wasCached } = await withCache(cacheKey, CACHE_TTL_MS, async () => {
      try {
        return await searchService.searchWithFallback(client, { channelId, hoursBack: 24 * 30, actionToken, query: text.slice(0, 200) });
      } catch (err) {
        console.error('workspaceContext: related-message search failed:', err.message);
        return [];
      }
    });
    relatedMessages = value.slice(0, 5);
    cached = wasCached;
  }
  telemetry.logEvent('workspace_context_built', { channel_id: channelId, primary_type: primaryType, duration_ms: Date.now() - start, cache_hit: cached });

  const isRecurring = recurring.count >= 3;
  const summaryParts = [];
  if (isRecurring) {
    summaryParts.push(
      `This appears to be the ${recurring.count}${ordinalSuffix(recurring.count)} ${primaryType.replace(/_/g, ' ')} from this channel in ${recurring.span_days || recurring.window_days} days.`
    );
  }
  if (requester.is_repeat) {
    summaryParts.push(`This requester has ${requester.total_signals} prior logged signal(s).`);
  }
  if (repeatVolunteers.length) {
    const top = repeatVolunteers[0];
    summaryParts.push(`${top.author_name} has completed ${top.completed_matches} similar match(es) before.`);
  }
  if (unresolvedSimilar.length) {
    summaryParts.push(`${unresolvedSimilar.length} similar signal(s) elsewhere are still unresolved.`);
  }

  return {
    requester,
    channel,
    recurring,
    unresolved_similar: unresolvedSimilar,
    repeat_volunteers: repeatVolunteers,
    related_messages: relatedMessages,
    is_recurring: isRecurring,
    summary_text: summaryParts.join(' ') || 'No prior related history found — this looks like a first-time signal.',
  };
}

/** @param {number} n */
function ordinalSuffix(n) {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  switch (n % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

module.exports = {
  withCache,
  _clearCache,
  getRequesterHistory,
  getRequesterHistoryByIdentifier,
  getChannelTrends,
  getRecurringByType,
  getUnresolvedSimilar,
  getRepeatVolunteers,
  getRepeatRequesters,
  getRecentConfirmedMatches,
  getSuccessfulOutcomes,
  getPriorityStatistics,
  buildContext,
};
