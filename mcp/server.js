#!/usr/bin/env node
// Community Beacon MCP server — exposes the community-impact pipeline as MCP
// tools over stdio, independent of the Slack Bolt process (app.js). Launch with
// `npm run mcp`. Intended for use from an MCP-compatible client (e.g. Claude
// Desktop, or any MCP client configured to spawn this process).
//
// Design note: this process never receives Slack events, so it never has a
// fresh Real-Time Search action_token. search_messages therefore always uses
// services/searchService.js's conversations.history fallback rather than RTS.
//
// Every tool's handler logic lives in a standalone exported `handle*`
// function so it can be both registered with the SDK and unit-tested
// directly (test/mcpTools.test.js) without spinning up a stdio transport.

require('dotenv').config();
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { WebClient } = require('@slack/web-api');
const { z } = require('zod');

const searchService = require('../services/searchService');
const intentEngine = require('../services/intentEngine');
const summaryService = require('../services/summaryService');
const priorityScore = require('../services/priorityScore');
const matchService = require('../services/matchService');
const matchDecision = require('../services/matchDecision');
const signalStore = require('../services/signalStore');
const crm = require('../services/crm');
const workspaceContext = require('../services/workspaceContext');
const analyticsService = require('../services/analytics');
const telemetry = require('../services/telemetry');

function getSlackClient() {
  if (!process.env.SLACK_BOT_TOKEN) {
    throw new Error('SLACK_BOT_TOKEN is not set — this tool needs a Slack bot token to call the Slack API.');
  }
  return new WebClient(process.env.SLACK_BOT_TOKEN);
}

/**
 * @param {unknown} payload
 * @returns {{ content: { type: 'text', text: string }[] }}
 */
function textResult(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

/**
 * @param {Error} err
 * @returns {{ content: { type: 'text', text: string }[], isError: true }}
 */
function errorResult(err) {
  return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
}

/** Projects a Signal down to the compact shape MCP tool responses use. */
function toSummary(s) {
  return {
    signal_id: s.signal_id,
    primary_type: s.primary_type,
    created_at: s.created_at,
    status: s.status,
    channel_id: s.message?.channel_id || 'unknown',
    author_name: s.message?.author_name || s.message?.author_user_id || 'unknown',
    permalink: s.message?.permalink || '',
    what_happened: s.summary?.what_happened || '',
  };
}

/** Wraps a tool handler with duration/outcome telemetry (Feature 9). */
function instrumented(toolName, fn) {
  return (args) => telemetry.time(`mcp_tool:${toolName}`, () => fn(args), { tool: toolName });
}

// --- Handlers (each also registered as an MCP tool below) -----------------

async function handleSummarizeThread({ channel, thread_ts }) {
  try {
    const client = getSlackClient();
    const messages = await searchService.getThreadContext(client, { channelId: channel, threadTs: thread_ts });
    if (!messages.length) return textResult({ messages_count: 0, signals: [], summary: null });

    const [latest, ...earlier] = [...messages].reverse();
    const threadContext = earlier.reverse().map((m) => m.text).join('\n');
    const signals = await intentEngine.detectSignals(latest.text, { threadContext });
    const summary = await summaryService.summarizeConversation({ text: latest.text, threadContext, signals });
    return textResult({ messages_count: messages.length, signals, summary });
  } catch (err) {
    return errorResult(err);
  }
}

async function handleSearchMessages({ channel, hours_back, query }) {
  try {
    const client = getSlackClient();
    const messages = await searchService.searchChannelHistoryFallback(client, { channelId: channel, hoursBack: hours_back, query });
    return textResult({ count: messages.length, messages });
  } catch (err) {
    return errorResult(err);
  }
}

async function handleDetectSignals({ text, thread_context }) {
  try {
    const signals = await intentEngine.detectSignals(text, { threadContext: thread_context || '' });
    return textResult({ signals });
  } catch (err) {
    return errorResult(err);
  }
}

/** @param {{ text?: string, signals?: { type: string, confidence?: number }[] }} args */
async function handleScorePriority({ text, signals }) {
  try {
    /** @type {{ type: string, confidence?: number }[]} */
    let resolvedSignals = [];
    if (signals && signals.length) {
      // zod's inferred shape marks `type` optional here even though the schema
      // requires it (z.object({ type: z.string(), ... })) — runtime is guaranteed
      // by zod validation before this handler runs, so this is a type-only cast.
      resolvedSignals = signals.map((s) => ({ type: /** @type {string} */ (s.type), confidence: s.confidence }));
    } else if (text) {
      resolvedSignals = await intentEngine.detectSignals(text);
    }

    const result = priorityScore.scorePriority(resolvedSignals);
    return textResult({ ...result, signals_used: resolvedSignals });
  } catch (err) {
    return errorResult(err);
  }
}

/** @param {{ text: string, channel?: string, ts?: string, author?: string, permalink?: string }} args */
async function handleLogCase({ text, channel, ts, author, permalink }) {
  try {
    const signals = await intentEngine.detectSignals(text);
    // Only pass a live client when a real channel is given — workspaceContext's
    // RTS/history search needs a valid channel ID, and passing one for the
    // 'unknown' placeholder channel would just log a spurious API error on
    // every call. This is what actually lets the MCP log_case path benefit
    // from the same live-search enrichment the Slack pipeline gets (Feature 1),
    // rather than falling back to structured-history-only silently.
    let client;
    if (channel) {
      try {
        client = getSlackClient();
      } catch {
        client = undefined;
      }
    }
    const history = await workspaceContext.buildContext({
      channelId: channel || 'unknown',
      authorId: author || 'unknown',
      primaryType: signalStore.pickPrimaryType(signals),
      text,
    }, { client });
    const summary = await summaryService.summarizeConversation({ text, signals, history });
    const signal = signalStore.createSignal({
      types: signals,
      summary,
      message: {
        channel_id: channel || 'unknown',
        ts: ts || String(Date.now() / 1000),
        permalink: permalink || '',
        author_user_id: author || 'unknown',
        author_name: author || 'unknown',
        text,
      },
    });
    const { recordId } = await crm.getProvider().logSignal(signal);
    signalStore.markCrmLogged(signal.signal_id, recordId);

    // Feature 3: run the same candidate-generation + confidence-branching a
    // Slack-detected signal gets, so a signal logged via MCP isn't left
    // without a match decision — only find_matches() (candidates, no branch)
    // was available here before.
    const candidates = matchService.findMatches(signal);
    const decision = matchDecision.decide(signal, candidates);
    const matchRecommendation = matchDecision.toMatchRecommendation(decision);
    signalStore.updateSignal(signal.signal_id, { decision_branch: decision.branch, match_recommendation: matchRecommendation });
    signalStore.recordTimelineEvent(
      signal.signal_id,
      'match_decision',
      `${decision.branch.toUpperCase()} confidence (${Math.round(decision.confidence * 100)}%): ${decision.explanation}`
    );

    return textResult({
      signal_id: signal.signal_id,
      case_record_id: recordId,
      signals,
      match_decision: { branch: decision.branch, confidence: decision.confidence, explanation: decision.explanation, candidate: matchRecommendation.candidate },
    });
  } catch (err) {
    return errorResult(err);
  }
}

async function handleFindMatches({ signal_id, limit }) {
  try {
    const signal = signalStore.getSignal(signal_id);
    if (!signal) throw new Error(`No signal found with signal_id "${signal_id}".`);
    const matches = matchService.findMatches(signal, { limit }).map(toSummary);
    return textResult({ count: matches.length, matches });
  } catch (err) {
    return errorResult(err);
  }
}

async function handleCreateFollowup({ signal_id, owner }) {
  try {
    const signal = signalStore.getSignal(signal_id);
    if (!signal) throw new Error(`No signal found with signal_id "${signal_id}".`);
    const { followupId } = await crm.getProvider().createFollowup(signal, owner);
    if (owner) signalStore.assignOwner(signal_id, owner);
    return textResult({ followup_id: followupId });
  } catch (err) {
    return errorResult(err);
  }
}

async function handleGetConstituentContext({ identifier }) {
  try {
    const crmContext = await crm.getProvider().getConstituentContext(identifier);
    const workspaceHistory = workspaceContext.getRequesterHistoryByIdentifier(identifier);
    if (!crmContext && !workspaceHistory.is_repeat) return textResult({ found: false, identifier });
    return textResult({ found: true, identifier, crm: crmContext || null, workspace_history: workspaceHistory });
  } catch (err) {
    return errorResult(err);
  }
}

// --- Feature 6: new workspace-history / analytics tools --------------------

/** @param {{ channel?: string, query?: string, hours_back?: number }} args */
async function handleSearchWorkspaceHistory({ channel, query, hours_back }) {
  try {
    const cacheKey = `mcp:search_workspace_history:${channel || 'all'}:${query || ''}:${hours_back}`;
    const { value, cached } = await workspaceContext.withCache(cacheKey, 60_000, async () => {
      let liveMessages = [];
      if (channel) {
        const client = getSlackClient();
        liveMessages = await searchService.searchChannelHistoryFallback(client, { channelId: channel, hoursBack: hours_back, query });
      }
      const q = (query || '').toLowerCase();
      const structured = signalStore
        .listAll()
        .filter((s) => {
          if (channel && s.message?.channel_id !== channel) return false;
          if (!q) return true;
          return s.primary_type.includes(q) || (s.summary?.what_happened || '').toLowerCase().includes(q) || (s.message?.text || '').toLowerCase().includes(q);
        })
        .slice(0, 20)
        .map(toSummary);
      return { liveMessages, structured };
    });
    return textResult({ live_messages: value.liveMessages, structured_signals: value.structured, cached });
  } catch (err) {
    return errorResult(err);
  }
}

/** @param {{ channel?: string }} args */
async function handleGetLocationPatterns({ channel }) {
  try {
    if (channel) return textResult(workspaceContext.getChannelTrends(channel));
    return textResult({ district_heatmap: analyticsService.districtHeatmap() });
  } catch (err) {
    return errorResult(err);
  }
}

async function handleGetRepeatRequesters({ limit }) {
  try {
    return textResult({ requesters: workspaceContext.getRepeatRequesters({ limit }) });
  } catch (err) {
    return errorResult(err);
  }
}

async function handleGetRepeatVolunteers({ limit }) {
  try {
    return textResult({ volunteers: workspaceContext.getRepeatVolunteers({ limit }) });
  } catch (err) {
    return errorResult(err);
  }
}

async function handleGetUnresolvedSimilar({ signal_id, limit }) {
  try {
    const signal = signalStore.getSignal(signal_id);
    if (!signal) throw new Error(`No signal found with signal_id "${signal_id}".`);
    return textResult({ similar: workspaceContext.getUnresolvedSimilar(signal, { limit }) });
  } catch (err) {
    return errorResult(err);
  }
}

async function handleGetRecentMatches({ limit }) {
  try {
    return textResult({ matches: workspaceContext.getRecentConfirmedMatches({ limit }) });
  } catch (err) {
    return errorResult(err);
  }
}

async function handleGetSuccessfulOutcomes({ limit }) {
  try {
    return textResult({ outcomes: workspaceContext.getSuccessfulOutcomes({ limit }) });
  } catch (err) {
    return errorResult(err);
  }
}

/** @param {{}} [_args] the SDK always calls handlers with an args object, even for an empty inputSchema */
async function handleGetPriorityStatistics(_args) {
  try {
    return textResult({ ...workspaceContext.getPriorityStatistics(), confidence_distribution: analyticsService.confidenceDistribution() });
  } catch (err) {
    return errorResult(err);
  }
}

/** @param {{ identifier?: string }} args */
async function handleSummarizeWorkspaceContext({ identifier }) {
  try {
    const analytics = analyticsService.buildAnalytics();
    const requester = identifier ? workspaceContext.getRequesterHistoryByIdentifier(identifier) : null;
    return textResult({ requester, analytics });
  } catch (err) {
    return errorResult(err);
  }
}

// --- Server wiring -----------------------------------------------------

const server = new McpServer({ name: 'community-beacon', version: '1.0.0' });

server.registerTool(
  'summarize_thread',
  {
    title: 'Summarize Thread',
    description: 'Fetches a Slack thread and returns detected community signals plus a coordinator-ready summary.',
    inputSchema: {
      channel: z.string().describe('Slack channel ID'),
      thread_ts: z.string().describe('Timestamp (ts) of the thread parent message'),
    },
  },
  instrumented('summarize_thread', handleSummarizeThread)
);

server.registerTool(
  'search_messages',
  {
    title: 'Search Messages',
    description: 'Searches a Slack channel for community-signal language (help requests, offers, urgent needs) over a lookback window.',
    inputSchema: {
      channel: z.string().describe('Slack channel ID'),
      hours_back: z.number().int().positive().max(168).default(24).describe('How many hours back to search (max 168)'),
      query: z.string().optional().describe('Override the default community-signal search query'),
    },
  },
  instrumented('search_messages', handleSearchMessages)
);

server.registerTool(
  'detect_signals',
  {
    title: 'Detect Community Signals',
    description: 'Classifies a message (and optional thread context) into community signals — needs, offers, coordination — with confidence, evidence, and reasoning.',
    inputSchema: {
      text: z.string().describe('The message text to analyze'),
      thread_context: z.string().optional().describe('Earlier thread messages for additional context'),
    },
  },
  instrumented('detect_signals', handleDetectSignals)
);

server.registerTool(
  'score_priority',
  {
    title: 'Score Priority',
    description: 'Computes a 0-100 priority score and critical/high/routine tier from detected signals (or from raw text, which is analyzed first). Deterministic and auditable — decides which need gets looked at first.',
    inputSchema: {
      text: z.string().optional().describe('Raw message text to analyze first, if signals are not already known'),
      signals: z
        .array(z.object({ type: z.string(), confidence: z.number() }))
        .optional()
        .describe('Previously detected signals, if already known'),
    },
  },
  instrumented('score_priority', handleScorePriority)
);

server.registerTool(
  'log_case',
  {
    title: 'Log Case',
    description: 'Detects community signals in a message, enriches with workspace history, summarizes it, persists it as a Community Beacon signal, runs the confidence-based match decision engine (HIGH/MEDIUM/LOW), and logs it to the configured case-management (CRM) provider.',
    inputSchema: {
      text: z.string().describe('The message text to log'),
      channel: z.string().optional().describe('Slack channel ID the message came from'),
      ts: z.string().optional().describe('Slack message timestamp'),
      author: z.string().optional().describe('Community member / author display name'),
      permalink: z.string().optional().describe('Permalink back to the original Slack message'),
    },
  },
  instrumented('log_case', handleLogCase)
);

server.registerTool(
  'find_matches',
  {
    title: 'Find Matches',
    description: 'For a previously logged signal, finds complementary open signals: open needs an offer of help could satisfy, or unclaimed offers that could meet a need. Deterministic type-affinity matching, ranked by priority.',
    inputSchema: {
      signal_id: z.string().describe('The signal_id returned by log_case or listed by the Slack bot'),
      limit: z.number().int().positive().max(10).default(3).describe('Maximum number of matches to return'),
    },
  },
  instrumented('find_matches', handleFindMatches)
);

server.registerTool(
  'create_followup',
  {
    title: 'Create Followup',
    description: 'Creates a case-log follow-up task for a previously logged Community Beacon signal.',
    inputSchema: {
      signal_id: z.string().describe('The signal_id returned by log_case or search results'),
      owner: z.string().optional().describe('Slack user ID or name to assign the follow-up to'),
    },
  },
  instrumented('create_followup', handleCreateFollowup)
);

server.registerTool(
  'get_constituent_context',
  {
    title: 'Get Constituent Context',
    description: 'Retrieves prior case-log activity, follow-ups, and workspace signal history for a community member (name, Slack user ID, or email) — "has this neighbor asked for help before, and who helped last time?"',
    inputSchema: {
      identifier: z.string().describe('Member name, Slack user ID, or email'),
    },
  },
  instrumented('get_constituent_context', handleGetConstituentContext)
);

server.registerTool(
  'search_workspace_history',
  {
    title: 'Search Workspace History',
    description:
      'Searches both live Slack message history (when a channel is given) and the persisted signal store for prior related activity — the core Feature 1 lookup combining Real-Time Search with structured workspace memory.',
    inputSchema: {
      channel: z.string().optional().describe('Slack channel ID to scope the live search to; omit to search structured history workspace-wide'),
      query: z.string().optional().describe('Keyword(s) to filter by (matched against signal type, summary, and message text)'),
      hours_back: z.number().int().positive().max(720).default(168).describe('How many hours back to search live messages (max 720 = 30 days)'),
    },
  },
  instrumented('search_workspace_history', handleSearchWorkspaceHistory)
);

server.registerTool(
  'get_location_patterns',
  {
    title: 'Get Location Patterns',
    description: 'Signal-volume trends for a channel (channel-as-district proxy), or the full workspace-wide demand heatmap by channel if no channel is given.',
    inputSchema: { channel: z.string().optional().describe('Slack channel ID; omit for the workspace-wide heatmap') },
  },
  instrumented('get_location_patterns', handleGetLocationPatterns)
);

server.registerTool(
  'get_repeat_requesters',
  {
    title: 'Get Repeat Requesters',
    description: 'Community members who have logged more than one need signal — candidates for a recurring-need intervention rather than a one-off match.',
    inputSchema: { limit: z.number().int().positive().max(50).default(5) },
  },
  instrumented('get_repeat_requesters', handleGetRepeatRequesters)
);

server.registerTool(
  'get_repeat_volunteers',
  {
    title: 'Get Repeat Volunteers',
    description: 'Volunteers with one or more confirmed completed matches, ranked by completed-match count — the pool to recommend for new matches.',
    inputSchema: { limit: z.number().int().positive().max(50).default(5) },
  },
  instrumented('get_repeat_volunteers', handleGetRepeatVolunteers)
);

server.registerTool(
  'get_unresolved_similar',
  {
    title: 'Get Unresolved Similar Signals',
    description: 'For a given signal, finds open or claimed-but-unresolved signals of the same type elsewhere in the workspace.',
    inputSchema: {
      signal_id: z.string().describe('The signal_id to find similar unresolved signals for'),
      limit: z.number().int().positive().max(50).default(10),
    },
  },
  instrumented('get_unresolved_similar', handleGetUnresolvedSimilar)
);

server.registerTool(
  'get_recent_matches',
  {
    title: 'Get Recent Matches',
    description: 'The most recently confirmed need <-> offer matches, most recent first.',
    inputSchema: { limit: z.number().int().positive().max(50).default(10) },
  },
  instrumented('get_recent_matches', handleGetRecentMatches)
);

server.registerTool(
  'get_successful_outcomes',
  {
    title: 'Get Successful Outcomes',
    description: 'Confirmed matches framed as impact outcomes — what got resolved, for whom, and by which volunteer.',
    inputSchema: { limit: z.number().int().positive().max(50).default(10) },
  },
  instrumented('get_successful_outcomes', handleGetSuccessfulOutcomes)
);

server.registerTool(
  'get_priority_statistics',
  {
    title: 'Get Priority Statistics',
    description: 'Workspace-wide breakdown of signals by priority tier (critical/high/routine) and by match-decision confidence branch (HIGH/MEDIUM/LOW).',
    inputSchema: {},
  },
  instrumented('get_priority_statistics', handleGetPriorityStatistics)
);

server.registerTool(
  'summarize_workspace_context',
  {
    title: 'Summarize Workspace Context',
    description:
      'The full Feature 1/7 context bundle: workspace-wide impact analytics, plus (if an identifier is given) that member\'s prior signal history — everything a coordinator summary reasons over.',
    inputSchema: { identifier: z.string().optional().describe('Member name or Slack user ID to include requester history for') },
  },
  instrumented('summarize_workspace_context', handleSummarizeWorkspaceContext)
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Community Beacon MCP server running on stdio');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error starting Community Beacon MCP server:', err);
    process.exit(1);
  });
}

module.exports = {
  handleSummarizeThread,
  handleSearchMessages,
  handleDetectSignals,
  handleScorePriority,
  handleLogCase,
  handleFindMatches,
  handleCreateFollowup,
  handleGetConstituentContext,
  handleSearchWorkspaceHistory,
  handleGetLocationPatterns,
  handleGetRepeatRequesters,
  handleGetRepeatVolunteers,
  handleGetUnresolvedSimilar,
  handleGetRecentMatches,
  handleGetSuccessfulOutcomes,
  handleGetPriorityStatistics,
  handleSummarizeWorkspaceContext,
};
