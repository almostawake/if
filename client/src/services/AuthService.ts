import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut as fbSignOut,
  onAuthStateChanged,
  type Auth,
  type ConfirmationResult,
  type User,
} from 'firebase/auth';
import { getFirebase } from '@/firebase/init';

const RECAPTCHA_HOST_ID = 'if-recaptcha';

export const AuthService = {
  /**
   * Text a six-digit code to an E.164 mobile. The returned handle carries
   * the session; pass it to confirmCode() with whatever the user types.
   *
   * Nothing here checks the whitelist — Firebase will happily create an
   * account for any number in an allowed SMS region. The whitelist check
   * happens after sign-in (AuthStore.checkAdmin), and the (app) layout
   * gate signs out anyone who isn't on it.
   */
  async sendCode(mobileE164: string): Promise<ConfirmationResult> {
    const { auth } = getFirebase();
    try {
      return await signInWithPhoneNumber(auth, mobileE164, freshRecaptcha(auth));
    } catch (e) {
      // Leave nothing spent behind for the retry the user is about to make.
      clearRecaptcha();
      throw e;
    }
  },

  async confirmCode(confirmation: ConfirmationResult, code: string): Promise<User> {
    const cred = await confirmation.confirm(code.trim());
    return cred.user;
  },

  async signOut(): Promise<void> {
    const { auth } = getFirebase();
    await fbSignOut(auth);
  },

  observe(cb: (user: User | null) => void): () => void {
    const { auth } = getFirebase();
    return onAuthStateChanged(auth, cb);
  },

  /**
   * Dev-only. The auth emulator sends no SMS — it just records the code it
   * would have sent. Poll for the one belonging to this number so local
   * sign-in doesn't mean digging through emulator logs. Prod has no
   * /emulator/v1/* route, so the DEV guard keeps this out of the bundle.
   *
   * Same trick the email-link flow used before phone auth replaced it.
   */
  async devCode(mobileE164: string): Promise<string | null> {
    if (!import.meta.env.DEV) return null;
    return pollEmulatorCode(mobileE164);
  },
};

// Invisible reCAPTCHA. Firebase requires a verifier for every web phone
// sign-in; "invisible" means the user only ever sees a challenge if
// Google's risk scoring asks for one. connectAuthEmulator() swaps in a
// no-op verifier, so this same path works in local dev untouched.
//
// A verifier is SINGLE USE. Reusing a solved one doesn't error — it hangs,
// silently falling back to a reCAPTCHA v2 challenge that never resolves,
// which looks to the user like a "sending…" button that sticks forever.
// It bites on the second sign-in of a page session (sign out, sign back
// in), because module state survives client-side navigation. So: one
// fresh verifier per send, and tear the old one down first.
let verifier: RecaptchaVerifier | null = null;

function freshRecaptcha(auth: Auth): RecaptchaVerifier {
  clearRecaptcha();
  let host = document.getElementById(RECAPTCHA_HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = RECAPTCHA_HOST_ID;
    document.body.appendChild(host);
  }
  verifier = new RecaptchaVerifier(auth, host, { size: 'invisible' });
  return verifier;
}

function clearRecaptcha(): void {
  try {
    verifier?.clear();
  } catch {
    // Already torn down — nothing to clean up.
  }
  verifier = null;
  // clear() detaches the widget but leaves the host div; a stale one makes
  // the next render a no-op, so the div goes too and gets rebuilt above.
  document.getElementById(RECAPTCHA_HOST_ID)?.remove();
}

/**
 * Hardcoded `demo-not-required` — the project id the emulator runs under
 * (see `npm run start:emulators`). The SDK's own projectId is the prod
 * project in a deployed build, so it can't be reused here.
 */
async function pollEmulatorCode(mobileE164: string): Promise<string | null> {
  const url = 'http://localhost:9099/emulator/v1/projects/demo-not-required/verificationCodes';
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const { verificationCodes } = (await res.json()) as {
          verificationCodes: Array<{ phoneNumber: string; code: string }>;
        };
        const match = verificationCodes.filter((c) => c.phoneNumber === mobileE164).pop();
        if (match?.code) return match.code;
      }
    } catch {
      // Endpoint not reachable — keep trying. We're in DEV mode by guard.
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}
