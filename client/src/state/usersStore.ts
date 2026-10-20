import { create } from 'zustand';
import { collection, onSnapshot, doc, setDoc, deleteDoc, query, orderBy } from 'firebase/firestore';
import type { User as FbUser } from 'firebase/auth';
import { getFirebase } from '@/firebase/init';
import { readLastKnown, writeLastKnown } from '@/services/lastKnown';
import { userSchema, type User } from '@common/User';
import { normalizeAuMobile } from '@common/mobile';

/**
 * The model subscribe-and-hold store (docs/CLAUDE-OFFLINE.md): one live
 * listener for the session, the rows held in memory, every screen reads
 * from here and never from the server. Copy this shape for a new
 * collection.
 */
type UsersState = {
  users: User[];
  /** True once Firestore has answered (from its cache or the server) —
   * NOT when the last-known copy painted. */
  loaded: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
  add: (mobile: string, addedBy: string) => void;
  remove: (mobile: string) => void;
  recordSignIn: (user: FbUser) => void;
};

const COLLECTION = 'users';

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

    // First paint from the app's own last-known copy — unless Firestore
    // has already delivered by the time it reads back.
    void readLastKnown(COLLECTION, userSchema).then((rows) => {
      if (rows && unsub && !useUsersStore.getState().loaded)
        useUsersStore.setState({ users: rows });
    });

    const q = query(collection(db, COLLECTION), orderBy('addedAt', 'asc'));
    unsub = onSnapshot(
      q,
      (snap) => {
        // A row that doesn't fit the schema is skipped, not thrown on: a
        // throw inside this callback would stop the listener for good and
        // freeze the list for everyone.
        const users: User[] = [];
        for (const d of snap.docs) {
          const parsed = userSchema.safeParse(d.data());
          if (parsed.success) users.push(parsed.data);
          else console.warn('users: skipping malformed row', d.id, parsed.error.issues);
        }
        useUsersStore.setState({ users, loaded: true, error: null });
        writeLastKnown(COLLECTION, users);
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

  // Writes return on the LOCAL write, never the server ack: with the
  // persistent cache on, an awaited setDoc hangs for the whole of an
  // outage. Validation throws before the write; the write itself is
  // queued by the SDK and the listener above echoes it at once.
  // Normalise before writing: the doc id has to match the phone_number
  // claim exactly or the invited person signs in and is bounced as "not
  // on the list" — the one failure mode worth spending a line to prevent.
  add: (mobile, addedBy) => {
    const e164 = normalizeAuMobile(mobile);
    if (!e164) throw new Error('Not an Australian mobile — like 0412 345 678');
    const { db } = getFirebase();
    const row = userSchema.parse({
      mobile: e164,
      admin: true,
      addedAt: Date.now(),
      addedBy,
    } satisfies User);
    setDoc(doc(db, COLLECTION, e164), row).catch((e) =>
      useUsersStore.setState({ error: (e as Error).message }),
    );
  },

  remove: (mobile) => {
    const { db } = getFirebase();
    deleteDoc(doc(db, COLLECTION, mobile)).catch((e) =>
      useUsersStore.setState({ error: (e as Error).message }),
    );
  },

  // Called once per successful sign-in. Enriches the existing whitelist
  // row with the now-available Firebase uid and the current sign-in
  // timestamp. setDoc with merge so we don't clobber `admin`, `addedBy`.
  // A user who isn't whitelisted fails this write (rules) and is then
  // bounced by the AppLayout gate — the intended outcome, so the
  // rejection is swallowed rather than shown.
  recordSignIn: (user) => {
    if (!user.phoneNumber) return;
    const { db } = getFirebase();
    setDoc(
      doc(db, COLLECTION, user.phoneNumber),
      { uid: user.uid, lastSignInAt: Date.now() },
      { merge: true },
    ).catch(() => {});
  },
}));
