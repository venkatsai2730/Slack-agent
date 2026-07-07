# Implementation Plan — Growth Beacon

**Status: historical, superseded by the Community Beacon pivot.** The product has since pivoted again, from Growth Beacon (B2B growth intelligence) to **Community Beacon** (Slack Agent for Good — community needs and offers of help). See `CHANGELOG.md`'s "[Unreleased] — Community Beacon pivot" entry and `ARCHITECTURE.md` for the current design; this file is kept only as a record of the Growth Beacon phase sequencing, most of which (Bolt/Socket Mode setup, RTS wrapper, MCP server pattern, CRM provider abstraction, typing strategy) carried forward unchanged into the current codebase.

This replaces the original Community-Impact-Agent-focused plan. The product pivoted from "community help request tracker" to **Growth Beacon**, an AI Growth Intelligence Slack agent for Product-Led-Growth companies (buying intent, expansion, churn-risk, and competitor-mention detection). The original `PROJECT_ANALYSIS.md` describes the pre-pivot codebase; it remains useful as a record of the reusable scaffolding (Bolt/Socket Mode setup, the RTS `action_token` cache quirk, the `llm.js` OpenAI-compatible wrapper) that this plan carries forward rather than rebuilding.

## Locked architectural decisions (resolved before implementation started)

These were ambiguous or under-specified in the product brief and were resolved with the user before writing code, per the brief's own "stop for critical architectural decisions" rule:

1. **Scope**: full pivot. The existing community-help domain logic (`services/tasks.js`, `services/summarize.js`, `services/scan.js`'s help-request query, `blocks/request-card.js`, `blocks/task-card.js`) is replaced by Growth Beacon's signal-detection domain. The reusable Slack/Bolt scaffolding (`app.js`, `services/rts.js`, `services/llm.js`) is kept and generalized.
2. **CRM integration**: provider-abstraction interface with a fully functional **Mock CRM** provider. HubSpot and Salesforce providers are stubbed behind the same interface and throw a clear "not configured" error — they are not wired to real APIs because no sandbox credentials are available. Swapping in real credentials later only requires implementing the two stub files; no call-site changes.
3. **Typing strategy**: incremental typing via `tsconfig.json` with `allowJs`/`checkJs` + JSDoc annotations. No `.ts` rewrite — this satisfies "no build/type errors" without touching the "don't rewrite the repository" constraint. `@slack/bolt` and `openai` ship their own type declarations, so `require()` calls into them are typed automatically; new modules get explicit JSDoc `@typedef`/`@param`/`@returns`.
4. **Dashboard**: Slack-native, built as an **App Home tab** (Block Kit), not a separate web server. The app has zero HTTP surface by design (Socket Mode only, no exposed ports — stated in the original README/Dockerfile); adding an Express server would be a real architectural change the brief didn't ask for explicitly, and the Slack-native version keeps the demo self-contained.

## Phase sequencing (implementation order differs slightly from the brief's numbering, to respect dependencies)

The brief lists Phase 5 (MCP Server) before Phase 6 (CRM). MCP's `log_to_crm`, `score_lead`, and `detect_intent` tools depend on the CRM provider and intent engine existing first, so those services are built before the MCP server wraps them. Slack-facing phases (1, 7, 8) are interleaved with their backing services rather than done as one final pass, since each command/listener is only meaningful once its service exists.

1. **Phase 1 — Platform**: env validation already exists in `app.js` (kept); `manifest.json` rewritten for Growth Beacon's scopes/commands/events/App Home; `package.json` renamed and re-described.
2. **Phase 2 — Search**: `services/rts.js` generalized to a domain-agnostic `searchMessages()` (the old hardcoded "help" query moves out); new `services/searchService.js` adds thread-context fetching, mention extraction, and a **non-RTS fallback path** (`conversations.history` + keyword filter) for callers with no cached `action_token` — this also unblocks the MCP server's `search_messages` tool, which runs as a separate process with no Slack event stream to harvest a token from.
3. **Phase 3 — Intent engine**: `services/intentEngine.js`, 15 signal types (union of the brief's two signal lists), each with confidence/evidence/reasoning/recommended_action, gated by a cheap keyword pre-filter so not every Slack message triggers an LLM call.
4. **Phase 4 — Summaries**: `services/summaryService.js`, executive-summary schema exactly as specified (what happened / why it matters / business impact / people involved / recommended next action).
5. **Phase 6 — CRM abstraction**: `services/crm/{index,mockProvider,hubspotProvider,salesforceProvider}.js`.
6. **Signal persistence + lead scoring** (not a numbered phase in the brief, but required by both MCP and the dashboard): `services/signalStore.js` (JSON-file store, same pattern as the old `tasks.js`) and `services/leadScore.js`.
7. **Phase 5 — MCP server**: `mcp/server.js`, a separate stdio entry point (`npm run mcp`) exposing the 7 required tools over `@modelcontextprotocol/sdk`, independent of the Bolt process.
8. **Phase 7 — Slack UX**: listeners rewritten for the new domain — passive `message` monitoring that posts signal-alert cards in real time, `/gb-scan`, `/gb-signals`, `/gb-report` commands, and action handlers for Open Thread / View CRM / Assign Owner / Mark False Positive.
9. **Phase 8 — Dashboard**: `app_home_opened` listener + `blocks/dashboard-blocks.js` rendering signal trends, top signal types, top channels, and open revenue/churn counts from `signalStore` stats.
10. **Phase 9 — Production readiness**: `tsconfig.json` + `npx tsc --noEmit` clean run, `node --test` unit tests for the pure-logic services (intent engine parsing, lead scoring, signal store, CRM mock), structured logging left on Bolt's existing logger (already reasonable for this scale), updated `README.md`, new `ARCHITECTURE.md`, new `CHANGELOG.md`.

## Explicitly deferred / out of scope for this pass

- Real HubSpot/Salesforce API calls (needs credentials the user doesn't have yet — stubs are ready to fill in).
- A browser-based dashboard (Slack-native App Home chosen instead — see decision 4 above).
- Horizontal scaling of the JSON-file signal store (same single-instance limitation the original `tasks.js` had; documented, not solved, since solving it means introducing a database, which is a bigger architectural change than this pass covers).
