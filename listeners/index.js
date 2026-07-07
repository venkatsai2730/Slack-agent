const appMention = require('./events/app-mention');
const message = require('./events/message');
const cbScan = require('./commands/cb-scan');
const cbNeeds = require('./commands/cb-needs');
const cbImpact = require('./commands/cb-impact');
const signalActions = require('./actions/signal-actions');
const assistant = require('./assistant');
const appHome = require('./app-home');

module.exports = (app) => {
  appMention(app);
  message(app);
  cbScan(app);
  cbNeeds(app);
  cbImpact(app);
  signalActions(app);
  assistant(app);
  appHome(app);
};
