# Community Beacon 🤝

**Slack Agent Builder Challenge — Slack Agent for Good**

An AI-native Slack agent for mutual-aid groups, nonprofits, and community organizations. Community Beacon continuously monitors Slack conversations, detects calls for help — food insecurity, housing need, medical need, transport, emotional support — and offers of help — volunteering, donations, skills, spare resources — summarizes them into coordinator-ready context, **matches offers to open needs**, logs cases, and proactively alerts coordinators and volunteers — all inside Slack.

It is not a chatbot you have to ask. It's a background intelligence layer that turns "does anyone have a spare car seat?" scrolling past in a busy channel into a tracked, prioritized, matched community signal with a recommended next action — so no request for help goes unanswered.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full technical design and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for how this was built in phases.

## The impact case

Mutual-aid and nonprofit communities coordinate almost entirely in Slack (or Slack-like tools), but that coordination is fragile: a request for a ride to a dialysis appointment, a note about being unable to afford groceries this week, an offer to donate a car seat — these all live in a fast-scrolling channel with no triage, no memory, and no way to connect a need to the person who could meet it. Volunteers burn out re-reading threads looking for who still needs help; people in genuine need go unnoticed because their message wasn't urgent-*sounding*, just urgent.

Community Beacon fixes the structural problem, not just the UX: every qualifying message becomes a persistent, prioritized, **matchable** record, visible on a live dashboard, without anyone having to manually track a spreadsheet or re-explain their situation from scratch.

## What it detects

**Needs:** Help Request · Urgent Need · Transport Need · Food Insecurity · Housing Need · Medical Need · Emotional Support Need · Resource Request
**Offers:** Volunteer Offer · Donation Offer · Skill Offer · Resource Available
**Coordination:** Event Coordination · Gratitude Report · Follow-Up Needed

Each detected signal includes a **confidence score**, the **evidence** (quoted text), **AI reasoning**, a deterministic **priority score** (critical/high/routine — medical and urgent needs are weighted highest, offers are weighted as capacity, never urgency), and a **recommended action** — never a bare label.

## How it works

1. **Monitor** — every new message in a channel Community Beacon is in gets checked (cheaply, via a keyword pre-filter) for community-signal language.
2. **Detect** — messages that pass the filter go to an LLM-based Community Signal Engine (`services/intentEngine.js`), which classifies them into zero or more of 15 signal types.
3. **Summarize** — qualifying signals get a coordinator-ready summary (`services/summaryService.js`): what happened, why it matters, community impact, people involved, recommended next action.
4. **Match** — `services/matchService.js` deterministically checks whether this signal complements any other *open* signal — an offer surfaces the needs it could meet, a need surfaces unclaimed offers that could meet it — so a "happy to drive anyone this week" post is linked to an actual open transport need, not just posted into the void.
5. **Alert** — a Block Kit card is posted with the signal type, priority, confidence, summary, any matches, and buttons: **Open Thread**, **View Case History**, **I Can Help** (claim), **Not a Request**.
6. **Log** — the signal is persisted locally and logged to the configured case-management provider (Mock by default; HubSpot/Salesforce Nonprofit Cloud are pluggable — see below).
7. **Report** — `/cb-impact` posts a daily AI-written community impact summary; the **App Home** tab shows a live impact dashboard.

You can also retroactively scan history (`@Community Beacon scan` or `/cb-scan`), list recent signals (`/cb-needs`), or ask the AI assistant panel questions directly.

## Setup (10 minutes)

1. **Create the Slack app**: go to [api.slack.com/apps](https://api.slack.com/apps) → *Create New App* → *From a manifest* → pick your workspace → paste the contents of `manifest.json`.
2. **Install** the app to your workspace (*Install App* page) and copy the **Bot User OAuth Token** (`xoxb-...`).
3. **App-level token**: *Basic Information* → *App-Level Tokens* → generate one with the `connections:write` scope (`xapp-...`).
4. **LLM key (free)**: create a token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens). (Or run [Ollama](https://ollama.com) locally — see `.env.sample`.)
5. Configure and run:
   ```bash
   cp .env.sample .env   # fill in the three required tokens
   npm install
   npm start             # → "🤝 Community Beacon is running (Socket Mode)"
   ```

> **Note on Real-Time Search access**: RTS (`assistant.search.context`) is available to internal workspace apps and directory-published apps. An internal app (created from this manifest in your own workspace) qualifies. When no fresh RTS token is available, search automatically falls back to `conversations.history` + keyword filtering — no hard failure either way.

### Case-log (CRM) provider

`CRM_PROVIDER` in `.env` controls which backend `services/crm/` logs signals to:

| Value | Status |
|---|---|
| `mock` (default) | Fully functional, file-backed (`data/crm-mock.json`) — no external account needed |
| `hubspot` | Stub — throws a clear "not configured" error until `HUBSPOT_API_KEY` is set and `services/crm/hubspotProvider.js` is implemented |
| `salesforce` | Stub — same pattern, via `SALESFORCE_*` env vars and `services/crm/salesforceProvider.js`. Framed around Salesforce **Nonprofit Cloud** (members → Constituents, needs → Cases) |

Business logic never imports a provider file directly — only `services/crm/index.js#getProvider()` — so wiring up a real case-management system later is a two-file change, not a refactor.

### MCP server

Community Beacon also exposes its pipeline as an MCP server, independent of the Slack bot process:

```bash
npm run mcp
```

Tools: `summarize_thread`, `search_messages`, `detect_signals`, `score_priority`, `find_matches`, `log_case`, `create_followup`, `get_constituent_context`. Point any MCP-compatible client (e.g. Claude Desktop) at this command to drive the community-intelligence pipeline directly, outside of Slack.

### Run with Docker (alternative to `npm start`)

Steps 1–4 above are still required (the app needs its tokens in `.env`). Then:

```bash
docker compose up -d --build     # build + run in the background
docker compose logs -f           # → "🤝 Community Beacon is running (Socket Mode)"
docker compose down              # stop
```

Signals and mock case-log data persist in the named volume `agent-data` (mounted at `/app/data`), so they survive container restarts. Socket Mode only makes outbound connections, so no ports are exposed.

## Demo walkthrough

1. Invite the bot to a channel: `/invite @Community Beacon`.
2. Post a couple of test messages, e.g.:
   > Does anyone know if there's a food pantry open this weekend? Money's tight until payday and I don't want to ask my neighbors again.

   > I have a car and some free time Saturday mornings if anyone needs a ride somewhere — happy to help out.
3. Within a few seconds, Community Beacon should post a signal card in-thread (real-time monitoring) — or trigger a retroactive scan with `@Community Beacon scan` (or `scan 48` for 48 hours back; `/cb-scan` also works if a mention happened in the last ~2 minutes, otherwise it degrades gracefully to a history-based search).
4. Each card shows the signal type, priority, confidence bar, evidence, coordinator summary, recommended action, and — if the offer above is still open — the food-pantry need should show up as a **possible match** on the ride-offer card, or vice versa. Try **View Case History**, **I Can Help**, and **Not a Request**.
5. `/cb-needs` — list recent signals. `/cb-impact` — post the AI-written community impact report (set `COMMUNITY_ALERTS_CHANNEL=#community-needs` in `.env` to route both alerts and reports to a dedicated channel).
6. Open the **App Home** tab (click the bot's name → Home) to see the live impact dashboard: community needs, offers of help, urgent needs, claimed signals, a 7-day trend, top signal types, top channels, top members.
7. Bonus: open the bot's **AI assistant panel** (sparkle icon) and ask "What community needs have been detected recently?"

## Project structure

```
app.js                        Slack bot entry point (Socket Mode)
mcp/server.js                 MCP server entry point (stdio, separate process)
manifest.json                 app manifest (scopes, commands, events, App Home, assistant)
listeners/                    Slack handlers (events, commands, actions, assistant, app-home)
services/rts.js               Real-Time Search wrapper + action_token cache (domain-agnostic)
services/searchService.js     community-signal queries + thread context + non-RTS fallback
services/intentEngine.js      LLM-based signal detection (15 signal types: needs, offers, coordination)
services/summaryService.js    coordinator-ready summary generation
services/priorityScore.js     deterministic priority scoring (critical/high/routine)
services/matchService.js      deterministic need↔offer matching
services/signalStore.js       signal persistence (data/signals.json) + stats
services/crm/                 case-log provider abstraction (mock, hubspot stub, salesforce stub)
services/report.js            daily aggregation + AI narrative
blocks/                       Block Kit builders (signal card, dashboard, report)
test/                         node:test unit tests for the pure-logic services
```
