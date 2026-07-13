# Demo Video Script — Community Beacon
### Slack Agent Builder Challenge (Devpost) — target runtime 3:00–3:10

**Structure:** Scope (0:00–0:35) → Architecture & workflow, shown on screen (0:35–1:15) → Business case (1:15–1:35) → Live Slack demo (1:35–2:50) → Close (2:50–3:05)

This is written to be *spoken*, not read — short sentences, natural pauses, contractions. Practice it out loud twice before recording; don't read it off a second monitor with your eyes visibly scanning left to right, judges notice.

Everything in the live-demo section is grounded in behavior you've actually verified running this session — nothing aspirational. Where a step needs the LLM to respond (5–15s of real latency), that's called out so you can talk through it instead of sitting in silence.

---

## Before you hit record — setup checklist

1. **Reset to a clean state**, so the numbers you show on camera are real and easy to narrate, not cluttered with test noise:
   ```bash
   echo '{"signals":[],"scans":[]}' > data/signals.json
   echo '{"activities":[],"followups":[]}' > data/crm-mock.json
   ```
   Restart the bot (`Ctrl+C`, then `npm start`) so it picks up the clean store.
2. **Close every tab except what's on screen.** You've got Devpost, job boards, Gmail, and Slack API docs open — none of that belongs in a recording. Keep only: the Slack workspace tab, the tab/app with your architecture diagram open, and a terminal.
3. **Dismiss the "Slack needs your permission to enable notifications" banner** at the bottom of the Slack window before you roll.
4. **Zoom to ~110–125%** and maximize the window so text reads clearly at video resolution.
5. **Recording tool:** Xbox Game Bar (`Win+G`) for screen+mic is fine; OBS if you want clean cuts between diagram/Slack/terminal.
6. **Do one full unrecorded dry run** first — this is where you'll discover LLM latency and find natural places to talk through it.
7. **Pre-arrange three windows**: your architecture diagram (full screen or zoomed so labels are legible — this is the visual for 0:35–1:15, have it open and ready before you hit record, not something you go find mid-take), Slack, and a terminal already `cd`'d into the project, ready to run `npm run mcp`. Alt-Tab between them — don't hunt for windows on camera.
8. **Rehearse the cursor moves in the Architecture beat below at least once** — the narration is timed to specific boxes in your diagram (Slack Workspace → Listeners → Reasoning Pipeline → Signal Store → Match Engine → back to Slack). Moving the mouse to the wrong box while talking is the single easiest thing to give away in this section, so walk through it silently once before recording it for real.

---

## 0:00–0:35 — Scope: what this is, and the problem it closes

**On screen:** Open the bot's **App Home** tab first, so a live dashboard is the first thing viewers see — no dead title slide.

**Say:**

> "This is Community Beacon — a Slack agent for mutual-aid groups and nonprofits, built for the Slack Agent Builder Challenge.
>
> Here's the actual problem it solves. Mutual-aid coordination happens almost entirely inside Slack — someone needs a ride to a dialysis appointment, someone can't afford groceries this week, someone else has a car seat to give away. All of it lands in one fast-scrolling channel with no memory and no way to connect a need to the person who could meet it. Volunteers burn out re-reading threads trying to remember who still needs help. And people in real need get missed — not because no one cares, but because their message didn't *sound* urgent. It just was.
>
> Community Beacon's scope is narrow and deliberate: detect these signals automatically, remember every one of them, match needs to offers with a confidence score instead of a guess, and escalate anything nobody's responded to. All without leaving Slack."

---

## 0:35–1:15 — Architecture & workflow (shown on screen)

**On screen:** Cut to your full architecture diagram, zoomed so every box label is readable. **Move your cursor to each box as you name it, in this exact order** — the narration below is written to match the diagram's actual layout and arrows, left-to-right, so don't free-narrate off it; follow the sequence:

1. Point at **Slack Workspace** (right-hand icon) — trace the outer line back around to **Listeners**, bottom-left.
2. Point at **Listeners**, then **MCP Server** just above it.
3. Move up into the **Reasoning Pipeline** box: **Intent Engine** → arrow to **LLM Endpoint**.
4. Still inside the pipeline box: **Workspace Context**.
5. Down to **Signal Store** (the cylinder in the middle).
6. Right, into **Match Engine**: **Match Service** → arrow to **Match Decision**.
7. Trace the line from Match Decision back out to **Slack Workspace** on the right.
8. Quick point at **Case Log** (Mock Store / CRM Provider) and **Analytics** at the bottom, and **Escalation Scheduler** in the Community Beacon Bot box — call these out as the side effects, don't dwell.

**Say (timed to the points above):**

> "Here's how it actually works under the hood — and I want to show this, not just claim it, because this exact diagram is what we built against.
>
> A message lands in Slack — that's this line, coming in on the left. It hits **Listeners**, our event handler, and separately, the exact same pipeline is reachable through an **MCP Server**, so anything that works from Slack also works from any MCP client, no Slack event required.
>
> Both feed into the **Reasoning Pipeline**. First, **Intent Engine** — that's an LLM call — classifies the message against fifteen signal types: needs like transport, food insecurity, medical, housing; offers like volunteering or donations.
>
> Then **Workspace Context** — this is the part most bots skip. Before anything gets decided, it checks the **Signal Store** — has this person asked before? Has this channel seen this need repeatedly this month? Is an identical request still sitting open?
>
> That history and the new message both go into **Summary Service**, which reasons over them together and writes the coordinator explanation — not just *what* was said, *why* it matters.
>
> Everything gets written to the **Signal Store**, which feeds the **Match Engine**: **Match Service** generates candidates, **Match Decision** scores them — text similarity, location, priority, track record — and branches three ways: high confidence auto-recommends, medium asks a human to approve, low is honest it doesn't know yet and posts outreach instead of guessing.
>
> That decision is what posts back out to Slack, closing the loop. Alongside it, every signal is written to a **Case Log** — pluggable into a real CRM — rolled into **Analytics** for the dashboard, and watched by an **Escalation Scheduler** that follows up on anything left unanswered too long.
>
> No servers, no exposed ports — this all runs inside Slack's Socket Mode, or standalone through MCP."

---

## 1:15–1:35 — Business case

**On screen:** Back to the App Home dashboard, or a wide shot of the channel.

**Say:**

> "Why does this matter as a product, not just a demo? Every nonprofit and mutual-aid group runs this exact workflow manually today — a volunteer coordinator scrolling a channel, holding all of this in their head. That doesn't scale past one small group, and it burns out the people doing it.
>
> Community Beacon turns that manual triage into a system of record: zero new infrastructure to stand up, since it lives entirely inside Slack, and a case-log layer that's already wired for Salesforce Nonprofit Cloud and HubSpot — so an org's existing CRM isn't replaced, it's fed. That's the difference between a clever demo and something an org could actually adopt next week."

---

## 1:35–2:50 — Live Slack demo

### Beat 1 — the dashboard is real (1:35–1:45, 10s)

**On screen:** Point your cursor at the App Home stats as you name them.

**Say:**
> "This dashboard is live, not a mockup — signal counts, response times by priority tier, confirmed matches, all updating as the workspace gets used."

### Beat 2 — post a need, then a matching offer (1:45–2:15, ~30s)

**On screen:** Switch to `#community-alerts`. Type and send:
```
I urgently need a ride to the hospital right now for a family emergency, please help
```
Wait for the card (narrate through the 5–10s LLM latency, don't sit in silence). Then send:
```
I have some grocery gift cards and canned food to donate — happy to help anyone struggling with groceries until payday
```

**Say (while waiting / as cards land):**
> "Watch — I'll post an urgent need... and it's caught in real time: type, priority, confidence, and the reasoning behind it. Now an offer..."

> *(If it lands MEDIUM):* "...and here's a medium-confidence match, with Approve and Reject buttons. That's not a guess — it's a weighted score across similarity, location, priority, and track record, asking a human to confirm because it isn't fully sure."

> *(If it lands LOW instead):* "...and here — it's honest that it doesn't have a confident match yet, so it posts outreach to volunteers instead of forcing one. That honesty is the point."

### Beat 3 — approve the match + the audit trail (2:15–2:30, 15s)

**On screen:** Click **Approve Match**, point out the status changing. Click **View Timeline**.

**Say:**
> "I'll approve it — the status updates immediately so no one double-confirms the same signal. And here's the full timeline: detected, history searched, context enriched, match decided, resolved. A complete audit trail for every decision."

### Beat 4 — retroactive scan + impact report (2:30–2:45, 15s)

**On screen:** Run `/cb-scan`, then `/cb-impact`.

**Say:**
> "I can retroactively scan a channel's history without creating duplicates for anything already caught — and `/cb-impact` gives a coordinator an AI-written report on demand: signals found, matches confirmed, hours saved."

### Beat 5 — the platform angle (2:45–2:50, 5s)

**On screen:** Alt-tab to the terminal, run `npm run mcp`.

**Say:**
> "And because this is also an MCP server, the same intelligence is available to any MCP client — this is a platform, not just a bot."

---

## 2:50–3:05 — Close

**On screen:** Cut back to the App Home dashboard or a wide shot of the resolved card.

**Say:**
> "Every request answered, every pattern remembered, every match explainable. Community Beacon — a Slack agent for good."

---

## After recording

1. **Trim dead air** from LLM waits if it drags — a 2–3 second cut is invisible but keeps pacing tight.
2. **Check total runtime is at or under the Devpost limit** for this challenge — confirm on the submission page, since limits vary by hackathon.
3. **Export at 1080p**, upload to YouTube (unlisted) or Vimeo for a stable link.
4. **Paste the link into Devpost's "Video demo link" field.**
5. Optional: pull 2–3 screenshots from the recording (dashboard, match card, timeline) for Devpost's image gallery.

---

## If something doesn't go to plan live

- **Detection takes longer than ~15s:** normal LLM latency, not a bug — keep talking, or cut the wait in editing.
- **A message lands on a different confidence branch than expected:** use the alternate line in Beat 2 — it's an equally strong, equally honest beat.
- **A slash command posts as plain text instead of executing:** stop, reinstall the app from the Slack API dashboard, and restart the recording rather than showing a broken command on camera.
