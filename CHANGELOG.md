# Changelog

## [Unreleased] — Live Slack workspace verification (3 defects found and fixed)

End-to-end verification against a real Slack workspace (transportation/food/volunteer-offer signals, dashboard, timeline, escalation DMs, all 17 MCP tools) surfaced three real defects. 96/96 tests passing (up from 94).

### Fixed

- **Concurrent processes silently dropped signals** (`services/signalStore.js`) — `app.js` and `mcp/server.js` are designed to run as two separate processes against the same `data/signals.json`, but each held its own in-memory copy and `save()` blindly overwrote the file, so whichever process saved last discarded any signals the other had persisted since its last load. Reproduced live (a food-insecurity signal detected mid-test vanished from the store) and with a standalone race simulation. `save()` now re-reads the on-disk state and merges by `signal_id` (newest `updated_at` wins per signal) before writing.
- **A lone medical/urgent emergency could never reach "critical" priority** (`services/priorityScore.js`) — `medical_need`/`urgent_need` were weighted at 30, but `critical` requires a score ≥ 55, so a single high-confidence signal of either type capped at `high` — the design (see prior test suite) required a *second* corroborating signal type to reach `critical`. A real test message ("someone collapsed and needs medical help now") was tagged with only `medical_need` and scored `high`, which would have used the 4-hour escalation SLA instead of the 1-hour one. Both weights raised to 60 so a single high-confidence signal alone crosses the critical threshold.
- **`npm test` silently destroyed production/demo data** (`services/signalStore.js`, `services/crm/mockProvider.js`, 9 test files) — 8 test files did `fs.rmSync()` directly on the real `data/signals.json` (one also on `data/crm-mock.json`) to reset state before requiring the module, with no isolation from a live deployment. Running the suite against a workspace with real accumulated signals (as this verification pass was doing) wiped it out — reproduced twice in this session. Both store modules' data file paths are now overridable via `SIGNALS_DATA_FILE`/`CRM_MOCK_DATA_FILE` env vars; every affected test now points at an isolated per-process temp file instead of the production path. Verified with a canary file that survives a full test run untouched.

## [Unreleased] — Follow-up fixes for the three documented edge cases

The prior verification pass found three edge cases and documented them as known limitations rather than fixing them. Revisited and fixed all three, which surfaced one more real defect along the way (`matchService.findMatches()` never excluded already-resolved signals). 94/94 tests passing (up from 87), `tsc --noEmit` clean.

### Fixed

- **Card buttons stayed clickable after a match was confirmed** (`blocks/signal-card.js`, `listeners/actions/signal-actions.js`) — `claim_help`/`not_a_request` now gate on `resolution.resolved`, not `signal.status`, so they disappear once a signal is resolved. Also guarded inside the action handlers themselves (defense in depth against a stale card render), with a clear ephemeral message if clicked anyway.
- **A rejected match was never retried** (`listeners/actions/signal-actions.js`) — `reject_match` now records the rejected candidate (`signalStore.addRejectedCandidate`, new `rejected_candidates` field) and immediately re-runs `matchService.findMatches()` + `matchDecision.decide()` against the remaining candidates, excluding everything rejected so far. Lands on a new HIGH/MEDIUM/LOW branch just like a fresh signal would, including posting outreach if it lands on LOW.
- **MCP's `log_case` never ran the match-decision engine** (`mcp/server.js`) — now runs `matchService.findMatches()` + `matchDecision.decide()` after persisting the signal, same as the Slack pipeline, and returns the decision in the tool's response.
- **(Found while fixing the above) `matchService.findMatches()` didn't exclude already-resolved signals** — it filtered by `status === 'new'`, but `confirmMatch()` never changes `status`, only `resolution`. A volunteer already matched to one need could be recommended again for an unrelated one; confirming that second "match" would silently overwrite the first `confirmed_match` record on the same signal. Now also excludes any candidate with `resolution.resolved`.

### Added

- `services/matchDecision.js#toMatchRecommendation()` — extracted shared helper (previously inlined in `scan.js`) so `scan.js`, the `reject_match` re-decision, and MCP's `log_case` all build the identical persisted shape.
- `services/signalStore.js#addRejectedCandidate()` + new `rejected_candidates` field (with load-time backfill for pre-existing data).
- `scan.js#postOutreach` exported so the reject_match re-decision can trigger the same LOW-branch outreach post a fresh signal would get.
- Tests: `test/signalCard.test.js` (button visibility), `test/signalActions.test.js` (resolved-state guards + reject/re-decide flow), a `handleLogCase` match-decision test in `test/mcpTools.test.js`.
- `ARCHITECTURE.md` — Known Limitations and Security properties updated to reflect the fixes.

## [Unreleased] — Production verification pass (4 defects found and fixed)

A full end-to-end verification of the agentic reasoning loop below, covering Socket Mode, event subscriptions, the detect→search→enrich→summarize→match→escalate pipeline, all 9 new MCP tools, CRM/telemetry/rate-limiting/prompt-injection handling, Block Kit rendering, and every interactive button. Four real defects were found and fixed; everything else verified clean (87/87 tests, `tsc --noEmit` clean).

### Fixed

- **Rate limiter gated every message, not just LLM-triggering ones** (`services/scan.js`) — `RATE_LIMIT_LLM_PER_CHANNEL_PER_MIN` was consumed by every message reaching `processMessageForSignals()`, so ordinary channel chatter could exhaust the budget and silently drop genuine signals arriving later in the same minute. Now only gates messages that pass `intentEngine.hasKeywordHint()`.
- **Escalation sweep could mark signals "escalated" with zero notifications sent** (`services/escalation.js`) — if no `COORDINATOR_USER_IDS`/`COMMUNITY_ALERTS_CHANNEL` were configured (or no Slack client was available), `runEscalationSweep()` still called `markEscalated()` for every candidate, silently burning through `ESCALATION_MAX_REMINDERS` without a human ever being notified. Now skips the sweep entirely (`skipped_no_destination`) when there's no viable destination, and only counts a signal as escalated if a DM or channel post actually succeeded.
- **Prompt-fence escape vector** (`services/llm.js`) — user message text was fenced in prompts with `"""..."""` but a message containing a literal `"""` could prematurely close the fence and inject new instructions. Added `sanitizeForPrompt()` (breaks the delimiter with a zero-width space) and applied it in `intentEngine.js`/`summaryService.js`.
- **MCP `log_case` never benefited from live-search enrichment** (`mcp/server.js`) — `workspaceContext.buildContext()` was called without a Slack client even though one was obtainable via `getSlackClient()`, so Feature 1 enrichment silently degraded to structured-history-only for signals logged through MCP. Now passes a client when a real channel is given.

### Added

- Tests: `processMessageForSignals rate-limits keyword-hinted messages, not every message` + a companion non-keyword test (`test/scan.test.js`); two `runEscalationSweep` no-destination regression tests (`test/escalation.test.js`); three `sanitizeForPrompt` tests (`test/llm.test.js`). 87 tests passing (up from 80).
- `ARCHITECTURE.md` — new "Security properties" section; Known Limitations expanded with the button-visibility-after-match, rejected-match-not-retried, and MCP-log_case-no-match-decision edge cases found during this pass.

## [Unreleased] — Agentic RTS+MCP reasoning loop (10-feature hackathon build)

Extends Community Beacon from a linear detect → summarize → match pipeline into an agentic system that reasons over live workspace history, matches with explainable confidence branching, escalates proactively, and tracks real impact metrics. All ten features below are implemented for real (no stubs/TODOs); existing functionality and architecture (Bolt + MCP two-process design, mock-first CRM, App Home dashboard, deterministic scoring) are preserved and extended, not replaced. See `ARCHITECTURE.md` for the full reasoning-loop diagram and sequencing.

### Added

- **`services/workspaceContext.js`** (Feature 1/7) — combines a live RTS/history search (reusing `searchService.js`/`rts.js`) with structured aggregation over `signalStore.js` (requester history, channel/type recurrence, unresolved similar signals, repeat volunteers/requesters, confirmed-match outcomes), cached with a 60s TTL (`withCache`). Wired into `scan.js#processMessageForSignals()` before summarization.
- **AI Coordinator Reasoning** (Feature 7) — `summaryService.js`'s prompt and output schema extended (additively) with `recurrence_summary`, `risk_assessment`, `volunteer_recommendation`, `confidence_score`, `reasoning`, `alternative_options`, `escalation_recommendation`, `expected_impact`; rendered in a new section of `signal-card.js`.
- **`services/matchDecision.js`** (Feature 3) — confidence-based HIGH/MEDIUM/LOW branching on top of `matchService.js`'s candidate generation (text similarity, volunteer history, channel proximity, priority, historical success). New `confirm_match`/`approve_match`/`reject_match` actions in `signal-actions.js`; LOW branch auto-posts outreach to `VOLUNTEERS_NEEDED_CHANNEL`.
- **`services/escalation.js`** (Feature 2) — proactive hourly sweep (`ESCALATION_CHECK_MINUTES`) for unresolved signals past a per-tier age threshold, respecting quiet hours and a max-reminders cap; DMs `COORDINATOR_USER_IDS` and posts to `COMMUNITY_ALERTS_CHANNEL` with an AI-written explanation. Scheduled from `app.js` via `setInterval`. New `im:write` manifest scope for DMs.
- **Reasoning timeline** (Feature 5) — every signal now carries a `timeline` of `{ at, stage, detail }` events (`signalStore.recordTimelineEvent`), viewable via a new **View Timeline** card button, and summarized in the dashboard/report.
- **`services/analytics.js`** (Feature 4) — time-to-match, response times by tier, auto-triage count, confidence-branch distribution, successful matches, escalation counts, coordinator interventions, volunteer utilization, repeat requesters/volunteers, per-channel demand heatmap, daily/weekly/monthly trends, and a documented estimated-hours-saved heuristic. Folded into `dashboard-blocks.js` and `report-blocks.js`/`report.js`.
- **9 new MCP tools** (Feature 6, `mcp/server.js`) — `search_workspace_history`, `get_location_patterns`, `get_repeat_requesters`, `get_repeat_volunteers`, `get_unresolved_similar`, `get_recent_matches`, `get_successful_outcomes`, `get_priority_statistics`, `summarize_workspace_context`; `get_constituent_context` extended to merge CRM context with workspace signal history. Every tool handler refactored into a standalone exported `handle*` function (registered with the SDK and unit-tested directly).
- **`services/telemetry.js`** (Feature 9) — structured JSON logging + timing wrapper, instrumenting RTS search, workspace-context builds, MCP tool calls, match decisions, and escalation sweeps. No new dependency.
- **Rate limiting** — a per-channel token bucket (`RATE_LIMIT_LLM_PER_CHANNEL_PER_MIN`) in `scan.js` capping LLM-triggering detections.
- **Signal schema extensions** (`signalStore.js`) — `timeline`, `escalation`, `resolution`, `confirmed_match`, `decision_branch`, `match_recommendation`, plus a load-time backfill for signals persisted before this pass.
- **Tests**: `test/workspaceContext.test.js`, `test/matchDecision.test.js`, `test/escalation.test.js`, `test/analytics.test.js`, `test/mcpTools.test.js` added; 80 tests passing (up from 41), `tsc --noEmit` clean.

### Changed

- `services/scan.js#processMessageForSignals()` — now runs the full detect → search history → enrich → summarize → persist → case-log → match-decide → post pipeline (previously detect → summarize → persist → case-log → match → post).
- `blocks/signal-card.js` — `signalCardBlocks(signal)` no longer takes a `{ matches }` option; the branch-labeled match recommendation and AI reasoning are read directly off the persisted signal.
- `.env.sample`, `manifest.json` (`im:write` scope), `README.md`, `ARCHITECTURE.md` — updated for the new environment variables, MCP tools, sequence diagram, and demo script.

## [Unreleased] — Community Beacon pivot (Slack Agent for Good)

Full domain pivot from **Growth Beacon** (B2B SaaS growth intelligence) to **Community Beacon** (community-impact agent for mutual-aid groups and nonprofits), built for the Slack Agent Builder Challenge's Slack Agent for Good track. This is, in a sense, a return to the project's original domain — see `PROJECT_ANALYSIS.md` for the pre-Growth-Beacon "Community Impact Agent" — but rebuilt on top of the Growth Beacon era's stronger architecture (MCP server, RTS + fallback search, typed JS, unit tests, provider abstraction).

### Added

- **New signal vocabulary** (`services/intentEngine.js`) — 15 community signal types across three categories: needs (`help_request`, `urgent_need`, `transport_need`, `food_insecurity`, `housing_need`, `medical_need`, `emotional_support_need`, `resource_request`), offers (`volunteer_offer`, `donation_offer`, `skill_offer`, `resource_available`), and coordination (`event_coordination`, `gratitude_report`, `follow_up_needed`). New keyword pre-filter and system prompt tuned for community-impact language.
- **Priority scoring** (`services/priorityScore.js`, replaces `leadScore.js`) — deterministic, explainable weighted-signal scoring (0–100, critical/high/routine tier); medical and urgent needs weighted highest, offers of help weighted as capacity (never urgency).
- **Need ↔ offer matching** (`services/matchService.js`, new) — when a signal comes in, deterministically finds complementary *open* signals: an offer surfaces the needs it could satisfy, a need surfaces unclaimed offers that could meet it. Surfaced directly on the Slack alert card. Ranked by priority score.
- **Case-log framing for the CRM layer** (`services/crm/`) — `mockProvider.js`'s `getCustomerContext` renamed to `getConstituentContext`; Salesforce stub reframed around **Nonprofit Cloud** (members → Constituents, needs → Cases).
- **New slash commands**: `/cb-scan` (replaces `/gb-scan`), `/cb-needs` (replaces `/gb-signals`), `/cb-impact` (replaces `/gb-report`).
- **New signal card actions**: "I Can Help" (claim, replaces "Assign Owner") and "Not a Request" (replaces "Mark False Positive"); "View CRM" renamed "View Case History".
- **MCP tools renamed/added**: `detect_intent` → `detect_signals`, `score_lead` → `score_priority`, `log_to_crm` → `log_case`, `get_customer_context` → `get_constituent_context`; new `find_matches` tool exposes the matching engine to MCP clients.
- **Impact dashboard** (`blocks/dashboard-blocks.js`) — reworked stats: community needs, offers of help, urgent needs, claimed signals (replacing revenue opportunities / churn risks / feature requests).
- **Tests**: `test/priorityScore.test.js` and `test/matchService.test.js` added; all existing suites (`intentEngine`, `signalStore`, `crmMock`, `searchService`, `scan`, `llm`) updated to the new vocabulary. 41 tests passing, `tsc --noEmit` clean.

### Removed

- `services/leadScore.js`, `test/leadScore.test.js` — replaced by `priorityScore.js`.
- All B2B/sales-domain signal types, weights, and copy (pricing intent, churn risk, competitor mention, enterprise buying intent, etc.).

### Changed

- `manifest.json` — renamed app to "Community Beacon", new slash commands, new description/assistant copy.
- `package.json` — renamed to `community-beacon`, updated description; `test` script now runs with `--test-concurrency=1` since `test/matchService.test.js` shares `signalStore`'s file-backed store with `test/signalStore.test.js`.
- `.env.sample` — `GROWTH_ALERTS_CHANNEL` → `COMMUNITY_ALERTS_CHANNEL`.
- `services/scan.js` — `processMessageForSignals()` now calls `matchService.findMatches()` and passes matches through to the signal card.
- `services/report.js`, `blocks/report-blocks.js` — narrative and headline rewritten for a community-impact audience.

## Prior history — Growth Beacon (superseded by the above pivot)

Full product pivot from **Community Impact Agent** (community help-request tracker) to **Growth Beacon** (AI growth intelligence agent for PLG companies), built for the Slack Agent Builder Challenge.

### Added

- **Intent Intelligence Engine** (`services/intentEngine.js`) — LLM-based detection of 15 business signal types (pricing intent, upgrade intent, expansion opportunity, feature request, competitor mention, integration request, churn risk, customer frustration, positive/negative sentiment, enterprise buying intent, decision-maker involvement, budget discussion, timeline discussion, security concern), each with confidence, evidence, reasoning, and a recommended action. Gated by a cheap keyword pre-filter to avoid an LLM call per message.
- **Executive summaries** (`services/summaryService.js`) — what happened, why it matters, business impact, people involved, recommended next action.
- **Signal persistence** (`services/signalStore.js`) — file-backed store (`data/signals.json`), atomic writes, status lifecycle (`new` → `reviewed` / `false_positive`), owner assignment, CRM-logged flag, and aggregate stats for the dashboard and daily report.
- **Lead scoring** (`services/leadScore.js`) — deterministic, explainable weighted-signal scoring (0–100, hot/warm/cold tier).
- **CRM provider abstraction** (`services/crm/`) — `index.js#getProvider()` is the only import path callers use; `mockProvider.js` is fully functional (file-backed); `hubspotProvider.js` / `salesforceProvider.js` are stubs that throw clear "not configured" errors, ready to implement once credentials exist.
- **Growth-signal search** (`services/searchService.js`) — Real-Time Search queries built on a generalized `services/rts.js`, plus a `conversations.history` + keyword-filter fallback for callers with no RTS `action_token` (used by the MCP server and to make cold-start UX graceful).
- **MCP server** (`mcp/server.js`, `npm run mcp`) — exposes `summarize_thread`, `search_messages`, `detect_intent`, `score_lead`, `log_to_crm`, `create_followup`, `get_customer_context` over stdio, independent of the Slack bot process. Verified end-to-end with a live smoke test.
- **Signal alert cards** (`blocks/signal-card.js`) — intent type, confidence bar, evidence, executive summary, recommended action; buttons for Open Thread, View CRM, Assign Owner, Mark False Positive (`listeners/actions/signal-actions.js`).
- **Real-time monitoring** (`listeners/events/message.js`) — every qualifying new message is checked for growth signals as it arrives, not just on manual scan.
- **App Home analytics dashboard** (`listeners/app-home.js`, `blocks/dashboard-blocks.js`) — Slack-native (no separate web server): total/today/7-day signal counts, revenue opportunities, churn risks, feature requests, false positives, a 7-day sparkline trend, top signal types, top channels, top customers.
- **Slash commands**: `/gb-scan` (replaces `/scan-requests`), `/gb-signals` (replaces `/list-tasks`), `/gb-report` (replaces `/daily-report`).
- **Incremental TypeScript checking** — `tsconfig.json` (`allowJs` + `checkJs`, no `.ts` rewrite), `npx tsc --noEmit` passes clean across the repo.
- **Unit tests** (`test/`, `node --test`) — 34 tests covering `leadScore`, `intentEngine`'s pure paths, `llm.extractJson`, `scan.parseHoursBack`, `searchService.extractMentionedUserIds`, `signalStore`, and the mock CRM provider.
- `IMPLEMENTATION_PLAN.md` rewritten for the Growth Beacon phase sequencing; `ARCHITECTURE.md` added as the current technical source of truth; `PROJECT_ANALYSIS.md` kept as historical record of the pre-pivot codebase.

### Removed

- Community-domain code with no Growth Beacon equivalent: `services/tasks.js`, `services/summarize.js`, `blocks/request-card.js`, `blocks/task-card.js`, `listeners/commands/scan-requests.js`, `listeners/commands/list-tasks.js`, `listeners/commands/daily-report.js`, `listeners/actions/task-actions.js`.

### Changed

- `manifest.json` — renamed app, new slash commands, `app_home.home_tab_enabled: true`, added `app_home_opened` event and `users:read` scope.
- `package.json` — renamed to `growth-beacon`, added `@modelcontextprotocol/sdk`, `zod`, `typescript` (dev); new `mcp`, `typecheck`, `test` scripts.
- `.env.sample` / `.env` — added `CRM_PROVIDER`, `SIGNAL_CONFIDENCE_THRESHOLD`, `GROWTH_ALERTS_CHANNEL` (replaces `IMPACT_CHANNEL`), and commented HubSpot/Salesforce credential placeholders.
- `services/report.js` — now aggregates `signalStore` stats instead of `tasks` stats; narrative prompt rewritten for a growth-intelligence audience.

## Prior history (Community Impact Agent, pre-pivot)

- Initial commit: Slack agent bot for finding community help requests, turning them into trackable tasks, and posting daily impact reports.
- Sanitized `.env.sample` (previously contained live-looking Slack/Hugging Face tokens instead of placeholders).
- Refactored to remove duplication: shared RTS token-capture helper, shared hours-back parsing, consolidated Block Kit constants, deduplicated `task_card` fallback logic (behavior-preserving, verified by full require-graph + live `npm start`).
