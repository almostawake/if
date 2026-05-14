// /consent + /oauth/callback — Google OAuth permission grant flow.
// Public (no bearer): browsers reach these directly. See CLAUDE-API.md
// "Public browser-facing routes" for the exception.

import { Router, type Request, type Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { getFirestore } from 'firebase-admin/firestore';
import { createHmac, randomBytes } from 'node:crypto';
import { grantSchema } from '../common/Grant';

const router = Router();

// Same redirect URI we registered with Google for this client — must match
// exactly. If you change these, update the OAuth client in Cloud Console →
// Google Auth Platform → Clients (both URIs sit on one client).
//
// Dev URI is hardcoded against `demo-not-required` because that's the project
// id the emulator runs under (npm run start:emulators uses --project
// demo-not-required as a deliberate constraint — see docs/CLAUDE-EMULATORS.md).
// Same pattern as every other local-vs-prod fork in this codebase.
function redirectUri(): string {
  return process.env.FUNCTIONS_EMULATOR
    ? 'http://localhost:5001/demo-not-required/australia-southeast1/api/oauth/callback'
    : `https://australia-southeast1-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/api/oauth/callback`;
}

const ID_SCOPES = ['openid', 'email'];
const STATE_TTL_MS = 10 * 60 * 1000;

function consentScopes(): string[] {
  return (process.env.ADMIN_CONSENTS ?? '').split(/\s+/).filter(Boolean);
}

function stateSecret(): string | undefined {
  return process.env.OAUTH_STATE_SECRET
    ?? process.env.CODE_THAT_OTHER_SERVICES_NEED_TO_GET_PAST_OUR_BOUNCER;
}

function signState(): string {
  const secret = stateSecret()!;
  const body = `${randomBytes(16).toString('base64url')}.${Date.now()}`;
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verifyState(state: string): boolean {
  const secret = stateSecret();
  if (!secret) return false;
  const parts = state.split('.');
  if (parts.length !== 3) return false;
  const [nonce, tsStr, mac] = parts;
  const expected = createHmac('sha256', secret).update(`${nonce}.${tsStr}`).digest('base64url');
  if (mac !== expected) return false;
  const ts = Number(tsStr);
  return Number.isFinite(ts) && Date.now() - ts < STATE_TTL_MS;
}

function configError(): string | null {
  if (!process.env.GOOGLE_HOSTING_CONSENT_ID) return 'GOOGLE_HOSTING_CONSENT_ID not set in functions/.env';
  if (!process.env.GOOGLE_HOSTING_CONSENT_KEY) return 'GOOGLE_HOSTING_CONSENT_KEY not set in functions/.env';
  if (!consentScopes().length) return 'ADMIN_CONSENTS not set in functions/.env';
  if (!stateSecret()) return 'OAUTH_STATE_SECRET (or fallback CODE_THAT_OTHER_SERVICES_NEED_TO_GET_PAST_OUR_BOUNCER) not set';
  return null;
}

function client(): OAuth2Client {
  return new OAuth2Client(
    process.env.GOOGLE_HOSTING_CONSENT_ID!,
    process.env.GOOGLE_HOSTING_CONSENT_KEY!,
    redirectUri(),
  );
}

// Friendly placeholder mirroring /'s "ah, one day a home page here." — shown
// when the template's been cloned but the OAuth client deets aren't filled in
// yet. Styling is hand-copied from the SvelteKit side (app.css @theme +
// app.html font link) because this function isn't part of the Tailwind build:
// JetBrains Mono 18px/1.45, #999 faint text on white, centred in the viewport
// with the same px-6 gutter. Keep in sync with client/src/routes/+page.svelte.
function placeholderPage(): string {
  return `<!doctype html><meta charset=utf-8><title>consent</title>
<link rel=preconnect href="https://fonts.googleapis.com">
<link rel=preconnect href="https://fonts.gstatic.com" crossorigin>
<link rel=stylesheet href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap">
<style>html,body{margin:0;padding:0}body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:0 1.5rem;font-family:'JetBrains Mono','Fira Code','SF Mono','Cascadia Code','Consolas',monospace;font-size:18px;line-height:1.45;background:#fff;color:#999}</style>
<div>consents will need some more setup to work.</div>`;
}

// Always reply HTML, never plain text. iOS Safari treats a text/plain
// response from /oauth/callback as a downloadable attachment ("callback.txt")
// instead of rendering it — surprises the user, hides the message. Same
// system-ui frame as the success page so error pages don't feel orphaned.
function htmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
  ));
}

function messagePage(title: string, body: string): string {
  return `<!doctype html><meta charset=utf-8><title>${htmlEscape(title)}</title>
<style>body{font-family:system-ui;max-width:480px;margin:4rem auto;padding:0 1rem;line-height:1.5}</style>
<h1>${htmlEscape(title)}</h1>
<p>${body}</p>`;
}

router.get('/consent', (_req: Request, res: Response) => {
  if (!process.env.GOOGLE_HOSTING_CONSENT_ID || !process.env.GOOGLE_HOSTING_CONSENT_KEY) {
    res.status(200).type('html').send(placeholderPage());
    return;
  }
  const err = configError();
  if (err) { res.status(500).type('html').send(messagePage('Config error', htmlEscape(err))); return; }

  const url = client().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [...ID_SCOPES, ...consentScopes()],
    state: signState(),
  });
  res.redirect(302, url);
});

router.get('/oauth/callback', async (req: Request, res: Response) => {
  const err = configError();
  if (err) { res.status(500).type('html').send(messagePage('Config error', htmlEscape(err))); return; }

  const code = String(req.query.code ?? '');
  const state = String(req.query.state ?? '');
  if (!code) { res.status(400).type('html').send(messagePage('Missing code', 'No <code>code</code> parameter on the callback URL.')); return; }
  if (!verifyState(state)) { res.status(400).type('html').send(messagePage('Invalid or expired state', 'The consent link is too old or was tampered with — start over from <a href="/consent">/consent</a>.')); return; }

  const { tokens } = await client().getToken(code);
  if (!tokens.id_token) { res.status(400).type('html').send(messagePage('Sign-in incomplete', 'Google did not return an id_token. Try again from <a href="/consent">/consent</a>.')); return; }

  const idPayload = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString());
  const email = String(idPayload.email ?? '').toLowerCase();
  if (!email) { res.status(400).type('html').send(messagePage('Sign-in incomplete', 'No email was attached to your Google identity token. Try again from <a href="/consent">/consent</a>.')); return; }

  const db = getFirestore();
  const userDoc = await db.doc(`users/${email}`).get();
  if (!userDoc.exists) {
    res.status(403).type('html').send(messagePage(
      'Access not granted',
      `<strong>${htmlEscape(email)}</strong> is not on the user whitelist. Ask the project owner to add you first.`,
    ));
    return;
  }

  const grant = grantSchema.parse({
    email,
    provider: 'google',
    refreshToken: tokens.refresh_token ?? null,
    accessToken: tokens.access_token ?? '',
    expiresAt: tokens.expiry_date ?? 0,
    scopes: consentScopes(),
    grantedAt: Date.now(),
  });
  await db.doc(`grants/${email}`).set(grant, { merge: true });

  res.status(200).type('html').send(
    `<!doctype html><meta charset=utf-8><title>Access granted</title>
     <style>body{font-family:system-ui;max-width:480px;margin:4rem auto;padding:0 1rem;line-height:1.5}</style>
     <h1>Access granted</h1>
     <p>Thanks, <strong>${email}</strong>. You can close this tab.</p>`,
  );
});

export default router;
