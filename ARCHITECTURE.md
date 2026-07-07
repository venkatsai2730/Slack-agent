# Architecture — Growth Beacon

`PROJECT_ANALYSIS.md` documents the pre-pivot codebase (Community Impact Agent) and is kept as historical record only. This file is the current source of truth for Growth Beacon's design.

## System diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Slack workspace                                                          │
│                                                                           │
│  message events ──┐                    slash commands ──┐               │
│  app_mention ──────┤                    /gb-scan          │              │
│  app_home_opened ──┤                    /gb-signals       │              │
│  assistant thread ─┘                    /gb-report        │              │
└───────────┬───────────────────────────────────┬───────────┬─────────────┘
            │  Socket Mode (outbound WS only)   │           │
            v                                   v           v
┌───────────────────────────────────────────────────────────────────────┐
│ app.js  →  listeners/  (Bolt event/command/action/assistant handlers) │
└───────────┬─────────────────────────────────────────────┬─────────────┘
            │                                             │
            v                                             v
┌───────────────────────────┐                 ┌───────────────────────────┐
│ services/scan.js           │                 │ blocks/                   │
│  processMessageForSignals()│ ── posts ──────>│  signal-card.js           │
│  runScan() (retroactive)   │                 │  dashboard-blocks.js      │
└─────┬──────────┬───────────┘                 │  report-blocks.js         │
      │          │                             └───────────────────────────┘
      v          v
┌──────────┐ ┌──────────────────┐        ┌────────────────────┐
│ search   │ │ intentEngine.js  │──────> │ summaryService.js   │
│ Service  │ │ (15 signal types)│        │ (executive summary) │
│ (+ rts.js)│ └──────────────────┘        └──────────┬──────────┘
└──────────┘                                          v
                                            ┌────────────────────┐
                                            │ signalStore.js      │
                                            │ (data/signals.json) │
                                            └──────────┬──────────┘
                                                        v
                                            ┌────────────────────┐
                                            │ services/crm/       │
                                            │ getProvider()        │
                                            │ mock | hubspot* | sf*│
                                            └────────────────────┘

┌───────────────────────────────────────────────────────────────────────┐
│ mcp/server.js  (separate process, stdio)                              │
│  summarize_thread · search_messages · detect_intent · score_lead      │
│  log_to_crm · create_followup · get_customer_context                  │
│  → same services/* modules as the Bolt app, no shared runtime state   │
│    beyond the on-disk data/*.json files                                │
└───────────────────────────────────────────────────────────────────────┘
* stubs — see "CRM provider abstraction" below
```

## Two independent entry points, one shared service layer

- **`app.js`** — the Slack bot, Socket Mode, long-lived process. Owns all Slack-specific concerns (Bolt handlers, Block Kit rendering, OAuth tokens).
- **`mcp/server.js`** — a separate stdio process for MCP clients. Never receives Slack events, so it never has a fresh Real-Time Search `action_token` — `searchService.searchWithFallback()`'s `conversations.history` fallback path is what makes `search_messages` work from here.

Both processes import the same `services/*` modules. Neither owns the other; they communicate only indirectly, through the on-disk JSON stores (`data/signals.json`, `data/crm-mock.json`). This is intentional: a signal logged via the MCP server's `log_to_crm` tool is immediately visible to `/gb-signals` in Slack, and vice versa, without any RPC between the two processes.

## Locked architectural decisions

These were resolved with the user before implementation, since the product brief specified a full pivot from the prior codebase without specifying several concrete engineering trade-offs:

1. **Full domain pivot, scaffolding kept.** `services/rts.js`, `services/llm.js`, and the Bolt/Socket-Mode setup in `app.js` carry over unchanged in spirit (generalized where needed — e.g. `rts.js` no longer hardcodes a domain-specific search query). All community-help-request domain logic was deleted, not deprecated in place.
2. **CRM: Mock-first, real providers stubbed.** No HubSpot/Salesforce sandbox credentials were available. `services/crm/index.js#getProvider()` is the only import path business logic is allowed to use; swapping `CRM_PROVIDER` in `.env` is the entire migration path once real credentials exist.
3. **Typing: incremental via `tsconfig.json` (`allowJs` + `checkJs`), not a `.ts` rewrite.** `npx tsc --noEmit` runs clean. Type-only casts (documented inline with a one-line comment explaining *why*) bridge a handful of spots where a dependency's `.d.ts` doesn't match its documented runtime behavior (e.g. `openai`'s dual CJS/ESM export shape under `Node16` module resolution, and Slack's untyped `assistant.search.context` response).
4. **Dashboard: Slack-native App Home, not a web server.** The app has zero HTTP surface by design (Socket Mode only, no exposed ports — true both before and after the pivot). `listeners/app-home.js` + `blocks/dashboard-blocks.js` render analytics directly into the Home tab on `app_home_opened`.

## The detection pipeline in detail

`services/scan.js` has exactly one function that does detection + persistence + CRM logging + card posting: **`processMessageForSignals()`**. Both real-time monitoring (`listeners/events/message.js`, every qualifying new message) and retroactive scans (`runScan()`, used by `/gb-scan` and `@Growth Beacon scan`) call it — signal detection, summarization, storage, and CRM logging exist in exactly one place.

1. `intentEngine.hasKeywordHint()` — a cheap regex pre-filter. Most Slack messages ("lol", "thanks!", "see you at standup") never reach the LLM.
2. `intentEngine.detectSignals()` — LLM call, returns zero or more `{ type, confidence, evidence, reasoning, recommended_action }` objects from a fixed 15-type vocabulary.
3. Confidence gate — `SIGNAL_CONFIDENCE_THRESHOLD` (default `0.6`). Below threshold, the signal is silently dropped (not even persisted) to keep alert volume sane.
4. `summaryService.summarizeConversation()` — LLM call, produces the executive-summary fields.
5. `signalStore.createSignal()` — persists to `data/signals.json` (write-through, atomic rename to avoid truncation on crash).
6. `crm.getProvider().logSignal()` — logs to the configured CRM provider. Failure here is caught and logged, not fatal — the signal is already safely persisted locally regardless of CRM availability.
7. `blocks/signal-card.js#signalCardBlocks()` — renders the alert, posted via the caller-supplied `post()` callback (real-time: threaded reply under the source message, or `GROWTH_ALERTS_CHANNEL` if set; retroactive scan: same channel being scanned).

## Signal lifecycle

`new` → (`assign_owner` button) → `reviewed`, or → (`mark_false_positive` button) → `false_positive`. Both transitions re-render the same card in place via `chat.update`, matching the pattern the prior codebase used for task status transitions.

## Known limitations (carried forward, not solved by this pass)

- **Single-instance JSON file stores.** `data/signals.json` and `data/crm-mock.json` have no concurrency control. Fine for one Socket Mode process; would corrupt under horizontal scaling. A DB migration is a bigger change than this pass scoped in (see `IMPLEMENTATION_PLAN.md`).
- **HubSpot/Salesforce are stubs.** They throw a clear, actionable error rather than silently no-op-ing, so this is a visible gap, not a silent one.
- **Real-time monitoring cost.** Every non-bot message in a monitored channel does incur one keyword-filter check; only messages that pass it reach the LLM. At very high message volume, the keyword filter is the only cost control — there's no rate limiting beyond that today.
