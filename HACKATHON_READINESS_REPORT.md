# Hackathon Readiness Report — Community Beacon

**Slack Agent Builder Challenge submission — Slack Agent for Good track.** This report is an honest self-assessment, not a sales pitch — see "Remaining limitations" and "Not yet done" before demo day.

## Architecture summary

Community Beacon is a Slack bot (Socket Mode, `@slack/bolt`) plus an independent MCP server, sharing one service layer:

- **Detection**: `services/intentEngine.js` classifies messages into 15 community-signal types (needs, offers, coordination) via an LLM, gated by a cheap keyword pre-filter. Every signal carries confidence, evidence, reasoning, and a recommended action.
- **Summarization**: `services/summaryService.js` produces coordinator-ready summaries (what happened / why it matters / community impact / people involved / next action).
- **Priority scoring**: `services/priorityScore.js` — deterministic, auditable 0–100 score with critical/high/routine tier; medical/urgent needs weighted highest.
- **Matching**: `services/matchService.js` — deterministic need↔offer matching, surfaced directly on the alert card. This is the feature that turns "a list of alerts" into "a system that connects people."
- **Persistence**: `services/signalStore.js`, file-backed (`data/signals.json`), atomic writes, status lifecycle, stats aggregation.
- **Case log**: `services/crm/` — provider abstraction with a fully functional Mock provider; HubSpot/Salesforce (Nonprofit Cloud) are stubs (no credentials were available).
- **Slack UX**: real-time message monitoring + retroactive `/cb-scan`, signal alert cards with 4 action buttons, `/cb-needs`, `/cb-impact`, an AI assistant panel, and an **App Home dashboard** (Slack-native, no separate web server).
- **MCP server**: `mcp/server.js`, 8 tools, runs as a separate stdio process.

Full diagram and design rationale: [ARCHITECTURE.md](ARCHITECTURE.md).

## Completed features

| Area | Status |
|---|---|
| Slack Platform (Bolt, Socket Mode, OAuth, env validation, manifest) | ✅ Done |
| Real-Time Search (thread history, mentions, non-RTS fallback) | ✅ Done |
| Community Signal Engine (15 signal types, confidence/evidence/reasoning/action) | ✅ Done |
| AI Coordinator Summaries | ✅ Done |
| Priority scoring (deterministic, critical/high/routine) | ✅ Done |
| Need ↔ offer matching (deterministic) | ✅ Done |
| MCP Server (8 tools, incl. `find_matches`) | ✅ Code complete — **not yet live-tested against real Slack** (see below) |
| Case-log integration (provider abstraction) | ✅ Mock fully working; HubSpot/Salesforce stubbed |
| Slack UX (Block Kit alert cards, 4 action buttons, match display) | ✅ Done |
| Dashboard | ✅ Done, as Slack-native App Home |
| Automated tests | ✅ 41/41 passing, `tsc --noEmit` clean |
| **Live deployment** | ❌ **Not done — no Slack app created yet, this is Phase 2** |
| **Demo video, architecture diagram export, text description for submission** | ❌ **Not done — this is Phase 3** |

**Verified working, not just "should work":**
- `npx tsc --noEmit` — clean, zero errors, across the whole repo.
- `npm test` — 41/41 unit tests passing (priorityScore, matchService, intentEngine's pure paths, signalStore, mock case log, search helpers, hours-parsing).

**Not yet verified (be upfront about this):**
- `npm start` against a real Slack workspace — the code pivot is complete and typechecks/tests clean, but no live Socket Mode connection has been established yet with a real `SLACK_BOT_TOKEN`/`SLACK_APP_TOKEN`. This is Phase 2 of the plan and needs a Slack app created at api.slack.com.
- `npm run mcp` end-to-end against a real LLM — same reason.
- The match-surfacing UX in a real Slack card (unit-tested via `matchService.test.js`, but not seen rendered live in Slack yet).

## Remaining limitations (be upfront about these in Q&A)

- **HubSpot and Salesforce are stubs.** They throw a clear "not configured" error rather than pretending to work.
- **Single-instance data store.** `data/signals.json` and `data/crm-mock.json` are plain JSON files with no concurrency control. Fine for a demo or single-instance deployment.
- **No rate limiting beyond the confidence gate.**
- **Matching is type-affinity, not semantic.** See `ARCHITECTURE.md`'s "Known limitations."
- **No integration/E2E test suite for the Slack listeners themselves** — only the pure-logic services have unit tests.
- **No monitoring/observability layer** beyond Bolt's built-in logger.

## What's left before this is submission-ready

In order:

1. **Create the Slack app** from `manifest.json` in a developer sandbox workspace, install it, collect `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN`.
2. **Get an LLM key** (free Hugging Face token, or local Ollama).
3. **Run `npm start`**, verify the live Socket Mode connection, and smoke-test the full loop: post a need message and an offer message, confirm cards post with correct priority + a surfaced match, click all four buttons, run all three slash commands, open App Home.
4. **Invite `slackhack@salesforce.com` and `testing@devpost.com`** to the sandbox.
5. **Write the text description** (features + the "Agent for Good" impact explanation — see README's "The impact case" section as a draft).
6. **Record the ~3-minute demo video** — script: App Home dashboard first (visual payoff) → post a need + an offer live, show real-time detection and the match surfacing → claim one with "I Can Help" → run `/cb-impact` → briefly show `mcp/server.js` tools as the platform angle.
7. **Export a visual architecture diagram** from `ARCHITECTURE.md`'s ASCII version.
8. **Submit via Devpost** with the sandbox URL, video, diagram, and description.

## Demo flow (for the judges, once Phase 2/3 are done)

1. Show the **App Home dashboard** first — immediate visual payoff, no setup narration needed.
2. Post 2 messages in a channel the bot is in: one need (e.g. a ride to a medical appointment), one offer (e.g. "happy to drive people Saturdays"). Let real-time monitoring catch them — a signal card appears within seconds, unprompted, and if they're compatible, each card should show the other as a **possible match**.
3. Click **I Can Help** on one card to show the claim loop; click **View Case History** to show the persistence layer.
4. Run `/cb-impact` to show the AI-written daily narrative.
5. Switch to a terminal, run `npm run mcp`, and call `detect_signals` → `score_priority` → `find_matches` live, to demonstrate the platform angle beyond just a Slack bot.
6. Mention the case-log provider abstraction and show `services/crm/salesforceProvider.js` briefly — "this is where Nonprofit Cloud credentials plug in, zero call-site changes."

## Recommended future improvements

1. Implement a real Salesforce Nonprofit Cloud provider once credentials are available.
2. Migrate `signalStore`/mock case log off plain JSON files to SQLite.
3. Add integration tests for the Slack listeners.
4. Add a scheduled trigger for `/cb-impact`.
5. Make matching semantic (embedding similarity) rather than pure type-affinity, so a "ride to a food bank" offer ranks above a generic transport offer for a food-insecurity need.
