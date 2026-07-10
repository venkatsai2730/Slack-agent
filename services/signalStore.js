// Signal store: in-memory with write-through to data/signals.json (hackathon-grade,
// no DB — same pattern the original task store used, generalized to signals).
// Status lifecycle: 'new' (needs attention) → 'reviewed' (claimed by a helper)
// or 'false_positive' (not actually a community signal).
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'signals.json');

/**
 * @typedef {Object} Signal
 * @property {string} signal_id
 * @property {import('./intentEngine').DetectedSignal[]} types
 * @property {string} primary_type
 * @property {import('./summaryService').ImpactSummary} summary
 * @property {{ channel_id: string, ts: string, permalink: string, author_user_id: string, author_name: string, text: string }} message
 * @property {boolean} used_thread_context
 * @property {'new'|'reviewed'|'false_positive'} status
 * @property {string|null} owner
 * @property {boolean} crm_logged
 * @property {string|null} crm_record_id
 * @property {{ at: string, stage: string, detail: string }[]} timeline
 * @property {{ escalated: boolean, escalated_at: string|null, reminder_count: number, last_reminder_at: string|null }} escalation
 * @property {{ resolved: boolean, resolved_at: string|null, resolution_type: string|null }} resolution
 * @property {{ signal_id: string, confidence: number, decided_by: string, decided_at: string }|null} confirmed_match
 * @property {'high'|'medium'|'low'|null} decision_branch
 * @property {{ branch: 'high'|'medium'|'low', confidence: number, explanation: string, candidate: { signal_id: string, primary_type: string, what_happened: string, author_name: string, permalink: string }|null }|null} match_recommendation
 * @property {string[]} rejected_candidates signal_ids a coordinator has explicitly rejected as a match — excluded from future re-decisions for this signal
 * @property {string} created_at
 * @property {string} updated_at
 */

let store = { signals: [], scans: [] };
let counter = 0;

// Backfills fields added after a given signal was first persisted, so a
// pre-existing data/signals.json (from before Features 1-5) loads cleanly
// instead of leaving old records with undefined timeline/escalation/etc.
function backfillSignal(signal) {
  if (!Array.isArray(signal.timeline)) {
    signal.timeline = [{ at: signal.created_at, stage: 'signal_detected', detail: `Detected ${signal.primary_type}` }];
  }
  if (!signal.escalation) signal.escalation = { escalated: false, escalated_at: null, reminder_count: 0, last_reminder_at: null };
  if (!signal.resolution) signal.resolution = { resolved: false, resolved_at: null, resolution_type: null };
  if (signal.confirmed_match === undefined) signal.confirmed_match = null;
  if (signal.decision_branch === undefined) signal.decision_branch = null;
  if (signal.match_recommendation === undefined) signal.match_recommendation = null;
  if (!Array.isArray(signal.rejected_candidates)) signal.rejected_candidates = [];
  return signal;
}

function load() {
  try {
    store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!Array.isArray(store.signals)) store.signals = [];
    if (!Array.isArray(store.scans)) store.scans = [];
    store.signals = store.signals.map(backfillSignal);
    counter = store.signals.length;
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('signals.json exists but could not be parsed, starting empty:', err.message);
  }
}
load();

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmpFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(store, null, 2));
    fs.renameSync(tmpFile, DATA_FILE);
  } catch (err) {
    console.error('Could not persist signals:', err.message);
  }
}

/**
 * @param {import('./intentEngine').DetectedSignal[]} detected
 * @returns {string}
 */
function pickPrimaryType(detected) {
  if (!detected.length) return 'other';
  return detected.reduce((best, s) => (s.confidence > best.confidence ? s : best), detected[0]).type;
}

/**
 * @param {{ types: import('./intentEngine').DetectedSignal[], summary: import('./summaryService').ImpactSummary, message: Signal['message'], usedThreadContext?: boolean }} input
 * @returns {Signal}
 */
function createSignal({ types, summary, message, usedThreadContext = false }) {
  counter += 1;
  const now = new Date().toISOString();
  const primaryType = pickPrimaryType(types);
  /** @type {Signal} */
  const signal = {
    signal_id: `signal_${Date.now()}_${counter}`,
    types,
    primary_type: primaryType,
    summary,
    message,
    used_thread_context: usedThreadContext,
    status: 'new',
    owner: null,
    crm_logged: false,
    crm_record_id: null,
    timeline: [{ at: now, stage: 'signal_detected', detail: `Detected ${primaryType}` }],
    escalation: { escalated: false, escalated_at: null, reminder_count: 0, last_reminder_at: null },
    resolution: { resolved: false, resolved_at: null, resolution_type: null },
    confirmed_match: null,
    decision_branch: null,
    match_recommendation: null,
    rejected_candidates: [],
    created_at: now,
    updated_at: now,
  };
  store.signals.push(signal);
  save();
  return signal;
}

/** @param {string} signalId */
function getSignal(signalId) {
  return store.signals.find((s) => s.signal_id === signalId) || null;
}

/**
 * @param {string} signalId
 * @param {Partial<Signal>} patch
 */
function updateSignal(signalId, patch) {
  const signal = getSignal(signalId);
  if (!signal) return null;
  Object.assign(signal, patch, { updated_at: new Date().toISOString() });
  save();
  return signal;
}

/** @param {string} signalId @param {string} userId */
function markFalsePositive(signalId, userId) {
  const existing = getSignal(signalId);
  updateSignal(signalId, { status: 'false_positive', owner: existing?.owner || userId });
  return resolveSignal(signalId, 'false_positive');
}

/** @param {string} signalId @param {string} userId */
function assignOwner(signalId, userId) {
  return updateSignal(signalId, { owner: userId, status: 'reviewed' });
}

/** @param {string} signalId @param {string} recordId */
function markCrmLogged(signalId, recordId) {
  return updateSignal(signalId, { crm_logged: true, crm_record_id: recordId });
}

/**
 * Appends an entry to a signal's reasoning timeline (Feature 5). Silently
 * no-ops for an unknown signal_id rather than throwing, since timeline
 * recording is best-effort instrumentation, not core business logic.
 * @param {string} signalId
 * @param {string} stage
 * @param {string} [detail]
 */
function recordTimelineEvent(signalId, stage, detail = '') {
  const signal = getSignal(signalId);
  if (!signal) return null;
  signal.timeline.push({ at: new Date().toISOString(), stage, detail });
  return updateSignal(signalId, { timeline: signal.timeline });
}

/**
 * Marks a signal as resolved (matched, false-positive, or manually closed) and
 * records the transition on the timeline. Idempotent — resolving an
 * already-resolved signal just refreshes resolved_at.
 * @param {string} signalId
 * @param {'matched'|'false_positive'|'manual'} resolutionType
 */
function resolveSignal(signalId, resolutionType) {
  const signal = getSignal(signalId);
  if (!signal) return null;
  const resolved_at = new Date().toISOString();
  const updated = updateSignal(signalId, { resolution: { resolved: true, resolved_at, resolution_type: resolutionType } });
  recordTimelineEvent(signalId, 'resolved', `Resolution: ${resolutionType}`);
  return updated;
}

/**
 * Confirms a HIGH/MEDIUM-confidence match between two signals (Feature 3's
 * "one-click confirm" / coordinator-approve flow). Marks both sides resolved.
 * @param {string} signalId
 * @param {string} matchedSignalId
 * @param {number} confidence
 * @param {string} decidedBy Slack user ID of whoever confirmed/approved it
 */
function confirmMatch(signalId, matchedSignalId, confidence, decidedBy) {
  const decided_at = new Date().toISOString();
  // Recorded symmetrically on both signals (not just the one whose card the
  // button was clicked on) so repeat-volunteer/requester lookups work
  // regardless of whether a need or an offer card initiated the confirmation.
  const updated = updateSignal(signalId, { confirmed_match: { signal_id: matchedSignalId, confidence, decided_by: decidedBy, decided_at } });
  updateSignal(matchedSignalId, { confirmed_match: { signal_id: signalId, confidence, decided_by: decidedBy, decided_at } });
  recordTimelineEvent(signalId, 'matched', `Matched with ${matchedSignalId} (confidence ${Math.round(confidence * 100)}%) by ${decidedBy}`);
  recordTimelineEvent(matchedSignalId, 'matched', `Matched with ${signalId} (confidence ${Math.round(confidence * 100)}%) by ${decidedBy}`);
  resolveSignal(signalId, 'matched');
  resolveSignal(matchedSignalId, 'matched');
  return updated;
}

/**
 * Records that a coordinator rejected a suggested match, so a later
 * re-decision (see matchDecision.js) never recommends the same candidate
 * again for this signal.
 * @param {string} signalId
 * @param {string} candidateId
 */
function addRejectedCandidate(signalId, candidateId) {
  const signal = getSignal(signalId);
  if (!signal) return null;
  if (signal.rejected_candidates.includes(candidateId)) return signal;
  return updateSignal(signalId, { rejected_candidates: [...signal.rejected_candidates, candidateId] });
}

/** @param {string} signalId */
function markEscalated(signalId) {
  const signal = getSignal(signalId);
  if (!signal) return null;
  const now = new Date().toISOString();
  const escalation = {
    escalated: true,
    escalated_at: signal.escalation.escalated_at || now,
    reminder_count: signal.escalation.reminder_count + 1,
    last_reminder_at: now,
  };
  const updated = updateSignal(signalId, { escalation });
  recordTimelineEvent(signalId, 'escalated', `Reminder #${escalation.reminder_count} sent to coordinators`);
  return updated;
}

/** @param {string} authorId Slack user ID */
function getSignalsByAuthor(authorId) {
  return store.signals.filter((s) => s.message?.author_user_id === authorId);
}

/** @param {string} channelId */
function getSignalsByChannel(channelId) {
  return store.signals.filter((s) => s.message?.channel_id === channelId);
}

/**
 * Unresolved signals older than an hours threshold — the core query for the
 * proactive escalation sweep (Feature 2).
 * @param {number} hours
 * @param {{ tier?: 'critical'|'high'|'routine' }} [opts]
 */
function listUnresolvedOlderThan(hours, { tier } = {}) {
  const { scorePriority } = require('./priorityScore');
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return store.signals.filter((s) => {
    if (s.resolution?.resolved) return false;
    if (s.status === 'false_positive') return false;
    if (new Date(s.created_at).getTime() > cutoff) return false;
    if (!tier) return true;
    return scorePriority(s.types).tier === tier;
  });
}

/** @param {number} [limit] */
function listRecent(limit = 20) {
  return [...store.signals].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
}

/** @param {Signal['status']} status */
function listByStatus(status) {
  return store.signals.filter((s) => s.status === status);
}

/** @returns {Signal[]} every signal, unfiltered — for cross-cutting aggregation (workspaceContext.js, analytics.js) */
function listAll() {
  return store.signals;
}

function logScan(signalsFound) {
  store.scans.push({ at: new Date().toISOString(), signals_found: signalsFound });
  save();
}

function isToday(iso) {
  return !!iso && new Date(iso).toDateString() === new Date().toDateString();
}

function isWithinDays(iso, days) {
  if (!iso) return false;
  const ageMs = Date.now() - new Date(iso).getTime();
  return ageMs >= 0 && ageMs <= days * 24 * 60 * 60 * 1000;
}

// Roll-up categories for statsSummary()'s convenience counters.
const NEED_SIGNAL_TYPES = new Set([
  'help_request', 'urgent_need', 'transport_need', 'food_insecurity',
  'housing_need', 'medical_need', 'emotional_support_need', 'resource_request',
]);
const OFFER_SIGNAL_TYPES = new Set(['volunteer_offer', 'donation_offer', 'skill_offer', 'resource_available']);
const URGENT_SIGNAL_TYPES = new Set(['urgent_need', 'medical_need']);

/**
 * Aggregated stats for the App Home dashboard and /cb-impact.
 */
function statsSummary() {
  const byType = {};
  const byChannel = {};
  const byMember = {};
  let communityNeeds = 0;
  let offersOfHelp = 0;
  let urgentNeeds = 0;

  for (const signal of store.signals) {
    for (const t of signal.types) {
      byType[t.type] = (byType[t.type] || 0) + 1;
      if (NEED_SIGNAL_TYPES.has(t.type)) communityNeeds += 1;
      if (OFFER_SIGNAL_TYPES.has(t.type)) offersOfHelp += 1;
      if (URGENT_SIGNAL_TYPES.has(t.type)) urgentNeeds += 1;
    }
    const channel = signal.message?.channel_id || 'unknown';
    byChannel[channel] = (byChannel[channel] || 0) + 1;
    const member = signal.message?.author_name || signal.message?.author_user_id || 'unknown';
    byMember[member] = (byMember[member] || 0) + 1;
  }

  const trend7d = Array.from({ length: 7 }, (_, i) => {
    const dayOffset = 6 - i;
    const count = store.signals.filter((s) => {
      const ageDays = Math.floor((Date.now() - new Date(s.created_at).getTime()) / (24 * 60 * 60 * 1000));
      return ageDays === dayOffset;
    }).length;
    return count;
  });

  const topChannels = Object.entries(byChannel).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topMembers = Object.entries(byMember).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return {
    total_signals: store.signals.length,
    signals_today: store.signals.filter((s) => isToday(s.created_at)).length,
    signals_last_7_days: store.signals.filter((s) => isWithinDays(s.created_at, 7)).length,
    open_signals: store.signals.filter((s) => s.status === 'new').length,
    claimed_signals: store.signals.filter((s) => s.status === 'reviewed').length,
    false_positives: store.signals.filter((s) => s.status === 'false_positive').length,
    by_type: byType,
    top_channels: topChannels,
    top_members: topMembers,
    community_needs: communityNeeds,
    offers_of_help: offersOfHelp,
    urgent_needs: urgentNeeds,
    trend_7d: trend7d,
  };
}

/**
 * Stats scoped to "today," used by /cb-impact — mirrors the shape the original
 * daily report expected (requests_found / etc.) but for signals.
 */
function statsForToday() {
  const todaysSignals = store.signals.filter((s) => isToday(s.created_at));
  const byCategory = {};
  for (const s of todaysSignals) {
    byCategory[s.primary_type] = (byCategory[s.primary_type] || 0) + 1;
  }
  const scansToday = store.scans.filter((sc) => isToday(sc.at)).reduce((sum, sc) => sum + sc.signals_found, 0);
  return {
    date: new Date().toDateString(),
    signals_found: scansToday,
    signals_created: todaysSignals.length,
    open_signals: listByStatus('new').length,
    by_type: byCategory,
  };
}

module.exports = {
  createSignal,
  getSignal,
  updateSignal,
  markFalsePositive,
  assignOwner,
  markCrmLogged,
  recordTimelineEvent,
  resolveSignal,
  confirmMatch,
  addRejectedCandidate,
  markEscalated,
  getSignalsByAuthor,
  getSignalsByChannel,
  listUnresolvedOlderThan,
  pickPrimaryType,
  listRecent,
  listByStatus,
  listAll,
  logScan,
  statsSummary,
  statsForToday,
};
