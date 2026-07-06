const OpenAI = require('openai');

// Any OpenAI-compatible endpoint works: Hugging Face router (default), Ollama, Groq, etc.
const client = new OpenAI({
  baseURL: process.env.LLM_BASE_URL || 'https://router.huggingface.co/v1',
  apiKey: process.env.LLM_API_KEY || 'missing-key', // app.js validates this at startup
});

const MODEL = process.env.LLM_MODEL || 'meta-llama/Llama-3.1-8B-Instruct';

async function complete(systemPrompt, userPrompt) {
  const res = await client.chat.completions.create({
    model: MODEL,
    temperature: 0,
    max_tokens: 600,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });
  return res.choices?.[0]?.message?.content || '';
}

// Small open models sometimes wrap JSON in prose — slice from first { to last }.
function extractJson(text, fallback) {
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return fallback;
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return fallback;
  }
}

module.exports = { complete, extractJson };
