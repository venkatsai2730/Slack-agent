// Shared display constants used across signal cards, the dashboard, and reports.

const SIGNAL_EMOJI = {
  pricing_intent: '💰',
  upgrade_intent: '⬆️',
  expansion_opportunity: '📈',
  feature_request: '💡',
  competitor_mention: '⚔️',
  integration_request: '🔌',
  churn_risk: '🚨',
  customer_frustration: '😠',
  positive_sentiment: '😊',
  negative_sentiment: '😞',
  enterprise_buying_intent: '🏢',
  decision_maker_involvement: '🎯',
  budget_discussion: '💵',
  timeline_discussion: '⏰',
  security_concern: '🔒',
};

const SIGNAL_LABEL = {
  pricing_intent: 'Pricing Intent',
  upgrade_intent: 'Upgrade Intent',
  expansion_opportunity: 'Expansion Opportunity',
  feature_request: 'Feature Request',
  competitor_mention: 'Competitor Mention',
  integration_request: 'Integration Request',
  churn_risk: 'Churn Risk',
  customer_frustration: 'Customer Frustration',
  positive_sentiment: 'Positive Sentiment',
  negative_sentiment: 'Negative Sentiment',
  enterprise_buying_intent: 'Enterprise Buying Intent',
  decision_maker_involvement: 'Decision-Maker Involvement',
  budget_discussion: 'Budget Discussion',
  timeline_discussion: 'Timeline Discussion',
  security_concern: 'Security Concern',
};

const STATUS_LABEL = {
  new: '🆕 New',
  reviewed: '✅ Reviewed',
  false_positive: '🚫 False positive',
};

const TIER_EMOJI = { hot: '🔥', warm: '🌤️', cold: '❄️' };

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
