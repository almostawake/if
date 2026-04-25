/**
 * Whitelist entry. Anyone whose email is in this collection can sign in
 * and use the app. All entries are equal — no admin/non-admin split.
 *
 * @collection allowedEmails
 *
 * Document ID = the lowercased email. Using email-as-id prevents
 * duplicates and makes existence checks a single get().
 */
export interface AllowedEmail {
  email: string;
  addedAt: number;
  addedBy: string;
}
