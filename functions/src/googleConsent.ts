// Google consent (Gmail / Calendar) for the ONE account the owner granted
// with `node cmd-consent.mjs`. The refresh token lives in functions/.env
// (Gen 2 auto-loads it, local and deployed); nothing is stored in Firestore.
//
// Usage:
//   import { google } from 'googleapis';            // add the dep when first needed
//   const gmail = google.gmail({ version: 'v1', auth: consentClient() });
//
// Google refresh tokens don't rotate — the client refreshes access tokens
// in memory as needed and there is nothing to write back.

import { OAuth2Client } from "google-auth-library";

function required(name: string): string {
  const v = process.env[name];
  if (!v)
    throw new Error(
      `${name} not set in functions/.env — run \`npm run consent\` (see docs/CLAUDE-DEPLOY.md)`,
    );
  return v;
}

/** Email of the account whose consent is stored. */
export function consentEmail(): string {
  return required("GOOGLE_HOSTING_CONSENT_EMAIL");
}

/** An authorised client for that account, scoped to ADMIN_CONSENTS. */
export function consentClient(): OAuth2Client {
  const client = new OAuth2Client(
    required("GOOGLE_HOSTING_CONSENT_ID"),
    required("GOOGLE_HOSTING_CONSENT_KEY"),
  );
  client.setCredentials({
    refresh_token: required("GOOGLE_HOSTING_CONSENT_REFRESH_TOKEN"),
  });
  return client;
}
