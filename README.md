# Community Impact Agent 🤝

**Slack Agent Builder Challenge — "Slack Agent for Good" track**

A Slack agent that finds community help requests using Slack's **Real-Time Search API**, summarizes them with AI into structured requests, turns them into trackable tasks rendered with Slack's native **`task_card`** block, and posts warm, AI-written **daily impact reports**.

## How it works

1. **Discover** — mention the bot (`@Community Impact Agent scan`) in a channel. The mention event delivers the short-lived `action_token` Slack requires for bot-token calls to `assistant.search.context` (Real-Time Search). The agent searches the last 24h for help-request language and filters results to the current channel.
2. **Summarize** — each candidate message goes to an LLM that extracts `{title, description, category, urgency}` and rejects non-requests. Requester and permalink come from RTS metadata, not the model.
3. **Track** — each request is posted as a Block Kit card with a **Create Task** button. Clicking it creates a task rendered with the native `task_card` block (`pending → in_progress → complete`, updated in place via `chat.update`).
4. **Report** — `/daily-report` aggregates today's stats and asks the LLM for a 3–4 sentence impact narrative, posted as a Block Kit report.

## Setup (10 minutes)

1. **Create the Slack app**: go to [api.slack.com/apps](https://api.slack.com/apps) → *Create New App* → *From a manifest* → pick your workspace → paste the contents of `manifest.json`.
2. **Install** the app to your workspace (*Install App* page) and copy the **Bot User OAuth Token** (`xoxb-...`).
3. **App-level token**: *Basic Information* → *App-Level Tokens* → generate one with the `connections:write` scope (`xapp-...`).
4. **LLM key (free)**: create a token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens). (Or run [Ollama](https://ollama.com) locally — see `.env.sample`.)
5. Configure and run:
   ```bash
   cp .env.sample .env   # fill in the three tokens
   npm install
   npm start             # → "⚡ Community Impact Agent is running (Socket Mode)"
   ```

> **Note on Real-Time Search access**: RTS is available to internal workspace apps and directory-published apps. An internal app (created from this manifest in your own workspace) qualifies.

### Run with Docker (alternative to `npm start`)

Steps 1–4 above are still required (the app needs the three tokens in `.env`). Then:

```bash
docker compose up -d --build     # build + run in the background
docker compose logs -f           # → "⚡ Community Impact Agent is running (Socket Mode)"
docker compose down              # stop
```

Tasks persist in the named volume `agent-data` (mounted at `/app/data`), so they survive container restarts. Socket Mode only makes outbound connections, so no ports are exposed. Without compose: `docker build -t community-impact-agent . && docker run -d --env-file .env -v agent-data:/app/data community-impact-agent`.

## Demo walkthrough

1. Create a channel (e.g. `#community-help`) and **invite the bot** (`/invite @Community Impact Agent`).
2. Post a few test messages, e.g.:
   > We urgently need 3 volunteers to teach basic computer skills at the community centre this weekend — anyone able to help?

   > Looking for donations of winter clothes for the shelter drive, drop-off by Friday.
3. Trigger a scan: `@Community Impact Agent scan` (or `scan 48` for 48 hours back).
   - `/scan-requests` also works if the bot received a mention in the last ~2 minutes (RTS's `action_token` only arrives in mention/message events, never in slash command payloads).
4. For each detected request you get a card with title, category, urgency, requester, and permalink. Click **✅ Create Task**.
5. The native `task_card` appears with status **pending**. Click **▶️ Start** → *in_progress*, then **✔️ Complete** → *complete* (the message updates in place and posts a thank-you in the thread).
6. `/list-tasks` — see open tasks. `/daily-report` — post the AI-written impact report (set `IMPACT_CHANNEL=#impact-daily` in `.env` to route it to a dedicated channel the bot is in).
7. Bonus: open the bot's **AI assistant panel** (sparkle icon) and ask "What tasks are currently open?"

*Production notes:* a scheduled trigger (cron / Slack scheduled workflows) would automate the daily report; an MCP server (e.g. Airtable) could persist tasks externally — both deliberately out of scope for the MVP.

## Devpost description (~170 words)

> **Community Impact Agent — turning "can anyone help?" into help delivered.**
>
> Every community Slack has the same problem: requests for help — volunteers, donations, tutoring, support — scroll past and vanish. Community Impact Agent makes sure they don't.
>
> Mention the agent in any channel and it uses Slack's **Real-Time Search API** (`assistant.search.context`) to find recent help requests. **Slack AI-powered reasoning** (an LLM behind Slack's agent surface) turns each raw message into a structured request with a title, category (education, health, finance, environment) and urgency. One click converts a request into a live task rendered with Slack's native **`task_card`** block, tracked from *pending* to *in progress* to *complete* — right where the conversation happened, with a permalink back to the original ask.
>
> At day's end, `/daily-report` aggregates everything and posts a warm, AI-written impact summary: requests surfaced, tasks completed, categories served. Volunteers see their impact; organizers see what's still open.
>
> Built with Bolt for JavaScript, Socket Mode, and an open-source LLM — nothing lost, every request counted.

## 3-minute demo video script

| Time | Scene | Script / actions |
|------|-------|------------------|
| 0:00–0:20 | **Problem** | Screen: a busy community channel. "In community Slacks, requests for help scroll away and get forgotten. Community Impact Agent makes every request visible, trackable, and counted." |
| 0:20–1:30 | **Scan + summarize + create task** | Post two help messages. Type `@Community Impact Agent scan`. Narrate: "The mention hands the agent a Real-Time Search token — it searches the last 24 hours live via `assistant.search.context`, and AI structures each hit into a categorized, urgency-rated request card." Click **Create Task** on the volunteer request. "One click — and it becomes a native Slack task card." |
| 1:30–2:20 | **Status tracking** | Click **Start** — card flips to *in progress*. "Volunteers claim work right in the channel." Click **Complete** — card flips to *complete*, thank-you posts in thread. Run `/list-tasks` to show the remaining open task. |
| 2:20–3:00 | **Daily report + close** | Run `/daily-report`. "At the end of each day, the agent writes the community's impact story — requests found, tasks completed, categories served." Show the AI narrative. "Community Impact Agent: nothing lost, every request counted. Built on Slack's Real-Time Search and agent platform." |

## Architecture (text diagram)

```
[Community members]                                [Volunteer clicks buttons]
      | post help requests                                    |
      v                                                       v
[Slack channels] --@mention (carries action_token)--> [Bolt app, Socket Mode]
                                                        |         |        |
                    +-----------------------------------+         |        |
                    v                                             v        v
        [assistant.search.context]                    [Task store]   [Assistant panel]
         (Real-Time Search API)                      (JSON file)     (Slack AI surface)
                    |                                      ^
                    v                                      |
        [LLM — HF router / Ollama]                         |
         summarize -> {title, category,                    |
                       urgency, ...}                       |
                    |                                      |
                    v                                      |
        [Request cards w/ Create Task btn] --click--> [native task_card blocks]
                                                       pending -> in_progress -> complete
                                                           |
                                                           v
                                            [/daily-report -> LLM narrative]
                                                           |
                                                           v
                                                  [#impact-daily channel]
```

**Boxes**: Slack channels → Bolt app (Socket Mode) → Real-Time Search API → LLM (open-source) → Block Kit request cards → task_card tracker (JSON store) → daily report generator → #impact-daily.
**Key arrows**: the `@mention` arrow carries the RTS `action_token`; button clicks flow back through the Bolt app to `chat.update`.

## Project structure

```
app.js                      entry point (Socket Mode)
manifest.json               app manifest (scopes, commands, events, assistant)
listeners/                  Slack handlers (events, commands, actions, assistant)
services/rts.js             Real-Time Search wrapper + action_token cache
services/summarize.js       LLM extraction of structured requests
services/tasks.js           task CRUD (in-memory + data/tasks.json)
services/report.js          daily aggregation + AI narrative
blocks/                     Block Kit builders (request card, task_card, report)
```
