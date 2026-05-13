// /consent + /oauth/callback — Google OAuth permission grant flow.
// Public (no bearer): browsers reach these directly. See CLAUDE-API.md
// "Public browser-facing routes" for the exception.

import { Router, type Request, type Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { getFirestore } from 'firebase-admin/firestore';
import { createHmac, randomBytes } from 'node:crypto';
import type { Grant } from '../types/Grant';

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
// yet. Same centred-faint-text vibe; minimal inline CSS since the function
// isn't bundled with the SvelteKit Tailwind build.
function placeholderPage(): string {
  return `<!doctype html><meta charset=utf-8><title>consent</title>
<style>html,body{margin:0;padding:0;height:100%}body{display:flex;align-items:center;justify-content:center;padding:0 1.5rem;font:14px/1.5 system-ui,-apple-system,sans-serif;color:#9ca3af}</style>
<div>consents will need some more setup to work.</div>`;
}

router.get('/consent', (_req: Request, res: Response) => {
  if (!process.env.GOOGLE_HOSTING_CONSENT_ID || !process.env.GOOGLE_HOSTING_CONSENT_KEY) {
    res.status(200).type('html').send(placeholderPage());
    return;
  }
  const err = configError();
  if (err) { res.status(500).type('text').send(`Config error: ${err}`); return; }

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
  if (err) { res.status(500).type('text').send(`Config error: ${err}`); return; }

  const code = String(req.query.code ?? '');
  const state = String(req.query.state ?? '');
  if (!code) { res.status(400).type('text').send('Missing code'); return; }
  if (!verifyState(state)) { res.status(400).type('text').send('Invalid or expired state'); return; }

  const { tokens } = await client().getToken(code);
  if (!tokens.id_token) { res.status(400).type('text').send('No id_token returned'); return; }

  const idPayload = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString());
  const email = String(idPayload.email ?? '').toLowerCase();
  if (!email) { res.status(400).type('text').send('No email in id_token'); return; }

  const db = getFirestore();
  const userDoc = await db.doc(`users/${email}`).get();
  if (!userDoc.exists) {
    res.status(403).type('text').send(
      `Access not granted: ${email} is not on the user whitelist. Ask the project owner to add you first.`,
    );
    return;
  }

  const grant: Grant = {
    email,
    provider: 'google',
    refreshToken: tokens.refresh_token ?? null,
    accessToken: tokens.access_token ?? '',
    expiresAt: tokens.expiry_date ?? 0,
    scopes: consentScopes(),
    grantedAt: Date.now(),
  };
  await db.doc(`grants/${email}`).set(grant, { merge: true });

  res.status(200).type('html').send(
    `<!doctype html><meta charset=utf-8><title>Access granted</title>
     <style>body{font-family:system-ui;max-width:480px;margin:4rem auto;padding:0 1rem;line-height:1.5}</style>
     <h1>Access granted</h1>
     <p>Thanks, <strong>${email}</strong>. You can close this tab.</p>`,
  );
});

export default router;
