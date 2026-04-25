import {
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signOut as fbSignOut,
  onAuthStateChanged,
  type User
} from 'firebase/auth';
import { getFirebase } from '$lib/firebase/init';

const PENDING_EMAIL_KEY = 'appsvelte:pendingSignInEmail';

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
