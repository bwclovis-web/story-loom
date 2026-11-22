import { hoverTooltip, tooltips } from "@codemirror/view";
import type { CodexEntry } from "@/writing/codexSuggest";
import { nameFromTitle } from "@/writing/crossRefs";

/**
 * Hover tip for recognized codex names and [[wiki]] links. Read-only peek;
 * does not write records.
 *
 * Matches full titles, the bare name from "Title — Kind" headings, aliases,
 * and (for multi-word names) first/last name parts — same idea as manuscript
 * cross-ref scanning. Tooltips mount on document.body so write-mode overflow
 * does not clip them.
 */
export function codexHoverExtension(entries: readonly CodexEntry[]) {
  if (!entries.length) return [];

  const index = buildCodexIndex(entries);

  return [
    tooltips({ parent: typeof document !== "undefined" ? document.body : undefined }),
    hoverTooltip(
      (view, pos) => {
        const line = view.state.doc.lineAt(pos);
        const hit = findCodexHitInLine(line.text, pos - line.from, index);
        if (!hit) return null;
        return {
          pos: line.from + hit.from,
          end: line.from + hit.to,
          above: true,
          create() {
            const dom = document.createElement("div");
            dom.className = "cm-codex-peek";
            const aliases = hit.entry.aliases.length
              ? ` (${hit.entry.aliases.slice(0, 3).join(", ")})`
              : "";
            const bare = nameFromTitle(hit.entry.title) ?? hit.entry.title;
            const label = document.createElement("div");
            label.textContent = `${bare}${aliases}`;
            dom.appendChild(label);
            if (bare !== hit.entry.title) {
              const kind = document.createElement("div");
              kind.className = "cm-codex-peek-kind";
              kind.textContent = hit.entry.title;
              dom.appendChild(kind);
            }
            return { dom };
          },
        };
      },
      { hoverTime: 200 },
    ),
  ];
}

export interface CodexHoverHit {
  from: number;
  to: number;
  entry: CodexEntry;
}

export interface CodexHoverIndex {
  byTerm: Map<string, CodexEntry>;
  terms: readonly string[];
}

export function buildCodexIndex(entries: readonly CodexEntry[]): CodexHoverIndex {
  const byTerm = new Map<string, CodexEntry>();
  for (const entry of entries) {
    for (const term of termsFor(entry)) {
      const key = term.toLocaleLowerCase();
      if (!byTerm.has(key)) byTerm.set(key, entry);
    }
  }
  return { byTerm, terms: [...byTerm.keys()].sort((a, b) => b.length - a.length) };
}

/** Pure line matcher used by the hover tip (and unit tests). */
export function findCodexHitInLine(
  text: string,
  offset: number,
  index: CodexHoverIndex,
): CodexHoverHit | null {
  const { byTerm, terms } = index;
  const wiki = /\[\[[^\]]+\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = wiki.exec(text))) {
    const from = match.index;
    const to = from + match[0].length;
    if (offset < from || offset > to) continue;
    const inner = match[0].slice(2, -2).trim();
    const entry = byTerm.get(inner.toLocaleLowerCase());
    if (entry) return { from, to, entry };
  }

  const lower = text.toLocaleLowerCase();
  for (const term of terms) {
    let from = 0;
    while (from <= lower.length - term.length) {
      const at = lower.indexOf(term, from);
      if (at < 0) break;
      const end = at + term.length;
      if (offset >= at && offset <= end && isNameBoundary(text, at, end)) {
        const entry = byTerm.get(term);
        if (entry) return { from: at, to: end, entry };
      }
      from = at + 1;
    }
  }
  return null;
}

/** Indexable spellings for one codex row. */
export function termsFor(entry: CodexEntry): string[] {
  const out = new Set<string>();
  const title = entry.title.trim();
  if (title) out.add(title);
  const bare = nameFromTitle(entry.title);
  if (bare) {
    out.add(bare);
    const words = bare.split(/\s+/);
    if (words.length >= 2) {
      for (const word of [words[0], words[words.length - 1]]) {
        if (word && word.length >= 3 && /^\p{L}/u.test(word)) out.add(word);
      }
    }
  }
  for (const alias of entry.aliases) {
    const a = alias.trim();
    if (a.length >= 2) out.add(a);
  }
  return [...out];
}

function isNameBoundary(text: string, start: number, end: number): boolean {
  const before = start === 0 || !/[\p{L}\p{N}'’]/u.test(text[start - 1]!);
  const after = end >= text.length || !/[\p{L}\p{N}'’]/u.test(text[end]!);
  return before && after;
}
