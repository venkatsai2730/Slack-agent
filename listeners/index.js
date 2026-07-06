const appMention = require('./events/app-mention');
const message = require('./events/message');
const scanRequests = require('./commands/scan-requests');
const listTasks = require('./commands/list-tasks');
const dailyReport = require('./commands/daily-report');
const taskActions = require('./actions/task-actions');
const assistant = require('./assistant');

module.exports = (app) => {
  appMention(app);
  message(app);
  scanRequests(app);
  listTasks(app);
  dailyReport(app);
  taskActions(app);
  assistant(app);
};
