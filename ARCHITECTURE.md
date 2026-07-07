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
└───────────┬─────────────────────────────────────────────┬─────────────┘
            │                                             │
            v                                             v
┌───────────────────────────┐                 ┌───────────────────────────┐
│ services/scan.js           │                 │ blocks/                   │
│  processMessageForSignals()│ ── posts ──────>│  signal-card.js           │
│  runScan() (retroactive)   │                 │  dashboard-blocks.js      │
└─────┬──────────┬───────────┘                 │  report-blocks.js        │
      │          │                             └───────────────────────────┘
      v          v
┌──────────┐ ┌──────────────────┐        ┌────────────────────┐
│ search   │ │ intentEngine.js  │──────> │ summaryService.js   │
│ Service  │ │ (15 signal types)│        │ (coordinator summary)│
│ (+ rts.js)│ └──────────────────┘        └──────────┬──────────┘
└──────────┘                                          v
                                            ┌────────────────────┐
                                            │ signalStore.js      │
                                            │ (data/signals.json) │
                                            └──────────┬──────────┘
                                            ┌───────────┴───────────┐
                                            v                       v
                                  ┌────────────────────┐  ┌────────────────────┐
                                  │ matchService.js     │  │ services/crm/       │
                                  │ need ↔ offer matching│  │ getProvider()        │
                                  └────────────────────┘  │ mock | hubspot* | sf*│
                                                            └────────────────────┘

┌───────────────────────────────────────────────────────────────────────┐
│ mcp/server.js  (separate process, stdio)                              │
│  summarize_thread · search_messages · detect_signals · score_priority │
│  find_matches · log_case · create_followup · get_constituent_context  │
│  → same services/* modules as the Bolt app, no shared runtime state   │
│    beyond the on-disk data/*.json files                                │
└───────────────────────────────────────────────────────────────────────┘
* stubs — see "Case-log provider abstraction" below
```

## Two independent entry points, one shared service layer

- **`app.js`** — the Slack bot, Socket Mode, long-lived process. Owns all Slack-specific concerns (Bolt handlers, Block Kit rendering, OAuth tokens).
- **`mcp/server.js`** — a separate stdio process for MCP clients. Never receives Slack events, so it never has a fresh Real-Time Search `action_token` — `searchService.searchWithFallback()`'s `conversations.history` fallback path is what makes `search_messages` work from here.

Both processes import the same `services/*` modules. Neither owns the other; they communicate only indirectly, through the on-disk JSON stores (`data/signals.json`, `data/crm-mock.json`). This is intentional: a signal logged via the MCP server's `log_case` tool is immediately visible to `/cb-needs` in Slack, and vice versa, without any RPC between the two processes.

## Locked architectural decisions

These were resolved before implementation of the Agent-for-Good pivot, since the domain change required several concrete engineering trade-offs:

1. **Domain pivot, scaffolding kept.** `services/rts.js`, `services/llm.js`, and the Bolt/Socket-Mode setup in `app.js` carry over unchanged in spirit (`rts.js` is domain-agnostic by design — no growth- or community-specific query strings live there). Only `services/searchService.js`'s query strings, `services/intentEngine.js`'s signal vocabulary, and the display/scoring layers changed.
2. **Case management: Mock-first, real providers stubbed.** No HubSpot/Salesforce sandbox credentials were available. `services/crm/index.js#getProvider()` is the only import path business logic is allowed to use; swapping `CRM_PROVIDER` in `.env` is the entire migration path once real credentials exist. The Salesforce stub is framed around **Nonprofit Cloud** (community members → Constituents, detected needs → Cases), since that's the realistic destination for this domain.
3. **Typing: incremental via `tsconfig.json` (`allowJs` + `checkJs`), not a `.ts` rewrite.** `npx tsc --noEmit` runs clean.
4. **Dashboard: Slack-native App Home, not a web server.** The app has zero HTTP surface by design (Socket Mode only, no exposed ports). `listeners/app-home.js` + `blocks/dashboard-blocks.js` render analytics directly into the Home tab on `app_home_opened`.
5. **Matching is deterministic, not an LLM call.** `services/matchService.js` uses a fixed type-affinity map (which offer types can plausibly satisfy which need types) plus `priorityScore` for ranking — fast, free, and auditable. An LLM call per match-check would be slower and non-reproducible for something that's fundamentally a lookup problem.

## The detection pipeline in detail

`services/scan.js` has exactly one function that does detection + persistence + case logging + matching + card posting: **`processMessageForSignals()`**. Both real-time monitoring (`listeners/events/message.js`, every qualifying new message) and retroactive scans (`runScan()`, used by `/cb-scan` and `@Community Beacon scan`) call it — signal detection, summarization, storage, matching, and case logging exist in exactly one place.

1. `intentEngine.hasKeywordHint()` — a cheap regex pre-filter. Most Slack messages ("lol", "see you at standup") never reach the LLM.
2. `intentEngine.detectSignals()` — LLM call, returns zero or more `{ type, confidence, evidence, reasoning, recommended_action }` objects from a fixed 15-type vocabulary (needs, offers, coordination).
3. Confidence gate — `SIGNAL_CONFIDENCE_THRESHOLD` (default `0.6`). Below threshold, the signal is silently dropped (not even persisted) to keep alert volume sane.
4. `summaryService.summarizeConversation()` — LLM call, produces the coordinator-summary fields.
5. `signalStore.createSignal()` — persists to `data/signals.json` (write-through, atomic rename to avoid truncation on crash).
6. `crm.getProvider().logSignal()` — logs to the configured case-log provider. Failure here is caught and logged, not fatal — the signal is already safely persisted locally regardless of provider availability.
7. `matchService.findMatches()` — deterministic lookup: for an offer, finds open needs it could satisfy; for a need, finds open offers that could meet it. Ranked by `priorityScore`, capped at 3.
8. `blocks/signal-card.js#signalCardBlocks()` — renders the alert (including any matches), posted via the caller-supplied `post()` callback (real-time: threaded reply under the source message, or `COMMUNITY_ALERTS_CHANNEL` if set; retroactive scan: same channel being scanned).

## Signal lifecycle

`new` (needs attention) → (`claim_help` button, "I Can Help") → `reviewed` (claimed by a helper), or → (`not_a_request` button) → `false_positive`. Both transitions re-render the same card in place via `chat.update`.

## Known limitations (carried forward, not solved by this pass)

- **Single-instance JSON file stores.** `data/signals.json` and `data/crm-mock.json` have no concurrency control. Fine for one Socket Mode process; would corrupt under horizontal scaling.
- **HubSpot/Salesforce are stubs.** They throw a clear, actionable error rather than silently no-op-ing, so this is a visible gap, not a silent one.
- **Real-time monitoring cost.** Every non-bot message in a monitored channel does incur one keyword-filter check; only messages that pass it reach the LLM. At very high message volume, the keyword filter is the only cost control — there's no rate limiting beyond that today.
- **Matching is type-affinity only, not semantic.** `matchService.findMatches()` doesn't know that a "ride to a food bank" offer is a stronger match for a "food_insecurity" need than a generic `volunteer_offer` — it treats all offers of a given type as equally plausible for all needs that type can address. Good enough to surface candidates for a human to confirm; not a dispatch engine.
