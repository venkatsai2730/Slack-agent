const { complete } = require('./llm');
const signalStore = require('./signalStore');
const analyticsService = require('./analytics');

const SYSTEM_PROMPT = `You write short, warm daily impact summaries for community organizers, mutual-aid coordinators, and nonprofit teams.
Given today's signal stats and workspace impact analytics as JSON, write 3-4 sentences summarizing the day's community needs, offers of help, matches made, escalations, and what still needs attention.
Mention concrete numbers. No headings, no bullet points, no emojis — just plain, hopeful, factual prose.`;

async function buildDailyReport() {
  const stats = signalStore.statsForToday();
  const analytics = analyticsService.buildAnalytics();
  let narrative;
  try {
    narrative = (await complete(SYSTEM_PROMPT, JSON.stringify({ stats, analytics }))).trim();
  } catch (err) {
    console.error('LLM report narrative failed, using fallback:', err.message);
  }
  if (!narrative) {
    narrative = `Today Community Beacon surfaced ${stats.signals_found} community signal(s) and logged ${stats.signals_created} new one(s), with ${stats.open_signals} still waiting for a helper. ${analytics.successful_matches} match(es) have been confirmed and ${analytics.escalations.signals_escalated} signal(s) escalated to a coordinator so far. Every need caught here is a neighbor who doesn't fall through the cracks of a busy channel.`;
  }
  return { stats, analytics, narrative };
}

module.exports = { buildDailyReport };
