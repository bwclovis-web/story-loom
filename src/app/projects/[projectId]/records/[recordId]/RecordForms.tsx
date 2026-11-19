"use client";

import { useActionState, useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { HelpHint } from "@/components/HelpHint";
import { IssueList } from "@/components/IssueList";
import { submitWithoutReset } from "@/components/submitWithoutReset";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { FindReplace, type DirectUndo } from "@/components/writing/FindReplace";
import { Proofreader, type ProofreadConfig } from "@/components/writing/Proofreader";
import { setUnsaved } from "@/components/shell/unsaved";
import { SpellingLanguageSelect } from "@/components/writing/SpellingLanguageSelect";
import { SpellOverlay } from "@/components/writing/SpellOverlay";
import { flagAt, SpellingPanel } from "@/components/writing/SpellingPanel";
import { useSpellcheck } from "@/components/writing/useSpellcheck";
import { WordCounts } from "@/components/writing/WordCounts";
import { AUTHORITY_STATUSES, type AuthorityStatus } from "@/domain/statuses";
import { normalizeNewlines } from "@/proofread/anchors";
import type { DictionaryWord } from "@/spelling/dictionary";
import { applyTextareaEdit } from "@/components/writing/textareaEdit";
import { imageMarkdown } from "@/images/imageFormat";
import { IMAGES, RECORD, WRITING } from "@/ui/labels";
import { invertEdit } from "@/writing/findReplace";
import type { SpellChecker, SpellingLanguage } from "@/writing/spelling";
import { saveRecordAction, setStatusAction, type FormResult } from "../../actions";

function Result({ state }: { state: FormResult }) {
  return (
    <>
      {state.message ? <Banner tone={state.ok ? "ok" : "error"}>{state.message}</Banner> : null}
      <IssueList issues={state.issues ?? []} />
    </>
  );
}

/** Saved fields come back re-formatted with sorted keys, so compare the JSON values rather than the text. */
function sameJson(a: string, b: string): boolean {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical((value as Record<string, unknown>)[k])]))
        : value;
  try {
    return JSON.stringify(canonical(JSON.parse(a.trim() || "{}"))) === JSON.stringify(canonical(JSON.parse(b.trim() || "{}")));
  } catch {
    return a === b;
  }
}

function InsertImage({
  images,
  disabled,
  onInsert,
}: {
  images: { name: string; label: string }[];
  disabled: boolean;
  onInsert: (markdown: string) => void;
}) {
  const [choice, setChoice] = useState(images[0].name);
  const selected = images.find((i) => i.name === choice) ?? images[0];
  return (
    <div className="row insert-image">
      <label className="inline">
        {IMAGES.insertLabel}
        <select value={selected.name} onChange={(e) => setChoice(e.target.value)}>
          {images.map((i) => (
            <option key={i.name} value={i.name}>
              {i.label ? `${i.name} (${i.label})` : i.name}
            </option>
          ))}
        </select>
      </label>
      <Button type="button" disabled={disabled} onClick={() => onInsert(imageMarkdown(selected.name, selected.label))} variant="secondary">
        {IMAGES.insertButton}
      </Button>
      <span className="small muted">{IMAGES.insertHint}</span>
    </div>
  );
}

function UnlockCheckbox({
  isProtected,
  checked,
  onChange,
}: {
  isProtected: boolean;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  if (!isProtected) return null;
  return (
    <label className="inline">
      <input type="checkbox" name="unlockProtected" checked={checked} onChange={(e) => onChange?.(e.target.checked)} />
      {RECORD.unlockProtected}
    </label>
  );
}

export function RecordEditor(props: {
  projectId: string;
  recordId: string;
  revision: number;
  title: string;
  body: string;
  fieldsJson: string;
  authorityStatus: AuthorityStatus;
  isProtected: boolean;
  isChapter: boolean;
  otherChaptersWords: number | null;
  spellingLanguage: SpellingLanguage;
  spellChecker: SpellChecker;
  dictionaryWords: DictionaryWord[];
  proofread: ProofreadConfig;
  /** Images attached to this reference document, for Insert image. */
  images?: { name: string; label: string }[];
}) {
  const [state, action, pending] = useActionState<FormResult, FormData>(
    saveRecordAction.bind(null, props.projectId, props.recordId),
    { ok: true },
  );
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // The text box reports line endings as "\n"; keep offsets in the same terms.
  const savedText = normalizeNewlines(props.body);
  const [text, setText] = useState(savedText);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [unlocked, setUnlocked] = useState(false);
  const [unlockedRevision, setUnlockedRevision] = useState(props.revision);
  const [language, setLanguage] = useState(props.spellingLanguage);
  const [directUndo, setDirectUndo] = useState<DirectUndo[]>([]);
  const [checker, setChecker] = useState(props.spellChecker);
  const [words, setWords] = useState(props.dictionaryWords);
  const editable = !props.isProtected || unlocked;

  const spell = useSpellcheck({ enabled: checker === "app", language, text, words });
  // If the app's checker cannot start, the browser's checker takes over so the text is still checked.
  const appUnderlines = checker === "app" && spell.status !== "error";
  const { flagsFor } = spell;
  const flags = useMemo(() => (appUnderlines ? flagsFor(text) : []), [appUnderlines, flagsFor, text]);
  // The underlines may trail fast typing by a moment, so typing itself never waits for them.
  const overlayText = useDeferredValue(text);
  const overlayFlags = useMemo(() => (appUnderlines ? flagsFor(overlayText) : []), [appUnderlines, flagsFor, overlayText]);

  const [title, setTitle] = useState(props.title);
  const [fields, setFields] = useState(props.fieldsJson);
  if (unlockedRevision !== props.revision) {
    setUnlockedRevision(props.revision);
    setUnlocked(false);
  }

  const dirty = text !== savedText || title.trim() !== props.title.trim() || sameJson(fields, props.fieldsJson) === false;
  const unsavedKey = `record-editor-${props.recordId}`;
  useEffect(() => {
    setUnsaved(unsavedKey, dirty);
    return () => setUnsaved(unsavedKey, false);
  }, [unsavedKey, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const readSelection = () => {
    const ta = bodyRef.current;
    if (ta) setSelection({ start: ta.selectionStart, end: ta.selectionEnd });
  };

  useEffect(() => {
    const onChange = () => {
      if (document.activeElement === bodyRef.current) readSelection();
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, []);

  const onBodyInput = (e: FormEvent<HTMLTextAreaElement>) => {
    setText(e.currentTarget.value);
    readSelection();
    if (e.nativeEvent.isTrusted && directUndo.length > 0) setDirectUndo([]);
  };

  return (
    <form onSubmit={submitWithoutReset(action)} className="stack">
      <input type="hidden" name="expectedRevision" value={props.revision} />
      <input type="hidden" name="authorityStatus" value={props.authorityStatus} />
      <label>
        Title
        <input type="text" name="title" defaultValue={props.title} required spellCheck lang={language} onInput={(e) => setTitle(e.currentTarget.value)} />
      </label>
      <div className="writing-tools stack">
        <div className="row">
          <strong>{WRITING.toolsHeading}</strong>
          <SpellingLanguageSelect value={language} onChange={setLanguage} />
        </div>
        <SpellingPanel
          projectId={props.projectId}
          checker={checker}
          onCheckerChange={setChecker}
          spell={spell}
          flags={flags}
          text={text}
          selection={selection}
          textareaRef={bodyRef}
          editable={editable}
          onUnlock={() => setUnlocked(true)}
          words={words}
          onWordsChange={setWords}
          onDirectEdit={(before, edit) =>
            setDirectUndo((stack) => [...stack, { inverse: invertEdit(before, edit), inserted: edit.text }])
          }
        />
        <HelpHint anchor="spelling" topic="spelling">
          {checker === "app"
            ? "Click an underlined word, or use Next word, to see suggestions and dictionary options."
            : "Spelling suggestions come from your browser and its settings. Right-click an underlined word to see them."}
        </HelpHint>
        <FindReplace
          textareaRef={bodyRef}
          text={text}
          selection={selection}
          canReplace={editable}
          onUnlock={() => setUnlocked(true)}
          directUndo={directUndo}
          onDirectUndoChange={setDirectUndo}
        />
        <Proofreader
          projectId={props.projectId}
          recordId={props.recordId}
          revision={props.revision}
          savedText={savedText}
          text={text}
          selection={selection}
          textareaRef={bodyRef}
          editable={editable}
          onUnlock={() => setUnlocked(true)}
          config={props.proofread}
        />
      </div>
      {props.images?.length ? (
        <InsertImage
          images={props.images}
          disabled={!editable}
          onInsert={(markdown) => {
            const ta = bodyRef.current;
            if (!ta) return;
            const before = ta.value;
            const edit = { start: ta.selectionStart, end: ta.selectionEnd, text: markdown };
            if (applyTextareaEdit(ta, edit) === "direct") {
              setDirectUndo((stack) => [...stack, { inverse: invertEdit(before, edit), inserted: edit.text }]);
            }
          }}
        />
      ) : null}
      <label>
        {RECORD.bodyLabel}
        <span className="spell-field">
          <textarea
            ref={bodyRef}
            name="body"
            className="document"
            defaultValue={props.body}
            style={{ minHeight: "16rem" }}
            spellCheck={!appUnderlines}
            lang={language}
            onInput={onBodyInput}
            onSelect={readSelection}
            onKeyUp={readSelection}
            onMouseUp={readSelection}
          />
          {appUnderlines ? (
            <SpellOverlay textareaRef={bodyRef} text={overlayText} flags={overlayFlags} current={flagAt(overlayFlags, selection)} />
          ) : null}
        </span>
      </label>
      <WordCounts
        text={text}
        selection={selection}
        isChapter={props.isChapter}
        otherChaptersWords={props.otherChaptersWords}
      />
      <label>
        {RECORD.fieldsLabel}
        <textarea
          name="fields"
          className="mono"
          defaultValue={props.fieldsJson}
          style={{ minHeight: "6rem" }}
          spellCheck={false}
          onInput={(e) => setFields(e.currentTarget.value)}
        />
      </label>
      <UnlockCheckbox key={props.revision} isProtected={props.isProtected} checked={unlocked} onChange={setUnlocked} />
      <Result state={state} />
      <div className="row">
        <Button type="submit" disabled={pending}>
          {RECORD.saveAsRevision(props.revision + 1)}
        </Button>
        <span className="small muted">Editing revision {props.revision}. Newer saves elsewhere will be detected.</span>
      </div>
    </form>
  );
}

export function StatusForm(props: {
  projectId: string;
  recordId: string;
  revision: number;
  status: AuthorityStatus;
  isProtected: boolean;
}) {
  const [state, action, pending] = useActionState<FormResult, FormData>(
    setStatusAction.bind(null, props.projectId, props.recordId),
    { ok: true },
  );

  return (
    <form onSubmit={submitWithoutReset(action)} className="stack">
      <input type="hidden" name="expectedRevision" value={props.revision} />
      <div className="row">
        <label>
          Status
          <select name="status" defaultValue={props.status}>
            {AUTHORITY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label style={{ flex: 1 }}>
          {RECORD.supersededByLabel}
          <input type="text" name="supersededBy" placeholder="rec_..." spellCheck={false} />
        </label>
      </div>
      <UnlockCheckbox key={props.revision} isProtected={props.isProtected} />
      <Result state={state} />
      <div>
        <Button type="submit" disabled={pending} variant="secondary">
          {RECORD.updateStatus}
        </Button>
      </div>
    </form>
  );
}
