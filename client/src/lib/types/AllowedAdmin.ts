/**
 * Whitelist entry for an admin. Anyone whose email is in this collection
 * can sign in to `/admin` and manage the app's admin surface. End users
 * at `/` are anonymous (no sign-in at all) and do not appear here.
 *
 * @collection allowedAdmins
 *
 * Document ID = the lowercased email. Using email-as-id prevents
 * duplicates and makes existence checks a single get().
 */
export interface AllowedAdmin {
  email: string;
  addedAt: number;
  addedBy: string;
}
