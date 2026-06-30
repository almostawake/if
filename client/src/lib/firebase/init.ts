import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';

// Local-only fallback config. `demo-not-required` is the Firebase emulator
// convention for "demo project" mode — no real Firebase project needed for
// `npm run start:emulators`. Production builds override these via the
// VITE_FIREBASE_* env vars in client/.env.
//
// `projectId` is force-pinned to `demo-not-required` in DEV regardless of
// what client/.env says: the emulator hub, firestore.rules, and
// cmd-seed-user.mjs all live under that id, and the Firestore emulator
// namespaces data + rule evaluation per requested projectId even in
// single-project mode — so a real prod projectId in client/.env splits the
// namespace and admin reads 403 against an empty `users` collection.
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'demo-key',
  // authDomain is the host that serves the Firebase Auth helper (/__/auth/*),
  // and therefore the host baked into every email magic-link. Set it to the
  // *current* host at runtime so the link always matches the URL the user is
  // signing in from — every Firebase-Hosting-connected + Auth-authorised
  // domain serves the handler same-origin, so no rebuild-per-domain is needed.
  // `window` is undefined during prerender and the auth emulator ignores
  // authDomain in DEV, so both fall back to the build-time env var.
  authDomain:
    !import.meta.env.DEV && typeof window !== 'undefined'
      ? window.location.host
      : (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'demo-not-required.web.app'),
  projectId: import.meta.env.DEV
    ? 'demo-not-required'
    : (import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'demo-not-required'),
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? 'demo-not-required.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '000000000000',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '1:000000000000:web:0000000000000000000000'
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

export function getFirebase() {
  if (!app) {
    app = getApps()[0] ?? initializeApp(config);
    auth = getAuth(app);
    db = getFirestore(app);

    if (import.meta.env.DEV) {
      // Emulator wiring. The `disableWarnings` flag silences the giant red
      // banner that the auth SDK injects in dev — useful info, but noisy
      // for our purposes.
      connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
      connectFirestoreEmulator(db, 'localhost', 8080);
    }
  }
  return { app: app!, auth: auth!, db: db! };
}
