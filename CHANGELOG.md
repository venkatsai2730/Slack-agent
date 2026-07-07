# Changelog

## [Unreleased] — Growth Beacon pivot

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
