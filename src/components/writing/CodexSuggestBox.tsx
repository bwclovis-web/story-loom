"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Atoms/Button";
import { WRITE } from "@/ui/labels";
import { codexTrigger, insertCodexTitle, matchCodex, type CodexEntry } from "@/writing/codexSuggest";

export function CodexSuggestBox({
  entries,
  text,
  cursor,
  onApply,
  onLink,
}: {
  entries: readonly CodexEntry[];
  text: string;
  cursor: number;
  onApply: (next: { text: string; cursor: number }) => void;
  onLink?: (entry: CodexEntry) => void;
}) {
  const trigger = codexTrigger(text, cursor);
  const matches = useMemo(() => (trigger ? matchCodex(entries, trigger.query) : []), [entries, trigger]);
  const [linked, setLinked] = useState<string | null>(null);
  if (!trigger || matches.length === 0) return null;
  return (
    <div className="codex-suggest" role="listbox" aria-label={WRITE.codexSuggest}>
      {matches.map((entry) => (
        <div key={entry.id} className="codex-suggest-row">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onApply(insertCodexTitle(text, trigger, entry.title))}
          >
            {entry.title}
          </Button>
          {onLink ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={linked === entry.id}
              onClick={() => {
                onLink(entry);
                setLinked(entry.id);
              }}
            >
              {linked === entry.id ? WRITE.codexLinked : WRITE.codexLink}
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
