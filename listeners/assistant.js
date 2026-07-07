const { Assistant } = require('@slack/bolt');
const rts = require('../services/rts');
const signalStore = require('../services/signalStore');
const { complete } = require('../services/llm');

const SYSTEM_PROMPT =
  'You are Growth Beacon, an AI growth intelligence assistant that monitors Slack for buying intent, ' +
  'expansion opportunities, competitor mentions, and churn risk. Keep answers short (2-4 sentences). ' +
  'Available features: "@Growth Beacon scan" in a channel finds growth signals via Real-Time Search; ' +
  '/gb-signals lists recently detected signals; /gb-report posts a growth intelligence summary.';

// Registers the app as a Slack AI app (assistant side panel) — the agent surface.
module.exports = (app) => {
  const assistant = new Assistant({
    threadStarted: async ({ say, setSuggestedPrompts }) => {
      await say('👋 Hi! I monitor Slack conversations for growth signals and turn them into CRM-ready business intelligence.');
      await setSuggestedPrompts({
        prompts: [
          { title: 'How do I scan for signals?', message: 'How do I scan a channel for growth signals?' },
          { title: 'Show recent signals', message: 'What growth signals have been detected recently?' },
        ],
      });
    },
    userMessage: async ({ message, body, say, setStatus, logger }) => {
      rts.captureFromEvent(message, body);
      try {
        await setStatus('is thinking...');
        const recent = signalStore.listRecent(5);
        const context = recent.length
          ? `Recently detected signals: ${recent.map((s) => `${s.primary_type} (${s.status})`).join('; ')}`
          : 'No growth signals have been detected yet.';
        // Bolt's Assistant userMessage payload is always a plain new message at
        // runtime; the broader message-event union type just doesn't say so.
        const userText = /** @type {{ text?: string }} */ (message).text || '';
        const reply = await complete(SYSTEM_PROMPT, `${context}\n\nUser: ${userText}`);
        await say(reply || 'Try `@Growth Beacon scan` in a channel to find growth signals!');
      } catch (err) {
        logger.error('Assistant reply failed:', err);
        await say('I hit a snag talking to my language model. Try `/gb-signals` or `@Growth Beacon scan` in a channel!');
      }
    },
  });

  app.assistant(assistant);
};
