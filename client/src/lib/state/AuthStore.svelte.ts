import type { User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { AuthService } from '$lib/services/AuthService';
import { getFirebase } from '$lib/firebase/init';

class AuthStore {
  user = $state<User | null>(null);
  /** null = not yet known, true/false = result of the whitelist check. */
  whitelisted = $state<boolean | null>(null);
  loaded = $state(false);
  private unsub: (() => void) | null = null;

  start = () => {
    if (this.unsub) return;
    this.unsub = AuthService.observe(async (u) => {
      this.user = u;
      if (!u || !u.email) {
        this.whitelisted = null;
      } else {
        this.whitelisted = await this.checkWhitelist(u.email);
      }
      this.loaded = true;
    });
  };

  stop = () => {
    this.unsub?.();
    this.unsub = null;
  };

  signOut = async () => {
    await AuthService.signOut();
  };

  // The Firestore rule denies the read entirely for non-whitelisted
  // users (it can't selectively allow "read your own row but nothing
  // else" without risking info leaks). So both `permission denied` and
  // `doc doesn't exist` collapse to the same answer: not whitelisted.
  private checkWhitelist = async (email: string): Promise<boolean> => {
    try {
      const { db } = getFirebase();
      const ref = doc(db, 'allowedEmails', email.toLowerCase());
      const snap = await getDoc(ref);
      return snap.exists();
    } catch {
      return false;
    }
  };
}

export const authStore = new AuthStore();
