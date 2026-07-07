const { complete } = require('./llm');
const signalStore = require('./signalStore');

const SYSTEM_PROMPT = `You write short, sharp growth-intelligence summaries for Growth, Sales, Customer Success, and Product leaders at a B2B SaaS company.
Given today's signal stats as JSON, write 3-4 sentences summarizing the day's business signals and their revenue/risk implications.
Mention concrete numbers. No headings, no bullet points, no emojis — just plain, confident prose.`;

async function buildDailyReport() {
  const stats = signalStore.statsForToday();
  let narrative;
  try {
    narrative = (await complete(SYSTEM_PROMPT, JSON.stringify(stats))).trim();
  } catch (err) {
    console.error('LLM report narrative failed, using fallback:', err.message);
  }
  if (!narrative) {
    narrative = `Today Growth Beacon surfaced ${stats.signals_found} growth signal(s) and logged ${stats.signals_created} new signal(s), with ${stats.open_signals} still open for review. Every signal caught is a conversation your team doesn't have to discover the hard way — in a support ticket, a lost renewal, or a competitor win.`;
  }
  return { stats, narrative };
}

module.exports = { buildDailyReport };
