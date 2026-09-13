import { create } from 'zustand';
import { collection, onSnapshot, doc, setDoc, deleteDoc, query, orderBy } from 'firebase/firestore';
import type { User as FbUser } from 'firebase/auth';
import { getFirebase } from '@/firebase/init';
import { userSchema, type User } from '@common/User';
import { normalizeAuMobile } from '@common/mobile';

type UsersState = {
  users: User[];
  loaded: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
  add: (mobile: string, addedBy: string) => Promise<void>;
  remove: (mobile: string) => Promise<void>;
  recordSignIn: (user: FbUser) => Promise<void>;
};

// The live Firestore listener handle. Module scope, not store state: it's
// plumbing, nothing renders from it, and keeping it out of the store means
// no component ever re-renders because a subscription was swapped.
let unsub: (() => void) | null = null;

export const useUsersStore = create<UsersState>(() => ({
  users: [],
  loaded: false,
  error: null,

  // Idempotent by design. React StrictMode mounts effects twice in dev, so
  // a second start() must be a no-op rather than a second listener.
  start: () => {
    if (unsub) return;
    const { db } = getFirebase();
    const q = query(collection(db, 'users'), orderBy('addedAt', 'asc'));
    unsub = onSnapshot(
      q,
      (snap) => {
        useUsersStore.setState({
          users: snap.docs.map((d) => userSchema.parse(d.data())),
          loaded: true,
        });
      },
      (err) => {
        useUsersStore.setState({ error: err.message, loaded: true });
      },
    );
  },

  stop: () => {
    unsub?.();
    unsub = null;
  },

  // Normalise before writing: the doc id has to match the phone_number
  // claim exactly or the invited person signs in and is bounced as "not
  // on the list" — the one failure mode worth spending a line to prevent.
  add: async (mobile, addedBy) => {
    const e164 = normalizeAuMobile(mobile);
    if (!e164) throw new Error('Not an Australian mobile — like 0412 345 678');
    const { db } = getFirebase();
    await setDoc(
      doc(db, 'users', e164),
      userSchema.parse({
        mobile: e164,
        admin: true,
        addedAt: Date.now(),
        addedBy,
      } satisfies User),
    );
  },

  remove: async (mobile) => {
    const { db } = getFirebase();
    await deleteDoc(doc(db, 'users', mobile));
  },

  // Called once per successful sign-in. Enriches the existing whitelist
  // row with the now-available Firebase uid and the current sign-in
  // timestamp. setDoc with merge so we don't clobber `admin`, `addedBy`.
  recordSignIn: async (user) => {
    if (!user.phoneNumber) return;
    const { db } = getFirebase();
    await setDoc(
      doc(db, 'users', user.phoneNumber),
      { uid: user.uid, lastSignInAt: Date.now() },
      { merge: true },
    );
  },
}));
