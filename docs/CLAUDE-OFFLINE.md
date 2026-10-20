# Offline — the contract every feature keeps

The app works with no signal. Not "tolerates" it: a screen opened with
no connection shows what it showed last time, instantly, and an edit
made there lands when the connection returns. Read this before adding
any collection, any store, any write, and any file.

Two halves. **Part 1, documents**, is built and is what `usersStore`
does today. **Part 2, files**, is design only — nothing in this repo
implements it yet; it records the shape to build to when the first
feature carries bytes (photos, PDFs, audio).

## What the promise covers

A day's work, not the archive. Everything a session has held is on the
device; what it never held is not. Outside the held window a read is a
query: online it works, offline it fails. Let the failure show as an
error; never narrate the rule in advance (§ UX rules).

**Not yet here:** a service worker / app shell. The *data* is on the
device, but the installed app does not boot offline yet — a reload with
no signal still needs the bundle from the network (or the browser's own
HTTP cache). Add the shell when a feature needs the installed app to
open cold with no signal.

---

# Part 1 — documents (built)

## Vocabulary — three words, keep them apart

- **Held** — physically on the device: instant, offline, possibly stale.
  For documents this is Firestore's own persistent cache
  (`client/src/firebase/init.ts`: IndexedDB, unlimited, shared across
  tabs). Everything a listener has ever delivered stays held, app closed
  or not.
- **Live** — subscribed with `onSnapshot`, receiving changes as they
  happen. Live is always a subset of held: you can only watch what you
  hold.
- **Pinned** — held *on purpose*: a standing subscription keeps the
  document on the device, as opposed to it being there because someone
  browsed past it. A session-scoped store's subscription is the pin;
  the unlimited cache means nothing evicts it.

## The store shape — subscribe and hold

`client/src/state/usersStore.ts` is the pattern. Every new collection
store copies it:

- `start()` opens ONE `onSnapshot` on the collection (or its window),
  guarded so a second call is a no-op. `stop()` closes it. The listener
  handle is module scope, not store state.
- Every snapshot replaces the rows wholesale (`setState({ rows, loaded:
  true, error: null })`). Rows that fail their zod schema are skipped
  with a `console.warn`, never thrown on — a throw inside the callback
  kills the listener for good.
- The error callback sets `error` and `loaded: true`. `loaded` means
  "Firestore has answered", from cache or server — not "the list is
  non-empty".
- Components read from the store, one field per selector
  (docs/CLAUDE-REACT.md § State). Nothing else reads the collection.

Session-scoped stores (needed on every screen — the whitelist, a
customer list, settings) start from `AppLayout`'s effect, once the gate
has passed. Page-scoped stores (one screen's data) start from that
page's effect. Promote to session scope only when a second screen needs
it, and remove the page-level start/stop in the same commit.

## Read from the store, never the server

Data a store holds is already on the device. Pick it out of the store
in memory:

```ts
const user = useUsersStore((s) => s.users.find((u) => u.mobile === mobile));
```

`getDoc`, `getDocs`, `getDocFromServer` and `getDocsFromServer` are
banned by lint (`client/eslint.config.js`, `no-restricted-imports`).
The one-shot reads go to the server first: online they block on a
round trip, with poor signal they stall for the whole outage, and a
cache fallback that never held the document answers "empty", which
reads as "doesn't exist".

For a single document no collection store holds, use a live single-doc
subscription — `onSnapshot(doc(...))` — as `authStore`'s whitelist watch
does: cache-first, instant, and it echoes later changes. If a one-shot
is genuinely unavoidable, `getDocFromCache` / `getDocsFromCache`: a
cache miss means "not held here", NOT "doesn't exist" — only a server
read is authoritative for absence.

## A failed read never masquerades as empty

A screen that could not read renders a failed read (the one red line,
docs/CLAUDE-REACT.md § Page chrome), never an empty list. Check
`error` before claiming "none". A snapshot with `metadata.fromCache`
and no rows, on a collection the device never held, is "unknown", not
"nothing" — `authStore` keeps the whitelist answer unknown in exactly
that case rather than signing the person out.

## The last-known copy — first paint is ours

Firestore will not open its cache until Firebase Auth has produced a
token, and Auth's boot first asks Google to reload the user. Fully
offline that fails fast; on one bar of signal it hangs tens of seconds,
and every held collection sits blank behind it.

So every session-scoped store keeps a copy the app owns
(`client/src/services/lastKnown.ts`, IndexedDB, keyed by collection
name — this app is single-tenant). Two lines, both already in
`usersStore`:

- `readLastKnown(name, schema)` in `start()`: paint from it unless
  Firestore has already delivered.
- `writeLastKnown(name, rows)` in the snapshot callback: every
  snapshot rewrites it (debounced).

The copy is for the FIRST PAINT only. Never read it after Firestore has
delivered, never write it from a local edit (the snapshot echo does
that), never treat it as a second source of truth. Rows come back
through their schema, so a copy from an older build can only lose rows,
never wedge a store. Page-scoped and windowed stores skip it: their
first paint is not what the app opens to.

## Windowing — collections that grow without bound

Hold a small whole-business set entire (the whitelist, settings). A
collection that grows per day or per user (logs, messages, readings)
gets a **window**: one standing query from a fixed back edge through
all future — the 1st of the previous calendar month is the standard
line, so every surface's reach agrees. A single-field range needs no
index; filter + range needs a composite in `firestore.indexes.json`.

Growth per year is the test, not row count today. Never cap a
collection silently: an unlogged cap reads as "we have everything".
Beyond the window a screen may query (online only) and must show the
failure when it fails — the edge belongs to the data, not to the page.

## Writes return on the local write

With the persistent cache on, `await setDoc(...)` resolves on the
SERVER ack, which with no signal is the end of the outage. So:

- Store write actions are synchronous: validate (throw before any
  write), then call `setDoc` / `deleteDoc` / `updateDoc` and return.
  `.catch` the promise into the store's `error`. The listener echoes
  the local write immediately, so the screen updates before the server
  has heard.
- Pages do not await writes and show no "saving" state. A bad value
  throws before the write and shows inline; a good one is on screen by
  the time the handler returns.
- Writes queue in the cache and drain in order when the connection
  returns. Rules rejections arrive then, through `.catch` — show them
  as the page's red line.

## UX rules that exist because of offline

- **No save buttons. Write as you edit.** Toggles, selects and taps
  write on change; free text writes debounced on input with a flush on
  blur and on leaving the screen. There is never anything unsaved, so
  no dirty state and no "unsaved changes" prompt. A button that *does a
  thing* (send, sign, add) is fine; a button whose only job is to
  commit already-entered fields is not. A creation form commits on its
  first valid state; a create button is a per-case owner decision.
- **Dismissal means close, never cancel.** Back, scrim, Escape leave.
  Never a control implying edits could be thrown away — they are
  already saved. Discard is a named action ("clear", "delete").
- **Writes return on the local write** (§ above). A click is answered
  at the click (docs/CLAUDE-REACT.md § Waiting).
- **Never narrate the offline rule.** No "works without signal", no
  "saved on this device, syncs later", no "check your connection"
  hints. Offline is felt, not described. The one place a next step may
  appear is an error ("couldn't load — try again"), as one clause.
- **A failed read is an error, not an empty state** (§ above).

---

# Part 2 — files (design only — nothing built yet)

Build to this when the first feature carries bytes. Nothing below
exists in this repo today.

## The fork — light vs heavy

One question per collection: **does each document drag a file behind
it** (image, PDF, audio in Cloud Storage)?

- **No → light.** Part 1 is the whole story. The subscription is the
  pin. No byte cache, no reconcile. Never copy heavy machinery onto a
  light collection.
- **Yes → heavy.** The document is metadata; the bytes live in
  Storage, which has no offline story at all — no cache, no queue, no
  retry. The app owns both directions itself.

## Custody — bytes on disk first, doc after

The capture handoff is the only moment the app holds the only copy of
something in page memory. Engineer it as a chain:

1. The bytes go into an on-device **upload queue** (IndexedDB) first,
   and the write is read back in a fresh transaction before it counts
   (a put can "complete" into a dead database). Time-box it; a wedged
   IndexedDB hangs rather than rejecting.
2. The Firestore doc is written after, status `pending`.
3. Half-states self-heal: bytes without a doc recreate the doc from the
   queue row; a doc without bytes cannot be created by a crash in this
   order. A doc still byte-less after an hour is stamped lost by the
   nightly reconcile (below).

Custody refused = loud, immediately: abort the capture before any
record exists and say "not saved — take it again".

## One upload lane

Every kind and size of file takes the same path. Per pass: mint a
resumable session per queued row (one callable, a batch at a time);
read the row's bytes fully into memory, then PUT (progress events feed
the ring); resume from the committed offset after a drop.

**The failure rule: rejected → park the row and carry on; unreachable →
stop and wait. Never delete either way.** A parked row keeps its place,
shows as stuck, and retries on reconnect or after a long interval. A
rejected row never sits at the head of the queue blocking the rest.

**Keep the row until the landing is recorded on the doc.** A Storage
trigger writes the landed object onto the doc; it reaches the device on
the doc's live subscription. Only then drop the row. A confirm callable
exists for repair past a grace period, not as the happy path. The doc
is the receipt; the row is the only reminder that one is owed.

## The byte cache and the pinned pack

Every displayed file is served read-through from a device-side byte
cache (IndexedDB, keyed `fileId/variant`): hit → instantly, offline
included; miss → signed URL → fetch → cached. Stored objects are
immutable — an edit is a new variant, never an overwrite — so cached
bytes never go stale. Unpinned rows live under a byte budget,
evict-oldest-used; pinned rows sit outside it.

A **pinned field pack** keeps every file in the held window on the
device, whether or not anyone opened it: a live windowed subscription
on the files collection (the same back edge as Part 1's window) is the
ONLY trigger. Each firing runs **reconcile**: compute the desired set
from the documents, diff against what the cache holds, pin what is
present, fetch what is missing, unpin what aged out. It ignores
per-document deltas on purpose and reconciles desired-vs-actual from
scratch every time, so it self-heals a failed download, an evicted
blob, a crash mid-fetch. Small variants (thumbs) first, then heavy
ones. Request persistent storage so the browser does not evict the
pack or the queue under disk pressure.

**Seed the cache after every upload**, with the very bytes just sent:
they are byte-identical to a download, and the file is now in the
pack's window — skip this and the device immediately pulls back down
what it just pushed up. Never narrow what the pack holds (by type, by
size, by cap) without the owner asking.

## The nightly reconcile — the net under all of it

A scheduled function walks every file doc against Storage: a doc
`pending` for over an hour with no bytes gets `bytesLostAt` stamped
(server-only field; the stamp lifts if bytes ever land); every object a
landed doc claims must exist. Clients render "lost" off that field
instead of an eternal placeholder.

## The sync ring

One indicator in the top bar (`HeaderRight`): two concentric arcs over
faint tracks — outer = sending (this device's unsent work), inner =
getting (the pack coming down); outer red = offline. Both tracks render
whenever the ring is visible. Measured in bytes, never file counts; the
sending count collapses to files, not queue rows.

## Access

Storage is private and every read is a callable-minted signed URL:
docs/CLAUDE-STACK.md § Storage privacy posture. Uploads mint resumable
sessions the same way. The client never touches a bucket directly.

## When the port happens — lift from acorn-for-arborists

- `client/src/lib/services/UploadQueueService.ts` — the two-store queue
  (bytes separate from bookkeeping).
- `client/src/lib/services/ImageCacheService.ts` — the byte cache,
  budget, pinning.
- `client/src/lib/state/SyncStore.svelte.ts` — the upload lane, custody
  handoffs, seeding.
- `client/src/lib/state/PrefetchStore.svelte.ts` — the pinned pack and
  reconcile.
- `client/src/lib/services/FileService.ts` — doc writes, variants, heal.
- `functions/src/files/*` — `startFileUpload`, `confirmFileUpload`,
  `getFileUrls` (`callables.ts`), `reconcile.ts`; the `fileObjectLanded`
  trigger in `functions/src/index.ts`.
- `functions/src/common/StoredFile.ts` — the schema (`bytesLostAt`,
  variants, `edit` pointer).
- `client/src/lib/components/SyncIndicator.svelte` — the ring.

Traps acorn paid for, one line each:

- Never rewrite a row's stored bytes; bookkeeping goes in a separate
  store, and a PUT sends bytes the app read into memory itself.
- A rejected upload is parked, never retried at the head of the queue;
  a transport failure stops the pass, never rotates.
- Keep the queue row until the doc records the landing.
- Seed the byte cache after EVERY upload, every file type.
- Cache the original's bytes at capture, not just derived variants.
- The ring counts files, not queue rows, and renders both tracks always.
- Display-warming dedupe keys on the landed-object record, not just
  file×variant.
- Check the load error before claiming a file is missing.
- Claim iOS pinch on touchstart, not touchmove; give the zoom box the
  file's aspect ratio.
