# AUTHORING

This file ships only in the template repo. `_strip_template_only` in `scripts/setup-project` deletes it from cloned projects, so anything written here is for *template authors* only — not for end users or their Claude.

## Repo identity

- GitHub: [github.com/almostawake/if](https://github.com/almostawake/if)
- Contact: andrew@almostawake.com
- This repo plays two roles: it's the template you edit, and it's the verbatim source `setup-project` clones into `~/Projects/<pid>` for end users. Anything you write at the root needs to be safe for *both* contexts — or marked author-only and stripped at clone time.

## How this template runs end-to-end

Three commands span the install → project → deploy lifecycle. Read this before debugging anything that crosses the script boundary.

1. **Bootstrap (once per machine)** — `curl -fsSL https://almostawake.com/i | bash` runs `aa/i`. Installs git + gh into `~/.if/`, clones this repo to `~/.if/staging`, then execs `scripts/install-dependencies` which installs node + java + claude code + chrome, copies `scripts/auth` to `~/.if/bin/auth` (long-lived per-user CLIs live there), and writes a marker block to `~/.zshrc` (PATH including `~/.if/bin`, `PROJECT_DIR=$HOME/Projects`, plus the `auth` and `setup-project` aliases).

2. **Per-project setup (once per project)** — the `setup-project` alias runs `scripts/setup-project` from `~/.if/staging`. Delegates Google sign-in to `~/.if/bin/auth` (Perl loopback OAuth → writes `~/.if/creds/<email>.json` per the contract there → emits the chosen email on stdout); reads back the access_token from the cred file; creates / picks a GCP project (`PID`); provisions ~21 APIs + Firestore (sydney) + Storage + Email Link auth; clones this template into `$PROJECT_DIR/<PID>`; runs `_strip_template_only` (see below); writes `.env` (`PROJECT_ID`, `ACCOUNT_EMAIL`) and `client/.env.production` (Firebase web config — fetched via `webApps.getConfig`); seeds the user's email into `allowedEmails`; builds + deploys.

3. **Deploys (any time after)** — `node scripts/deploy.mjs` from the project root. Reads `.env` for `PROJECT_ID` + `ACCOUNT_EMAIL`, gets a fresh access_token from `~/.if/creds/<email>.json` (refreshing in place via the stored refresh_token if expired — never re-prompts OAuth just because of expiry), runs `npm run build:all`, then pushes hosting + firestore.rules via the Firebase REST APIs. See `CLAUDE.md` § Deploying for the why.

**The cred contract:** `~/.if/creds/<email>.json` is the source of truth for tokens. `~/.if/bin/auth` writes it post-OAuth; `deploy.mjs` reads it and refreshes-in-place. Full schema + refresh rules: `~/.if/creds/CLAUDE.md`. `gcloud auth print-access-token` is only a fallback when the cred file is missing.

**`~/.if/bin/auth` standalone:** the same tool also runs as a bare `auth` from any shell — UI on stderr, chosen email on stdout's last line, so `EMAIL=$(auth)` works. This is what `setup-project` does. Force-reauths every run (no token-refresh shortcut), so the cred file is always fresh after.

## Author-only files (stripped from clones)

`_strip_template_only` in `scripts/setup-project` removes these from `~/Projects/<pid>` after `gh repo clone`. Keep this list in sync with the function — if you add a new author-only file, add it both places.

- `AUTHORING.md`
- `scripts/auth` — multi-account Google OAuth CLI; install-dependencies copies it to `~/.if/bin/auth`
- `scripts/install-dependencies` — bootstrap-time installer for node/java/claude/chrome
- `scripts/setup-project` — per-project provisioning + first deploy
- `scripts/setup-project-bootstrap` — early bootstrap stage
- `scripts/lib` — bash helpers used by the above
- `scripts/assets/` — claude config blobs, OS X quick-action zip, etc.
- `scripts/CLAUDE-SCRIPTS.md` — author notes about the scripts above

What stays in clones: `scripts/deploy.mjs`, `client/`, `functions/`, `docs/`, `firestore.rules`, root `package.json` and friends.

## Inline author-only fences

For the rare line that *must* live inside a runtime file (e.g. the discovery pointer at the top of `CLAUDE.md` so author Claude finds this file), wrap it in:

```
<!-- @author-only:start -->
...content stripped from clones...
<!-- @author-only:end -->
```

`_strip_template_only` runs a perl pass over `CLAUDE.md` to remove fenced regions. Default for everything else is "put it in `AUTHORING.md`" — fences are a last resort.

## Template README vs clone README

- Root `README.md` in this repo is the **GitHub landing page** for new template users — install instructions, the `curl ... almostawake.com/i.sh` bootstrap, etc. It stays as-is.
- `_strip_template_only` **overwrites** `README.md` post-clone with a small per-project version (project ID, deploy command, link back to `almostawake/if`). End users never see the template README inside their cloned project.
