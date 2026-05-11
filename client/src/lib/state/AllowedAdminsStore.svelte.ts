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
import type { AllowedAdmin } from '$lib/types/AllowedAdmin';

class AllowedAdminsStore {
  admins = $state<AllowedAdmin[]>([]);
  loaded = $state(false);
  error = $state<string | null>(null);
  private unsub: (() => void) | null = null;

  start = () => {
    if (this.unsub) return;
    const { db } = getFirebase();
    const q = query(collection(db, 'allowedAdmins'), orderBy('addedAt', 'asc'));
    this.unsub = onSnapshot(
      q,
      (snap) => {
        this.admins = snap.docs.map((d) => d.data() as AllowedAdmin);
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
    await setDoc(doc(db, 'allowedAdmins', e), {
      email: e,
      addedAt: Date.now(),
      addedBy
    } satisfies AllowedAdmin);
  };

  remove = async (email: string) => {
    const { db } = getFirebase();
    await deleteDoc(doc(db, 'allowedAdmins', email.trim().toLowerCase()));
  };
}

export const allowedAdminsStore = new AllowedAdminsStore();
