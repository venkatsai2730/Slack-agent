const rts = require('../../services/rts');

// We don't act on every channel message (too noisy for an MVP) — but if Slack
// includes an action_token in the payload, cache it so /scan-requests can use it.
module.exports = (app) => {
  app.event('message', async ({ event, body }) => {
    rts.cacheActionToken(rts.extractActionToken(event, body));
  });
};
