// All inbound HTTP for this project lives in this one function. See docs/CLAUDE-API.md
// for the why and the conventions. tl;dr: one Cloud Run service = one cold-start shared
// across every route. Callables (`onCall`) and background triggers do NOT belong here —
// they're separate exports.

import express, {type NextFunction, type Request, type Response} from "express";
import {setGlobalOptions} from "firebase-functions/v2";
import {onRequest} from "firebase-functions/v2/https";

// Pin every function in this codebase to Sydney. Matches the Firestore + Storage region
// set up by the new-project provisioner. Override per-function only if there's a reason.
setGlobalOptions({region: "australia-southeast1"});

const app = express();
app.use(express.json());

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

// SCAFFOLD — replace this catch-all with real routes when you add the first one.
// Real routes look like: `app.get('/widgets', handler)` / `app.post('/widgets', handler)`.
// After adding real routes, swap this handler for a 404:
//   app.use((_req, res) => res.status(404).json({error: "not found"}));
app.use((_req, res) => {
  res.status(200).json({
    ok: true,
    message: "Next, you will add something useful to this API.",
  });
});

export const api = onRequest(app);
