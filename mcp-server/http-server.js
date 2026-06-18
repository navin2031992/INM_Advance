#!/usr/bin/env node
/**
 * IntelliMatch MCP HTTP Server
 * =============================
 * Exposes all 8 IntelliMatch tools over HTTP so any AI tool can use them:
 *
 *  ┌─────────────────────────────────────────────────────────────────┐
 *  │  Endpoint           Protocol          Clients                   │
 *  ├─────────────────────────────────────────────────────────────────┤
 *  │  POST/GET /mcp      MCP Streamable    Cursor, Continue.dev,     │
 *  │                     HTTP (2024-11-05) Windsurf, VS Code Copilot │
 *  ├─────────────────────────────────────────────────────────────────┤
 *  │  GET  /sse          MCP Legacy SSE    Older MCP clients         │
 *  │  POST /message                                                   │
 *  ├─────────────────────────────────────────────────────────────────┤
 *  │  GET  /openai/tools OpenAI function   LM Studio, Ollama,        │
 *  │  POST /openai/tools/call  calling     Open WebUI, any LLM       │
 *  ├─────────────────────────────────────────────────────────────────┤
 *  │  GET  /health       JSON status       monitoring / smoke test   │
 *  └─────────────────────────────────────────────────────────────────┘
 *
 * Usage:
 *   node mcp-server/http-server.js              # default: 127.0.0.1:3456
 *   MCP_HTTP_PORT=4000 node mcp-server/http-server.js
 *   MCP_HTTP_HOST=0.0.0.0 node mcp-server/http-server.js   # bind all interfaces (LAN)
 *
 * Security:
 *   - Default host 127.0.0.1 is localhost-only (safe for single-machine use).
 *   - CORS is restricted to localhost origins — wildcard * is NOT used.
 *   - /mcp and /sse use MCP protocol auth (handled by SDK).
 *   - Set MCP_HTTP_HOST=0.0.0.0 only behind your org firewall / reverse proxy.
 */

import express                                from 'express';
import { StreamableHTTPServerTransport }      from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport }                 from '@modelcontextprotocol/sdk/server/sse.js';
import { createMcpServer, getToolDefinitions, callTool } from './shared.js';

const PORT = parseInt(process.env.MCP_HTTP_PORT || '3456', 10);
const HOST = process.env.MCP_HTTP_HOST || '127.0.0.1';

const app = express();
app.use(express.json({ limit: '4mb' }));

// ── CORS — localhost origins only (no wildcard) ───────────────────────────────
// Allows IDE extensions and local browser tools to connect, but prevents
// arbitrary web pages from making credentialed cross-origin requests.
const LOCALHOST_ORIGIN_PREFIXES = [
  'http://localhost',
  'http://127.0.0.1',
  'vscode-webview://',
  'vscode-file://',
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && LOCALHOST_ORIGIN_PREFIXES.some(p => origin.startsWith(p))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  // Never set Access-Control-Allow-Origin: * — that lets any page read responses
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status:  'ok',
    server:  'intellimatch-mcp',
    version: '1.0.0',
    endpoints: {
      mcp_streamable: `http://${HOST}:${PORT}/mcp`,
      mcp_legacy_sse: `http://${HOST}:${PORT}/sse`,
      openai_tools:   `http://${HOST}:${PORT}/openai/tools`,
      openai_call:    `http://${HOST}:${PORT}/openai/tools/call`
    }
  });
});

// ── MCP Streamable HTTP (2024-11-05 spec) ─────────────────────────────────────
// Stateless: fresh server+transport per request — no session management needed.
app.all('/mcp', async (req, res) => {
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server    = createMcpServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error.' });
    }
  }
});

// ── MCP Legacy SSE (deprecated spec — kept for broad client compatibility) ────
const sseClients = new Map();   // sessionId → SSEServerTransport

app.get('/sse', async (req, res) => {
  try {
    const transport = new SSEServerTransport('/message', res);
    const server    = createMcpServer();
    await server.connect(transport);
    sseClients.set(transport.sessionId, transport);
    req.on('close', () => sseClients.delete(transport.sessionId));
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error.' });
  }
});

app.post('/message', async (req, res) => {
  const sessionId  = req.query.sessionId;
  const transport  = sseClients.get(sessionId);
  if (!transport) return res.status(404).json({ error: 'Session not found or expired.' });
  try {
    await transport.handlePostMessage(req, res);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── OpenAI-compatible function calling API ────────────────────────────────────

/**
 * GET /openai/tools
 * Returns all tools in OpenAI function-calling format.
 * Use to populate the "tools" array in a chat completion request.
 *
 * Body:     { "name": "generate_test_data", "arguments": { "records": 100, "format": "csv" } }
 * Response: { "content": [{ "type": "text", "text": "..." }] }
 */
app.get('/openai/tools', (_req, res) => {
  const tools = getToolDefinitions().map(t => ({
    type: 'function',
    function: {
      name:        t.name,
      description: t.description,
      parameters:  t.inputSchema
    }
  }));
  res.json({ tools });
});

/**
 * POST /openai/tools/call
 * Execute a single tool by name with arguments.
 */
app.post('/openai/tools/call', async (req, res) => {
  const { name, arguments: args } = req.body || {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: '"name" (string) is required in the request body.' });
  }

  try {
    const result = await callTool(name, args || {});
    res.json(result);
  } catch (err) {
    // Sanitize error — strip absolute internal paths before returning
    res.status(400).json({
      content: [{ type: 'text', text: `Error in ${name}: ${sanitizeError(err.message)}` }],
      isError: true,
      error:   sanitizeError(err.message)
    });
  }
});

// ── Error sanitizer — strips absolute file paths from messages ────────────────
function sanitizeError(msg) {
  return String(msg)
    .replace(/[A-Za-z]:[\\\/][^\s,'"]+/g, '[path]')   // Windows: C:\...
    .replace(/\/(?:[\w.-]+\/){2,}[\w.-]*/g, '[path]'); // Unix: /home/user/...
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, HOST, () => {
  const base = `http://${HOST}:${PORT}`;
  console.error('');
  console.error('╔══════════════════════════════════════════════════════╗');
  console.error('║   IntelliMatch MCP HTTP Server — ready               ║');
  console.error('╚══════════════════════════════════════════════════════╝');
  console.error('');
  console.error(`  MCP Streamable HTTP  →  ${base}/mcp`);
  console.error(`  MCP Legacy SSE       →  ${base}/sse  (+ POST ${base}/message)`);
  console.error(`  OpenAI tool list     →  GET  ${base}/openai/tools`);
  console.error(`  OpenAI tool call     →  POST ${base}/openai/tools/call`);
  console.error(`  Health               →  GET  ${base}/health`);
  console.error('');
  if (HOST === '0.0.0.0') {
    console.error('  WARNING: Bound to 0.0.0.0 — accessible on your local network.');
    console.error('  Ensure this host is behind your organisation\'s firewall.');
  } else {
    console.error('  Localhost-only (127.0.0.1). Set MCP_HTTP_HOST=0.0.0.0 for LAN access.');
  }
  console.error('');
});
