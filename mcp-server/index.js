#!/usr/bin/env node
/**
 * IntelliMatch MCP Server — stdio transport
 *
 * Used by Claude Code (.mcp.json), Roo Code, and Cline.
 * For HTTP/OpenAI-compatible access run: node mcp-server/http-server.js
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer }      from './shared.js';

const server    = createMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
