import type { SpellChecker } from "@/writing/spelling";

/** Run state of the in-app checker. Mirrors `useSpellcheck` without importing that client hook. */
export type SpellcheckRunStatus = "off" | "loading" | "ready" | "error";

/**
 * What the manuscript footer may say about spelling.
 * "clear" is the only state that may read "No spelling issues", and only after
 * the app checker has finished a check. The browser checker cannot report a count.
 */
export type SpellingFooterKind = "checking" | "disabled" | "unavailable" | "failed" | "clear" | "issues";

export function spellingFooterKind(input: {
  checker: SpellChecker;
  status: SpellcheckRunStatus;
  issueCount: number;
  /** True after the app checker has applied a completed check, not merely loaded its dictionary. */
  checkCompleted: boolean;
}): SpellingFooterKind {
  if (input.checker !== "app") return "unavailable";
  if (input.status === "off") return "disabled";
  if (input.status === "error") return "failed";
  if (input.status !== "ready" || !input.checkCompleted) return "checking";
  return input.issueCount > 0 ? "issues" : "clear";
}
