const { Assistant } = require('@slack/bolt');
const rts = require('../services/rts');
const signalStore = require('../services/signalStore');
const { complete } = require('../services/llm');

const SYSTEM_PROMPT =
  'You are Community Beacon, an AI community-impact assistant that watches Slack for calls for help ' +
  '(food, housing, transport, medical, emotional support) and offers of help (volunteers, donations, skills), ' +
  'and makes sure none go unanswered. Keep answers short (2-4 sentences) and warm. ' +
  'Available features: "@Community Beacon scan" in a channel finds community signals via Real-Time Search; ' +
  '/cb-needs lists recently detected needs and offers; /cb-impact posts a community impact report.';

// Registers the app as a Slack AI app (assistant side panel) — the agent surface.
module.exports = (app) => {
  const assistant = new Assistant({
    threadStarted: async ({ say, setSuggestedPrompts }) => {
      await say('👋 Hi! I watch this community for calls for help and offers of help, so no one falls through the cracks.');
      await setSuggestedPrompts({
        prompts: [
          { title: 'How do I scan for needs?', message: 'How do I scan a channel for community needs?' },
          { title: 'Show recent needs', message: 'What community needs have been detected recently?' },
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
          : 'No community signals have been detected yet.';
        // Bolt's Assistant userMessage payload is always a plain new message at
        // runtime; the broader message-event union type just doesn't say so.
        const userText = /** @type {{ text?: string }} */ (message).text || '';
        const reply = await complete(SYSTEM_PROMPT, `${context}\n\nUser: ${userText}`);
        await say(reply || 'Try `@Community Beacon scan` in a channel to find community needs!');
      } catch (err) {
        logger.error('Assistant reply failed:', err);
        await say('I hit a snag talking to my language model. Try `/cb-needs` or `@Community Beacon scan` in a channel!');
      }
    },
  });

  app.assistant(assistant);
};
