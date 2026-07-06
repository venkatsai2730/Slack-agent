const { complete, extractJson } = require('./llm');

const SYSTEM_PROMPT = `You analyze Slack messages from community channels and decide whether each one is a request for help (volunteers, donations, assistance, support, resources).

Respond with ONLY a JSON object, no other text:
{
  "is_request": true or false,
  "title": "short actionable title, max 10 words",
  "description": "1-2 sentence summary of what is needed",
  "category": "education" | "health" | "finance" | "environment" | "other",
  "urgency": "low" | "medium" | "high"
}
If the message is not a help request (e.g. chit-chat, an offer, a bot command), set is_request to false.`;

const CATEGORIES = ['education', 'health', 'finance', 'environment', 'other'];
const URGENCIES = ['low', 'medium', 'high'];

// Returns a structured request object, or null when the message isn't a help request.
async function summarizeAsRequest(msg) {
  const text = msg.content || '';
  if (!text.trim()) return null;

  const fallback = {
    is_request: true,
    title: text.slice(0, 60),
    description: text.slice(0, 300),
    category: 'other',
    urgency: 'medium',
  };

  let parsed = fallback;
  try {
    const raw = await complete(
      SYSTEM_PROMPT,
      `Message from ${msg.author_name || 'someone'} in #${msg.channel_name || 'a channel'}:\n"""${text}"""`
    );
    parsed = extractJson(raw, fallback);
  } catch (err) {
    console.error('LLM summarization failed, using fallback:', err.message);
  }

  if (parsed.is_request === false) return null;

  return {
    title: String(parsed.title || fallback.title).slice(0, 150),
    description: String(parsed.description || fallback.description).slice(0, 500),
    category: CATEGORIES.includes(parsed.category) ? parsed.category : 'other',
    urgency: URGENCIES.includes(parsed.urgency) ? parsed.urgency : 'medium',
    requester: msg.author_name || msg.author_user_id || 'unknown',
    message_permalink: msg.permalink || '',
  };
}

module.exports = { summarizeAsRequest };
