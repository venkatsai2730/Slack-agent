const signalStore = require('../services/signalStore');
const { dashboardBlocks } = require('../blocks/dashboard-blocks');

// Renders the analytics dashboard into the App Home "Home" tab whenever a user
// opens it — Slack-native alternative to a separate web dashboard (see
// IMPLEMENTATION_PLAN.md, "Locked architectural decisions", item 4).
module.exports = (app) => {
  app.event('app_home_opened', async ({ event, client, logger }) => {
    if (event.tab !== 'home') return;
    try {
      const stats = signalStore.statsSummary();
      await client.views.publish({
        user_id: event.user,
        view: { type: 'home', blocks: dashboardBlocks(stats) },
      });
    } catch (err) {
      logger.error('Failed to publish App Home dashboard:', err);
    }
  });
};
