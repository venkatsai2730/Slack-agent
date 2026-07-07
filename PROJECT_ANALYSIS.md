# Project Analysis — Community Impact Agent

> **⚠️ Historical document.** The project pivoted to **Growth Beacon** (see `README.md`, `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`, `CHANGELOG.md`). This file describes the pre-pivot codebase and is kept only as a record of the reusable scaffolding decisions carried forward. It does not describe the current application.

## 1. What this project is

A Slack bot (built for the "Slack Agent Builder Challenge — Slack Agent for Good" track) that:

1. **Discovers** help requests in a channel using Slack's Real-Time Search API (`assistant.search.context`).
2. **Summarizes** each candidate message with an LLM into a structured request (`title`, `description`, `category`, `urgency`).
3. **Tracks** each request as a task rendered with Slack's native `task_card` block, moved through `pending → in_progress → complete`.
4. **Reports** a daily, AI-written impact narrative via `/daily-report`.

It runs as a single long-lived Node.js process connected to Slack over **Socket Mode** (outbound WebSocket only — no inbound HTTP server, no public URL needed).

## 2. Tech stack

| Concern | Choice |
|---|---|
| Slack SDK | `@slack/bolt` v4 (Socket Mode, `Assistant` class for the AI side-panel surface) |
| LLM client | `openai` SDK v4, pointed at any OpenAI-compatible endpoint |
| Default LLM backend | Hugging Face Inference Router (`meta-llama/Llama-3.1-8B-Instruct`), free tier |
| Alternate LLM backend | Local Ollama (commented out in `.env.sample`) |
| Persistence | Flat JSON file (`data/tasks.json`), loaded into memory at startup, write-through on every mutation |
| Runtime | Node.js ≥ 18 |
| Deployment | Bare `node app.js`, or Docker (`node:22-alpine`, non-root `node` user, named volume for `/app/data`) |

No database, no web framework, no test suite, no CI config exist in this repo.

## 3. Entry point & startup flow (`app.js`)

1. Loads `.env` via `dotenv`.
2. Hard-fails (`process.exit(1)`) if `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, or `LLM_API_KEY` are missing.
3. Constructs a Bolt `App` in Socket Mode.
4. Calls `registerListeners(app)` (`listeners/index.js`), which wires up every event/command/action/assistant handler.
5. Starts the app and logs `⚡ Community Impact Agent is running (Socket Mode)`.

## 4. Module map

```
app.js                          entry point
manifest.json                   Slack app manifest (scopes, slash commands, events, assistant config)
listeners/
  index.js                      registers all handlers
  events/app-mention.js         @mention handler — the primary "scan" trigger
  events/message.js             passive listener, only used to cache RTS action_token
  commands/scan-requests.js     /scan-requests slash command
  commands/list-tasks.js        /list-tasks slash command
  commands/daily-report.js      /daily-report slash command
  actions/task-actions.js       button handlers: create_task, task_start, task_complete
  assistant.js                  Slack "AI assistant" side-panel surface (chat-style Q&A)
services/
  rts.js                        Real-Time Search wrapper + action_token cache
  summarize.js                  LLM prompt/parsing: raw message -> structured request
  scan.js                       shared pipeline: RTS search -> summarize -> post cards
  tasks.js                      task CRUD + stats, backed by data/tasks.json
  report.js                     daily stats aggregation + LLM narrative
  llm.js                        thin OpenAI-compatible chat completion wrapper + JSON extraction helper
blocks/
  request-card.js               Block Kit for a discovered help request (+ Create Task button)
  task-card.js                  native `task_card` block (with Block Kit fallback) + status buttons
  report-blocks.js              Block Kit for the daily report message
data/                           created at runtime; tasks.json lives here (gitignored)
```

## 5. Core workflows

### 5.1 Discover + summarize (`@mention` → `services/scan.js`)

- `app_mention` event fires → `rts.extractActionToken()` pulls `action_token` from the event payload → cached for 2 minutes (`rts.js`, `MAX_TOKEN_AGE_MS`).
- Text is matched against `/scan(?:\s+(\d{1,3}))?/i` to extract an optional hours-back value (capped at 168h / 7 days).
- `runScan()`:
  1. Posts a "🔎 Scanning..." status message.
  2. Calls `assistant.search.context` via `rts.searchRecentMessages()` with a fixed query (`help OR need OR "looking for" OR volunteer OR donate OR urgent OR support`), filtered to the current channel and non-bot authors.
  3. Drops the bot's own messages and anything containing the literal word "scan" (avoids re-ingesting its own trigger).
  4. Caps candidates at 5 (`MAX_REQUESTS_PER_SCAN`) to keep demo latency low.
  5. Sends each candidate to `summarizeAsRequest()` (LLM call with a strict JSON-only system prompt); non-requests are dropped (`is_request: false`).
  6. Logs the scan (`tasks.logScan`) and posts one Block Kit card per request, each with a "✅ Create Task" button whose `value` is the entire serialized request JSON.

### 5.2 Real-Time Search token quirk (`services/rts.js`)

This is the most important non-obvious design constraint in the codebase:

- `assistant.search.context` **requires** a short-lived `action_token` when called with a bot token.
- Slack **only** includes this token in `app_mention` / `message` event payloads — **never** in slash command payloads.
- Workaround: every `app_mention` and `message` event opportunistically caches the freshest token (2-minute TTL). `/scan-requests` reuses that cached token if one is still fresh; otherwise it replies asking the user to `@mention` the bot first.
- This means **`/scan-requests` run cold (no prior mention) will always fail** with an ephemeral warning — this is expected behavior, not a bug, but it's a common first-run surprise (came up earlier in this session).

### 5.3 Task lifecycle (`listeners/actions/task-actions.js`, `services/tasks.js`)

- **Create**: clicking "Create Task" parses the button's `value` (the original request JSON) → `tasks.createTask()` → posts a `task_card` block (falls back to plain Block Kit sections if the surface rejects `task_card` — handled via catching `invalid_blocks`) → replaces the original request card's button with a "✅ Task created by @user" line.
- **Start / Complete**: `task_start` and `task_complete` actions call `tasks.updateStatus()` and `chat.update` the existing task message in place. Completing a task also posts a threaded "🎉 ... thank you!" message.
- **Persistence caveat**: tasks live in an in-memory array, write-through to `data/tasks.json`. If the process restarts, the array reloads from disk, but any task message whose Slack `ts`/channel isn't re-derivable is otherwise fine (the store only holds task state, not Slack message refs) — however, button clicks reference `task_id` values baked into old messages, so a task created before a restart still resolves correctly as long as `data/tasks.json` survived (Docker volume, or same host).

### 5.4 Daily report (`/daily-report` → `services/report.js`)

- Aggregates `tasks.statsForToday()` (requests found, tasks created/completed, open count, breakdown by category — all computed by comparing ISO date strings to "today").
- Sends stats as JSON to the LLM with a prompt asking for 3–4 warm sentences, no headings/emojis.
- Falls back to a canned narrative string if the LLM call fails or returns empty.
- Posts to `IMPACT_CHANNEL` env var if set; if that fails (bot not in channel, bad name), logs a warning and falls back to posting in the current channel instead — the demo is designed to never hard-fail here.

### 5.5 Assistant side-panel (`listeners/assistant.js`)

- Registers a Bolt `Assistant` surface (the Slack "AI apps" side panel).
- On thread start: greets the user and sets two suggested prompts.
- On each user message: caches any action_token found, builds a short context string from currently open tasks, and asks the LLM to answer conversationally (system prompt constrains it to a friendly 2–4 sentence assistant that explains the bot's features).

## 6. Data model (`data/tasks.json`)

```json
{
  "tasks": [
    {
      "task_id": "task_<timestamp>_<counter>",
      "title": "string",
      "details": "string",
      "status": "pending | in_progress | complete",
      "assignee": "slack_user_id | null",
      "category": "education | health | finance | environment | other",
      "urgency": "low | medium | high",
      "source_request": { "requester": "string", "permalink": "string" },
      "created_at": "ISO 8601",
      "completed_at": "ISO 8601 | null"
    }
  ],
  "scans": [
    { "at": "ISO 8601", "requests_found": 0 }
  ]
}
```

No schema migrations, no validation beyond category/urgency whitelist checks in `summarize.js`.

## 7. Configuration (`.env`)

| Var | Required | Purpose |
|---|---|---|
| `SLACK_BOT_TOKEN` | yes | `xoxb-...` bot token |
| `SLACK_APP_TOKEN` | yes | `xapp-...` app-level token (Socket Mode, needs `connections:write`) |
| `LLM_API_KEY` | yes | API key for the OpenAI-compatible LLM endpoint |
| `LLM_BASE_URL` | no | defaults to Hugging Face router |
| `LLM_MODEL` | no | defaults to `meta-llama/Llama-3.1-8B-Instruct` |
| `IMPACT_CHANNEL` | no | target channel for `/daily-report`; falls back to current channel |

## 8. Known limitations / risks (as observed in code, not hypothetical)

- **In-memory + single JSON file store**: no concurrency control, no multi-instance support, data loss risk if the file write is interrupted mid-write (no atomic rename).
- **No automated daily report trigger**: `/daily-report` is manual-only; the README explicitly notes a scheduled trigger is "out of scope for the MVP."
- **RTS token dependency**: any workflow that needs a fresh scan without a preceding mention (e.g. a cron-triggered scan) cannot work today, since only mention/message events carry the token.
- **No tests**: zero automated test coverage (`package.json` has no `test` script).
- **Secrets hygiene (resolved this session)**: `.env.sample` previously contained real, working Slack and Hugging Face tokens instead of placeholders; it has been sanitized to placeholders and a local `.env` (gitignored) was created from the original values. **The original tokens should still be rotated**, since they were present in a tracked file in git history.
- **LLM output trust**: `extractJson()` in `llm.js` does a naive first-`{`-to-last-`}` slice with a `try/catch` fallback — reasonable for small open models that wrap JSON in prose, but offers no schema validation beyond category/urgency whitelists.
