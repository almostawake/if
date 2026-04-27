#!/bin/bash
#
# if setup check — reports diagnostic info to the instructor
#
# Usage:
#   curl -fsSL https://almostawake.com/check.sh | bash
#
# CLAUDE EDIT NOTICE: When editing this file, bump ZSHRC_VERSION in
# zshrc-remote by 1. Shows in user's prompt as [v38] etc. — their signal
# that the push went live.
#
set -e

# --- Load shared helpers ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/if-lib.sh"

# --- Config ---
NTFY_TOPIC="if-ntfy-setup-check"

cat <<BANNER

  ┌─────────────────────────────────┐
  │     appsvelte setup check       │
  └─────────────────────────────────┘

This will check what's installed on your machine and send a diagnostic
report to your instructor so they can help you with any setup issues.

BANNER

# --- Build and display report ---
build_diagnostic_report
echo ""
echo "$DIAG_REPORT"
echo ""

# --- Send to ntfy (silent) ---
post_diagnostic_to_ntfy "$NTFY_TOPIC" "Setup Check" || true

echo ""
echo "Done."
echo ""
