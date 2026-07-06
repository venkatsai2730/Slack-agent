const { Assistant } = require('@slack/bolt');
const rts = require('../services/rts');
const tasks = require('../services/tasks');
const { complete } = require('../services/llm');

const SYSTEM_PROMPT =
  'You are the Community Impact Agent, a friendly Slack assistant that helps communities ' +
  'track help requests as tasks. Keep answers short (2-4 sentences). Available features: ' +
  '"@Community Impact Agent scan" in a channel finds help requests via Real-Time Search; ' +
  '/list-tasks lists open tasks; /daily-report posts an impact summary.';

// Registers the app as a Slack AI app (assistant side panel) — the agent surface.
module.exports = (app) => {
  const assistant = new Assistant({
    threadStarted: async ({ say, setSuggestedPrompts }) => {
      await say('👋 Hi! I turn community help requests into trackable tasks.');
      await setSuggestedPrompts({
        prompts: [
          { title: 'How do I scan for requests?', message: 'How do I scan a channel for help requests?' },
          { title: 'Show open tasks', message: 'What tasks are currently open?' },
        ],
      });
    },
    userMessage: async ({ message, body, say, setStatus, logger }) => {
      rts.cacheActionToken(rts.extractActionToken(message, body));
      try {
        await setStatus('is thinking...');
        const open = tasks.listOpen();
        const context = open.length
          ? `Currently open tasks: ${open.map((t) => `${t.title} (${t.status})`).join('; ')}`
          : 'There are no open tasks right now.';
        const reply = await complete(SYSTEM_PROMPT, `${context}\n\nUser: ${message.text}`);
        await say(reply || 'Try `@Community Impact Agent scan` in a channel to find help requests!');
      } catch (err) {
        logger.error('Assistant reply failed:', err);
        await say('I hit a snag talking to my language model. Try `/list-tasks` or `@Community Impact Agent scan` in a channel!');
      }
    },
  });

  app.assistant(assistant);
};
