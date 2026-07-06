const { complete } = require('./llm');
const tasks = require('./tasks');

const SYSTEM_PROMPT = `You write short, warm impact summaries for a community volunteering Slack workspace.
Given today's stats as JSON, write 3-4 encouraging sentences about the community's impact today.
Mention concrete numbers. No headings, no bullet points, no emojis — just warm plain prose.`;

async function buildDailyReport() {
  const stats = tasks.statsForToday();
  let narrative;
  try {
    narrative = (await complete(SYSTEM_PROMPT, JSON.stringify(stats))).trim();
  } catch (err) {
    console.error('LLM report narrative failed, using fallback:', err.message);
  }
  if (!narrative) {
    narrative = `Today the community surfaced ${stats.requests_found} help request(s), created ${stats.tasks_created} task(s), and completed ${stats.tasks_completed}. Every task closed is a neighbour helped — thank you!`;
  }
  return { stats, narrative };
}

module.exports = { buildDailyReport };
