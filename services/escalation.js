// Proactive agentic escalation (Feature 2): rather than only reacting to
// incoming messages, this module is run on a timer (wired up in app.js) to
// sweep for unresolved signals that have sat too long, and proactively DM the
// configured coordinators + post a channel alert with an AI explanation.

const signalStore = require('./signalStore');
const workspaceContext = require('./workspaceContext');
const llm = require('./llm');
const telemetry = require('./telemetry');

const SYSTEM_PROMPT = `You are a community-impact analyst writing a one-sentence escalation explanation for a mutual-aid coordinator. Given a signal's summary, priority tier, hours unresolved, and workspace history, explain briefly why a human should step in now. Be factual, not alarmist. Respond with plain text, one sentence, no JSON, no markdown.`;

/** @returns {{ enabled: boolean, checkMinutes: number, ageHours: Record<string,number>, maxReminders: number, quietStart: number, quietEnd: number, coordinatorIds: string[], alertsChannel?: string }} */
function config() {
  const num = (name, fallback) => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    enabled: process.env.ESCALATION_ENABLED !== 'false',
    checkMinutes: num('ESCALATION_CHECK_MINUTES', 60),
    ageHours: {
      critical: num('ESCALATION_AGE_HOURS_CRITICAL', 1),
      high: num('ESCALATION_AGE_HOURS_HIGH', 4),
      routine: num('ESCALATION_AGE_HOURS_ROUTINE', 24),
    },
    maxReminders: num('ESCALATION_MAX_REMINDERS', 3),
    quietStart: num('ESCALATION_QUIET_HOURS_START', 22),
    quietEnd: num('ESCALATION_QUIET_HOURS_END', 7),
    coordinatorIds: (process.env.COORDINATOR_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
    alertsChannel: process.env.COMMUNITY_ALERTS_CHANNEL,
  };
}

/**
 * @param {Date} date
 * @param {{ quietStart: number, quietEnd: number }} cfg
 * @returns {boolean}
 */
function isQuietHours(date, cfg) {
  const hour = date.getHours();
  const { quietStart, quietEnd } = cfg;
  if (quietStart === quietEnd) return false;
  // Wrapping window (e.g. 22 -> 7) vs a same-day window (e.g. 1 -> 5).
  return quietStart > quietEnd ? hour >= quietStart || hour < quietEnd : hour >= quietStart && hour < quietEnd;
}

/** @param {string} tier falls back to the routine threshold for any unrecognized tier @param {{ ageHours: Record<string, number> }} cfg */
function ageThresholdHours(tier, cfg) {
  return cfg.ageHours[tier] ?? cfg.ageHours.routine;
}

/**
 * Finds unresolved signals past their tier's age threshold that haven't
 * already hit the max-reminders cap.
 * @param {ReturnType<typeof config>} cfg
 */
function selectEscalationCandidates(cfg) {
  const tiers = /** @type {const} */ (['critical', 'high', 'routine']);
  const seen = new Set();
  const candidates = [];
  for (const tier of tiers) {
    const hours = ageThresholdHours(tier, cfg);
    for (const signal of signalStore.listUnresolvedOlderThan(hours, { tier })) {
      if (seen.has(signal.signal_id)) continue;
      if (signal.escalation.reminder_count >= cfg.maxReminders) continue;
      seen.add(signal.signal_id);
      candidates.push({ signal, tier, hours });
    }
  }
  return candidates;
}

/**
 * @param {{ signal: import('./signalStore').Signal, tier: string, hours: number }} candidate
 */
async function buildExplanation({ signal, tier, hours }) {
  const history = workspaceContext.getRecurringByType(signal.primary_type, signal.message.channel_id);
  const ageHours = Math.round((Date.now() - new Date(signal.created_at).getTime()) / (60 * 60 * 1000));
  const fallback = `This ${tier}-priority ${signal.primary_type.replace(/_/g, ' ')} has remained unresolved for ${ageHours} hour(s)${history.is_recurring ? `, and this channel has seen ${history.count} similar signals recently` : ''} — coordinator intervention is recommended.`;
  try {
    const userPrompt = JSON.stringify({
      summary: signal.summary?.what_happened,
      tier,
      age_hours: ageHours,
      recurrence: history,
    });
    const text = (await llm.complete(SYSTEM_PROMPT, userPrompt)).trim();
    return text || fallback;
  } catch (err) {
    console.error('Escalation explanation generation failed, using fallback:', err.message);
    return fallback;
  }
}

/**
 * Runs one escalation sweep: DMs coordinators, posts a channel alert, and
 * records the escalation on each candidate signal. Safe to call repeatedly —
 * quiet hours and the max-reminders cap keep it from spamming.
 *
 * A signal is only ever marked escalated (consuming one of its
 * ESCALATION_MAX_REMINDERS slots) if a notification actually went out. Without
 * this guard, a workspace with no COORDINATOR_USER_IDS/COMMUNITY_ALERTS_CHANNEL
 * configured (or no `client`) would silently burn through every candidate's
 * reminder budget without a single human ever being notified, after which
 * selectEscalationCandidates() would exclude it forever — a signal that looks
 * "handled" but was never actually surfaced to anyone.
 * @param {{ client: any }} opts
 * @returns {Promise<{ escalated: number, skipped_quiet_hours: boolean, skipped_no_destination: boolean }>}
 */
async function runEscalationSweep({ client }) {
  const start = Date.now();
  const cfg = config();
  if (!cfg.enabled) return { escalated: 0, skipped_quiet_hours: false, skipped_no_destination: false };
  if (isQuietHours(new Date(), cfg)) {
    telemetry.logEvent('escalation_sweep', { outcome: 'skipped_quiet_hours', duration_ms: Date.now() - start });
    return { escalated: 0, skipped_quiet_hours: true, skipped_no_destination: false };
  }
  if (!client || (!cfg.coordinatorIds.length && !cfg.alertsChannel)) {
    telemetry.logEvent('escalation_sweep', { outcome: 'skipped_no_destination', duration_ms: Date.now() - start, has_client: Boolean(client) });
    return { escalated: 0, skipped_quiet_hours: false, skipped_no_destination: true };
  }

  const candidates = selectEscalationCandidates(cfg);
  let escalated = 0;

  for (const candidate of candidates) {
    const { signal, tier } = candidate;
    const explanation = await buildExplanation(candidate);
    const text =
      `🚨 *Escalation:* ${signal.primary_type.replace(/_/g, ' ')} (${tier}) has been unresolved since <!date^${Math.floor(new Date(signal.created_at).getTime() / 1000)}^{date_short_pretty} {time}|${signal.created_at}>.\n` +
      `${explanation}\n` +
      `<${signal.message.permalink || '#'}|View the original message> · Signal ID: \`${signal.signal_id}\``;

    let notified = false;
    for (const userId of cfg.coordinatorIds) {
      try {
        const opened = await client.conversations.open({ users: userId });
        await client.chat.postMessage({ channel: opened.channel.id, text });
        notified = true;
      } catch (err) {
        console.error(`Escalation DM to ${userId} failed:`, err.message);
      }
    }
    if (cfg.alertsChannel) {
      try {
        await client.chat.postMessage({ channel: cfg.alertsChannel, text });
        notified = true;
      } catch (err) {
        console.error(`Escalation channel post to ${cfg.alertsChannel} failed:`, err.message);
      }
    }

    if (notified) {
      signalStore.markEscalated(signal.signal_id);
      escalated += 1;
    } else {
      console.error(`Escalation for signal ${signal.signal_id} produced no successful notification — not consuming its reminder budget.`);
    }
  }

  telemetry.logEvent('escalation_sweep', { outcome: 'ran', duration_ms: Date.now() - start, candidates: candidates.length, escalated });
  return { escalated, skipped_quiet_hours: false, skipped_no_destination: false };
}

module.exports = { config, isQuietHours, ageThresholdHours, selectEscalationCandidates, buildExplanation, runEscalationSweep };
