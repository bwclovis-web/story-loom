"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import {
  findMatches,
  findRegexMatches,
  invertEdit,
  matchAt,
  nextMatch,
  previousMatch,
  replaceAllEdit,
  replaceOneEdit,
  type RegexPreviewError,
  type TextEdit,
} from "@/writing/findReplace";
import { MANUSCRIPT_REPLACE, WRITING } from "@/ui/labels";
import { ProtectionTick } from "./ProtectionTick";
import { applyTextareaEdit, selectRange } from "./textareaEdit";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Atoms/Checkbox";

interface DirectUndo {
  inverse: TextEdit;
  /** Text the replacement inserted; the undo applies only while it is still there. */
  inserted: string;
}

export function FindReplace({
  textareaRef,
  text,
  selection,
  canReplace,
  onUnlock,
  directUndo,
  onDirectUndoChange,
  initial = null,
}: {
  textareaRef: RefObject<import("@/components/writing/EditorSurface").EditorSurface | HTMLTextAreaElement | null>;
  text: string;
  selection: { start: number; end: number };
  canReplace: boolean;
  onUnlock: () => void;
  directUndo: DirectUndo[];
  onDirectUndoChange: (stack: DirectUndo[]) => void;
  /** Search to start with; its first match is selected when the editor opens. */
  initial?: { query: string; matchCase: boolean } | null;
}) {
  const [query, setQuery] = useState(initial?.query ?? "");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(initial?.matchCase ?? false);
  const [useRegex, setUseRegex] = useState(false);
  const [message, setMessage] = useState("");

  const found = useMemo(
    () => (useRegex ? findRegexMatches(text, query, { matchCase }) : { matches: findMatches(text, query, { matchCase }), error: null as RegexPreviewError | null }),
    [text, query, matchCase, useRegex],
  );
  const matches = found.matches;
  const regexMessage = found.error ? REGEX_ERROR[found.error] : "";
  const current = matchAt(matches, selection.start, selection.end);

  const selectedInitial = useRef(false);
  useEffect(() => {
    const ta = textareaRef.current;
    if (selectedInitial.current || !initial || !ta) return;
    selectedInitial.current = true;
    const first = findMatches(ta.value, initial.query, { matchCase: initial.matchCase })[0];
    if (first) selectRange(ta, first.start, first.end);
  }, [initial, textareaRef]);

  const status = !query
    ? ""
    : matches.length === 0
      ? WRITING.noMatches
      : current >= 0
        ? `${current + 1} of ${matches.length}`
        : `${matches.length} match${matches.length === 1 ? "" : "es"}`;

  const go = (direction: "next" | "previous") => {
    const ta = textareaRef.current;
    if (!ta || matches.length === 0) return;
    const i =
      direction === "next" ? nextMatch(matches, ta.selectionStart, ta.selectionEnd) : previousMatch(matches, ta.selectionStart);
    setMessage("");
    selectRange(ta, matches[i].start, matches[i].end);
  };

  const record = (before: string, edit: TextEdit, how: "native" | "direct") => {
    if (how === "direct") onDirectUndoChange([...directUndo, { inverse: invertEdit(before, edit), inserted: edit.text }]);
  };

  const replaceOne = () => {
    const ta = textareaRef.current;
    if (!ta || !canReplace || matches.length === 0) return;
    const i = current >= 0 ? current : nextMatch(matches, ta.selectionStart, ta.selectionEnd);
    const before = ta.value;
    const edit = replaceOneEdit(matches[i], replacement);
    record(before, edit, applyTextareaEdit(ta, edit));
    const after = findMatches(ta.value, query, { matchCase });
    const caret = edit.start + edit.text.length;
    setMessage("Replaced 1.");
    if (after.length > 0) {
      const n = nextMatch(after, caret, caret);
      selectRange(ta, after[n].start, after[n].end);
    }
  };

  const replaceAll = () => {
    const ta = textareaRef.current;
    if (!ta || !canReplace) return;
    const before = ta.value;
    const found = findMatches(before, query, { matchCase });
    const edit = replaceAllEdit(before, found, replacement);
    if (!edit) return;
    record(before, edit, applyTextareaEdit(ta, edit));
    setMessage(`Replaced ${found.length}.`);
  };

  const undoDirect = () => {
    const ta = textareaRef.current;
    const last = directUndo[directUndo.length - 1];
    if (!ta || !last) return;
    const { inverse, inserted } = last;
    if (ta.value.slice(inverse.start, inverse.end) !== inserted) {
      setMessage("The text has changed since that replacement, so it cannot be undone here.");
      onDirectUndoChange([]);
      return;
    }
    applyTextareaEdit(ta, inverse);
    onDirectUndoChange(directUndo.slice(0, -1));
    setMessage("Replacement undone.");
  };

  const onFindKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    go(e.shiftKey ? "previous" : "next");
  };
  const onReplaceKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    replaceOne();
  };

  const disabledReplace = !canReplace || matches.length === 0;

  return (
    <div className="find-replace stack" role="search" aria-label="Find and replace in this document">
      <div className="row">
        <label className="inline">
          {WRITING.find}
          <input type="text" value={query} onChange={(e) => {
              setQuery(e.target.value);
              setMessage("");
            }} onKeyDown={onFindKey} spellCheck={false} />
        </label>
        <Checkbox
          checked={matchCase}
          onChange={(e) => {
            setMatchCase(e.target.checked);
            setMessage("");
          }}
          label={WRITING.matchCase}
        />
        <Checkbox
          checked={useRegex}
          onChange={(e) => {
            setUseRegex(e.target.checked);
            setMessage("");
          }}
          label={MANUSCRIPT_REPLACE.useRegex}
        />
        <Button type="button" variant="secondary" onClick={() => go("previous")} disabled={matches.length === 0}>
          {WRITING.previous}
        </Button>
        <Button type="button" variant="secondary" onClick={() => go("next")} disabled={matches.length === 0}>
          {WRITING.next}
        </Button>
        <span className="small muted" aria-live="polite">
          {regexMessage || status}
        </span>
      </div>
      <div className="row">
        <label className="inline">
          {WRITING.replaceWith}
          <input
            type="text"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={onReplaceKey}
          />
        </label>
        <Button type="button" variant="secondary" onClick={replaceOne} disabled={disabledReplace}>
          {WRITING.replace}
        </Button>
        <Button type="button" variant="secondary" onClick={replaceAll} disabled={disabledReplace}>
          {WRITING.replaceAll}
        </Button>
        {directUndo.length > 0 ? (
          <Button type="button" variant="secondary" onClick={undoDirect}>
            {WRITING.undoReplacement}
          </Button>
        ) : null}
        <span className="small muted" aria-live="polite">
          {message}
        </span>
      </div>
      {!canReplace ? <ProtectionTick note={WRITING.protectedReplace} onUnlock={onUnlock} /> : null}
    </div>
  );
}

const REGEX_ERROR: Record<RegexPreviewError, string> = {
  too_long: MANUSCRIPT_REPLACE.regexTooLong,
  nested: MANUSCRIPT_REPLACE.regexNested,
  invalid: MANUSCRIPT_REPLACE.regexInvalid,
  slow: MANUSCRIPT_REPLACE.regexSlow,
};

export type { DirectUndo };
