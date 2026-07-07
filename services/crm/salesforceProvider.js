// Salesforce CRM provider — STUB. Not wired to the real Salesforce API because no
// sandbox credentials were available at implementation time (see
// IMPLEMENTATION_PLAN.md, "Locked architectural decisions", item 2).
//
// To implement: use the Salesforce REST API (sObject Task/Lead endpoints) with
// SALESFORCE_CLIENT_ID / SALESFORCE_CLIENT_SECRET / SALESFORCE_INSTANCE_URL from
// the environment (OAuth 2.0 client credentials or JWT bearer flow). Each
// function below must keep the same signature as services/crm/mockProvider.js
// so services/crm/index.js can swap providers without any call-site changes.

/** @returns {never} */
function requireConfigured() {
  if (!process.env.SALESFORCE_INSTANCE_URL) {
    throw new Error(
      'Salesforce CRM provider is not configured. Set SALESFORCE_CLIENT_ID/SALESFORCE_CLIENT_SECRET/SALESFORCE_INSTANCE_URL and implement services/crm/salesforceProvider.js.'
    );
  }
  throw new Error('Salesforce CRM provider is stubbed and not yet implemented — see services/crm/salesforceProvider.js.');
}

/** @param {import('../signalStore').Signal} signal @returns {Promise<{ recordId: string }>} */
async function logSignal(signal) {
  requireConfigured();
}

/** @param {import('../signalStore').Signal} signal @param {string} [owner] @returns {Promise<{ followupId: string }>} */
async function createFollowup(signal, owner) {
  requireConfigured();
}

/** @param {string} identifier @returns {Promise<object|null>} */
async function getCustomerContext(identifier) {
  requireConfigured();
}

module.exports = { logSignal, createFollowup, getCustomerContext };
