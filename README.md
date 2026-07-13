# Community Beacon 

**Slack Agent Builder Challenge — Slack Agent for Good**

An AI-native Slack agent for mutual-aid groups, nonprofits, and community organizations. Community Beacon continuously monitors Slack conversations, detects calls for help — food insecurity, housing need, medical need, transport, emotional support — and offers of help — volunteering, donations, skills, spare resources — searches **workspace history** (Real-Time Search + a persistent signal memory) for prior related activity, reasons over both the current message and that history to produce a coordinator summary with **confidence-scored recommendations**, **matches offers to open needs** through a HIGH/MEDIUM/LOW confidence-based decision engine, **proactively escalates** unresolved signals that have sat too long, and tracks impact analytics — all inside Slack.

It is not a chatbot you have to ask, and it is not a message classifier. It's an agent that remembers: every new signal is reasoned about alongside everything the workspace has seen before — "this is the fourth transport request from this channel in nine days; Sarah has completed five similar matches nearby" — so no request for help goes unanswered, and repeat patterns get a systemic response instead of another one-off.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full technical design and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for how this was built in phases.

## The impact case

Mutual-aid and nonprofit communities coordinate almost entirely in Slack (or Slack-like tools), but that coordination is fragile: a request for a ride to a dialysis appointment, a note about being unable to afford groceries this week, an offer to donate a car seat — these all live in a fast-scrolling channel with no triage, no memory, and no way to connect a need to the person who could meet it. Volunteers burn out re-reading threads looking for who still needs help; people in genuine need go unnoticed because their message wasn't urgent-*sounding*, just urgent.

Community Beacon fixes the structural problem, not just the UX: every qualifying message becomes a persistent, prioritized, **matchable** record, visible on a live dashboard, without anyone having to manually track a spreadsheet or re-explain their situation from scratch.

## What it detects

**Needs:** Help Request · Urgent Need · Transport Need · Food Insecurity · Housing Need · Medical Need · Emotional Support Need · Resource Request
**Offers:** Volunteer Offer · Donation Offer · Skill Offer · Resource Available
**Coordination:** Event Coordination · Gratitude Report · Follow-Up Needed

Each detected signal includes a **confidence score**, the **evidence** (quoted text), **AI reasoning**, a deterministic **priority score** (critical/high/routine — medical and urgent needs are weighted highest, offers are weighted as capacity, never urgency), and a **recommended action** — never a bare label.

## How it works — the agentic reasoning loop

```
Slack message
   ↓
Signal Detection        (services/intentEngine.js — 15-type LLM classifier)
   ↓
Workspace History Search (services/workspaceContext.js — RTS live search + persisted signal memory)
   ↓
MCP Context Enrichment   (mcp/server.js's workspace-history tools, same services layer)
   ↓
Coordinator Summary      (services/summaryService.js — reasons over message + history together)
   ↓
Confidence-Based Match Decision (services/matchDecision.js — HIGH auto-recommend / MEDIUM review / LOW outreach)
   ↓
Reasoning Timeline + Dashboard + Proactive Escalation (services/escalation.js, hourly sweep)
```

1. **Monitor** — every new message in a channel Community Beacon is in gets checked (cheaply, via a keyword pre-filter) for community-signal language.
2. **Detect** — messages that pass the filter go to an LLM-based Community Signal Engine (`services/intentEngine.js`), which classifies them into zero or more of 15 signal types.
3. **Search workspace history** — `services/workspaceContext.js` combines a live Real-Time Search sweep (`services/rts.js` / `searchService.js`) with structured aggregation over every signal ever detected (`signalStore.js`): has this person asked before? How many times has this channel seen this need this month? Is anyone else's identical request still unresolved? Which volunteers have a track record here? Results are cached (60s TTL) so repeat lookups in the same channel don't re-search.
4. **Enrich via MCP** — the same workspace-history functions are exposed as MCP tools (`search_workspace_history`, `get_repeat_requesters`, `get_repeat_volunteers`, `get_unresolved_similar`, `get_recent_matches`, `get_location_patterns`, `get_priority_statistics`, `summarize_workspace_context`, and an extended `get_constituent_context`) — usable standalone from any MCP client, not just from inside the Slack pipeline.
5. **Summarize with reasoning** — `services/summaryService.js` combines the current message *and* the workspace-history object into one LLM call, producing not just "what happened" but a recurrence summary, risk assessment, volunteer recommendation, confidence score, reasoning, alternative options, an escalation recommendation, and expected impact.
6. **Decide the match** — `services/matchDecision.js` scores every candidate from `matchService.js`'s type-affinity list on text similarity, volunteer track record, location (channel) proximity, priority, and historical success rate, then branches: **HIGH** confidence auto-recommends with a one-click Confirm; **MEDIUM** asks a coordinator to Approve/Reject with an explanation; **LOW** posts outreach to `VOLUNTEERS_NEEDED_CHANNEL` instead of guessing.
7. **Record the timeline** — every stage (detected, history searched, context enriched, match decided, escalated, resolved) is timestamped on the signal and viewable via the **View Timeline** button, the dashboard, and the daily report.
8. **Alert** — a Block Kit card is posted with the signal type, priority, confidence, AI coordinator reasoning, the match decision, and buttons: **Open Thread**, **View Case History**, **View Timeline**, **I Can Help**, **Not a Request** (plus **Confirm/Approve/Reject Match** where applicable).
9. **Escalate proactively** — `services/escalation.js` runs on a timer (`ESCALATION_CHECK_MINUTES`, default hourly), finds unresolved signals past a per-tier age threshold that haven't hit `ESCALATION_MAX_REMINDERS`, and — outside quiet hours — DMs `COORDINATOR_USER_IDS` and posts to `COMMUNITY_ALERTS_CHANNEL` with an AI-written explanation.
10. **Log** — the signal is persisted locally and logged to the configured case-management provider (Mock by default; HubSpot/Salesforce Nonprofit Cloud are pluggable — see below).
11. **Report impact** — `/cb-impact` and the **App Home** dashboard surface real metrics (`services/analytics.js`): time-to-match, response times by tier, auto-triage counts, volunteer utilization, repeat requesters/volunteers, a per-channel demand heatmap, escalation counts, and an estimated coordinator-hours-saved figure.

You can also retroactively scan history (`@Community Beacon scan` or `/cb-scan`), list recent signals (`/cb-needs`), or ask the AI assistant panel questions directly.

> **Note on "location":** Slack messages carry no structured geography, so "district" is modeled as the channel a signal was posted in — the demand heatmap and recurrence reasoning are channel-scoped by design, not an LLM guess at a place name.

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

> **Note on escalation DMs**: `manifest.json` includes the `im:write` scope (needed for `conversations.open` to DM coordinators). If you installed the app before this scope was added, reinstall it from the *Install App* page after re-pasting the manifest, or add the scope manually under *OAuth & Permissions*. Set `COORDINATOR_USER_IDS` in `.env` (comma-separated Slack user IDs) to enable escalation DMs — see `.env.sample` for the full set of escalation-tuning variables.

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

**Core pipeline tools:** `summarize_thread`, `search_messages`, `detect_signals`, `score_priority`, `find_matches`, `log_case`, `create_followup`, `get_constituent_context` (now also merges workspace signal history, not just CRM records).

**Workspace-history & analytics tools (Feature 6):** `search_workspace_history` (RTS + persisted signal memory combined), `get_location_patterns` (channel-as-district trends / workspace heatmap), `get_repeat_requesters`, `get_repeat_volunteers`, `get_unresolved_similar`, `get_recent_matches`, `get_successful_outcomes`, `get_priority_statistics`, `summarize_workspace_context` (the full analytics + requester-history bundle).

Point any MCP-compatible client (e.g. Claude Desktop) at this command to drive the community-intelligence pipeline — including its workspace memory — directly, outside of Slack.

### Run with Docker (alternative to `npm start`)

Steps 1–4 above are still required (the app needs its tokens in `.env`). Then:

```bash
docker compose up -d --build     # build + run in the background
docker compose logs -f           # → "🤝 Community Beacon is running (Socket Mode)"
docker compose down              # stop
```

Signals and mock case-log data persist in the named volume `agent-data` (mounted at `/app/data`), so they survive container restarts. Socket Mode only makes outbound connections, so no ports are exposed.

## Demo walkthrough (first 60 seconds)

1. Invite the bot to a channel: `/invite @Community Beacon`.
2. Post a first message: *"Does anyone know if there's a food pantry open this weekend? Money's tight until payday."* — a signal card appears with the signal type, priority, confidence, and summary. No history yet, so no recurrence reasoning — this is the baseline.
3. Post two or three more transport/food requests in the **same channel** over the next messages (this is what "workspace history" needs to have something to find). Then post a message that repeats the earlier pattern, e.g. another transport request.
4. Watch the new card: it now includes a **🧠 AI Coordinator Reasoning** section — *"This appears to be the Nth transport request from this channel in N days"* — impossible to produce from the single message alone, since it comes from `workspaceContext.buildContext()` combining the live RTS search with the persisted signal history.
5. Post a volunteer offer ("happy to drive anyone this week") — watch the **🤝 Match decision** section label which confidence branch executed (HIGH/MEDIUM/LOW) with an explanation, and (for HIGH/MEDIUM) a **Confirm/Approve Match** button.
6. Open the **App Home** tab — the dashboard now shows the 🧭 *Agentic reasoning & impact* section: response times, auto-triage counts, confidence-branch distribution, escalation queue, the channel demand heatmap, and repeat requesters/volunteers, updating live as you post.
7. To see proactive escalation without waiting an hour, temporarily set `ESCALATION_CHECK_MINUTES=1` and `ESCALATION_AGE_HOURS_ROUTINE=0` in `.env`, restart, and watch an unresolved signal get DMed to `COORDINATOR_USER_IDS` and posted to `COMMUNITY_ALERTS_CHANNEL` with an AI-written explanation — then revert the env vars.
8. `/cb-needs` — list recent signals. `/cb-impact` — post the AI-written report, now including matches confirmed, escalations sent, and estimated coordinator hours saved.
9. Click **View Timeline** on any card to see its full reasoning timeline: detected → history searched → context enriched → match decided → (escalated) → resolved.
10. Bonus: open the bot's **AI assistant panel** (sparkle icon) and ask "What community needs have been detected recently?", or point an MCP client at `npm run mcp` and call `summarize_workspace_context`.

## Project structure

```
app.js                        Slack bot entry point (Socket Mode)
mcp/server.js                 MCP server entry point (stdio, separate process)
manifest.json                 app manifest (scopes, commands, events, App Home, assistant)
listeners/                    Slack handlers (events, commands, actions, assistant, app-home)
services/rts.js               Real-Time Search wrapper + action_token cache (domain-agnostic)
services/searchService.js     community-signal queries + thread context + non-RTS fallback
services/intentEngine.js      LLM-based signal detection (15 signal types: needs, offers, coordination)
services/workspaceContext.js  Feature 1 — RTS + persisted-signal-history aggregation, cached
services/summaryService.js    coordinator-ready summary + AI reasoning generation (Feature 7)
services/priorityScore.js     deterministic priority scoring (critical/high/routine)
services/matchService.js      deterministic need↔offer candidate generation
services/matchDecision.js     Feature 3 — confidence scoring + HIGH/MEDIUM/LOW branching
services/escalation.js        Feature 2 — proactive escalation sweep (scheduled from app.js)
services/analytics.js         Feature 4 — impact metrics (response time, utilization, heatmap, trends)
services/telemetry.js         Feature 9 — structured logging + timing instrumentation
services/signalStore.js       signal persistence (data/signals.json), timeline, stats
services/crm/                 case-log provider abstraction (mock, hubspot stub, salesforce stub)
services/report.js            daily aggregation + AI narrative + analytics
blocks/                       Block Kit builders (signal card, dashboard, report)
test/                         node:test unit tests for the pure-logic services
```
