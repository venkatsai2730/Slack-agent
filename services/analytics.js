// Impact analytics (Feature 4): real metrics computed from signalStore's
// persisted signals (timeline, escalation, resolution, confirmed_match —
// all populated by services/scan.js, matchDecision.js, and escalation.js).
// Consumed by the App Home dashboard (blocks/dashboard-blocks.js), the
// /cb-impact report (services/report.js), and the MCP get_priority_statistics
// / summarize_workspace_context tools.
//
// Documented assumption: MINUTES_SAVED_PER_AUTO_MATCH estimates the manual
// triage time a HIGH-confidence auto-recommendation replaces. It's a stated
// heuristic, not a measured constant — call it out as such wherever it's shown.
const MINUTES_SAVED_PER_AUTO_MATCH = 15;

const signalStore = require('./signalStore');
const workspaceContext = require('./workspaceContext');
const { scorePriority } = require('./priorityScore');

const HUMAN_ACTION_STAGES = new Set(['matched', 'resolved', 'escalated', 'match_rejected']);

/** @param {import('./signalStore').Signal} signal @returns {string|null} ISO timestamp of the first human/system decision after automatic pipeline stages */
function firstHumanActionAt(signal) {
  const hit = signal.timeline.find((e) => HUMAN_ACTION_STAGES.has(e.stage));
  return hit ? hit.at : null;
}

/** @param {number[]} values */
function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** @param {number[]} values */
function average(values) {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

/** @returns {number} minutes */
function minutesBetween(startIso, endIso) {
  return (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000;
}

/**
 * Response-time stats (created -> first human/system decision), overall and
 * split by the tier the signal had at creation.
 */
function responseTimeStats() {
  const byTier = { critical: [], high: [], routine: [] };
  const all = [];
  for (const signal of signalStore.listAll()) {
    const respondedAt = firstHumanActionAt(signal);
    if (!respondedAt) continue;
    const minutes = minutesBetween(signal.created_at, respondedAt);
    all.push(minutes);
    const tier = scorePriority(signal.types).tier;
    byTier[tier].push(minutes);
  }
  return {
    median_minutes: Math.round(median(all)),
    average_minutes: Math.round(average(all)),
    critical_average_minutes: Math.round(average(byTier.critical)),
    routine_average_minutes: Math.round(average(byTier.routine)),
  };
}

/** Median/average time from signal creation to a confirmed match. */
function timeToMatchStats() {
  const durations = [];
  for (const signal of signalStore.listAll()) {
    if (!signal.confirmed_match) continue;
    durations.push(minutesBetween(signal.created_at, signal.confirmed_match.decided_at));
  }
  return { median_minutes: Math.round(median(durations)), average_minutes: Math.round(average(durations)) };
}

/** Counts signals by the match-decision branch that executed (Feature 3). */
function confidenceDistribution() {
  const counts = { high: 0, medium: 0, low: 0, undecided: 0 };
  for (const signal of signalStore.listAll()) {
    counts[signal.decision_branch || 'undecided'] += 1;
  }
  return counts;
}

/** Unique confirmed-match pairs (confirmed_match is stored symmetrically, so divide by 2). */
function successfulMatchesCount() {
  const withMatch = signalStore.listAll().filter((s) => s.confirmed_match).length;
  return Math.round(withMatch / 2);
}

function escalationStats() {
  const escalated = signalStore.listAll().filter((s) => s.escalation?.escalated);
  const totalReminders = escalated.reduce((sum, s) => sum + s.escalation.reminder_count, 0);
  return { signals_escalated: escalated.length, total_reminders_sent: totalReminders };
}

/** Coordinator interventions: MEDIUM-branch signals a human explicitly approved or rejected. */
function coordinatorInterventionsCount() {
  return signalStore.listAll().filter((s) => s.decision_branch === 'medium' && (s.confirmed_match || s.timeline.some((e) => e.stage === 'match_rejected'))).length;
}

/** Distinct volunteer utilization: what fraction of everyone who's offered help has completed at least one confirmed match. */
function volunteerUtilization() {
  const { OFFER_TYPES } = require('./matchService');
  const volunteers = new Set();
  const active = new Set();
  for (const s of signalStore.listAll()) {
    if (!OFFER_TYPES.has(s.primary_type)) continue;
    const authorId = s.message?.author_user_id || 'unknown';
    volunteers.add(authorId);
    if (s.confirmed_match) active.add(authorId);
  }
  return { total_volunteers: volunteers.size, active_volunteers: active.size, utilization_rate: volunteers.size ? Math.round((active.size / volunteers.size) * 100) / 100 : 0 };
}

/** Per-channel signal counts — the "district demand heatmap" (channel-as-district proxy). */
function districtHeatmap() {
  const byChannel = new Map();
  for (const s of signalStore.listAll()) {
    const ch = s.message?.channel_id || 'unknown';
    byChannel.set(ch, (byChannel.get(ch) || 0) + 1);
  }
  return [...byChannel.entries()].sort((a, b) => b[1] - a[1]).map(([channel_id, count]) => ({ channel_id, count }));
}

/**
 * Count-per-bucket trend over `periods` buckets of `bucketDays` each, most
 * recent bucket last — generalizes signalStore.statsSummary()'s trend_7d.
 * @param {number} periods
 * @param {number} bucketDays
 */
function trend(periods, bucketDays) {
  const signals = signalStore.listAll();
  return Array.from({ length: periods }, (_, i) => {
    const bucketsAgo = periods - 1 - i;
    const start = Date.now() - (bucketsAgo + 1) * bucketDays * 24 * 60 * 60 * 1000;
    const end = Date.now() - bucketsAgo * bucketDays * 24 * 60 * 60 * 1000;
    return signals.filter((s) => {
      const t = new Date(s.created_at).getTime();
      return t >= start && t < end;
    }).length;
  });
}

/** Oldest unresolved signals, for the dashboard's "signal aging" widget. */
function oldestUnresolved(limit = 5) {
  return signalStore
    .listAll()
    .filter((s) => !s.resolution?.resolved && s.status !== 'false_positive')
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(0, limit)
    .map((s) => ({
      signal_id: s.signal_id,
      primary_type: s.primary_type,
      channel_id: s.message?.channel_id,
      age_hours: Math.round((Date.now() - new Date(s.created_at).getTime()) / (60 * 60 * 1000)),
      tier: scorePriority(s.types).tier,
    }));
}

/**
 * Full impact-analytics snapshot for the dashboard, /cb-impact report, and
 * the summarize_workspace_context MCP tool.
 */
function buildAnalytics() {
  const confidence = confidenceDistribution();
  const autoTriageCount = confidence.high; // HIGH branch = handled without any coordinator review
  return {
    response_time: responseTimeStats(),
    time_to_match: timeToMatchStats(),
    auto_triage_count: autoTriageCount,
    confidence_distribution: confidence,
    successful_matches: successfulMatchesCount(),
    false_positives: signalStore.statsSummary().false_positives,
    false_negatives: null, // not computable from within the system — would need an external ground-truth audit
    escalations: escalationStats(),
    coordinator_interventions: coordinatorInterventionsCount(),
    volunteer_utilization: volunteerUtilization(),
    repeat_requesters: workspaceContext.getRepeatRequesters({ limit: 10 }),
    repeat_volunteers: workspaceContext.getRepeatVolunteers({ limit: 10 }),
    district_heatmap: districtHeatmap(),
    trend_daily_14d: trend(14, 1),
    trend_weekly_8w: trend(8, 7),
    trend_monthly_6m: trend(6, 30),
    oldest_unresolved: oldestUnresolved(5),
    estimated_coordinator_hours_saved: Math.round(((autoTriageCount * MINUTES_SAVED_PER_AUTO_MATCH) / 60) * 10) / 10,
    assumptions: { minutes_saved_per_auto_match: MINUTES_SAVED_PER_AUTO_MATCH },
  };
}

module.exports = {
  buildAnalytics,
  responseTimeStats,
  timeToMatchStats,
  confidenceDistribution,
  successfulMatchesCount,
  escalationStats,
  coordinatorInterventionsCount,
  volunteerUtilization,
  districtHeatmap,
  trend,
  oldestUnresolved,
};
