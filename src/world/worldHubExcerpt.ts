import { WORLD } from "@/ui/labels";

const EXCERPT_MAX = 220;

/**
 * Deterministic plain-text excerpt for World Hub reading cards.
 * Prefers author summary / Living World profile summary, then Markdown body
 * with syntax stripped. Never persists; never invents AI copy.
 */
export function worldHubReadingExcerpt(
  fields: Readonly<Record<string, unknown>>,
  body: string,
  emptyLabel: string = WORLD.noDescriptionYet,
): string {
  const summary = pickSummary(fields);
  if (summary) return clipPlain(summary, EXCERPT_MAX);
  const fromBody = markdownToPlain(body);
  if (fromBody) return clipPlain(fromBody, EXCERPT_MAX);
  return emptyLabel;
}

function pickSummary(fields: Readonly<Record<string, unknown>>): string {
  if (typeof fields.summary === "string" && fields.summary.trim()) return fields.summary.trim();
  const profile = fields.worldProfile;
  if (profile && typeof profile === "object" && !Array.isArray(profile)) {
    const summary = (profile as { summary?: unknown }).summary;
    if (typeof summary === "string" && summary.trim()) return summary.trim();
  }
  return "";
}

/** Strip common Markdown / HTML markers for card excerpts. */
export function markdownToPlain(source: string): string {
  return source
    .replace(/\r\n?/g, "\n")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[\t ]*[-*+]\s+/gm, "")
    .replace(/^[\t ]*\d+\.\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function clipPlain(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max - 1);
  const breakAt = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("—"), slice.lastIndexOf("-"));
  const clipped = (breakAt > max * 0.5 ? slice.slice(0, breakAt) : slice).trimEnd();
  return `${clipped}…`;
}
