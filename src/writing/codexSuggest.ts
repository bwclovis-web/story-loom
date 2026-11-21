export interface CodexEntry {
  id: string;
  title: string;
  aliases: readonly string[];
}

export interface CodexTrigger {
  start: number;
  end: number;
  query: string;
  kind: "wiki" | "at";
}

/** The unfinished `[[` or `@` the cursor is inside, if any. */
export function codexTrigger(text: string, cursor: number): CodexTrigger | null {
  const before = text.slice(0, Math.max(0, cursor));
  const wiki = /\[\[([^\]\n]*)$/.exec(before);
  if (wiki && wiki.index !== undefined) {
    return { start: wiki.index, end: cursor, query: wiki[1] ?? "", kind: "wiki" };
  }
  const at = /(?:^|\s)@([^\s@[]{0,60})$/.exec(before);
  if (at && at.index !== undefined) {
    const mark = at[0].lastIndexOf("@");
    return { start: at.index + mark, end: cursor, query: at[1] ?? "", kind: "at" };
  }
  return null;
}

export function matchCodex(entries: readonly CodexEntry[], query: string, limit = 8): CodexEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  const hits = entries.filter((entry) => {
    if (!needle) return true;
    const hay = [entry.title, ...entry.aliases].join("\n").toLocaleLowerCase();
    return hay.includes(needle);
  });
  return hits.slice(0, limit);
}

/** Replace the trigger with the reference's title. The prose stays plain Markdown. */
export function insertCodexTitle(text: string, trigger: CodexTrigger, title: string): { text: string; cursor: number } {
  const next = text.slice(0, trigger.start) + title + text.slice(trigger.end);
  return { text: next, cursor: trigger.start + title.length };
}
