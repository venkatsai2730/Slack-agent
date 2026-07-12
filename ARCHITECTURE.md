# Architecture — Community Beacon

`PROJECT_ANALYSIS.md` documents the original pre-Growth-Beacon-pivot codebase (also, fittingly, a community help-request tracker) and is kept as historical record only. This file is the current source of truth for Community Beacon's design.

## System diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Slack workspace                                                          │
│                                                                           │
│  message events ──┐                    slash commands ──┐               │
│  app_mention ──────┤                    /cb-scan          │              │
│  app_home_opened ──┤                    /cb-needs         │              │
│  assistant thread ─┘                    /cb-impact        │              │
└───────────┬───────────────────────────────────┬───────────┬─────────────┘
            │  Socket Mode (outbound WS only)   │           │
            v                                   v           v
┌───────────────────────────────────────────────────────────────────────┐
│ app.js  →  listeners/  (Bolt event/command/action/assistant handlers) │
│         →  setInterval scheduler for services/escalation.js           │
└───────────┬─────────────────────────────────────────────┬─────────────┘
            │                                             │
            v                                             v
┌───────────────────────────┐                 ┌───────────────────────────┐
│ services/scan.js           │                 │ blocks/                   │
│  processMessageForSignals()│ ── posts ──────>│  signal-card.js           │
│  runScan() (retroactive)   │                 │  dashboard-blocks.js      │
└─────┬───────────────────────┘                 │  report-blocks.js        │
      │  the agentic reasoning loop:            └───────────────────────────┘
      v
┌──────────────────┐   ┌───────────────────────┐   ┌─────────────────────────┐
│ intentEngine.js   │──>│ workspaceContext.js    │──>│ summaryService.js       │
│ (15 signal types) │   │ RTS search (rts.js /   │   │ message + history →     │
└──────────────────┘   │ searchService.js) +     │   │ AI Coordinator Reasoning│
                        │ signalStore aggregation │   └───────────┬─────────────┘
                        │ (60s TTL cache)          │               v
                        └───────────────────────┘   ┌─────────────────────────┐
                                                     │ signalStore.js           │
                                                     │ (data/signals.json,      │
                                                     │  timeline, escalation,   │
                                                     │  confirmed_match)        │
                                                     └──────────┬──────────────┘
                                          ┌───────────────────────┼───────────────────────┐
                                          v                       v                       v
                                ┌──────────────────┐   ┌──────────────────┐   ┌────────────────────┐
                                │ matchService.js   │──>│ matchDecision.js  │   │ services/crm/       │
                                │ candidate gen.    │   │ HIGH/MEDIUM/LOW   │   │ getProvider()        │
                                │ (type affinity)   │   │ confidence branch │   │ mock | hubspot* | sf*│
                                └──────────────────┘   └──────────────────┘   └────────────────────┘
                                          │
                                          v
                                ┌──────────────────────────────────────────┐
                                │ services/analytics.js — time-to-match,    │
                                │ response times, utilization, heatmap,     │
                                │ escalation counts, trends (dashboard +    │
                                │ /cb-impact + summarize_workspace_context) │
                                └──────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────┐
│ services/escalation.js — hourly sweep (app.js's setInterval)           │
│  finds unresolved signals past a per-tier age threshold, outside quiet │
│  hours, under the max-reminders cap → DMs COORDINATOR_USER_IDS +       │
│  posts COMMUNITY_ALERTS_CHANNEL with an AI-written explanation         │
└───────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────┐
│ mcp/server.js  (separate process, stdio)                              │
│  Core: summarize_thread · search_messages · detect_signals ·          │
│        score_priority · find_matches · log_case · create_followup ·   │
│        get_constituent_context (now includes workspace history)       │
│  Workspace history/analytics (Feature 6): search_workspace_history ·   │
│        get_location_patterns · get_repeat_requesters ·                │
│        get_repeat_volunteers · get_unresolved_similar ·                │
│        get_recent_matches · get_successful_outcomes ·                  │
│        get_priority_statistics · summarize_workspace_context           │
│  → same services/* modules as the Bolt app (including                 │
│    workspaceContext.js and analytics.js), no shared runtime state      │
│    beyond the on-disk data/*.json files                                │
└───────────────────────────────────────────────────────────────────────┘
* stubs — see "Case-log provider abstraction" below
```

### The Feature 1 reasoning loop, in sequence

```
Slack message
  │
  ├─▶ intentEngine.detectSignals()            signal_detected (timeline)
  │
  ├─▶ workspaceContext.buildContext()          history_searched, context_enriched (timeline)
  │     ├─ signalStore aggregation: requester history, channel/type recurrence,
  │     │  unresolved similar signals, repeat volunteers — all in-memory, ~free
  │     └─ searchService.searchWithFallback() — live RTS (or conversations.history
  │        fallback) sweep, cached 60s per channel+type
  │
  ├─▶ summaryService.summarizeConversation({ text, signals, history })
  │     → coordinator summary + recurrence/risk/volunteer/confidence reasoning
  │
  ├─▶ signalStore.createSignal()               (signal now persisted)
  │
  ├─▶ matchService.findMatches() → matchDecision.decide()   match_decision (timeline)
  │     HIGH → one-click Confirm · MEDIUM → coordinator Approve/Reject · LOW → outreach post
  │
  └─▶ signal-card.js posted, with AI reasoning + match decision + View Timeline button
```

This is the sequence that makes the reasoning "impossible without combining RTS + MCP + the signal store": the recurrence/volunteer claims in the coordinator summary are only true because `workspaceContext.buildContext()` actually queried both the live conversation history and the persisted structured record before the LLM ever saw the message.

## Two independent entry points, one shared service layer

- **`app.js`** — the Slack bot, Socket Mode, long-lived process. Owns all Slack-specific concerns (Bolt handlers, Block Kit rendering, OAuth tokens).
- **`mcp/server.js`** — a separate stdio process for MCP clients. Never receives Slack events, so it never has a fresh Real-Time Search `action_token` — `searchService.searchWithFallback()`'s `conversations.history` fallback path is what makes `search_messages` work from here.

Both processes import the same `services/*` modules, including `workspaceContext.js` and `analytics.js`. Neither owns the other; they communicate only indirectly, through the on-disk JSON stores (`data/signals.json`, `data/crm-mock.json`). This is intentional: a signal logged via the MCP server's `log_case` tool is immediately visible to `/cb-needs` in Slack, and vice versa, without any RPC between the two processes — and a signal's confirmed matches, escalation state, and reasoning timeline are equally visible from either process.

`services/escalation.js`'s scheduled sweep (`setInterval` in `app.js`) only ever runs in the Bolt process — `mcp/server.js` never starts it, since a stdio tool-call process has no business running a background timer.

## Locked architectural decisions

These were resolved before implementation of the Agent-for-Good pivot, since the domain change required several concrete engineering trade-offs:

1. **Domain pivot, scaffolding kept.** `services/rts.js`, `services/llm.js`, and the Bolt/Socket-Mode setup in `app.js` carry over unchanged in spirit (`rts.js` is domain-agnostic by design — no growth- or community-specific query strings live there). Only `services/searchService.js`'s query strings, `services/intentEngine.js`'s signal vocabulary, and the display/scoring layers changed.
2. **Case management: Mock-first, real providers stubbed.** No HubSpot/Salesforce sandbox credentials were available. `services/crm/index.js#getProvider()` is the only import path business logic is allowed to use; swapping `CRM_PROVIDER` in `.env` is the entire migration path once real credentials exist. The Salesforce stub is framed around **Nonprofit Cloud** (community members → Constituents, detected needs → Cases), since that's the realistic destination for this domain.
3. **Typing: incremental via `tsconfig.json` (`allowJs` + `checkJs`), not a `.ts` rewrite.** `npx tsc --noEmit` runs clean.
4. **Dashboard: Slack-native App Home, not a web server.** The app has zero HTTP surface by design (Socket Mode only, no exposed ports). `listeners/app-home.js` + `blocks/dashboard-blocks.js` render analytics directly into the Home tab on `app_home_opened`.
5. **Candidate generation is deterministic; confidence scoring is deterministic too.** `services/matchService.js` uses a fixed type-affinity map plus `priorityScore` for candidate ranking; `services/matchDecision.js` layers a weighted-factor confidence score (text similarity, volunteer history, location, priority, historical success) on top to decide the HIGH/MEDIUM/LOW branch. Neither step calls an LLM — fast, free, reproducible, and auditable (every factor is visible in the card's explanation text). The LLM-produced `confidence_score` in the coordinator summary is a separate, complementary signal (the AI's own read on the situation), not part of this scoring formula.
   - **Scoring is direction-agnostic.** `decide(signal, candidates)` is called with whichever signal was just detected as `signal` — sometimes a need, sometimes an offer, since `matchService.findMatches()` is symmetric. Two factors (`priority`, `volunteerHistory`) mean "the need's urgency" and "the offer author's track record," not "signal's" or "candidate's," so `computeMatchConfidence()` resolves which of the pair is actually the offer side (`resolveSides()`, keyed off `matchService.OFFER_TYPES`) before scoring either factor. Without this, an offer arriving to match an already-open urgent need scored near-zero on both factors — the reverse of a need arriving to match an existing offer, which scored correctly. `explain()` mirrors the same resolution so its "has completed N matches" reason is never attributed to a need-requester's name. Covered by `test/matchDecision.test.js`'s symmetry tests.
6. **"District" = Slack channel, not an LLM-guessed location.** Messages carry no structured geography. Rather than have the LLM guess at place names (unreliable — most messages never name one), `workspaceContext.js` and `analytics.js` treat each monitored channel as a district proxy. The demand heatmap and recurrence counts are channel-scoped by design.
7. **Escalation scheduling is a plain `setInterval`, not a new dependency.** `services/escalation.js` is scheduled from `app.js` after `app.start()`. No cron library was added — the config (`ESCALATION_CHECK_MINUTES`, per-tier age thresholds, quiet hours, max reminders) is simple enough that a plain timer plus a pure `isQuietHours()` check covers it.

## The detection & reasoning pipeline in detail

`services/scan.js` has exactly one function that does detection + history search + enrichment + persistence + case logging + match-decision + card posting: **`processMessageForSignals()`**. Both real-time monitoring (`listeners/events/message.js`, every qualifying new message) and retroactive scans (`runScan()`, used by `/cb-scan` and `@Community Beacon scan`) call it — every stage exists in exactly one place.

1. `intentEngine.hasKeywordHint()` — a cheap regex pre-filter. Most Slack messages ("lol", "see you at standup") never reach the LLM.
2. A per-channel rate limiter (`RATE_LIMIT_LLM_PER_CHANNEL_PER_MIN`, in-memory token bucket in `scan.js`) caps LLM-triggering detections — the keyword filter alone has no hard ceiling.
3. `intentEngine.detectSignals()` — LLM call, returns zero or more `{ type, confidence, evidence, reasoning, recommended_action }` objects from a fixed 15-type vocabulary (needs, offers, coordination).
4. Confidence gate — `SIGNAL_CONFIDENCE_THRESHOLD` (default `0.6`). Below threshold, the signal is silently dropped (not even persisted) to keep alert volume sane.
5. `workspaceContext.buildContext()` — Feature 1: RTS/history search (cached 60s) + `signalStore` aggregation (requester history, channel recurrence, unresolved similar signals, repeat volunteers).
6. `summaryService.summarizeConversation({ text, signals, history })` — LLM call, produces the coordinator-summary fields *and* the history-informed reasoning fields (Feature 7).
7. `signalStore.createSignal()` — persists to `data/signals.json` (write-through, atomic rename to avoid truncation on crash); auto-records the first `signal_detected` timeline entry.
8. `signalStore.recordTimelineEvent()` — logs `history_searched` and `context_enriched` timeline stages.
9. `crm.getProvider().logSignal()` — logs to the configured case-log provider. Failure here is caught and logged, not fatal — the signal is already safely persisted locally regardless of provider availability.
10. `matchService.findMatches()` → `matchDecision.decide()` — deterministic candidate generation, then confidence-scored branching (Feature 3); the branch and any recommended candidate are persisted onto the signal as `match_recommendation` so re-renders (claim/reject) don't need to recompute it.
11. LOW branch → `postOutreach()` posts to `VOLUNTEERS_NEEDED_CHANNEL` (or its fallback chain) instead of guessing a match.
12. `blocks/signal-card.js#signalCardBlocks()` — renders the alert (AI reasoning, match decision branch, timeline/claim/reject buttons), posted via the caller-supplied `post()` callback (real-time: threaded reply under the source message, or `COMMUNITY_ALERTS_CHANNEL` if set; retroactive scan: same channel being scanned).

## Signal lifecycle

`new` (needs attention) → (`claim_help` button, "I Can Help") → `reviewed` (claimed by a helper), or → (`not_a_request` button) → `false_positive`. A signal is separately marked **resolved** (`resolution.resolved`) when a match is confirmed (`confirm_match`/`approve_match`) or manually closed — `resolved` and `reviewed` are independent: a claimed signal isn't necessarily resolved yet. All status/resolution transitions re-render the same card in place via `chat.update` and append a `timeline` entry.

## Security properties

- **Prompt injection.** Every LLM call fences Slack-message text inside a `"""..."""` delimiter (`intentEngine.js`, `summaryService.js`). `services/llm.js#sanitizeForPrompt()` neutralizes a literal `"""` inside user text (via an inserted zero-width space) so a message can't prematurely close the fence and inject new "instructions" after it. `workspaceContext`/analytics data passed to the LLM is always `JSON.stringify`'d, never raw-concatenated. This is a mitigation, not a guarantee — no string-fencing scheme is airtight against a sufficiently adversarial small open model, but it closes the specific escape vector.
- **Rate limiting.** `services/scan.js`'s per-channel token bucket (`RATE_LIMIT_LLM_PER_CHANNEL_PER_MIN`, default 20/min) only consumes a slot for messages that pass `intentEngine.hasKeywordHint()` — i.e. messages that would actually reach the LLM — so ordinary channel chatter can't exhaust the budget and cause genuine signals arriving later in the same minute to be silently dropped.
- **Escalation notification integrity.** `services/escalation.js#runEscalationSweep()` only marks a signal escalated (consuming one of its `ESCALATION_MAX_REMINDERS` slots) if a DM or channel post actually succeeded. If no `COORDINATOR_USER_IDS`/`COMMUNITY_ALERTS_CHANNEL` is configured (or no Slack client is available), the sweep skips entirely (`skipped_no_destination: true`) rather than quietly "escalating" signals nobody will ever see.
- **Search scope.** `rts.js` always sets `channel_types: ['public_channel']` — private channels and DMs are never searched by RTS or the workspace-history tools, in Slack or via MCP.
- **MCP input validation.** Every tool's `inputSchema` is a zod schema; malformed calls are rejected before the handler runs.

## Known limitations (carried forward, not solved by this pass)

- **Single-instance JSON file stores.** `data/signals.json` and `data/crm-mock.json` have no concurrency control. Fine for one Socket Mode process; would corrupt under horizontal scaling. This also means the `workspaceContext`/MCP-tool in-memory cache and the escalation scheduler's state reset on process restart.
- **HubSpot/Salesforce are stubs.** They throw a clear, actionable error rather than silently no-op-ing, so this is a visible gap, not a silent one.
- **Real-time monitoring cost.** Every non-bot message in a monitored channel does incur one keyword-filter check; only messages that pass it reach the LLM, and a per-channel rate limiter caps LLM calls beyond that.
- **Matching is type-affinity + weighted-factor confidence, not semantic embeddings.** `matchDecision.js` doesn't know that a "ride to a food bank" offer is a stronger match for a "food_insecurity" need than a generic `volunteer_offer` beyond the crude text-similarity factor — it's a scoring formula over cheap signals, not an embedding-based similarity search. Good enough to rank and branch candidates for a human (or a HIGH-confidence auto-confirm) to act on; not a dispatch engine.
- **False negatives are not measurable from within the system.** `analytics.js` reports `false_negatives: null` rather than fabricating a number — a real value would require an external ground-truth audit (e.g. a coordinator manually reviewing missed requests), which is out of scope for this pass.
- **`estimated_coordinator_hours_saved` is a stated heuristic**, not a measured constant — `analytics.js`'s `MINUTES_SAVED_PER_AUTO_MATCH` assumption is documented in the analytics snapshot itself (`assumptions` field) so it's never presented as more precise than it is.
- **A rejected match's retry only considers candidates that already existed at rejection time.** `reject_match` immediately re-runs `matchService.findMatches()` + `matchDecision.decide()` excluding every previously-rejected candidate (tracked in `rejected_candidates`), but it doesn't re-trigger automatically if a *new* candidate signal arrives later — that still requires a manual match via `/cb-needs` or the MCP `find_matches` tool.
- **Once-matched signals never resurface as recommendation candidates**, and card buttons that would conflict with a resolved signal are hidden. `matchService.findMatches()` excludes any signal with `resolution.resolved` (not just non-`'new'` status), and `claim_help`/`not_a_request` gate on `resolution.resolved`, both in the rendered card and defensively inside the action handlers themselves (in case a coordinator is looking at a stale render).
