# Blueprint: process-with-llm — Assessment

**Scope: assessment only.** This decides *whether and how* the app should use an LLM — it does not build anything. When the assessment is done you present a verdict and a short plan, then **stop**. Build guidance comes later; reference code is in `snippets/`.

## Your job

The user wants the app to use AI to process something — classify, score, tag, extract fields, or summarise text or records. You've been told (in the command arguments) what they want done, and to what data; if not, ask. Then:

1. Work through the checks below.
2. Land on one **implementation type** (the "rungs" at the end).
3. Write a short plan to `llm-plan.md` in the project root, and present the verdict to the user.
4. **Stop.** Do not write the LLM code yet.

The user is a non-developer. Explain the verdict in plain terms: what the AI will do, where it runs, roughly what it will cost, how reliable it'll be, and anything that could make it a poor fit. Keep jargon minimal and offer to expand.

## How the stack does LLM calls (fixed — don't reinvent)

The if stack calls **Gemini on Vertex AI**, authenticated by the Cloud Function's own service account (ADC). It is **pre-provisioned** — `aiplatform.googleapis.com` is enabled and the runtime service account holds `roles/aiplatform.user`. There is **no API key**, and you should not introduce one.

- **Don't use the Gemini *Developer* API** (the `generativelanguage.googleapis.com` + API-key path). It bills a separate AI-Studio prepaid-credits pool and returns `429 "prepayment credits depleted"` *even when the project's Cloud Billing is enabled*. Vertex runs the identical Gemini models but bills the project's Cloud Billing account directly. This trap cost a day once — don't repeat it.
- **Model:** default to the newest stable **Flash** (cheap, fast, plenty for classification/extraction). Don't trust a model name from memory — new Flash models ship often; list them live (`publishers/google/models`) and pick the newest non-preview Flash. Use Pro only if Flash proves too weak.
- **Structured output:** ask for JSON via `responseSchema` (Vertex uses UPPERCASE types — `ARRAY`/`OBJECT`/`STRING`). Use `temperature: 0` for classify/extract; raise it only for creative text.

See `snippets/example-gemini-call.ts` for a complete, working call (ADC auth, structured output, retry, demo-safe).

## Gate questions (check first — any can stop or reshape the job)

- **Is an LLM even the right tool?** If the rule is deterministic — a keyword match, a lookup table, a regex, a fixed mapping — do *that* instead. It's free, instant, and never wrong in a surprising way. LLMs are for fuzzy judgement and open-ended text. Very often the best design is a **cheap deterministic pre-filter** that disposes of the easy/obvious cases, with the LLM called only on the ambiguous remainder — that's how the tenders app keeps its bill down (most records never reach the LLM).
- **Volume & cost.** How many records, how often? Every call costs real money against Cloud Billing. Batch many records into one call, cap how many you process per run, and only process *new* records — not the whole history every time.
- **Accuracy tolerance.** Is a wrong answer a minor annoyance or a real problem? LLMs are probabilistic — they will be wrong sometimes. For anything consequential, keep a human in the loop (see "Feedback" below).
- **Live or background?** Does the user need the answer *right now* in a request, or can it run in the background / on a schedule? This picks the rung.

## Branch — what shape is the output?

The task determines the `responseSchema`:

- **Classify / score** → a single field constrained to a closed set (`enum`). `temperature: 0`.
- **Tag (multi-label)** → an array of strings (optionally enum-constrained).
- **Extract fields** → an object with typed properties (the fields you want pulled out).
- **Summarise / rewrite / generate** → a string. `temperature` may be > 0.

Always include the record's **id** in the output so results map back to inputs.

## Branch — what triggers it?

- **Live, per request, low volume** → the answer is needed in the moment → **Rung 1**.
- **On demand, a set at a time** → the user clicks "process these" and waits / gets notified → **Rung 2**.
- **Continuous / growing dataset** → new records arrive over time and need processing without anyone asking → **Rung 3**.

## The implementation types (rungs)

- **Rung 1 — Inline sync call.** A callable (or HTTP handler) makes one Vertex call and returns the result to the user live. Lowest volume, needs the answer now (e.g. "summarise this one note I just wrote"). Simplest — no batching, no schedule.
- **Rung 2 — On-demand batch.** A user/admin action processes a set: batch ~15 records per call, structured output, retry on rate limits, cap per run. Good when a human triggers the work and can wait or be notified.
- **Rung 3 — Scheduled incremental.** A scheduled function processes only *new / not-yet-processed* records each run, behind a cheap deterministic pre-filter, capped per run, preserving prior results. Good for a dataset that grows on its own (the tenders pattern).

## Cross-cutting (every rung)

- **Batch + retry + cap** — ~15 records/call; retry `429`/`503` with backoff (`5s, 15s, 30s, 60s`); cap per run (e.g. `LLM_MAX_PER_RUN`) so a backlog can't run up a surprise bill.
- **Demo no-op** — skip the call when `GCLOUD_PROJECT` is unset or starts with `demo-` (the emulator), so local dev never errors.
- **Parse defensively** — concatenate *all* response parts (newer "thinking" models emit several), then extract the JSON array before parsing.
- **Feedback (optional, recommended)** — let the user correct results; feed the most recent corrections back into the prompt as labelled examples (few-shot). Cheap, no fine-tuning, noticeably lifts quality.

## Output

Write `llm-plan.md` in the project root with:

- **Task** — what the AI does, in one line.
- **Input → output** — what goes in, and the output shape (sketch the `responseSchema`).
- **Rung** — named, with where it runs (callable / scheduled).
- **Model** — which Gemini model (and a note to confirm it's still current).
- **Volume & cost posture** — rough record count × frequency; pre-filter and per-run cap if any.
- **Reliability** — accuracy tolerance and whether there's a human-review / feedback step.
- **Blockers / unknowns** — anything you couldn't determine or that needs the user.

Then present the same verdict to the user in plain language and **stop**. Do not start building.
</content>
