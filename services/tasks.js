// Task store: in-memory with write-through to data/tasks.json (hackathon-grade, no DB).
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'tasks.json');

let store = { tasks: [], scans: [] };
let counter = 0;

function load() {
  try {
    store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    counter = store.tasks.length;
  } catch {
    // first run — start empty
  }
}
load();

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
  } catch (err) {
    console.error('Could not persist tasks:', err.message);
  }
}

function createTask(request) {
  counter += 1;
  const task = {
    task_id: `task_${Date.now()}_${counter}`,
    title: request.title,
    details: request.description,
    status: 'pending',
    assignee: null,
    category: request.category || 'other',
    urgency: request.urgency || 'medium',
    source_request: {
      requester: request.requester || 'unknown',
      permalink: request.message_permalink || '',
    },
    created_at: new Date().toISOString(),
    completed_at: null,
  };
  store.tasks.push(task);
  save();
  return task;
}

function getTask(taskId) {
  return store.tasks.find((t) => t.task_id === taskId) || null;
}

function updateStatus(taskId, status, assignee) {
  const task = getTask(taskId);
  if (!task) return null;
  task.status = status;
  if (assignee && !task.assignee) task.assignee = assignee;
  task.completed_at = status === 'complete' ? new Date().toISOString() : null;
  save();
  return task;
}

function listOpen() {
  return store.tasks.filter((t) => t.status !== 'complete');
}

function logScan(requestsFound) {
  store.scans.push({ at: new Date().toISOString(), requests_found: requestsFound });
  save();
}

function isToday(iso) {
  return !!iso && new Date(iso).toDateString() === new Date().toDateString();
}

function statsForToday() {
  const byCategory = {};
  let tasksCreated = 0;
  let tasksCompleted = 0;
  for (const t of store.tasks) {
    if (isToday(t.created_at)) {
      tasksCreated += 1;
      byCategory[t.category] = (byCategory[t.category] || 0) + 1;
    }
    if (isToday(t.completed_at)) tasksCompleted += 1;
  }
  const requestsFound = store.scans
    .filter((s) => isToday(s.at))
    .reduce((sum, s) => sum + s.requests_found, 0);
  return {
    date: new Date().toDateString(),
    requests_found: requestsFound,
    tasks_created: tasksCreated,
    tasks_completed: tasksCompleted,
    open_tasks: listOpen().length,
    by_category: byCategory,
  };
}

module.exports = { createTask, getTask, updateStatus, listOpen, logScan, statsForToday };
