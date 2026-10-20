// The app's OWN last-known copy of a held collection — the first thing a
// screen paints at boot, before Firestore has said a word.
//
// Firestore's persistent cache is cache-first, but the SDK will not open
// it until Firebase Auth has delivered the first token, and Auth's boot
// reloads the user from Google first (a token refresh when the last is
// over an hour old, plus an account lookup every time). Fully offline
// those requests fail at once and Auth falls back to the stored user;
// on BAD reception they hang to their 30s timeouts, and every held
// collection sits blank behind them. So: keep a copy the app controls,
// paint from it immediately, and let Firestore overwrite it when it
// lands. docs/CLAUDE-OFFLINE.md § The last-known copy.
//
// IndexedDB, not localStorage: structured clone stores the parsed rows as
// they are, with no size ceiling worth worrying about. Keyed by collection
// name — this app is single-tenant, so there is no account to key by.
// Rows go back through their zod schema on the way out, so a copy written
// by an older build can only lose the rows that no longer parse, never
// wedge a store. Every call is best-effort: a browser with no IndexedDB
// (private mode, a blocked origin) just boots the old way.

/** The slice of a zod schema this needs — structural, so the client's
 * and functions' zod versions never have to agree on a type. */
type Schema<T> = { safeParse: (v: unknown) => { success: true; data: T } | { success: false } };

const DB_NAME = 'if-last-known';
const STORE = 'collections';
/** Coalesce a burst of snapshots (a sync catching up after signal
 * returns fires one per batch) into one write. */
const WRITE_DEBOUNCE_MS = 500;

const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * The stored rows for one collection, re-validated per row, in the order
 * they were written (the store's own sort). Null when nothing is held
 * here or the store can't be read — a caller treats both as "boot the
 * old way".
 */
export async function readLastKnown<T>(name: string, schema: Schema<T>): Promise<T[] | null> {
  try {
    const db = await openDb();
    const raw = await new Promise<unknown>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!Array.isArray(raw)) return null;
    const rows: T[] = [];
    for (const r of raw) {
      const parsed = schema.safeParse(r);
      if (parsed.success) rows.push(parsed.data);
    }
    return rows;
  } catch {
    return null;
  }
}

/** Replace the stored rows for one collection. Debounced and
 * fire-and-forget: the copy is at most one snapshot behind, never a
 * write the caller waits on. */
export function writeLastKnown(name: string, rows: readonly unknown[]): void {
  const pending = pendingWrites.get(name);
  if (pending) clearTimeout(pending);
  pendingWrites.set(
    name,
    setTimeout(() => {
      pendingWrites.delete(name);
      void (async () => {
        try {
          const db = await openDb();
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(rows, name);
          await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
          });
          db.close();
        } catch (e) {
          console.error('last-known copy write failed', name, e);
        }
      })();
    }, WRITE_DEBOUNCE_MS),
  );
}
