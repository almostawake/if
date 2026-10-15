#!/usr/bin/env node
//
// cmd-consent.mjs — grant this project Google consent (Gmail / Calendar)
// for ONE account and store the refresh token in functions/.env.
//
// This is the whole consent flow for the project: the owner runs it once
// on their machine, the browser opens, they click Allow, and the refresh
// token lands next to the other function secrets. `npm run deploy:functions` then ships it to prod.
//
// CLI:  node cmd-consent.mjs [<email>]   grant in the browser, write token
//       node cmd-consent.mjs --status    does the stored token still work?
//                                        prints email + granted scopes
//       node cmd-consent.mjs --token     print a fresh access_token (for
//                                        local scripts / curl against
//                                        gmail / calendar APIs)
//       node cmd-consent.mjs --force     re-grant even if a token is stored
//
// Account: positional <email>, else EMAIL_OF_GOOGLE_HOSTING_ACCOUNT in root
// .env. login_hint pre-selects it; the grant is rejected if a different
// account is chosen in the chooser.
//
// Reads  functions/.env: GOOGLE_HOSTING_CONSENT_ID / _KEY (the Desktop-app
//                        OAuth client), ADMIN_CONSENTS (scopes to ask for;
//                        `openid email` are added here).
// Writes functions/.env: GOOGLE_HOSTING_CONSENT_REFRESH_TOKEN,
//                        GOOGLE_HOSTING_CONSENT_EMAIL (atomic rewrite, other
//                        lines untouched).
//
// Why a Desktop-app client: Google lets it redirect to any
// http://127.0.0.1:<port> without pre-registering URIs, so a throwaway
// local server catches the code — same mechanism as cmd-auth.mjs. Google
// refresh tokens don't rotate (unlike Xero's), so nothing writes back after
// the grant; the token lives until revoked or unused for 6 months.
//
// Functions-side consumer: functions/src/googleConsent.ts.

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ROOT_ENV = path.join(ROOT, ".env");
const FUNCTIONS_ENV = path.join(ROOT, "functions", ".env");

const ID_SCOPES = "openid email";
const AUTH_URL = "https://accounts.google.com/o/oauth2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const HTTP_TIMEOUT_MS = 25_000;
const BROWSER_TIMEOUT_MS = 300_000;

// ---------- .env helpers (same bare-string parser as cmd-auth.mjs) ----------

function readEnvKey(file, key) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  const re = new RegExp(`^${key}\\s*=\\s*(.*)$`);
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(re);
    if (!m) continue;
    let v = m[1].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    return v || null;
  }
  return null;
}

// Replace `KEY=...` lines in place, append missing ones at the end. Atomic
// (tmp + rename) so a crash mid-write never leaves a half-written secrets file.
function upsertEnv(file, pairs) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const lines = text.split("\n");
  const pending = { ...pairs };
  const out = lines.map((line) => {
    const m = line.match(/^([A-Z0-9_]+)\s*=/);
    if (m && m[1] in pending) {
      const v = pending[m[1]];
      delete pending[m[1]];
      return `${m[1]}=${v}`;
    }
    return line;
  });
  if (Object.keys(pending).length) {
    if (out.length && out[out.length - 1] !== "") out.push("");
    for (const [k, v] of Object.entries(pending)) out.push(`${k}=${v}`);
    out.push("");
  }
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, out.join("\n"), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function clientConfig() {
  const id = readEnvKey(FUNCTIONS_ENV, "GOOGLE_HOSTING_CONSENT_ID");
  const secret = readEnvKey(FUNCTIONS_ENV, "GOOGLE_HOSTING_CONSENT_KEY");
  const consents = readEnvKey(FUNCTIONS_ENV, "ADMIN_CONSENTS");
  const missing = [
    !id && "GOOGLE_HOSTING_CONSENT_ID",
    !secret && "GOOGLE_HOSTING_CONSENT_KEY",
    !consents && "ADMIN_CONSENTS",
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(
      `functions/.env is missing ${missing.join(", ")} — see functions/.env.example`,
    );
  }
  return { id, secret, scope: `${ID_SCOPES} ${consents}`.trim() };
}

function resolveAccount(arg) {
  if (arg) return arg;
  const env = readEnvKey(ROOT_ENV, "EMAIL_OF_GOOGLE_HOSTING_ACCOUNT");
  if (env) return env;
  throw new Error(
    "no account: pass an email, or set EMAIL_OF_GOOGLE_HOSTING_ACCOUNT in .env",
  );
}

// ---------- HTTP ----------

async function fetchWithTimeout(url, opts = {}, timeoutMs = HTTP_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function postToken(body) {
  const res = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`token endpoint ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

// Exchange the stored refresh token for a short-lived access token.
async function refreshAccessToken() {
  const { id, secret } = clientConfig();
  const refreshToken = readEnvKey(
    FUNCTIONS_ENV,
    "GOOGLE_HOSTING_CONSENT_REFRESH_TOKEN",
  );
  if (!refreshToken)
    throw new Error(
      "no GOOGLE_HOSTING_CONSENT_REFRESH_TOKEN in functions/.env — run `npm run consent` first",
    );
  const tokens = await postToken({
    client_id: id,
    client_secret: secret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  return tokens.access_token;
}

// ---------- browser grant (loopback server, as in cmd-auth.mjs) ----------

function openBrowser(url) {
  // `open -a APP --args URL` — the `--args` is load-bearing; see the note in
  // cmd-auth.mjs. Falls back to the default browser when the launcher is absent.
  const launcherApp = path.join(
    process.env.HOME || "",
    "Applications/Chrome with Claude Code.app",
  );
  if (fs.existsSync(launcherApp)) {
    spawn("open", ["-a", launcherApp, "--args", url], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return;
  }
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(opener, [url], { detached: true, stdio: "ignore" }).unref();
}

const PAGE = (
  ok,
  title,
  body,
) => `<!doctype html><meta charset=utf-8><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:540px;margin:3em auto;padding:0 1.5em;color:#333;line-height:1.55}h1{color:${ok ? "#0a7" : "#b33"};font-size:1.4em}</style>
<h1>${ok ? "✓" : "✗"} ${title}</h1><p>${body}</p><p style="color:#888;font-size:.9em">Return to your terminal. You can close this tab.</p>`;

async function grant(account) {
  const { id, secret, scope } = clientConfig();
  return new Promise((resolve, reject) => {
    let timer;
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, "http://127.0.0.1");
      if (u.pathname !== "/") {
        res.writeHead(404, { Connection: "close" }).end();
        return;
      }
      const reply = (ok, title, body) => {
        res.writeHead(200, {
          "Content-Type": "text/html",
          Connection: "close",
        });
        res.end(PAGE(ok, title, body));
      };
      const error = u.searchParams.get("error");
      if (error) {
        reply(false, "Consent refused", `Google said: ${error}`);
        cleanup();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }
      const code = u.searchParams.get("code");
      if (!code) {
        res.writeHead(200, { Connection: "close" }).end();
        return;
      }
      try {
        const port = server.address().port;
        const tokens = await postToken({
          client_id: id,
          client_secret: secret,
          code,
          redirect_uri: `http://127.0.0.1:${port}`,
          grant_type: "authorization_code",
        });
        if (!tokens.refresh_token)
          throw new Error(
            "Google returned no refresh_token (prompt=consent should force one)",
          );
        const who = await (
          await fetchWithTimeout(USERINFO_URL, {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
          })
        ).json();
        const email = String(who.email || "").toLowerCase();
        if (email !== account.toLowerCase()) {
          reply(
            false,
            "Wrong account",
            `Signed in as <b>${email}</b>, expected <b>${account}</b>. Nothing was saved.`,
          );
          cleanup();
          reject(
            new Error(`account mismatch: requested ${account}, got ${email}`),
          );
          return;
        }
        reply(
          true,
          "Consent granted",
          `<b>${email}</b> has granted access. The token is saved in functions/.env.`,
        );
        cleanup();
        resolve({
          email,
          refreshToken: tokens.refresh_token,
          scope: tokens.scope || scope,
        });
      } catch (e) {
        try {
          reply(false, "Token exchange failed", e.message);
        } catch {
          /* already sent */
        }
        cleanup();
        reject(e);
      }
    });
    function cleanup() {
      if (timer) clearTimeout(timer);
      try {
        server.close();
      } catch {
        /* closed */
      }
    }
    server.on("error", (e) => {
      cleanup();
      reject(e);
    });
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const url = `${AUTH_URL}?${new URLSearchParams({
        client_id: id,
        redirect_uri: `http://127.0.0.1:${port}`,
        response_type: "code",
        scope,
        access_type: "offline",
        prompt: "consent",
        login_hint: account,
      })}`;
      const secs = Math.floor(BROWSER_TIMEOUT_MS / 1000);
      console.error(
        `⋯  opening browser to grant consent as ${account} (${secs}s timeout)`,
      );
      console.error(
        '   if Google shows "hasn\'t verified this app": Advanced → continue (expected — unverified by choice)',
      );
      console.error(`   if it doesn't open, click: ${url}`);
      openBrowser(url);
      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`browser consent timed out after ${secs}s`));
      }, BROWSER_TIMEOUT_MS);
    });
  });
}

// ---------- CLI ----------

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.find((a) => !a.startsWith("--"));

try {
  if (flags.has("--token")) {
    console.log(await refreshAccessToken());
    process.exit(0);
  }

  if (flags.has("--status")) {
    const email = readEnvKey(FUNCTIONS_ENV, "GOOGLE_HOSTING_CONSENT_EMAIL");
    const accessToken = await refreshAccessToken();
    const info = await (
      await fetchWithTimeout(
        `${TOKENINFO_URL}?access_token=${encodeURIComponent(accessToken)}`,
      )
    ).json();
    console.log(`✓ valid — consent held for ${info.email || email}`);
    console.log(
      `  scopes: ${(info.scope || "").split(" ").join("\n          ")}`,
    );
    process.exit(0);
  }

  const account = resolveAccount(positional);
  if (
    !flags.has("--force") &&
    readEnvKey(FUNCTIONS_ENV, "GOOGLE_HOSTING_CONSENT_REFRESH_TOKEN")
  ) {
    const held =
      readEnvKey(FUNCTIONS_ENV, "GOOGLE_HOSTING_CONSENT_EMAIL") || "unknown";
    console.error(
      `consent already stored for ${held} — use --status to check it, --force to re-grant`,
    );
    process.exit(0);
  }
  const { email, refreshToken, scope } = await grant(account);
  upsertEnv(FUNCTIONS_ENV, {
    GOOGLE_HOSTING_CONSENT_REFRESH_TOKEN: refreshToken,
    GOOGLE_HOSTING_CONSENT_EMAIL: email,
  });
  console.error(`✓  consent granted by ${email}`);
  console.error(`   scopes: ${scope}`);
  console.error(
    "   saved to functions/.env — run `npm run deploy:functions` to ship it",
  );
  process.exit(0);
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exit(2);
}
