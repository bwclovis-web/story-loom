"use client";

import Link from "next/link";
import { useEffect, useState, type RefObject } from "react";
import { addDictionaryWordAction } from "@/app/projects/[projectId]/dictionary/actions";
import { defaultCaseSensitive, similarDictionaryWords, type DictionaryScope, type DictionaryWord, type SpellFlag } from "@/spelling/dictionary";
import { stripPossessive } from "@/spelling/words";
import { SPELLING } from "@/ui/labels";
import type { TextEdit } from "@/writing/findReplace";
import { SPELL_CHECKERS, spellCheckerCookie, type SpellChecker } from "@/writing/spelling";
import { ProtectionTick } from "./ProtectionTick";
import { applyTextareaEdit, selectRange } from "./textareaEdit";
import type { Spellcheck } from "./useSpellcheck";
import { Button } from "@/components/ui/Button";

/** The flagged word the selection is in, if any. */
export function flagAt(flags: readonly SpellFlag[], selection: { start: number; end: number }): SpellFlag | null {
  return flags.find((f) => f.start <= selection.start && selection.end <= f.end) ?? null;
}

function SpellCheckerSelect({ value, onChange }: { value: SpellChecker; onChange: (checker: SpellChecker) => void }) {
  return (
    <label className="inline">
      {SPELLING.checker}
      <select
        value={value}
        onChange={(e) => {
          const checker = e.target.value as SpellChecker;
          document.cookie = spellCheckerCookie(checker);
          onChange(checker);
        }}
      >
        {SPELL_CHECKERS.map((c) => (
          <option key={c.code} value={c.code}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Suggestions({
  word,
  words,
  spell,
  disabled,
  onPick,
}: {
  word: string;
  words: readonly DictionaryWord[];
  spell: Spellcheck;
  disabled: boolean;
  onPick: (replacement: string) => void;
}) {
  const [found, setFound] = useState<{ word: string; list: string[] } | null>(null);
  const { suggest } = spell;

  useEffect(() => {
    let live = true;
    suggest(word).then((list) => {
      if (live) setFound({ word, list });
    });
    return () => {
      live = false;
    };
  }, [word, suggest]);

  const similar = similarDictionaryWords(word, words);
  const standard = found?.word === word ? found.list : null;
  const all = [...similar, ...(standard ?? []).filter((s) => !similar.includes(s) && s !== word)];

  return (
    <div className="row small">
      <span className="muted">{SPELLING.suggestions}:</span>
      {all.map((s) => (
        <Button key={s} type="button" variant="secondary" disabled={disabled} onClick={() => onPick(s)}>
          {s}
        </Button>
      ))}
      {standard === null ? <span className="muted">{SPELLING.findingSuggestions}</span> : null}
      {standard !== null && all.length === 0 ? <span className="muted">{SPELLING.noSuggestions}</span> : null}
    </div>
  );
}

type Notice = { ok: boolean; text: string } | null;

function AddWord({
  projectId,
  word,
  onWordsChange,
  onNotice,
}: {
  projectId: string;
  word: string;
  onWordsChange: (words: DictionaryWord[]) => void;
  onNotice: (notice: Notice) => void;
}) {
  const [matchCase, setMatchCase] = useState(defaultCaseSensitive(word));
  const [busy, setBusy] = useState(false);

  const add = async (scope: DictionaryScope) => {
    setBusy(true);
    onNotice(null);
    try {
      const result = await addDictionaryWordAction(projectId, { word, caseSensitive: matchCase, scope }, true);
      onNotice({ ok: result.ok, text: result.message });
      if (result.ok) onWordsChange(result.words);
    } catch {
      onNotice({ ok: false, text: "The word could not be added. Try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="row small">
      <Button type="button" variant="secondary" disabled={busy} onClick={() => add("project")}>
        {SPELLING.addToProject}
      </Button>
      <Button type="button" variant="secondary" disabled={busy} onClick={() => add("workspace")}>
        {SPELLING.addToWorkspace}
      </Button>
      <label className="inline">
        <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} />
        {SPELLING.matchCase}
      </label>
    </div>
  );
}

export function SpellingPanel({
  projectId,
  checker,
  onCheckerChange,
  spell,
  flags,
  text,
  selection,
  textareaRef,
  editable,
  onUnlock,
  words,
  onWordsChange,
  onDirectEdit,
}: {
  projectId: string;
  checker: SpellChecker;
  onCheckerChange: (checker: SpellChecker) => void;
  spell: Spellcheck;
  /** Flags placed on `text`, the text box's current value. */
  flags: readonly SpellFlag[];
  text: string;
  selection: { start: number; end: number };
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  editable: boolean;
  onUnlock: () => void;
  words: readonly DictionaryWord[];
  onWordsChange: (words: DictionaryWord[]) => void;
  onDirectEdit: (before: string, edit: TextEdit) => void;
}) {
  const [notice, setNotice] = useState<Notice>(null);
  const current = checker === "app" && spell.status === "ready" ? flagAt(flags, selection) : null;
  const dictionaryForm = current ? (stripPossessive(current.word) ?? current.word) : "";
  const similar = current ? similarDictionaryWords(current.word, words) : [];

  const go = (direction: 1 | -1) => {
    const ta = textareaRef.current;
    if (!ta || flags.length === 0) return;
    setNotice(null);
    const target =
      direction === 1
        ? (flags.find((f) => f.start >= ta.selectionEnd) ?? flags[0])
        : (flags.findLast((f) => f.end <= ta.selectionStart) ?? flags[flags.length - 1]);
    selectRange(ta, target.start, target.end);
  };

  const replace = (replacement: string) => {
    const ta = textareaRef.current;
    if (!ta || !current || !editable || ta.value.slice(current.start, current.end) !== current.word) return;
    const before = ta.value;
    const edit = { start: current.start, end: current.end, text: replacement };
    if (applyTextareaEdit(ta, edit) === "direct") onDirectEdit(before, edit);
    ta.setSelectionRange(edit.start + replacement.length, edit.start + replacement.length);
  };

  let status: string;
  if (checker === "browser") status = "";
  else if (spell.status === "loading") status = SPELLING.loading;
  else if (spell.status === "error") status = SPELLING.failed;
  else status = flags.length ? SPELLING.flagged(flags.length) : SPELLING.noneFlagged;

  return (
    <div className="spelling-panel stack">
      <div className="row">
        <SpellCheckerSelect value={checker} onChange={onCheckerChange} />
        {status ? (
          <span className={`small ${spell.status === "error" ? "error-text" : "muted"}`} role="status">
            {status}
          </span>
        ) : null}
        {checker === "app" && spell.status === "ready" && flags.length > 0 ? (
          <>
            <Button type="button" variant="secondary" onClick={() => go(-1)}>
              {SPELLING.previous}
            </Button>
            <Button type="button" variant="secondary" onClick={() => go(1)}>
              {SPELLING.next}
            </Button>
          </>
        ) : null}
        <Link className="small" href={`/projects/${projectId}/dictionary`}>
          {SPELLING.manageDictionary}
        </Link>
      </div>
      {spell.status === "error" && checker === "app" && spell.error ? <div className="small muted">{spell.error}</div> : null}
      {current ? (
        <div className="spell-current stack">
          <div>
            <strong>{current.word}</strong>
          </div>
          {similar.length > 0 ? (
            <div className="small warning-text">{SPELLING.similarNote(similar.map((w) => `"${w}"`).join(", "))}</div>
          ) : null}
          <Suggestions word={current.word} words={words} spell={spell} disabled={!editable} onPick={replace} />
          {!editable ? <ProtectionTick note={SPELLING.protectedNote} onUnlock={onUnlock} /> : null}
          <div className="row small">
            <Button type="button" variant="secondary" onClick={() => spell.ignoreOnce(current, text)}>
              {SPELLING.ignoreOnce}
            </Button>
          </div>
          <AddWord
            key={dictionaryForm}
            projectId={projectId}
            word={dictionaryForm}
            onWordsChange={onWordsChange}
            onNotice={setNotice}
          />
        </div>
      ) : null}
      {notice ? (
        <div className={`small ${notice.ok ? "" : "error-text"}`} role="status">
          {notice.text}
        </div>
      ) : null}
    </div>
  );
}
