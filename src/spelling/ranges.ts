import { mapText, mapUntouched } from "@/proofread/apply";

/**
 * Moves ranges found in `from` to where they are in `to`. A range is dropped
 * when its characters or the characters right next to it changed, because
 * the word it marked may now be different; the next check finds it again.
 */
export function mapRanges<T extends { start: number; end: number }>(from: string, to: string, ranges: readonly T[]): T[] {
  if (from === to || ranges.length === 0) return [...ranges];
  const map = mapText(from, to);
  const out: T[] = [];
  for (const r of ranges) {
    const at = mapUntouched(map, r.start, r.end);
    if (at) out.push({ ...r, start: at.start, end: at.end });
  }
  return out;
}
