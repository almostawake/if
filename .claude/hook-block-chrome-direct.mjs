#!/usr/bin/env node
//
// PreToolUse hook for Bash. Blocks direct Chrome invocations that
// bypass the "Chrome with Claude Code" launcher — those create an
// orphan profile (typically /tmp/chrome-mcp-profile) that loses
// signed-in state and that chrome-devtools MCP can't reuse.
//
// The launcher (~/Applications/Chrome with Claude Code.app) is the single source of
// truth for port 9222 + the Chrome-Claude profile. Use it via:
//
//   open -a "Chrome with Claude Code"
//
// Stdin contract: JSON with { tool_input: { command: "..." } }.
// Exit codes: 2 = block (stderr surfaced to model); 0 = allow.

import fs from 'node:fs';

const input = fs.readFileSync(0, 'utf8');
const cmd = JSON.parse(input).tool_input?.command || '';

// Require binary path AND a launch-style flag in the same command, so
// commit messages / grep / ls that merely mention these strings don't
// trip the block.
const HAS_BINARY = /Google Chrome\.app\/Contents\/MacOS\/Google Chrome/.test(cmd);
const HAS_LAUNCH_FLAG = /--remote-debugging-port|--user-data-dir/.test(cmd);

if (HAS_BINARY && HAS_LAUNCH_FLAG) {
  console.error(
    "Blocked: don't spawn Chrome by path with --remote-debugging-port. " +
    "Use `open -a \"Chrome with Claude Code\"` — the launcher (in " +
    "~/Applications/) handles port 9222 and the Chrome-Claude profile " +
    "that chrome-devtools MCP attaches to. Direct spawns create an orphan " +
    "profile MCP can't reuse and lose signed-in state."
  );
  process.exit(2);
}
