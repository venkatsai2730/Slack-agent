// Shared display constants used across signal cards, the dashboard, and reports.

const SIGNAL_EMOJI = {
  help_request: '🙋',
  urgent_need: '🚨',
  transport_need: '🚗',
  food_insecurity: '🍲',
  housing_need: '🏠',
  medical_need: '🏥',
  emotional_support_need: '💛',
  resource_request: '📋',
  volunteer_offer: '🙌',
  donation_offer: '🎁',
  skill_offer: '🛠️',
  resource_available: '📦',
  event_coordination: '📅',
  gratitude_report: '🌟',
  follow_up_needed: '🔁',
};

const SIGNAL_LABEL = {
  help_request: 'Help Request',
  urgent_need: 'Urgent Need',
  transport_need: 'Transport Need',
  food_insecurity: 'Food Insecurity',
  housing_need: 'Housing Need',
  medical_need: 'Medical Need',
  emotional_support_need: 'Emotional Support Need',
  resource_request: 'Resource Request',
  volunteer_offer: 'Volunteer Offer',
  donation_offer: 'Donation Offer',
  skill_offer: 'Skill Offer',
  resource_available: 'Resource Available',
  event_coordination: 'Event Coordination',
  gratitude_report: 'Gratitude Report',
  follow_up_needed: 'Follow-Up Needed',
};

const STATUS_LABEL = {
  new: '🆕 Needs attention',
  reviewed: '🙋 Claimed',
  false_positive: '🚫 Not a request',
};

const TIER_EMOJI = { critical: '🚨', high: '⚠️', routine: '✅' };

/**
 * Renders a confidence score (0-1) as a 5-dot bar for compact display in Block Kit.
 * @param {number} confidence
 * @returns {string}
 */
function confidenceBar(confidence) {
  const filled = Math.max(0, Math.min(5, Math.round(confidence * 5)));
  return '●'.repeat(filled) + '○'.repeat(5 - filled);
}

module.exports = { SIGNAL_EMOJI, SIGNAL_LABEL, STATUS_LABEL, TIER_EMOJI, confidenceBar };
