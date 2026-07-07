# Changelog

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
