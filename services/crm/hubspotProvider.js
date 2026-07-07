// HubSpot case-log provider — STUB. Not wired to the real HubSpot API because no
// sandbox credentials were available at implementation time (see
// ARCHITECTURE.md, "Locked architectural decisions", item 2).
//
// To implement: use the HubSpot CRM API (Engagements / Timeline API,
// https://developers.hubspot.com/docs/api/crm/engagements) with HUBSPOT_API_KEY
// from the environment. Each function below must keep the same signature as
// services/crm/mockProvider.js so services/crm/index.js can swap providers
// without any call-site changes.

/** @returns {never} */
function requireConfigured() {
  if (!process.env.HUBSPOT_API_KEY) {
    throw new Error(
      'HubSpot provider is not configured. Set HUBSPOT_API_KEY and implement services/crm/hubspotProvider.js.'
    );
  }
  throw new Error('HubSpot provider is stubbed and not yet implemented — see services/crm/hubspotProvider.js.');
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
async function getConstituentContext(identifier) {
  requireConfigured();
}

module.exports = { logSignal, createFollowup, getConstituentContext };
