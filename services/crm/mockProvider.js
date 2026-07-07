// Fully functional mock case log: persists to data/crm-mock.json, same
// write-through pattern as services/signalStore.js. Good enough to demo the
// case-management flow end-to-end without any external account.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'crm-mock.json');

let store = { activities: [], followups: [] };
let counter = 0;

function load() {
  try {
    store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!Array.isArray(store.activities)) store.activities = [];
    if (!Array.isArray(store.followups)) store.followups = [];
    counter = store.activities.length + store.followups.length;
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('crm-mock.json exists but could not be parsed, starting empty:', err.message);
  }
}
load();

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmpFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(store, null, 2));
    fs.renameSync(tmpFile, DATA_FILE);
  } catch (err) {
    console.error('Could not persist mock case-log data:', err.message);
  }
}

/**
 * @param {import('../signalStore').Signal} signal
 * @returns {Promise<{ recordId: string }>}
 */
async function logSignal(signal) {
  counter += 1;
  const recordId = `mockcrm_activity_${Date.now()}_${counter}`;
  store.activities.push({
    record_id: recordId,
    signal_id: signal.signal_id,
    constituent: signal.message?.author_name || signal.message?.author_user_id || 'unknown',
    primary_type: signal.primary_type,
    summary: signal.summary?.what_happened || '',
    logged_at: new Date().toISOString(),
  });
  save();
  return { recordId };
}

/**
 * @param {import('../signalStore').Signal} signal
 * @param {string} [owner]
 * @returns {Promise<{ followupId: string }>}
 */
async function createFollowup(signal, owner) {
  counter += 1;
  const followupId = `mockcrm_followup_${Date.now()}_${counter}`;
  store.followups.push({
    followup_id: followupId,
    signal_id: signal.signal_id,
    owner: owner || null,
    action: signal.summary?.recommended_next_action || 'Follow up on this signal.',
    status: 'open',
    created_at: new Date().toISOString(),
  });
  save();
  return { followupId };
}

/**
 * Prior help history for a community member: "has this neighbor asked before,
 * and is anyone already following up?"
 * @param {string} identifier member name, Slack user id, or email
 * @returns {Promise<object|null>}
 */
async function getConstituentContext(identifier) {
  const activities = store.activities.filter((a) => a.constituent === identifier);
  const followups = store.followups.filter((f) =>
    activities.some((a) => a.signal_id === f.signal_id)
  );
  if (!activities.length) return null;
  return {
    constituent: identifier,
    total_activities: activities.length,
    open_followups: followups.filter((f) => f.status === 'open').length,
    recent_activities: activities.slice(-5).reverse(),
  };
}

module.exports = { logSignal, createFollowup, getConstituentContext };
