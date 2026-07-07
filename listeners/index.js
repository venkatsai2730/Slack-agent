const appMention = require('./events/app-mention');
const message = require('./events/message');
const gbScan = require('./commands/gb-scan');
const gbSignals = require('./commands/gb-signals');
const gbReport = require('./commands/gb-report');
const signalActions = require('./actions/signal-actions');
const assistant = require('./assistant');
const appHome = require('./app-home');

module.exports = (app) => {
  appMention(app);
  message(app);
  gbScan(app);
  gbSignals(app);
  gbReport(app);
  signalActions(app);
  assistant(app);
  appHome(app);
};
