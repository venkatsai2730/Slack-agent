// Shared community-signal pipeline: search/detect (used by /cb-scan for retroactive
// scans) and per-message processing (used by the passive message listener for
// real-time monitoring). Both paths funnel through processMessageForSignals()
// so detection, persistence, case logging, and card rendering only live in one place.

const searchService = require('./searchService');
const intentEngine = require('./intentEngine');
const summaryService = require('./summaryService');
const signalStore = require('./signalStore');
const matchService = require('./matchService');
const crm = require('./crm');
const { signalCardBlocks } = require('../blocks/signal-card');

const MAX_CANDIDATES_PER_SCAN = 5; // keep demo latency low

/** @typedef {(msg: { text: string, blocks?: any[] }) => Promise<any>} PostFn */

function confidenceThreshold() {
  const value = Number(process.env.SIGNAL_CONFIDENCE_THRESHOLD);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0.6;
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
 * Runs the full detect -> summarize -> persist -> case-log -> match -> post
 * pipeline for a single message. Returns the created Signal, or null if no
 * qualifying signal (below confidence threshold, or none detected) was found.
 * @param {{
 *   channelId: string, ts: string, text: string, authorId?: string, authorName?: string,
 *   permalink?: string, threadContext?: string, post: PostFn
 * }} opts
 * @returns {Promise<import('./signalStore').Signal | null>}
 */
async function processMessageForSignals({ channelId, ts, text, authorId, authorName, permalink, threadContext, post }) {
  const detected = await intentEngine.detectSignals(text, { threadContext });
  if (!detected.length) return null;

  const topConfidence = Math.max(...detected.map((s) => s.confidence));
  if (topConfidence < confidenceThreshold()) return null;

  const summary = await summaryService.summarizeConversation({ text, threadContext, signals: detected });
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

  try {
    const { recordId } = await crm.getProvider().logSignal(signal);
    signalStore.markCrmLogged(signal.signal_id, recordId);
  } catch (err) {
    console.error('Case logging failed (signal is still saved locally):', err.message);
  }

  // Deterministic need ↔ offer matching: an offer of help surfaces the open
  // needs it could meet, and a new need surfaces recent unclaimed offers.
  const matches = matchService.findMatches(signal);

  await post({
    text: `${summary.what_happened}`,
    blocks: signalCardBlocks(signalStore.getSignal(signal.signal_id), { matches }),
  });

  return signal;
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
    });
    if (signal) found += 1;
  }

  signalStore.logScan(found);

  if (found === 0) {
    await post({ text: `No unanswered community signals found in the last ${hoursBack}h. All quiet. 🎉` });
  }
  return found;
}

module.exports = { runScan, parseHoursBack, makeChannelPoster, processMessageForSignals, confidenceThreshold };
