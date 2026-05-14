// All inbound HTTP for this project lives in this one function. See docs/CLAUDE-API.md
// for the why and the conventions. tl;dr: one Cloud Run service = one cold-start shared
// across every route. Callables (`onCall`) and background triggers do NOT belong here —
// they're separate exports.

import express, {type NextFunction, type Request, type Response} from "express";
import {initializeApp, getApps} from "firebase-admin/app";
import {setGlobalOptions} from "firebase-functions/v2";
import {onRequest} from "firebase-functions/v2/https";
import oauthRouter from "./api/oauth";

if (!getApps().length) initializeApp();

// Functions deploy to the same region as the project's Firestore database.
// cmd-deploy.mjs looks that region up (it's immutable — set at project
// creation) and injects it as FIREBASE_REGION, so functions always sit with
// their data and there's no hardcoded region to drift. The emulator has no
// deploy wrapper, so it keeps the legacy constant. TODO(emulator): give the
// emulator a real region source in the emulator pass.
const region =
  process.env.FIREBASE_REGION ??
  (process.env.FUNCTIONS_EMULATOR ? "australia-southeast1" : undefined);
if (!region) {
  throw new Error(
    "FIREBASE_REGION not set — deploy via `npm run deploy*`, which looks the " +
    "region up from the project's Firestore location. See docs/CLAUDE-STACK.md.",
  );
}
setGlobalOptions({region});

const app = express();
app.use(express.json());

// Public browser-facing routes (no bearer required). End users click /consent in
// their browser — they don't carry the shared secret. Keep this short and explicit;
// see CLAUDE-API.md → "Public browser-facing routes".
app.use(oauthRouter);

// Bearer-token gate. Reads the shared secret from functions/.env (Gen 2 auto-loads it).
// Every route below this middleware requires `Authorization: Bearer <secret>`.
app.use((req: Request, res: Response, next: NextFunction) => {
  const expected = process.env.CODE_THAT_OTHER_SERVICES_NEED_TO_GET_PAST_OUR_BOUNCER;
  if (!expected) {
    console.error("CODE_THAT_OTHER_SERVICES_NEED_TO_GET_PAST_OUR_BOUNCER not set in functions/.env");
    res.status(500).json({error: "server misconfigured"});
    return;
  }
  const header = req.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (supplied !== expected) {
    res.status(401).json({error: "unauthorized"});
    return;
  }
  next();
});

app.use((_req, res) => res.status(404).json({error: "not found"}));

export const api = onRequest(app);
