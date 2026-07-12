// Confidence-based matching decision engine (Feature 3): takes the candidate
// signals matchService.findMatches() already narrowed down by type-affinity,
// and scores each one on multiple factors to decide whether the system should
// auto-recommend (HIGH), ask a coordinator to review (MEDIUM), or give up on
// an automatic match and post outreach instead (LOW). Deterministic and
// explainable, like matchService/priorityScore — no LLM call in the scoring
// itself, only the confidence_score from summaryService's LLM output factors in.

const { scorePriority } = require('./priorityScore');
const { OFFER_TYPES } = require('./matchService');
const workspaceContext = require('./workspaceContext');
const telemetry = require('./telemetry');

const HIGH_THRESHOLD = 0.75;
const MEDIUM_THRESHOLD = 0.45;

const WEIGHTS = {
  typeAffinity: 0.15, // candidates are already type-affinity filtered by matchService, so this is a flat baseline
  textSimilarity: 0.2,
  volunteerHistory: 0.25,
  locationProximity: 0.15,
  priority: 0.15,
  historicalSuccess: 0.1,
};

/**
 * Bag-of-words Jaccard similarity — cheap, dependency-free, good enough to
 * distinguish "ride to a food bank" from "ride to a medical appointment."
 * @param {string} a
 * @param {string} b
 */
function textSimilarity(a, b) {
  const wordsA = new Set(String(a || '').toLowerCase().match(/[a-z0-9]+/g) || []);
  const wordsB = new Set(String(b || '').toLowerCase().match(/[a-z0-9]+/g) || []);
  if (!wordsA.size || !wordsB.size) return 0;
  let intersection = 0;
  for (const w of wordsA) if (wordsB.has(w)) intersection += 1;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union ? intersection / union : 0;
}

/**
 * @param {import('./signalStore').Signal} candidate
 * @returns {number} 0-1, how many completed matches this candidate's author has, normalized
 */
function volunteerHistoryScore(candidate) {
  const authorId = candidate.message?.author_user_id;
  if (!authorId) return 0;
  const entry = workspaceContext.getRepeatVolunteers({ limit: 1000 }).find((v) => v.author_id === authorId);
  return entry ? Math.min(entry.completed_matches / 5, 1) : 0;
}

/**
 * Has this exact type pair (signal.primary_type <-> candidate.primary_type)
 * been successfully matched before, anywhere in the workspace?
 * @param {import('./signalStore').Signal} signal
 * @param {import('./signalStore').Signal} candidate
 */
function historicalSuccessScore(signal, candidate) {
  const outcomes = workspaceContext.getSuccessfulOutcomes({ limit: 1000 });
  const pairTypes = new Set([signal.primary_type, candidate.primary_type]);
  const priorSuccesses = outcomes.filter((o) => o.primary_type === signal.primary_type || o.primary_type === candidate.primary_type).length;
  if (!priorSuccesses) return 0;
  return pairTypes.size ? Math.min(priorSuccesses / 4, 1) : 0;
}

/**
 * findMatches() only ever pairs an offer-type signal with a need/coordination-type
 * one (see matchService's OFFER_TO_NEEDS/NEED_TO_OFFERS), so exactly one of
 * signal/candidate is always the offer side — but decide() is called with
 * whichever of the two was just detected as `signal`, so that side isn't
 * consistently the offer. Two of the confidence factors are direction-
 * sensitive (they mean "the need's urgency" and "the offer author's track
 * record", not "signal's" or "candidate's") and must be evaluated on the
 * correct side regardless of which one triggered this decision.
 * @param {import('./signalStore').Signal} signal
 * @param {import('./signalStore').Signal} candidate
 * @returns {{ offerSide: import('./signalStore').Signal, needSide: import('./signalStore').Signal }}
 */
function resolveSides(signal, candidate) {
  const signalIsOffer = OFFER_TYPES.has(signal.primary_type);
  return { offerSide: signalIsOffer ? signal : candidate, needSide: signalIsOffer ? candidate : signal };
}

/**
 * @param {import('./signalStore').Signal} signal
 * @param {import('./signalStore').Signal} candidate
 * @returns {{ confidence: number, factors: Record<string, number> }}
 */
function computeMatchConfidence(signal, candidate) {
  const { offerSide, needSide } = resolveSides(signal, candidate);
  const factors = {
    typeAffinity: 1,
    textSimilarity: textSimilarity(signal.summary?.what_happened, candidate.summary?.what_happened),
    volunteerHistory: volunteerHistoryScore(offerSide),
    locationProximity: signal.message?.channel_id === candidate.message?.channel_id ? 1 : 0.4,
    priority: scorePriority(needSide.types).score / 100,
    historicalSuccess: historicalSuccessScore(signal, candidate),
  };
  const confidence = Object.entries(WEIGHTS).reduce((sum, [key, weight]) => sum + weight * factors[key], 0);
  return { confidence: Math.max(0, Math.min(1, confidence)), factors };
}

/**
 * Explains, in one sentence, why a candidate was recommended — surfaced in
 * the coordinator-review (MEDIUM) card and the HIGH auto-recommend card.
 *
 * `factors.volunteerHistory` is scored against whichever of signal/candidate
 * is the true offer side (see resolveSides()), which is not always
 * `candidate` — e.g. when a volunteer's own offer just triggered detection,
 * `candidate` is the need it's being matched against, and *that person* has
 * no volunteer track record to credit. Only surface the "has completed N
 * matches" reason when `candidate` (the one this sentence names) is actually
 * the offer side that earned it, so the explanation never credits a
 * requester with a volunteer's history.
 * @param {import('./signalStore').Signal} signal
 * @param {import('./signalStore').Signal} candidate
 * @param {Record<string, number>} factors
 */
function explain(signal, candidate, factors) {
  const { offerSide } = resolveSides(signal, candidate);
  const authorName = candidate.message?.author_name || candidate.message?.author_user_id || 'This volunteer';
  const reasons = [];
  if (factors.volunteerHistory > 0 && offerSide === candidate) {
    const count = Math.round(factors.volunteerHistory * 5);
    reasons.push(`has completed ${count} similar match${count === 1 ? '' : 'es'}`);
  }
  if (factors.locationProximity === 1) reasons.push('is in the same channel');
  if (factors.textSimilarity > 0.15) reasons.push('described very similar circumstances');
  if (factors.historicalSuccess > 0) reasons.push('this type of pairing has succeeded before');
  const reasonText = reasons.length ? reasons.join(', ') : 'is the best available type-affinity match';
  return `Recommended because ${authorName} ${reasonText}.`;
}

/**
 * Scores every matchService candidate and branches into HIGH / MEDIUM / LOW.
 * @param {import('./signalStore').Signal} signal
 * @param {import('./signalStore').Signal[]} candidates from matchService.findMatches()
 * @returns {{
 *   branch: 'high'|'medium'|'low',
 *   recommended: import('./signalStore').Signal|null,
 *   confidence: number,
 *   explanation: string,
 *   scored: { signal: import('./signalStore').Signal, confidence: number, factors: Record<string, number> }[]
 * }}
 */
function decide(signal, candidates) {
  const scored = candidates
    .map((candidate) => ({ signal: candidate, ...computeMatchConfidence(signal, candidate) }))
    .sort((a, b) => b.confidence - a.confidence);

  /** @type {{ branch: 'high'|'medium'|'low', recommended: import('./signalStore').Signal|null, confidence: number, explanation: string, scored: typeof scored }} */
  let result;
  if (!scored.length) {
    result = { branch: 'low', recommended: null, confidence: 0, explanation: 'No complementary open signals found — routing to outreach.', scored: [] };
  } else {
    const top = scored[0];
    if (top.confidence >= HIGH_THRESHOLD) {
      result = { branch: 'high', recommended: top.signal, confidence: top.confidence, explanation: explain(signal, top.signal, top.factors), scored };
    } else if (top.confidence >= MEDIUM_THRESHOLD) {
      result = { branch: 'medium', recommended: top.signal, confidence: top.confidence, explanation: explain(signal, top.signal, top.factors), scored };
    } else {
      result = { branch: 'low', recommended: null, confidence: top.confidence, explanation: 'Best candidate confidence too low to recommend automatically — routing to outreach.', scored };
    }
  }

  telemetry.logEvent('match_decision', { signal_id: signal.signal_id, branch: result.branch, confidence: result.confidence, candidate_count: candidates.length });
  return result;
}

/**
 * Converts a decide() result into the compact shape persisted on a signal
 * (`signalStore`'s `match_recommendation` field) and rendered by
 * `blocks/signal-card.js`. Single source of truth so `scan.js`'s initial
 * decision and any later re-decision (e.g. after a rejected match) build the
 * exact same shape.
 * @param {ReturnType<typeof decide>} decision
 */
function toMatchRecommendation(decision) {
  return {
    branch: decision.branch,
    confidence: decision.confidence,
    explanation: decision.explanation,
    candidate: decision.recommended
      ? {
          signal_id: decision.recommended.signal_id,
          primary_type: decision.recommended.primary_type,
          what_happened: decision.recommended.summary?.what_happened || '',
          author_name: decision.recommended.message?.author_name || decision.recommended.message?.author_user_id || 'unknown',
          permalink: decision.recommended.message?.permalink || '',
        }
      : null,
  };
}

module.exports = { decide, computeMatchConfidence, textSimilarity, toMatchRecommendation, HIGH_THRESHOLD, MEDIUM_THRESHOLD };
