/**
 * @collection grants/{email}
 *
 * Per-user record of a Google OAuth permission grant — the refresh token
 * and metadata captured when a user clicks the /consent link, signs in to
 * Google, and clicks "Allow" on the consent screen.
 *
 * Keyed by lowercased email (matching `/users/{email}`). Anyone who can
 * sign in (i.e. has a /users doc) can also grant; this doc is where the
 * resulting credentials land.
 *
 * Doc presence == "this user has granted us Google access at least once."
 *
 * Security: never client-readable. Default-deny in firestore.rules covers
 * the /grants collection — only the Admin SDK (Cloud Functions) reads or
 * writes it. Refresh tokens are credentials and must never leave the
 * server.
 */
export interface Grant {
  email: string;
  provider: 'google';
  refreshToken: string | null;
  accessToken: string;
  expiresAt: number;
  scopes: string[];
  grantedAt: number;
}
