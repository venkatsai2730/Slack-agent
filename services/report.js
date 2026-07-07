const { complete } = require('./llm');
const signalStore = require('./signalStore');

const SYSTEM_PROMPT = `You write short, warm daily impact summaries for community organizers, mutual-aid coordinators, and nonprofit teams.
Given today's signal stats as JSON, write 3-4 sentences summarizing the day's community needs, offers of help, and what still needs attention.
Mention concrete numbers. No headings, no bullet points, no emojis — just plain, hopeful, factual prose.`;

async function buildDailyReport() {
  const stats = signalStore.statsForToday();
  let narrative;
  try {
    narrative = (await complete(SYSTEM_PROMPT, JSON.stringify(stats))).trim();
  } catch (err) {
    console.error('LLM report narrative failed, using fallback:', err.message);
  }
  if (!narrative) {
    narrative = `Today Community Beacon surfaced ${stats.signals_found} community signal(s) and logged ${stats.signals_created} new one(s), with ${stats.open_signals} still waiting for a helper. Every need caught here is a neighbor who doesn't fall through the cracks of a busy channel.`;
  }
  return { stats, narrative };
}

module.exports = { buildDailyReport };
