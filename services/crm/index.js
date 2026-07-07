// Case-log (CRM) provider abstraction. Business logic (listeners, MCP tools)
// should only ever import getProvider() from here — never a specific provider
// file directly — so swapping CRM_PROVIDER in .env is the only change needed to
// switch backends. Nonprofits track constituents and cases in real CRMs
// (e.g. Salesforce Nonprofit Cloud), which is exactly what this abstracts.

const mock = require('./mockProvider');
const hubspot = require('./hubspotProvider');
const salesforce = require('./salesforceProvider');

/**
 * @typedef {Object} CrmProvider
 * @property {(signal: import('../signalStore').Signal) => Promise<{recordId: string}>} logSignal
 * @property {(signal: import('../signalStore').Signal, owner?: string) => Promise<{followupId: string}>} createFollowup
 * @property {(identifier: string) => Promise<object|null>} getConstituentContext
 */

/** @type {Record<string, CrmProvider>} */
const PROVIDERS = { mock, hubspot, salesforce };

/** @returns {CrmProvider} */
function getProvider() {
  const name = (process.env.CRM_PROVIDER || 'mock').toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown CRM_PROVIDER "${name}". Supported: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return provider;
}

module.exports = { getProvider };
