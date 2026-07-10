require('dotenv').config();
const { App, LogLevel } = require('@slack/bolt');
const registerListeners = require('./listeners');
const escalation = require('./services/escalation');

const missing = ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'LLM_API_KEY'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(', ')}. Copy .env.sample to .env and fill them in.`);
  process.exit(1);
}

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: LogLevel.INFO,
});

registerListeners(app);

(async () => {
  try {
    await app.start();
    console.log('🤝 Community Beacon is running (Socket Mode)');

    // Feature 2: proactive escalation sweep, run on a timer. Only ever runs in
    // this long-lived Bolt process — mcp/server.js never starts this interval.
    const cfg = escalation.config();
    if (cfg.enabled) {
      const client = app.client;
      setInterval(() => {
        escalation.runEscalationSweep({ client }).catch((err) => console.error('Escalation sweep failed:', err.message));
      }, cfg.checkMinutes * 60_000);
      console.log(`⏰ Escalation sweep scheduled every ${cfg.checkMinutes} minute(s)`);
    }
  } catch (error) {
    console.error('Failed to start app:', error);
    process.exit(1);
  }
})();
