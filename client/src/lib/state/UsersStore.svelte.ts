import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  query,
  orderBy
} from 'firebase/firestore';
import type { User as FbUser } from 'firebase/auth';
import { getFirebase } from '$lib/firebase/init';
import { userSchema, type User } from '$common/User';

class UsersStore {
  users = $state<User[]>([]);
  loaded = $state(false);
  error = $state<string | null>(null);
  private unsub: (() => void) | null = null;

  start = () => {
    if (this.unsub) return;
    const { db } = getFirebase();
    const q = query(collection(db, 'users'), orderBy('addedAt', 'asc'));
    this.unsub = onSnapshot(
      q,
      (snap) => {
        this.users = snap.docs.map((d) => userSchema.parse(d.data()));
        this.loaded = true;
      },
      (err) => {
        this.error = err.message;
        this.loaded = true;
      }
    );
  };

  stop = () => {
    this.unsub?.();
    this.unsub = null;
  };

  add = async (email: string, addedBy: string) => {
    const e = email.trim().toLowerCase();
    if (!e) throw new Error('Email is required');
    const { db } = getFirebase();
    await setDoc(doc(db, 'users', e), userSchema.parse({
      email: e,
      admin: true,
      addedAt: Date.now(),
      addedBy
    } satisfies User));
  };

  remove = async (email: string) => {
    const { db } = getFirebase();
    await deleteDoc(doc(db, 'users', email.trim().toLowerCase()));
  };

  // Called once per successful email-link sign-in. Enriches the
  // existing whitelist row with the now-available Firebase uid and
  // the current sign-in timestamp. setDoc with merge so we don't
  // clobber `admin`, `addedBy`, etc.
  recordSignIn = async (user: FbUser) => {
    if (!user.email) return;
    const { db } = getFirebase();
    await setDoc(
      doc(db, 'users', user.email.toLowerCase()),
      { uid: user.uid, lastSignInAt: Date.now() },
      { merge: true }
    );
  };
}

export const usersStore = new UsersStore();
