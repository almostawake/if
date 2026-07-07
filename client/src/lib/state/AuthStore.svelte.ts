import type { User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { AuthService } from '$lib/services/AuthService';
import { getFirebase } from '$lib/firebase/init';

// Singleton — constructor subscribes to onAuthStateChanged once, for the
// rest of the page session. Importing this module is what causes
// Firebase to initialize. The public `/` page imports it too (via
// AppHeader, to show sign-in state in the top bar), so Firebase Auth now
// initializes for anonymous visitors — read-only: they still have no
// data path (docs/CLAUDE-AUTH.md).
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
