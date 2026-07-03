#!/usr/bin/env node
//
// PostToolUse hook for Bash. After a `git commit` runs, inject a
// reminder to keep docs/PROJECT.md (the app's functional state) and
// any affected docs/CLAUDE-*.md in sync with what was committed.
//
// Deterministic backstop for the "Before committing" checklist in
// CLAUDE.md — instruction-following decays over long sessions; this
// fires every time.
//
// Stdin contract: JSON with { tool_input: { command: "..." } }.
// Output: PostToolUse hookSpecificOutput.additionalContext (non-blocking).

import fs from 'node:fs';

const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const cmd = input.tool_input?.command || '';

// `git … commit` within one shell statement (not across ;, &&, or |),
// so `git log && echo commit` doesn't match.
if (/\bgit\b[^;&|\n]*\bcommit\b/.test(cmd)) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext:
        'A git commit just ran. If it shipped or changed app behaviour, ' +
        'verify docs/PROJECT.md (what the app does) and any affected ' +
        'docs/CLAUDE-*.md were updated in that commit — amend or follow ' +
        'up now if not. If nothing behavioural changed, ignore this.'
    }
  }));
}
