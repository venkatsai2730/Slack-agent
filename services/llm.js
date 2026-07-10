// Node16 module resolution sees this dual CJS/ESM package's types as non-constructable
// from a plain require(); the runtime value is a callable class either way (verified),
// so this is a type-only assertion with no behavior change.
const OpenAI = /** @type {new (config: { baseURL: string, apiKey: string }) => import('openai').default} */ (
  /** @type {unknown} */ (require('openai'))
);

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

// Every prompt in this codebase fences user-controlled text (Slack message
// content) inside a `"""..."""` delimiter so the model can distinguish
// instructions from data. A message that itself contains a literal `"""`
// could otherwise prematurely close that fence and inject new "instructions"
// after it. Splitting the delimiter with an explicit zero-width space
// (U+200B, built via fromCharCode rather than pasting the invisible
// character into source) neutralizes that without visibly altering the
// text — Slack/log output renders identically since U+200B has no glyph.
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
function sanitizeForPrompt(text) {
  return String(text || '').split('"""').join(`"${ZERO_WIDTH_SPACE}""`);
}

module.exports = { complete, extractJson, sanitizeForPrompt };
