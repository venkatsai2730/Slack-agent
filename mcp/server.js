#!/usr/bin/env node
// Growth Beacon MCP server — exposes the growth-intelligence pipeline as MCP
// tools over stdio, independent of the Slack Bolt process (app.js). Launch with
// `npm run mcp`. Intended for use from an MCP-compatible client (e.g. Claude
// Desktop, or any MCP client configured to spawn this process).
//
// Design note: this process never receives Slack events, so it never has a
// fresh Real-Time Search action_token. search_messages therefore always uses
// services/searchService.js's conversations.history fallback rather than RTS.

require('dotenv').config();
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { WebClient } = require('@slack/web-api');
const { z } = require('zod');

const searchService = require('../services/searchService');
const intentEngine = require('../services/intentEngine');
const summaryService = require('../services/summaryService');
const leadScore = require('../services/leadScore');
const signalStore = require('../services/signalStore');
const crm = require('../services/crm');

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

const server = new McpServer({ name: 'growth-beacon', version: '1.0.0' });

server.registerTool(
  'summarize_thread',
  {
    title: 'Summarize Thread',
    description: 'Fetches a Slack thread and returns detected growth signals plus an executive summary.',
    inputSchema: {
      channel: z.string().describe('Slack channel ID'),
      thread_ts: z.string().describe('Timestamp (ts) of the thread parent message'),
    },
  },
  async ({ channel, thread_ts }) => {
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
);

server.registerTool(
  'search_messages',
  {
    title: 'Search Messages',
    description: 'Searches a Slack channel for growth-signal language over a lookback window.',
    inputSchema: {
      channel: z.string().describe('Slack channel ID'),
      hours_back: z.number().int().positive().max(168).default(24).describe('How many hours back to search (max 168)'),
      query: z.string().optional().describe('Override the default growth-signal search query'),
    },
  },
  async ({ channel, hours_back, query }) => {
    try {
      const client = getSlackClient();
      const messages = await searchService.searchChannelHistoryFallback(client, {
        channelId: channel,
        hoursBack: hours_back,
        query,
      });
      return textResult({ count: messages.length, messages });
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  'detect_intent',
  {
    title: 'Detect Intent',
    description: 'Classifies a message (and optional thread context) into growth signals with confidence, evidence, and reasoning.',
    inputSchema: {
      text: z.string().describe('The message text to analyze'),
      thread_context: z.string().optional().describe('Earlier thread messages for additional context'),
    },
  },
  async ({ text, thread_context }) => {
    try {
      const signals = await intentEngine.detectSignals(text, { threadContext: thread_context || '' });
      return textResult({ signals });
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  'score_lead',
  {
    title: 'Score Lead',
    description: 'Computes a 0-100 lead score and hot/warm/cold tier from detected signals (or from raw text, which is analyzed first).',
    inputSchema: {
      text: z.string().optional().describe('Raw message text to analyze first, if signals are not already known'),
      signals: z
        .array(z.object({ type: z.string(), confidence: z.number() }))
        .optional()
        .describe('Previously detected signals, if already known'),
    },
  },
  async ({ text, signals }) => {
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

      const result = leadScore.scoreLead(resolvedSignals);
      return textResult({ ...result, signals_used: resolvedSignals });
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  'log_to_crm',
  {
    title: 'Log To CRM',
    description: 'Detects signals in a message, summarizes it, persists it as a Growth Beacon signal, and logs it to the configured CRM provider.',
    inputSchema: {
      text: z.string().describe('The message text to log'),
      channel: z.string().optional().describe('Slack channel ID the message came from'),
      ts: z.string().optional().describe('Slack message timestamp'),
      author: z.string().optional().describe('Customer / author display name'),
      permalink: z.string().optional().describe('Permalink back to the original Slack message'),
    },
  },
  async ({ text, channel, ts, author, permalink }) => {
    try {
      const signals = await intentEngine.detectSignals(text);
      const summary = await summaryService.summarizeConversation({ text, signals });
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
      return textResult({ signal_id: signal.signal_id, crm_record_id: recordId, signals });
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  'create_followup',
  {
    title: 'Create Followup',
    description: 'Creates a CRM follow-up task for a previously logged Growth Beacon signal.',
    inputSchema: {
      signal_id: z.string().describe('The signal_id returned by log_to_crm or search results'),
      owner: z.string().optional().describe('Slack user ID or name to assign the follow-up to'),
    },
  },
  async ({ signal_id, owner }) => {
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
);

server.registerTool(
  'get_customer_context',
  {
    title: 'Get Customer Context',
    description: 'Retrieves prior CRM activity and follow-ups for a customer identifier (name, Slack user ID, or email).',
    inputSchema: {
      identifier: z.string().describe('Customer name, Slack user ID, or email'),
    },
  },
  async ({ identifier }) => {
    try {
      const context = await crm.getProvider().getCustomerContext(identifier);
      return textResult(context || { found: false, identifier });
    } catch (err) {
      return errorResult(err);
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Growth Beacon MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error starting Growth Beacon MCP server:', err);
  process.exit(1);
});
