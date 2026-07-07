# Growth Beacon 🚦

**Slack Agent Builder Challenge — AI Growth Intelligence**

An AI-native Slack agent for Product-Led-Growth companies. Growth Beacon continuously monitors Slack conversations, detects high-value business signals (buying intent, pricing discussions, expansion opportunities, churn risk, competitor mentions, and more), summarizes them into executive-ready context, logs them to a CRM, and proactively alerts Growth, Sales, Customer Success, and Product teams — all inside Slack.

It is not a chatbot you have to ask. It's a background intelligence layer that turns "someone mentioned pricing in #customer-success" into a tracked, scored, CRM-logged business signal with a recommended next action.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full technical design and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for how this was built in phases.

## What it detects

Pricing intent · Upgrade intent · Expansion opportunities · Feature requests · Competitor mentions · Integration requests · Churn risk · Customer frustration · Positive/negative sentiment · Enterprise buying intent · Decision-maker involvement · Budget discussion · Timeline discussion · Security concerns

Each detected signal includes a **confidence score**, the **evidence** (quoted text), **AI reasoning**, and a **recommended action** — never a bare label.

## How it works

1. **Monitor** — every new message in a channel Growth Beacon is in gets checked (cheaply, via a keyword pre-filter) for growth-signal language.
2. **Detect** — messages that pass the filter go to an LLM-based Intent Intelligence Engine (`services/intentEngine.js`), which classifies them into zero or more of 15 signal types.
3. **Summarize** — qualifying signals get an executive summary (`services/summaryService.js`): what happened, why it matters, business impact, people involved, recommended next action.
4. **Alert** — a Block Kit card is posted with the signal type, confidence, summary, and buttons: **Open Thread**, **View CRM**, **Assign Owner**, **Mark False Positive**.
5. **Log to CRM** — the signal is persisted locally and logged to the configured CRM provider (Mock by default; HubSpot/Salesforce are pluggable — see below).
6. **Report** — `/gb-report` posts a daily AI-written growth intelligence summary; the **App Home** tab shows a live analytics dashboard.

You can also retroactively scan history (`@Growth Beacon scan` or `/gb-scan`), list recent signals (`/gb-signals`), or ask the AI assistant panel questions directly.

## Setup (10 minutes)

1. **Create the Slack app**: go to [api.slack.com/apps](https://api.slack.com/apps) → *Create New App* → *From a manifest* → pick your workspace → paste the contents of `manifest.json`.
2. **Install** the app to your workspace (*Install App* page) and copy the **Bot User OAuth Token** (`xoxb-...`).
3. **App-level token**: *Basic Information* → *App-Level Tokens* → generate one with the `connections:write` scope (`xapp-...`).
4. **LLM key (free)**: create a token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens). (Or run [Ollama](https://ollama.com) locally — see `.env.sample`.)
5. Configure and run:
   ```bash
   cp .env.sample .env   # fill in the three required tokens
   npm install
   npm start             # → "🚀 Growth Beacon is running (Socket Mode)"
   ```

> **Note on Real-Time Search access**: RTS (`assistant.search.context`) is available to internal workspace apps and directory-published apps. An internal app (created from this manifest in your own workspace) qualifies. When no fresh RTS token is available, search automatically falls back to `conversations.history` + keyword filtering — no hard failure either way.

### CRM provider

`CRM_PROVIDER` in `.env` controls which backend `services/crm/` logs signals to:

| Value | Status |
|---|---|
| `mock` (default) | Fully functional, file-backed (`data/crm-mock.json`) — no external account needed |
| `hubspot` | Stub — throws a clear "not configured" error until `HUBSPOT_API_KEY` is set and `services/crm/hubspotProvider.js` is implemented |
| `salesforce` | Stub — same pattern, via `SALESFORCE_*` env vars and `services/crm/salesforceProvider.js` |

Business logic never imports a provider file directly — only `services/crm/index.js#getProvider()` — so wiring up a real CRM later is a two-file change, not a refactor.

### MCP server

Growth Beacon also exposes its pipeline as an MCP server, independent of the Slack bot process:

```bash
npm run mcp
```

Tools: `summarize_thread`, `search_messages`, `detect_intent`, `score_lead`, `log_to_crm`, `create_followup`, `get_customer_context`. Point any MCP-compatible client (e.g. Claude Desktop) at this command to drive the growth-intelligence pipeline directly, outside of Slack.

### Run with Docker (alternative to `npm start`)

Steps 1–4 above are still required (the app needs its tokens in `.env`). Then:

```bash
docker compose up -d --build     # build + run in the background
docker compose logs -f           # → "🚀 Growth Beacon is running (Socket Mode)"
docker compose down              # stop
```

Signals and mock-CRM data persist in the named volume `agent-data` (mounted at `/app/data`), so they survive container restarts. Socket Mode only makes outbound connections, so no ports are exposed.

## Demo walkthrough

1. Invite the bot to a channel: `/invite @Growth Beacon`.
2. Post a few test messages, e.g.:
   > We're evaluating an enterprise upgrade and need to discuss pricing with our CFO before renewing next quarter.

   > Honestly getting frustrated — the API integration keeps timing out and we're considering [Competitor X] instead.
3. Within a few seconds, Growth Beacon should post a signal card in-thread (real-time monitoring) — or trigger a retroactive scan with `@Growth Beacon scan` (or `scan 48` for 48 hours back; `/gb-scan` also works if a mention happened in the last ~2 minutes, otherwise it degrades gracefully to a history-based search).
4. Each card shows the intent type, confidence bar, evidence, executive summary, and recommended action. Try **View CRM**, **Assign Owner**, and **Mark False Positive**.
5. `/gb-signals` — list recent signals. `/gb-report` — post the AI-written growth intelligence report (set `GROWTH_ALERTS_CHANNEL=#growth-signals` in `.env` to route both alerts and reports to a dedicated channel).
6. Open the **App Home** tab (click the bot's name → Home) to see the live analytics dashboard: signal trends, top types, top channels, top customers, revenue opportunities vs. churn risks.
7. Bonus: open the bot's **AI assistant panel** (sparkle icon) and ask "What growth signals have been detected recently?"

## Project structure

```
app.js                        Slack bot entry point (Socket Mode)
mcp/server.js                 MCP server entry point (stdio, separate process)
manifest.json                 app manifest (scopes, commands, events, App Home, assistant)
listeners/                    Slack handlers (events, commands, actions, assistant, app-home)
services/rts.js               Real-Time Search wrapper + action_token cache (domain-agnostic)
services/searchService.js     growth-signal queries + thread context + non-RTS fallback
services/intentEngine.js      LLM-based signal detection (15 signal types)
services/summaryService.js    executive summary generation
services/leadScore.js         deterministic lead scoring (hot/warm/cold)
services/signalStore.js       signal persistence (data/signals.json) + stats
services/crm/                 CRM provider abstraction (mock, hubspot stub, salesforce stub)
services/report.js            daily aggregation + AI narrative
blocks/                       Block Kit builders (signal card, dashboard, report)
test/                         node:test unit tests for the pure-logic services
```
