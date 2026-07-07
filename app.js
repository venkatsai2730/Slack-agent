require('dotenv').config();
const { App, LogLevel } = require('@slack/bolt');
const registerListeners = require('./listeners');

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
  } catch (error) {
    console.error('Failed to start app:', error);
    process.exit(1);
  }
})();
