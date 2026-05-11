import {
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signOut as fbSignOut,
  onAuthStateChanged,
  type User
} from 'firebase/auth';
import { getFirebase } from '$lib/firebase/init';

const PENDING_EMAIL_KEY = 'if:pendingSignInEmail';

export const AuthService = {
  /**
   * Send a magic-link email. The link points back at our `/auth/action`
   * route, which calls completeEmailLink() to finish sign-in.
   */
  async sendLink(email: string): Promise<void> {
    const { auth } = getFirebase();
    const url = `${window.location.origin}/auth/action`;
    await sendSignInLinkToEmail(auth, email, {
      url,
      handleCodeInApp: true
    });
    // signInWithEmailLink requires the email back at consumption time
    // (Firebase doesn't put it in the link, to prevent session-fixation
    // attacks where someone forwards their link to a victim).
    window.localStorage.setItem(PENDING_EMAIL_KEY, email);

    // Local-dev convenience: no email is actually sent in the auth
    // emulator. Poll its oobCodes endpoint for the link we just created
    // and navigate there ourselves. Prod has no /emulator/v1/* route, so
    // the explicit DEV guard keeps this dead code in production.
    if (import.meta.env.DEV) {
      await followEmulatorLink(email);
    }
  },

  isLink(href: string): boolean {
    const { auth } = getFirebase();
    return isSignInWithEmailLink(auth, href);
  },

  /**
   * Complete sign-in after the user clicks the magic link. Reads the
   * email from localStorage; if the user opened the link on a different
   * device, the caller must prompt for the email and pass it via
   * `emailOverride`.
   */
  async completeEmailLink(href: string, emailOverride?: string): Promise<User> {
    const { auth } = getFirebase();
    const email = emailOverride ?? window.localStorage.getItem(PENDING_EMAIL_KEY);
    if (!email) throw new Error('No email available — open the link on the same device, or re-enter the email.');
    const cred = await signInWithEmailLink(auth, email, href);
    window.localStorage.removeItem(PENDING_EMAIL_KEY);
    return cred.user;
  },

  async signOut(): Promise<void> {
    const { auth } = getFirebase();
    await fbSignOut(auth);
  },

  observe(cb: (user: User | null) => void): () => void {
    const { auth } = getFirebase();
    return onAuthStateChanged(auth, cb);
  }
};

/**
 * Dev-only. Polls the Firebase Auth emulator's pending OOB codes for up
 * to 5s, picks the matching email-link entry, and navigates the window
 * to its `oobLink` so the user doesn't have to copy-paste from a log.
 *
 * Hardcoded `demo-not-required` — that's the project id the emulator
 * runs under (see `npm run start:emulators` → `firebase --project
 * demo-not-required ...`). The Firebase SDK's `app.options.projectId`
 * is the *prod* project (from client/.env) so we can't reuse it here.
 */
async function followEmulatorLink(email: string): Promise<void> {
  const url = 'http://localhost:9099/emulator/v1/projects/demo-not-required/oobCodes';
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const { oobCodes } = (await res.json()) as {
          oobCodes: Array<{ email: string; requestType: string; oobLink: string }>;
        };
        const match = oobCodes
          .filter((c) => c.email === email && c.requestType === 'EMAIL_SIGNIN')
          .pop();
        if (match?.oobLink) {
          window.location.href = match.oobLink;
          return;
        }
      }
    } catch {
      // Endpoint not reachable — keep trying. We're in DEV mode by guard.
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  // Fell through: leave the user on the "check your email" screen so
  // they can grab the link manually (e.g. emulator UI hidden behind a
  // firewall in some setup).
}
