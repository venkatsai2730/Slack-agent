// Shared community-signal pipeline: search/detect (used by /cb-scan for retroactive
// scans) and per-message processing (used by the passive message listener for
// real-time monitoring). Both paths funnel through processMessageForSignals()
// so detection, persistence, case logging, and card rendering only live in one place.

const searchService = require('./searchService');
const intentEngine = require('./intentEngine');
const summaryService = require('./summaryService');
const signalStore = require('./signalStore');
const matchService = require('./matchService');
const workspaceContext = require('./workspaceContext');
const matchDecision = require('./matchDecision');
const crm = require('./crm');
const { signalCardBlocks } = require('../blocks/signal-card');

const MAX_CANDIDATES_PER_SCAN = 5; // keep demo latency low

/** @typedef {(msg: { text: string, blocks?: any[] }) => Promise<any>} PostFn */

// Per-channel token bucket guarding LLM-triggering detection calls — the
// keyword pre-filter in intentEngine.hasKeywordHint() is the only cost/abuse
// control today; this adds a hard ceiling per channel per minute so a noisy
// or adversarial channel can't drive unbounded LLM spend.
const rateLimiter = (() => {
  /** @type {Map<string, { count: number, windowStart: number }>} */
  const buckets = new Map();
  const WINDOW_MS = 60 * 1000;

  function limit() {
    const value = Number(process.env.RATE_LIMIT_LLM_PER_CHANNEL_PER_MIN);
    return Number.isFinite(value) && value > 0 ? value : 20;
  }

  /** @param {string} channelId @returns {boolean} true if this call may proceed */
  function allow(channelId) {
    const now = Date.now();
    const bucket = buckets.get(channelId);
    if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
      buckets.set(channelId, { count: 1, windowStart: now });
      return true;
    }
    if (bucket.count >= limit()) return false;
    bucket.count += 1;
    return true;
  }

  return { allow };
})();

function confidenceThreshold() {
  const value = Number(process.env.SIGNAL_CONFIDENCE_THRESHOLD);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0.6;
}

// LOW-confidence-match outreach target: a dedicated channel if configured,
// otherwise the existing alerts channel, otherwise the source channel itself.
function outreachChannel(sourceChannelId) {
  return process.env.VOLUNTEERS_NEEDED_CHANNEL || process.env.COMMUNITY_ALERTS_CHANNEL || sourceChannelId;
}

/**
 * Feature 3's LOW branch: no confident match found, so proactively ask the
 * wider workspace for help instead of leaving the signal to rot unclaimed.
 * @param {{ client: any, signal: import('./signalStore').Signal }} opts
 */
async function postOutreach({ client, signal }) {
  if (!client) return;
  const priority = require('./priorityScore').scorePriority(signal.types);
  const target = outreachChannel(signal.message.channel_id);
  const URGENCY_BY_TIER = { critical: 'Immediate', high: 'Same day', routine: 'Routine' };
  const urgency = URGENCY_BY_TIER[priority.tier] || 'Routine';
  try {
    await client.chat.postMessage({
      channel: target,
      text: `📣 Volunteers needed: ${signal.summary.what_happened}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text:
              `📣 *Volunteers needed*\n` +
              `*Need:* ${signal.summary.what_happened}\n` +
              `*Priority:* ${priority.tier} (${priority.score}/100)\n` +
              `*Location:* <#${signal.message.channel_id}>\n` +
              `*Urgency:* ${urgency}`,
          },
        },
      ],
    });
    signalStore.recordTimelineEvent(signal.signal_id, 'outreach_posted', `Posted outreach to ${target} — no high/medium confidence match found`);
  } catch (err) {
    console.error('Outreach post failed (signal is still saved):', err.message);
  }
}

// Parses an optional "hours back" argument (from slash command text or an
// @mention's "scan <n>" capture group), clamped to a max lookback window.
function parseHoursBack(rawValue, { defaultHours = 24, maxHours = 168 } = {}) {
  const parsed = parseInt(rawValue, 10);
  return Math.min(Number.isNaN(parsed) ? defaultHours : parsed, maxHours);
}

// Builds a post() callback bound to a single channel, for callers of runScan().
function makeChannelPoster(client, channelId) {
  return (msg) => client.chat.postMessage({ channel: channelId, ...msg });
}

/**
 * Runs the full detect -> search history -> enrich -> summarize -> persist ->
 * case-log -> match-decide -> post pipeline for a single message (Features
 * 1, 3, 5, 7). Returns the created Signal, or null if no qualifying signal
 * (below confidence threshold, none detected, or rate-limited) was found.
 * @param {{
 *   channelId: string, ts: string, text: string, authorId?: string, authorName?: string,
 *   permalink?: string, threadContext?: string, post: PostFn, client?: any, actionToken?: string|null
 * }} opts
 * @returns {Promise<import('./signalStore').Signal | null>}
 */
async function processMessageForSignals({ channelId, ts, text, authorId, authorName, permalink, threadContext, post, client, actionToken }) {
  // A message already signaled once (by real-time monitoring or a prior scan)
  // must never be re-detected — real-time monitoring and /cb-scan's lookback
  // window both cover the same messages, and without this guard every rescan
  // would create a fresh duplicate signal for everything already on record.
  if (signalStore.findByChannelAndTs(channelId, ts)) return null;

  // Rate-limit only messages that would actually reach the LLM (i.e. pass the
  // keyword pre-filter) — gating on every message here would let ordinary
  // channel chatter exhaust the budget and silently drop genuine signals
  // that arrive later in the same minute.
  const wouldReachLlm = intentEngine.hasKeywordHint(text) || intentEngine.hasKeywordHint(threadContext);
  if (wouldReachLlm && !rateLimiter.allow(channelId)) return null;

  const detected = await intentEngine.detectSignals(text, { threadContext });
  if (!detected.length) return null;

  const topConfidence = Math.max(...detected.map((s) => s.confidence));
  if (topConfidence < confidenceThreshold()) return null;

  // Feature 1: search workspace history (structured signal history + a live
  // RTS/fallback sweep) BEFORE summarizing, so the coordinator summary can
  // reason over both the current message and everything that came before it.
  const primaryType = signalStore.pickPrimaryType(detected);
  const history = await workspaceContext.buildContext({ channelId, authorId: authorId || 'unknown', primaryType, text }, { client, actionToken });

  const summary = await summaryService.summarizeConversation({ text, threadContext, signals: detected, history });
  const signal = signalStore.createSignal({
    types: detected,
    summary,
    message: {
      channel_id: channelId,
      ts,
      permalink: permalink || '',
      author_user_id: authorId || 'unknown',
      author_name: authorName || authorId || 'unknown',
      text,
    },
    usedThreadContext: Boolean(threadContext),
  });

  signalStore.recordTimelineEvent(
    signal.signal_id,
    'history_searched',
    `Searched workspace history — ${history.related_messages.length} related message(s), ${history.unresolved_similar.length} unresolved similar signal(s)`
  );
  signalStore.recordTimelineEvent(signal.signal_id, 'context_enriched', history.summary_text);

  try {
    const { recordId } = await crm.getProvider().logSignal(signal);
    signalStore.markCrmLogged(signal.signal_id, recordId);
  } catch (err) {
    console.error('Case logging failed (signal is still saved locally):', err.message);
  }

  // Feature 3: deterministic candidate generation (matchService, unchanged)
  // followed by confidence-based branching (matchDecision) instead of a flat list.
  const candidates = matchService.findMatches(signal);
  const decision = matchDecision.decide(signal, candidates);
  const matchRecommendation = matchDecision.toMatchRecommendation(decision);
  signalStore.updateSignal(signal.signal_id, { decision_branch: decision.branch, match_recommendation: matchRecommendation });
  signalStore.recordTimelineEvent(
    signal.signal_id,
    'match_decision',
    `${decision.branch.toUpperCase()} confidence (${Math.round(decision.confidence * 100)}%): ${decision.explanation}`
  );

  if (decision.branch === 'low' && client) {
    await postOutreach({ client, signal: signalStore.getSignal(signal.signal_id) });
  }

  if (summary.escalation_recommendation === 'yes') {
    signalStore.recordTimelineEvent(signal.signal_id, 'escalation_recommended', 'AI recommended coordinator escalation based on workspace history.');
  }

  await post({
    text: `${summary.what_happened}`,
    blocks: signalCardBlocks(signalStore.getSignal(signal.signal_id)),
  });

  return signalStore.getSignal(signal.signal_id);
}

/**
 * Retroactively scans a channel's recent history for community signals.
 * post: async ({ text, blocks }) => void — posts a message into the target channel.
 * @param {{ client: any, channelId: string, hoursBack: number, actionToken?: string | null, botUserId?: string, post: PostFn }} opts
 */
async function runScan({ client, channelId, hoursBack, actionToken, botUserId, post }) {
  await post({ text: `🔎 Scanning the last ${hoursBack}h for community needs and offers of help...` });

  const messages = await searchService.searchWithFallback(client, { channelId, hoursBack, actionToken });
  const candidates = messages
    .filter((m) => !botUserId || m.author_user_id !== botUserId)
    .slice(0, MAX_CANDIDATES_PER_SCAN);

  let found = 0;
  for (const msg of candidates) {
    const signal = await processMessageForSignals({
      channelId,
      ts: msg.ts,
      text: msg.content,
      authorId: msg.author_user_id,
      authorName: msg.author_name,
      permalink: msg.permalink,
      post,
      client,
      actionToken,
    });
    if (signal) found += 1;
  }

  signalStore.logScan(found);

  if (found === 0) {
    await post({ text: `No unanswered community signals found in the last ${hoursBack}h. All quiet. 🎉` });
  }
  return found;
}

module.exports = {
  runScan,
  parseHoursBack,
  makeChannelPoster,
  processMessageForSignals,
  confidenceThreshold,
  outreachChannel,
  postOutreach,
  _rateLimiter: rateLimiter, // exposed for tests only
};
