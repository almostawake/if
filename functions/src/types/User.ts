/**
 * @collection users/{email}
 *
 * One row per signed-in user. Doc presence == "may sign in to /admin".
 *
 * Doc id is the lowercased email — the only stable identifier we have
 * at invite time (Firebase uid doesn't exist until first sign-in).
 * Email-link auth keys on email anyway, so it's the natural id here.
 *
 * Fields are split into two phases:
 *  - Invite time: { email, admin, addedAt, addedBy } — written by
 *    /admin add or the bootstrap seed.
 *  - First sign-in onwards: { uid, lastSignInAt } get filled in (and
 *    `lastSignInAt` refreshed on every subsequent sign-in).
 *
 * `admin: true` on every row today — every user IS an admin. The
 * field exists for explicit visibility in the Firestore console and
 * to future-proof for non-admin user records later.
 */
export interface User {
  email: string;
  admin: boolean;
  addedAt: number;
  addedBy: string;
  uid?: string;
  lastSignInAt?: number;
}
