// Minimal structured observability (Feature 9) — no new dependency. Emits
// single-line JSON to stderr (so it never pollutes MCP's stdio JSON-RPC
// channel on stdout) with a stable shape: { at, type, ...payload }. Good
// enough to grep/pipe into a log aggregator without pulling in pino/winston
// for a hackathon-grade single-process app.

/**
 * @param {string} type e.g. 'rts_search', 'mcp_tool', 'match_decision', 'escalation_sweep'
 * @param {Record<string, unknown>} payload
 */
function logEvent(type, payload = {}) {
  try {
    console.error(JSON.stringify({ at: new Date().toISOString(), type, ...payload }));
  } catch (err) {
    console.error(`telemetry: failed to serialize event "${type}":`, err.message);
  }
}

/**
 * Times an async operation and logs its outcome (success/failure + duration),
 * without changing its return value or thrown errors.
 * @template T
 * @param {string} label
 * @param {() => Promise<T>} fn
 * @param {Record<string, unknown>} [context]
 * @returns {Promise<T>}
 */
async function time(label, fn, context = {}) {
  const start = Date.now();
  try {
    const result = await fn();
    logEvent(label, { ...context, duration_ms: Date.now() - start, outcome: 'success' });
    return result;
  } catch (err) {
    logEvent(label, { ...context, duration_ms: Date.now() - start, outcome: 'failure', error: err.message });
    throw err;
  }
}

const counters = new Map();

/** @param {string} name */
function increment(name) {
  counters.set(name, (counters.get(name) || 0) + 1);
  return counters.get(name);
}

/** @param {string} name */
function getCounter(name) {
  return counters.get(name) || 0;
}

module.exports = { logEvent, time, increment, getCounter };
