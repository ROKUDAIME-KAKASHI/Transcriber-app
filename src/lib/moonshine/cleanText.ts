/**
 * Tidies raw model output for one phrase.
 *
 * Small speech models sometimes get stuck repeating themselves on noise or cut-off audio
 * ("and what you can do and what you can do and what you can do…"), or return only
 * punctuation for a cough. This keeps real speech intact and removes those artefacts.
 */

/** Same 1–6 word run repeated this many times in a row = a model loop, not speech. */
const LOOP_REPEATS: Record<number, number> = { 1: 4, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3 };

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

/** True if the text contains a repetition loop (used by the worker to retry with stricter decoding). */
export function hasLoop(text: string): boolean {
  return collapseLoops(text.split(/\s+/).filter(Boolean)).length !== text.split(/\s+/).filter(Boolean).length;
}

function collapseLoops(words: string[]): string[] {
  const keys = words.map(norm);
  const out: string[] = [];
  const outKeys: string[] = [];
  let i = 0;
  while (i < words.length) {
    let skipped = false;
    for (let n = 6; n >= 1; n--) {
      if (i + n * LOOP_REPEATS[n] > words.length) continue;
      const unit = keys.slice(i, i + n).join(" ");
      if (!unit.trim()) continue;
      let reps = 1;
      while (keys.slice(i + reps * n, i + (reps + 1) * n).join(" ") === unit) reps++;
      if (reps >= LOOP_REPEATS[n]) {
        // Keep one copy (two for single words: "no, no" is normal speech).
        const keep = n === 1 ? 2 : 1;
        for (let k = 0; k < n * keep; k++) { out.push(words[i + k]); outKeys.push(keys[i + k]); }
        i += reps * n;
        skipped = true;
        break;
      }
    }
    if (!skipped) { out.push(words[i]); outKeys.push(keys[i]); i++; }
  }
  return out;
}

export function cleanPhrase(raw: string): string {
  let text = raw.replace(/\s+/g, " ").trim();
  if (!/[\p{L}\p{N}]/u.test(text)) return ""; // only punctuation / symbols
  text = collapseLoops(text.split(" ")).join(" ");
  // Model output sometimes starts lowercase after a cut; bubbles read better capitalised.
  text = text.replace(/^(["'(]?)(\p{Ll})/u, (_, q: string, c: string) => q + c.toUpperCase());
  // Spaces before punctuation (" ,") from token joins.
  text = text.replace(/\s+([,.!?;:])/g, "$1");
  return text;
}
