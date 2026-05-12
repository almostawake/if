import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  query,
  orderBy
} from 'firebase/firestore';
import { getFirebase } from '$lib/firebase/init';
import type { User } from '$types/User';

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
        this.users = snap.docs.map((d) => d.data() as User);
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
    await setDoc(doc(db, 'users', e), {
      email: e,
      addedAt: Date.now(),
      addedBy
    } satisfies User);
  };

  remove = async (email: string) => {
    const { db } = getFirebase();
    await deleteDoc(doc(db, 'users', email.trim().toLowerCase()));
  };
}

export const usersStore = new UsersStore();
