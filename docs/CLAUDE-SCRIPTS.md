# Install + new-project scripts

Operational guide for the bash that gets a user from a fresh Mac to a deployable Firebase template. Covers the relationship between the `aa` repo (public bootstrap, served at almostawake.com) and the `if` repo (private, cloned to `~/.if/staging`), and the conventions for working on either.

This is **separate** from `../CLAUDE.md` because that file describes the template app the user ends up with — Svelte, Firebase, Firestore. End users browsing the `if` repo shouldn't have to wade through script-machinery guidance to find what applies to them. Anything about the install scripts goes here, not there.

> The full aa↔if flow / repo file map / auth model / deploy notes are still being written. For now this file holds the few operational rules we've already established.

## VM-debug ntfy topic

When the user is testing `aa/i` or `scripts/n` on a VM and asks for a command they can copy/paste into the VM terminal:

- Send via `curl -d '<command>' https://ntfy.sh/if-debug`
- They read it on phone (Ntfy app, subscribed to `if-debug`) and paste in the VM. Saves them retyping multi-line greps/diagnostics.

## Logs

- `aa/i` and `scripts/i` both write `/tmp/if-install.log` with timestamped markers (`log "..."` helper). When diagnosing a hang, ask for `cat /tmp/if-install.log` from the failing run.
- `scripts/n` writes `/tmp/if-new.log`.
