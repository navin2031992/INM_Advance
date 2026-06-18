# Quick Setup — IntelliMatch MCP Server

Connect the IntelliMatch data generator to your AI coding assistant in under 5 minutes.

Two transport modes are available:

| Mode | File | Used by |
|---|---|---|
| **stdio** | `mcp-server/index.js` | Claude Code, Roo Code, Cline |
| **HTTP** | `mcp-server/http-server.js` | Cursor, Continue.dev, LM Studio, Ollama, Open WebUI, any OpenAI-compatible tool |

---

## Prerequisites

1. **Node.js 18+** — [nodejs.org](https://nodejs.org)
2. **Project dependencies installed**

```bash
# In the project root
npm install

# In the mcp-server directory
cd mcp-server && npm install && cd ..
```

---

## Option A — Claude Code (built-in, zero config)

Claude Code reads `.mcp.json` from the project root automatically.  
The file is already present — just open the project folder:

```bash
# Open Claude Code in the project folder
claude .
```

Test it immediately:
```
Generate 100 CSV records with perfect match scenario
```

---

## Option B — Roo Code (VS Code Extension)

### Step 1 — Open Roo MCP Settings

In VS Code:
- Press `Ctrl+Shift+P` → type **"Roo: Open MCP Settings"**  
- Or navigate to the Roo Code sidebar → MCP icon → **Edit MCP Settings**

### Step 2 — Add the server

Paste the following into `mcp_settings.json` (merge with any existing servers):

```json
{
  "mcpServers": {
    "intellimatch": {
      "command": "node",
      "args": ["mcp-server/index.js"],
      "cwd": "C:\\NewInitiatives\\mcp\\INM_Advance",
      "description": "IntelliMatch FIS Dummy Data Generator"
    }
  }
}
```

> **Windows path**: Use double-backslash `\\` or forward slashes `/` in the `cwd` value.  
> Replace `C:\\NewInitiatives\\mcp\\INM_Advance` with your actual project path.

### Step 3 — Reload

- Click the **Reload** button in Roo's MCP panel, or restart VS Code.
- You should see **intellimatch** appear in the connected servers list.

### Step 4 — Test

Open the Roo chat and type:
```
List all available output formats for IntelliMatch
```

---

## Option C — Cline (VS Code Extension)

### Step 1 — Open Cline MCP Settings

In VS Code with Cline installed:
- Click the Cline icon in the Activity Bar
- Click the **Settings / gear icon** → **MCP Servers**
- Or press `Ctrl+Shift+P` → **"Cline: Open MCP Settings"**

### Step 2 — Add the server

The Cline MCP settings file is typically at:
```
%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json
```

Add the following entry (merge with existing):

```json
{
  "mcpServers": {
    "intellimatch": {
      "command": "node",
      "args": ["mcp-server/index.js"],
      "cwd": "C:\\NewInitiatives\\mcp\\INM_Advance",
      "disabled": false,
      "alwaysAllow": []
    }
  }
}
```

> Replace the `cwd` path with your actual project path.

### Step 3 — Reload

Restart VS Code or click **Reload MCP Servers** in the Cline settings panel.

### Step 4 — Test

In the Cline chat:
```
Generate 200 records with GL:BANK import format and CSV output
```

---

## Option D — VS Code `.vscode/mcp.json` (shared team config)

If your team uses VS Code's native MCP support, create `.vscode/mcp.json`:

```json
{
  "servers": {
    "intellimatch": {
      "type": "stdio",
      "command": "node",
      "args": ["mcp-server/index.js"],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

This uses `${workspaceFolder}` which resolves automatically for everyone on the team.

---

## Option E — HTTP Server (Cursor, LM Studio, Ollama, Open WebUI, any OpenAI tool)

### Step 1 — Start the HTTP server

```bash
# Default: localhost:3456
node mcp-server/http-server.js

# Custom port
MCP_HTTP_PORT=4000 node mcp-server/http-server.js

# Expose on LAN (all network interfaces — only if behind your org firewall)
MCP_HTTP_HOST=0.0.0.0 node mcp-server/http-server.js
```

### Step 2 — Connect your AI tool

#### Cursor
Add to `.cursor/mcp.json` in your project (or `~/.cursor/mcp.json` globally):
```json
{
  "mcpServers": {
    "intellimatch": {
      "url": "http://127.0.0.1:3456/mcp"
    }
  }
}
```

#### Continue.dev
Add to `~/.continue/config.json`:
```json
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": { "type": "streamableHttp", "url": "http://127.0.0.1:3456/mcp" }
      }
    ]
  }
}
```

#### LM Studio / Ollama / Open WebUI (OpenAI function calling)

Use the REST endpoints directly:

**List all tools** (call this to get the `tools` array for your chat request):
```
GET http://127.0.0.1:3456/openai/tools
```

**Execute a tool** (call this when the model invokes a function):
```
POST http://127.0.0.1:3456/openai/tools/call
Content-Type: application/json

{ "name": "generate_test_data", "arguments": { "records": 100, "format": "csv" } }
```

#### Any OpenAI-compatible client (Python example)
```python
import requests, openai

# 1. Fetch tool definitions
tools = requests.get("http://127.0.0.1:3456/openai/tools").json()["tools"]

# 2. Send to your model (OpenAI, Azure, local, etc.)
client = openai.OpenAI()
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Generate 500 GL:BANK records in CSV format"}],
    tools=tools
)

# 3. Execute the tool call the model chose
tool_call = response.choices[0].message.tool_calls[0]
result = requests.post(
    "http://127.0.0.1:3456/openai/tools/call",
    json={"name": tool_call.function.name, "arguments": tool_call.function.arguments}
).json()
print(result["content"][0]["text"])
```

### Step 3 — Verify

```bash
curl http://127.0.0.1:3456/health
# → { "status": "ok", "server": "intellimatch-mcp", ... }

curl http://127.0.0.1:3456/openai/tools | python -m json.tool | head -20
# → { "tools": [ { "type": "function", "function": { "name": "generate_test_data" ... } } ] }
```

---

## Verifying the Connection

Once connected, try these prompts to confirm everything works:

| Prompt | Expected result |
|---|---|
| `List all IntelliMatch formats` | Returns 14+ format names and descriptions |
| `List reconciliation scenarios` | Returns 7 scenario descriptions |
| `Preview 10 records in CSV format` | Returns an inline CSV block |
| `Generate 50 records with perfect scenario` | Creates files in ./output/ |

---

## Example Prompts to Try

### Basic generation
```
Generate 1000 CSV records with mixed scenarios for IntelliMatch testing
```

```
Generate an Excel file with 500 records using the GL:BANK import schema
```

```
Generate SWIFT MT940 statements for the oneToMany scenario with 3-way splits
```

### Previewing output
```
Preview what BAI2 format looks like with amountDiff scenario
```

```
Show me 10 records of the AP import schema in CSV format
```

### New format — day 1 usage
```
Create a new TSV (tab-separated) output format for our ETL pipeline
```

```
Create a semicolon-delimited format named "sapcsv" for SAP mass data import
```

### New import schema — new row types
```
Add a new ledger import schema named "DYNAMICS365" for Microsoft Dynamics 365 
with these fields:
- JournalNum from rec.TxnID
- AccountNum from rec.LedgerAccount  
- TransDate from rec.TransactionDate
- CurrencyCode from rec.Currency
- AmountCurDebit from rec.DebitAmount
- AmountCurCredit from rec.CreditAmount
- Txt from rec.Description
- Voucher from rec.ReferenceNumber

Description: "Microsoft Dynamics 365 General Journal import"
```

```
Add a new statement schema named "BLOOMBERG_BANK" with:
- message_id: rec.StatementID
- account: rec.BankAccountNumber
- trade_date: rec.TransactionDate
- settle_date: rec.ValueDate
- ccy: rec.Currency
- net_amount: rec.Amount
- side: if rec.DebitCreditIndicator is C then "CREDIT" else "DEBIT"
- ref: rec.ReferenceNumber

Description: "Bloomberg Terminal bank message feed format"
```

### After adding a new format/schema
```
Generate 500 records using the DYNAMICS365 import schema in CSV format
```

```
Generate BLOOMBERG_BANK statements for the perfect scenario
```

---

## Troubleshooting

### "Cannot find module '@modelcontextprotocol/sdk'"
```bash
cd mcp-server && npm install
```

### "Generator failed" or "node not found"
- Ensure Node.js 18+ is in your PATH: `node --version`
- Check that `npm install` was run in the project root too

### Server shows as disconnected in Roo/Cline
- Verify the `cwd` path is absolute and correct for your system
- Check for JSON syntax errors in your settings file
- Try restarting VS Code completely

### Output files not appearing
```
List generated files
```
The AI will call `get_generated_files` and show what was produced.

### Format/schema not recognized after creation
The `create_output_format` and `add_import_schema` tools patch `src/index.js` and `src/formatters/importFormatMapper.js` automatically. If changes don't take effect:
```bash
node src/index.js --help
```
Check that the new format/schema name appears in the output.

---

## File Locations Reference

| File | Purpose |
|---|---|
| `.mcp.json` | Claude Code MCP config (project root) |
| `mcp-server/index.js` | MCP server entry point |
| `mcp-server/package.json` | MCP server dependencies |
| `src/index.js` | Generator CLI (patched when new formats added) |
| `src/formatters/importFormatMapper.js` | Import schemas (patched when new schemas added) |
| `src/formatters/*Formatter.js` | Output formatters (new ones written here) |
| `generator.config.json` | Default generation settings |
| `output/ledger/` | Generated ledger files |
| `output/statement/` | Generated statement files |


For Roo Code — open Ctrl+Shift+P → "Roo: Open MCP Settings" and add:


"intellimatch": {
  "command": "node",
  "args": ["mcp-server/index.js"],
  "cwd": "C:\\NewInitiatives\\mcp\\INM_Advance"
}
For Cline — open the Cline MCP settings (%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json) and add:


"intellimatch": {
  "command": "node",
  "args": ["mcp-server/index.js"],
  "cwd": "C:\\NewInitiatives\\mcp\\INM_Advance",
  "disabled": false,
  "alwaysAllow": []
}
That's it — no npm install, no extra config, just merge that block into the existing mcpServers object. The .mcp.json already in the project root handles Claude Code auto-discovery, so that one works with zero config when you open the folder.

