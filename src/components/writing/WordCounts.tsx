"use client";

import { useMemo } from "react";
import { countWords, formatWordCount } from "@/writing/wordCount";
import { WRITING } from "@/ui/labels";

export function WordCounts({
  text,
  selection,
  isChapter,
  otherChaptersWords,
  documentLabel,
}: {
  text: string;
  selection: { start: number; end: number };
  /** True for manuscript chapters and scenes, which count toward the book. */
  isChapter: boolean;
  /** Saved word total of the project's other manuscript chapters and scenes; only for manuscript text. */
  otherChaptersWords: number | null;
  documentLabel?: string;
}) {
  const documentWords = useMemo(() => countWords(text), [text]);
  const selected = selection.end > selection.start ? text.slice(selection.start, selection.end) : "";
  const selectionWords = selected ? countWords(selected) : null;

  return (
    <div className="word-counts small">
      <span>
        {documentLabel ?? (isChapter ? WRITING.chapterCount : WRITING.documentCount)}: <strong>{formatWordCount(documentWords)}</strong>
      </span>
      <span>
        {WRITING.selectionCount}:{" "}
        {selectionWords === null ? <span className="muted">none</span> : <strong>{formatWordCount(selectionWords)}</strong>}
      </span>
      {isChapter && otherChaptersWords !== null ? (
        <span>
          {WRITING.bookCount}: <strong>{formatWordCount(otherChaptersWords + documentWords)}</strong>{" "}
          <span className="muted">({WRITING.bookCountNote})</span>
        </span>
      ) : null}
    </div>
  );
}
