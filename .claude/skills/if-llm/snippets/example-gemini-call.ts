// Reference: calling Gemini on Vertex AI from a Cloud Function.
//
// Lifted and de-specialised from a real project (sih-tenders). Treat this as
// inspiration, not an API — names, schema, and batch sizes are yours to shape.
//
// WHY VERTEX, NOT THE GEMINI DEVELOPER API: the Developer API authenticates
// with an API key and bills a *separate* AI-Studio prepaid-credits pool — it
// returns 429 "prepayment credits depleted" even when the project's Cloud
// Billing is enabled. Vertex AI runs the identical Gemini models but bills the
// project's Cloud Billing account directly, authenticated by the function's own
// service account (ADC). No API key. The if stack pre-provisions this:
// aiplatform.googleapis.com enabled + the runtime SA holding roles/aiplatform.user.

import { GoogleAuth } from 'google-auth-library';

// ADC: the Cloud Functions runtime service account authenticates itself.
// The cloud-platform scope covers Vertex.
let _auth: GoogleAuth | null = null;
function authClient(): GoogleAuth {
  return (_auth ??= new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' }));
}

// Structured-output schema. NOTE: Vertex uses UPPERCASE type names
// (ARRAY/OBJECT/STRING/NUMBER/BOOLEAN), not JSON-Schema lowercase.
// Shape this to whatever you want back. Example below: classify each record
// into a closed set of labels, with the id echoed so results map to inputs.
const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      id: { type: 'STRING' },
      label: { type: 'STRING', enum: ['yes', 'maybe', 'no'] },
      reason: { type: 'STRING' },
    },
    required: ['id', 'label'],
  },
};

type Result = { id: string; label: string; reason?: string };

/**
 * Run one structured Gemini call over a batch of records on Vertex AI.
 * - No-op (returns []) when there's no real GCP project (the emulator runs as
 *   demo-*), so local dev never errors.
 * - Retries 429/503 with backoff; other errors drop the batch (caller keeps
 *   whatever it had before — a failed record isn't overwritten with garbage).
 * - Concatenates ALL response parts (newer "thinking" models emit several),
 *   then defensively regex-extracts the JSON array before parsing.
 */
async function classifyBatch(
  systemPrompt: string,
  records: { id: string; text: string }[],
): Promise<Result[]> {
  if (records.length === 0) return [];

  const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (!project || project.startsWith('demo-')) {
    console.warn(`LLM skipped — no real GCP project (project=${project ?? 'unset'})`);
    return [];
  }
  // Default to your functions region; override per project. 'global' also works.
  const location = process.env.GEMINI_LOCATION || 'australia-southeast1';
  // Don't trust a model name from memory — newer Flash models ship often. List
  // them live (.../publishers/google/models) and pick the newest stable Flash.
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  const url = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;

  let token: string | null | undefined;
  try {
    token = await authClient().getAccessToken();
  } catch (e) {
    console.error(`LLM: failed to get ADC token — ${(e as Error).message}`);
    return [];
  }
  if (!token) return [];

  const userContent =
    'Classify these records:\n\n' +
    records.map((r) => JSON.stringify({ id: r.id, text: r.text.slice(0, 500) })).join('\n');

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userContent }] }],
          generationConfig: {
            temperature: 0, // deterministic for classify/extract; raise for creative text
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
      });

      if (res.status === 429 || res.status === 503) {
        const waitMs = [5000, 15000, 30000, 60000][attempt] ?? 60000;
        console.warn(`Vertex ${res.status} (attempt ${attempt + 1}), waiting ${waitMs / 1000}s…`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      if (!res.ok) {
        console.error(`Vertex API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
        return [];
      }

      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.error('No JSON array in Vertex response:', text.slice(0, 200));
        return [];
      }
      return JSON.parse(jsonMatch[0]) as Result[];
    } catch (e) {
      console.error(`Vertex batch error (attempt=${attempt}): ${(e as Error).message}`);
      return [];
    }
  }
  return [];
}

// ── Scaling: chunk + cap (Rung 2/3) ──────────────────────────────────────────
// One call handles a batch (~15 records is a good size). For more, loop in
// chunks. Cap per run so a backlog can't run up a surprise bill — the overflow
// is picked up on the next run.
export async function classifyAll(
  systemPrompt: string,
  all: { id: string; text: string }[],
): Promise<Result[]> {
  const CAP = Number(process.env.LLM_MAX_PER_RUN ?? 150);
  const work = all.slice(0, CAP);
  if (all.length > CAP) console.warn(`Capped at ${CAP}; ${all.length - CAP} left for next run.`);
  const out: Result[] = [];
  for (let i = 0; i < work.length; i += 15) {
    out.push(...(await classifyBatch(systemPrompt, work.slice(i, i + 15))));
  }
  return out;
}

// ── Few-shot from user feedback (optional, recommended) ───────────────────────
// To lift quality without fine-tuning, prepend a handful of the user's most
// recent corrections to the user content as labelled examples, e.g.:
//
//   GOOD MATCHES (confirmed by user):
//   - "<short record summary>"
//   NOT RELEVANT (rejected by user):
//   - "<short record summary>"
//
// Keep it small (~12 most-recent, mixed) and short (a line each) — it rides in
// every batch, so it costs tokens on every call.
</content>
