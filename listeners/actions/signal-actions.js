const signalStore = require('../../services/signalStore');
const crm = require('../../services/crm');
const matchService = require('../../services/matchService');
const matchDecision = require('../../services/matchDecision');
const scan = require('../../services/scan');
const { signalCardBlocks } = require('../../blocks/signal-card');

async function updateSignalCard(client, channel, ts, signal) {
  const text = signal.summary?.what_happened || signal.primary_type;
  await client.chat.update({ channel, ts, text, blocks: signalCardBlocks(signal) });
}

module.exports = (app) => {
  // "Open Thread" is a url button — Slack still sends an interaction payload for
  // it that must be acked, even though the link opens client-side regardless.
  app.action('open_thread', async ({ ack }) => {
    await ack();
  });

  app.action('view_case', async ({ ack, action, respond, logger }) => {
    await ack();
    try {
      const signal = signalStore.getSignal(action.value);
      if (!signal) {
        await respond({ response_type: 'ephemeral', text: '⚠️ Signal not found (the app may have restarted with a cleared store).' });
        return;
      }
      const identifier = signal.message.author_name || signal.message.author_user_id;
      const context = await crm.getProvider().getConstituentContext(identifier);
      const text = context
        ? `*Case history for ${identifier}:*\n• Prior signals logged: ${context.total_activities}\n• Open follow-ups: ${context.open_followups}`
        : `No prior case history found for *${identifier}*. This looks like their first logged signal.`;
      await respond({ response_type: 'ephemeral', text });
    } catch (err) {
      logger.error('view_case failed:', err);
      await respond({ response_type: 'ephemeral', text: `⚠️ Could not load case history: \`${err.message}\`` });
    }
  });

  // "I Can Help" — the clicking user claims the need as its helper.
  app.action('claim_help', async ({ ack, body, action, client, logger, respond }) => {
    await ack();
    try {
      const existing = signalStore.getSignal(action.value);
      if (!existing) {
        await respond({ response_type: 'ephemeral', text: '⚠️ Signal not found (the app may have restarted with a cleared store).' });
        return;
      }
      // Defense in depth: the card itself stops rendering this button once a
      // signal is resolved, but a coordinator could still be looking at a
      // stale render (an older copy of the card, a slow client) — guard the
      // action itself rather than trusting the button's mere presence.
      if (existing.resolution?.resolved) {
        await respond({ response_type: 'ephemeral', text: '⚠️ This signal has already been resolved — no need to claim it.' });
        return;
      }
      const signal = signalStore.assignOwner(action.value, body.user.id);
      await updateSignalCard(client, body.channel.id, body.message.ts, signal);
    } catch (err) {
      logger.error('claim_help failed:', err);
      await respond({ response_type: 'ephemeral', text: `⚠️ Could not claim this signal: \`${err.message}\`` });
    }
  });

  app.action('not_a_request', async ({ ack, body, action, client, logger, respond }) => {
    await ack();
    try {
      const existing = signalStore.getSignal(action.value);
      if (!existing) {
        await respond({ response_type: 'ephemeral', text: '⚠️ Signal not found (the app may have restarted with a cleared store).' });
        return;
      }
      if (existing.resolution?.resolved) {
        await respond({
          response_type: 'ephemeral',
          text: '⚠️ This signal has already been resolved (a match was confirmed) — marking it "not a request" now would overwrite that history. Use View Timeline to review it instead.',
        });
        return;
      }
      const signal = signalStore.markFalsePositive(action.value, body.user.id);
      await updateSignalCard(client, body.channel.id, body.message.ts, signal);
    } catch (err) {
      logger.error('not_a_request failed:', err);
      await respond({ response_type: 'ephemeral', text: `⚠️ Could not update signal: \`${err.message}\`` });
    }
  });

  // Feature 5: shows the per-signal reasoning timeline recorded throughout the
  // detect -> search -> enrich -> decide -> post pipeline.
  app.action('view_timeline', async ({ ack, action, respond, logger }) => {
    await ack();
    try {
      const signal = signalStore.getSignal(action.value);
      if (!signal) {
        await respond({ response_type: 'ephemeral', text: '⚠️ Signal not found (the app may have restarted with a cleared store).' });
        return;
      }
      const lines = signal.timeline.map((e) => `• \`${new Date(e.at).toLocaleTimeString()}\` *${e.stage}* — ${e.detail}`);
      await respond({ response_type: 'ephemeral', text: `*🕒 Reasoning timeline for this signal:*\n${lines.join('\n')}` });
    } catch (err) {
      logger.error('view_timeline failed:', err);
      await respond({ response_type: 'ephemeral', text: `⚠️ Could not load timeline: \`${err.message}\`` });
    }
  });

  // Feature 3 HIGH branch — one-click confirm, no coordinator review needed.
  app.action('confirm_match', async ({ ack, body, action, client, logger, respond }) => {
    await ack();
    try {
      const { signal_id, candidate_id } = JSON.parse(action.value);
      const signal = signalStore.confirmMatch(signal_id, candidate_id, signalStore.getSignal(signal_id)?.match_recommendation?.confidence || 0.75, body.user.id);
      if (!signal) {
        await respond({ response_type: 'ephemeral', text: '⚠️ Signal not found (the app may have restarted with a cleared store).' });
        return;
      }
      await updateSignalCard(client, body.channel.id, body.message.ts, signal);
    } catch (err) {
      logger.error('confirm_match failed:', err);
      await respond({ response_type: 'ephemeral', text: `⚠️ Could not confirm this match: \`${err.message}\`` });
    }
  });

  // Feature 3 MEDIUM branch — coordinator explicitly approves the suggested match.
  app.action('approve_match', async ({ ack, body, action, client, logger, respond }) => {
    await ack();
    try {
      const { signal_id, candidate_id } = JSON.parse(action.value);
      const signal = signalStore.confirmMatch(signal_id, candidate_id, signalStore.getSignal(signal_id)?.match_recommendation?.confidence || 0.5, body.user.id);
      if (!signal) {
        await respond({ response_type: 'ephemeral', text: '⚠️ Signal not found (the app may have restarted with a cleared store).' });
        return;
      }
      await updateSignalCard(client, body.channel.id, body.message.ts, signal);
    } catch (err) {
      logger.error('approve_match failed:', err);
      await respond({ response_type: 'ephemeral', text: `⚠️ Could not approve this match: \`${err.message}\`` });
    }
  });

  // Feature 3 MEDIUM branch — coordinator rejects the suggestion. Rather than
  // just clearing the recommendation and leaving the signal to rot until a
  // manual re-scan, immediately re-run matchDecision against the remaining
  // candidates (excluding every previously-rejected one, so it can never
  // re-recommend the same candidate) — the same auto-retry behavior a fresh
  // signal gets, applied on rejection.
  app.action('reject_match', async ({ ack, body, action, client, logger, respond }) => {
    await ack();
    try {
      const { signal_id, candidate_id } = JSON.parse(action.value);
      const existing = signalStore.getSignal(signal_id);
      if (!existing) {
        await respond({ response_type: 'ephemeral', text: '⚠️ Signal not found (the app may have restarted with a cleared store).' });
        return;
      }

      signalStore.addRejectedCandidate(signal_id, candidate_id);
      signalStore.recordTimelineEvent(signal_id, 'match_rejected', `Coordinator ${body.user.id} rejected a match with ${candidate_id}`);

      const refreshed = signalStore.getSignal(signal_id);
      const candidates = matchService.findMatches(refreshed).filter((c) => !refreshed.rejected_candidates.includes(c.signal_id));
      const decision = matchDecision.decide(refreshed, candidates);
      const matchRecommendation = matchDecision.toMatchRecommendation(decision);
      signalStore.updateSignal(signal_id, { decision_branch: decision.branch, match_recommendation: matchRecommendation });
      signalStore.recordTimelineEvent(
        signal_id,
        'match_decision',
        `Re-decided after rejection — ${decision.branch.toUpperCase()} confidence (${Math.round(decision.confidence * 100)}%): ${decision.explanation}`
      );

      if (decision.branch === 'low' && client) {
        await scan.postOutreach({ client, signal: signalStore.getSignal(signal_id) });
      }

      await updateSignalCard(client, body.channel.id, body.message.ts, signalStore.getSignal(signal_id));
    } catch (err) {
      logger.error('reject_match failed:', err);
      await respond({ response_type: 'ephemeral', text: `⚠️ Could not reject this match: \`${err.message}\`` });
    }
  });
};
