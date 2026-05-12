/**
 * @collection users/{email}
 *
 * One row per signed-in user. Doc presence == "may sign in to /admin".
 *
 * Doc id is the lowercased email — the only stable identifier we have
 * at invite time (Firebase uid doesn't exist until first sign-in).
 * Email-link auth keys on email anyway, so it's the natural id here.
 *
 * Lifecycle:
 *  - Invited: written by /admin (or seeded at bootstrap) with `addedAt` + `addedBy`.
 *  - Signed in: same row — no separate "users vs allowed" split. Add fields
 *    here (e.g. `lastSignInAt`) when there's a real need; types under
 *    `functions/src/types/` are the single source of truth, shared with
 *    the client via the `$types` alias.
 */
export interface User {
  email: string;
  addedAt: number;
  addedBy: string;
}
