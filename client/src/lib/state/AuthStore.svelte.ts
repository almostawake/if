import type { User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { AuthService } from '$lib/services/AuthService';
import { getFirebase } from '$lib/firebase/init';

// Singleton — constructor subscribes to onAuthStateChanged once, for the
// rest of the page session. Importing this module is what causes
// Firebase to initialize, so it's deliberately NOT imported from the
// root layout: the public `/` route stays Firebase-free. Only routes
// that actually need auth (/admin, /login) import it.
class AuthStore {
  user = $state<User | null>(null);
  /** null = not yet known, true/false = result of the user-whitelist check. */
  isAdmin = $state<boolean | null>(null);
  loaded = $state(false);

  constructor() {
    AuthService.observe(async (u) => {
      this.user = u;
      if (!u || !u.email) {
        this.isAdmin = null;
      } else {
        this.isAdmin = await this.checkAdmin(u.email);
      }
      this.loaded = true;
    });
  }

  signOut = async () => {
    await AuthService.signOut();
  };

  // The Firestore rule denies the read entirely for non-admin users
  // (it can't selectively allow "read your own row but nothing else"
  // without risking info leaks). So both `permission denied` and
  // `doc doesn't exist` collapse to the same answer: not an admin.
  private checkAdmin = async (email: string): Promise<boolean> => {
    try {
      const { db } = getFirebase();
      const ref = doc(db, 'users', email.toLowerCase());
      const snap = await getDoc(ref);
      return snap.exists();
    } catch {
      return false;
    }
  };
}

export const authStore = new AuthStore();
