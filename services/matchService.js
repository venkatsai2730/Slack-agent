// Need ↔ offer matching: when someone offers help, surface the open needs that
// offer could satisfy — and when a need comes in, surface recent offers that
// could meet it. Deterministic (type-affinity + priority + recency), not an LLM
// call, so matches are instant, free, and explainable.

const signalStore = require('./signalStore');
const { scorePriority } = require('./priorityScore');

/**
 * Which need types each offer type can plausibly satisfy. The inverse map
 * (need -> offers) is derived below so the two can never drift apart.
 * @type {Record<string, string[]>}
 */
const OFFER_TO_NEEDS = {
  volunteer_offer: ['help_request', 'urgent_need', 'transport_need', 'event_coordination', 'emotional_support_need', 'medical_need'],
  donation_offer: ['food_insecurity', 'housing_need', 'resource_request', 'urgent_need'],
  skill_offer: ['help_request', 'resource_request', 'event_coordination'],
  resource_available: ['resource_request', 'food_insecurity', 'housing_need', 'transport_need'],
};

/** @type {Record<string, string[]>} need type -> offer types that can meet it */
const NEED_TO_OFFERS = {};
for (const [offer, needs] of Object.entries(OFFER_TO_NEEDS)) {
  for (const need of needs) {
    (NEED_TO_OFFERS[need] = NEED_TO_OFFERS[need] || []).push(offer);
  }
}

const OFFER_TYPES = new Set(Object.keys(OFFER_TO_NEEDS));

/**
 * Finds open (status "new", not already resolved) signals that complement
 * the given one: open needs for an offer, recent offers for a need. Returns
 * [] for signal types with no matching affinity (e.g. gratitude_report).
 *
 * Excludes already-`resolution.resolved` signals in addition to filtering by
 * status — `confirmMatch()` never changes a signal's `status` (only
 * `resolution`/`confirmed_match`), so without this a volunteer already
 * matched to one need could be recommended again for an unrelated one;
 * confirming that second "match" would silently overwrite the first
 * `confirmed_match` record on the same offer signal.
 * @param {import('./signalStore').Signal} signal
 * @param {{ limit?: number }} [opts]
 * @returns {import('./signalStore').Signal[]}
 */
function findMatches(signal, { limit = 3 } = {}) {
  const targetTypes = OFFER_TYPES.has(signal.primary_type)
    ? OFFER_TO_NEEDS[signal.primary_type]
    : NEED_TO_OFFERS[signal.primary_type];
  if (!targetTypes || !targetTypes.length) return [];

  const targets = new Set(targetTypes);
  return signalStore
    .listByStatus('new')
    .filter((s) => s.signal_id !== signal.signal_id && targets.has(s.primary_type) && !s.resolution?.resolved)
    .sort((a, b) => {
      const byPriority = scorePriority(b.types).score - scorePriority(a.types).score;
      return byPriority !== 0 ? byPriority : b.created_at.localeCompare(a.created_at);
    })
    .slice(0, limit);
}

module.exports = { findMatches, OFFER_TO_NEEDS, NEED_TO_OFFERS, OFFER_TYPES };
