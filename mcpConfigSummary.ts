export const mcpConfigSummary = {
  "supabase": {
    "url": "https://mcp.supabase.com/mcp"
  },
  "filesystem": {
    "command": "npx",
    "args": [
      "-y",
      "@modelcontextprotocol/server-filesystem",
      "/Users/mac/Documents/project"
    ]
  },
  "playwright": {
    "command": "npx",
    "args": [
      "@playwright/mcp@latest"
    ]
  },
  "omx_state": {
    "command": "node",
    "args": [
      "/opt/homebrew/lib/node_modules/oh-my-codex/dist/mcp/state-server.js"
    ]
  },
  "omx_memory": {
    "command": "node",
    "args": [
      "/opt/homebrew/lib/node_modules/oh-my-codex/dist/mcp/memory-server.js"
    ]
  },
  "omx_code_intel": {
    "command": "node",
    "args": [
      "/opt/homebrew/lib/node_modules/oh-my-codex/dist/mcp/code-intel-server.js"
    ]
  },
  "omx_trace": {
    "command": "node",
    "args": [
      "/opt/homebrew/lib/node_modules/oh-my-codex/dist/mcp/trace-server.js"
    ]
  },
  "omx_team_run": {
    "command": "node",
    "args": [
      "/opt/homebrew/lib/node_modules/oh-my-codex/dist/mcp/team-server.js"
    ]
  }
}
