import { create } from 'zustand';
import type { User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { AuthService } from '@/services/AuthService';
import { getFirebase } from '@/firebase/init';

// Who is signed in, and are they on the whitelist. One store, subscribed
// to Firebase once for the whole page session (see the bottom of this
// file). Importing this module is what causes Firebase to initialize.
type AuthState = {
  user: User | null;
  /** null = not yet known, true/false = result of the user-whitelist check. */
  isAdmin: boolean | null;
  loaded: boolean;
  signOut: () => Promise<void>;
};

export const useAuthStore = create<AuthState>(() => ({
  user: null,
  isAdmin: null,
  loaded: false,
  signOut: async () => {
    await AuthService.signOut();
  },
}));

// The Firestore rule denies the read entirely for non-admin users
// (it can't selectively allow "read your own row but nothing else"
// without risking info leaks). So both `permission denied` and
// `doc doesn't exist` collapse to the same answer: not an admin.
//
// `mobile` comes straight from Firebase's phone_number claim, which is
// already E.164 — no normalising here, and none wanted: normalising a
// claim would mask a whitelist row stored in the wrong shape.
async function checkAdmin(mobile: string): Promise<boolean> {
  try {
    const { db } = getFirebase();
    const snap = await getDoc(doc(db, 'users', mobile));
    return snap.exists();
  } catch {
    return false;
  }
}

// Module-scope subscription, started once on first import and never torn
// down — the signed-in identity outlives every component. Deliberately
// NOT in a useEffect: React StrictMode double-mounts in dev, and auth
// state is not per-component state.
AuthService.observe(async (user) => {
  if (!user || !user.phoneNumber) {
    useAuthStore.setState({ user, isAdmin: null, loaded: true });
    return;
  }
  const isAdmin = await checkAdmin(user.phoneNumber);
  useAuthStore.setState({ user, isAdmin, loaded: true });
});
