// The search boxes' shared rules: every space-separated word has to
// appear somewhere in the text, in any order, case ignored.

/** The words typed, lower-cased — none for a blank box. */
export const searchTerms = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

/** Does every word appear in the text (already lower-cased)? A blank search matches everything. */
export const matchesAll = (text: string, terms: string[]) => terms.every((t) => text.includes(t));

/**
 * The text cut into pieces at each search word, for highlighting: a run of
 * plain text, then a matched word, and so on. Words that overlap are found
 * longest first; the case is the text's own.
 */
export function markTerms(text: string, terms: string[]): { text: string; hit: boolean }[] {
  const words = terms.filter(Boolean).sort((a, b) => b.length - a.length);
  if (!words.length || !text) return [{ text, hit: false }];
  const re = new RegExp(words.map(escape).join('|'), 'gi');
  const out: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index), hit: false });
    out.push({ text: m[0], hit: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
