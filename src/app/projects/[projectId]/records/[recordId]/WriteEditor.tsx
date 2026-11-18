"use client";

import Link from "next/link";
import {
  useActionState,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { IssueList } from "@/components/IssueList";
import { ContextRail, ContextRailToggle, useContextRail } from "@/components/shell/ContextRail";
import { HistoryIcon, MoreIcon } from "@/components/shell/icons";
import { useLayout } from "@/components/shell/LayoutContext";
import { setUnsaved } from "@/components/shell/unsaved";
import { submitWithoutReset } from "@/components/submitWithoutReset";
import { EditorToolbar, linkSeedFrom, shortcutHint, type FormatCommand, type LinkSeed } from "@/components/writing/EditorToolbar";
import { FindReplace, type DirectUndo } from "@/components/writing/FindReplace";
import { Proofreader, type ProofreadConfig } from "@/components/writing/Proofreader";
import { SpellingLanguageSelect } from "@/components/writing/SpellingLanguageSelect";
import { SpellOverlay } from "@/components/writing/SpellOverlay";
import { applyTextareaEdit } from "@/components/writing/textareaEdit";
import { flagAt, SpellingPanel } from "@/components/writing/SpellingPanel";
import { useSpellcheck } from "@/components/writing/useSpellcheck";
import { WordCounts } from "@/components/writing/WordCounts";
import type { AuthorityStatus } from "@/domain/statuses";
import { normalizeNewlines } from "@/proofread/anchors";
import type { DictionaryWord } from "@/spelling/dictionary";
import { TextAppearanceMenu } from "@/components/TextAppearanceMenu";
import { RECORD, tidySummary, WRITE, WRITING } from "@/ui/labels";
import { invertEdit } from "@/writing/findReplace";
import { minimalEdit, toggleInline } from "@/writing/markdownFormat";
import { tidyText } from "@/writing/tidy";
import type { SpellChecker, SpellingLanguage } from "@/writing/spelling";
import { saveRecordAction, type FormResult } from "../../actions";
import {
  WriteContext,
  type AttachableSource,
  type ChoiceItem,
  type LinkedItem,
  type NoteItem,
  type SourceItem,
} from "./WriteContext";

const LOADABLE_FILE = /\.(md|markdown|txt)$/i;
const LOAD_MAX_BYTES = 5 * 1024 * 1024;

export function WriteEditor(props: {
  projectId: string;
  recordId: string;
  kind: "chapter" | "scene";
  revision: number;
  title: string;
  body: string;
  fieldsJson: string;
  authorityStatus: AuthorityStatus;
  isProtected: boolean;
  parent: { id: string; title: string } | null;
  /** Opens Find with this text, from a manuscript search result. */
  initialFind: { query: string; matchCase: boolean } | null;
  otherChaptersWords: number | null;
  spellingLanguage: SpellingLanguage;
  spellChecker: SpellChecker;
  dictionaryWords: DictionaryWord[];
  proofread: ProofreadConfig;
  notes: NoteItem[];
  linked: LinkedItem[];
  choices: ChoiceItem[];
  sources: SourceItem[];
  attachableSources: AttachableSource[];
  draftScopeId: string | null;
  initialPins: import("@/server/services/readingPinService").ReadingPinView[];
  /** Status, protection, history and compare, rendered by the server below the text. */
  details: ReactNode;
}) {
  const idPrefix = useId();
  const editorId = `${idPrefix}-text`;
  const contextId = `${idPrefix}-context`;
  const findId = `${idPrefix}-find`;
  const spellId = `${idPrefix}-spell`;
  const { focusMode, setFocusMode } = useLayout();
  const rail = useContextRail();

  const [state, action, pending] = useActionState<FormResult, FormData>(
    saveRecordAction.bind(null, props.projectId, props.recordId),
    { ok: true },
  );
  const formRef = useRef<HTMLFormElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // The text box reports line endings as "\n"; keep offsets in the same terms.
  const savedText = normalizeNewlines(props.body);
  const [text, setText] = useState(savedText);
  const [title, setTitle] = useState(props.title);
  const [fields, setFields] = useState(props.fieldsJson);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [unlocked, setUnlocked] = useState(false);
  const [unlockedRevision, setUnlockedRevision] = useState(props.revision);
  const [language, setLanguage] = useState(props.spellingLanguage);
  const [directUndo, setDirectUndo] = useState<DirectUndo[]>([]);
  const [checker, setChecker] = useState(props.spellChecker);
  const [words, setWords] = useState(props.dictionaryWords);
  const [findOpen, setFindOpen] = useState(props.initialFind !== null);
  const [spellOpen, setSpellOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [linkRequest, setLinkRequest] = useState<(LinkSeed & { id: number }) | null>(null);
  /** "notice" shows even with nothing unsaved and clears on the next keystroke. */
  const [loadNote, setLoadNote] = useState<{ tone: "info" | "error" | "notice"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const editable = !props.isProtected || unlocked;

  const spell = useSpellcheck({ enabled: checker === "app", language, text, words });
  const appUnderlines = checker === "app" && spell.status !== "error";
  const { flagsFor } = spell;
  const flags = useMemo(() => (appUnderlines ? flagsFor(text) : []), [appUnderlines, flagsFor, text]);
  const overlayText = useDeferredValue(text);
  const overlayFlags = useMemo(() => (appUnderlines ? flagsFor(overlayText) : []), [appUnderlines, flagsFor, overlayText]);

  if (unlockedRevision !== props.revision) {
    setUnlockedRevision(props.revision);
    setUnlocked(false);
  }

  // Unsaved means the server has not acknowledged what is on screen.
  const dirty = text !== savedText || title !== props.title || fields !== props.fieldsJson;
  const saveStatus = pending ? WRITE.saving : !state.ok ? WRITE.notSaved : dirty ? WRITE.unsaved : WRITE.savedRevision(props.revision);
  const statusTone = pending ? "busy" : !state.ok ? "error" : dirty ? "dirty" : "saved";

  const unsavedKey = `editor-${props.recordId}`;
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

  const readSelection = useCallback(() => {
    const ta = bodyRef.current;
    if (ta) setSelection({ start: ta.selectionStart, end: ta.selectionEnd });
  }, []);

  useEffect(() => {
    const onChange = () => {
      if (document.activeElement === bodyRef.current) readSelection();
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, [readSelection]);

  const onBodyInput = (e: FormEvent<HTMLTextAreaElement>) => {
    setText(e.currentTarget.value);
    readSelection();
    if (loadNote?.tone === "notice") setLoadNote(null);
    if (e.nativeEvent.isTrusted && directUndo.length > 0) setDirectUndo([]);
  };

  /** Runs a formatting command as one edit the browser's undo can reverse, then restores the selection. */
  const format = (command: FormatCommand) => {
    const ta = bodyRef.current;
    if (!ta || !editable) return;
    const before = ta.value;
    const result = command(before, { start: ta.selectionStart, end: ta.selectionEnd });
    const edit = minimalEdit(before, result.edit);
    if (edit.start !== edit.end || edit.text !== "") {
      const how = applyTextareaEdit(ta, edit);
      if (how === "direct") setDirectUndo((stack) => [...stack, { inverse: invertEdit(before, edit), inserted: edit.text }]);
    }
    ta.focus();
    ta.setSelectionRange(result.selection.start, result.selection.end);
    readSelection();
  };

  /** Fills the editor from a file as one undoable edit. Saving is left to the author. */
  const loadFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    const ta = bodyRef.current;
    if (!file || !ta) return;
    if (!editable) return setLoadNote({ tone: "error", text: WRITE.loadNotEditable });
    if (!LOADABLE_FILE.test(file.name)) return setLoadNote({ tone: "error", text: WRITE.loadWrongType });
    if (file.size > LOAD_MAX_BYTES) return setLoadNote({ tone: "error", text: WRITE.loadTooLarge });
    const raw = await file.text();
    const loaded = normalizeNewlines(raw.replace(/^\uFEFF/, ""));
    if (!loaded.trim()) return setLoadNote({ tone: "error", text: WRITE.loadEmpty });
    const before = ta.value;
    if (before.trim() && before !== loaded && !window.confirm(WRITE.loadConfirm(file.name))) return;
    const edit = { start: 0, end: before.length, text: loaded };
    if (applyTextareaEdit(ta, edit) === "direct") {
      setDirectUndo((stack) => [...stack, { inverse: invertEdit(before, edit), inserted: edit.text }]);
    }
    ta.setSelectionRange(0, 0);
    ta.scrollTop = 0;
    readSelection();
    const warning = raw.includes("\uFFFD") ? ` ${WRITE.loadNotUtf8}` : "";
    setLoadNote({ tone: "info", text: `${WRITE.loadedFile(file.name)}${warning}` });
  };

  /** Tidies the whole text as one undoable edit. Saving is left to the author. */
  const tidy = () => {
    const ta = bodyRef.current;
    if (!ta) return;
    if (!editable) return setLoadNote({ tone: "error", text: WRITE.tidyNotEditable });
    const before = ta.value;
    const result = tidyText(before);
    if (!result.changed) return setLoadNote({ tone: "notice", text: WRITE.alreadyTidy });
    const edit = minimalEdit(before, { start: 0, end: before.length, text: result.text });
    if (applyTextareaEdit(ta, edit) === "direct") {
      setDirectUndo((stack) => [...stack, { inverse: invertEdit(before, edit), inserted: edit.text }]);
    }
    ta.focus();
    ta.setSelectionRange(edit.start, edit.start);
    readSelection();
    setLoadNote({ tone: "info", text: WRITE.tidied(tidySummary(result.report)) });
  };

  // Focus mode hides the panels with CSS only, so the text box, its selection and its undo history are untouched.
  const savedSelection = useRef<{ start: number; end: number } | null>(null);
  const toggleFocus = (on: boolean) => {
    const ta = bodyRef.current;
    if (ta) savedSelection.current = { start: ta.selectionStart, end: ta.selectionEnd };
    setFocusMode(on);
  };
  useEffect(() => {
    const ta = bodyRef.current;
    const sel = savedSelection.current;
    if (!ta || !sel) return;
    savedSelection.current = null;
    ta.focus({ preventScroll: false });
    ta.setSelectionRange(sel.start, sel.end);
  }, [focusMode]);
  useEffect(() => {
    if (!focusMode) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        toggleFocus(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => () => setFocusMode(false), [setFocusMode]);

  const focusFind = useRef(false);
  const openFind = () => {
    if (findOpen) {
      document.getElementById(findId)?.querySelector<HTMLInputElement>("input")?.focus();
      return;
    }
    focusFind.current = true;
    setFindOpen(true);
  };
  useEffect(() => {
    if (!findOpen || !focusFind.current) return;
    focusFind.current = false;
    document.getElementById(findId)?.querySelector<HTMLInputElement>("input")?.focus();
  });

  const onFormKey = (e: KeyboardEvent<HTMLFormElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;
    const key = e.key.toLowerCase();
    const inText = e.target === bodyRef.current;
    if (key === "s" && !e.shiftKey) {
      e.preventDefault();
      formRef.current?.requestSubmit();
    } else if (key === "f" && e.shiftKey) {
      e.preventDefault();
      toggleFocus(!focusMode);
    } else if (key === "f") {
      e.preventDefault();
      openFind();
    } else if (inText && !e.shiftKey && (key === "b" || key === "i")) {
      e.preventDefault();
      format((t, s) => toggleInline(t, s, key === "b" ? "bold" : "italic"));
    } else if (inText && !e.shiftKey && key === "k") {
      e.preventDefault();
      const seed = linkSeedFrom(e.target as HTMLTextAreaElement);
      setLinkRequest((prev) => ({ ...seed, id: (prev?.id ?? 0) + 1 }));
    }
  };

  const documentLabel = props.kind === "scene" ? WRITING.sceneCount : WRITING.chapterCount;

  return (
    <div className="write-layout">
      <div className="write-main">
        <form ref={formRef} onSubmit={submitWithoutReset(action)} onKeyDown={onFormKey} className="write-form">
          <input type="hidden" name="expectedRevision" value={props.revision} />
          <input type="hidden" name="authorityStatus" value={props.authorityStatus} />

          <header className="write-header">
            <div className="write-title-row">
              <div className="write-title-block">
                {props.parent ? (
                  <p className="write-crumb small muted">
                    {WRITE.inChapter}{" "}
                    <Link href={`/projects/${encodeURIComponent(props.projectId)}/records/${encodeURIComponent(props.parent.id)}`}>
                      {props.parent.title}
                    </Link>
                  </p>
                ) : null}
                <h1 className="write-title">
                  <input
                    type="text"
                    name="title"
                    aria-label={WRITE.documentTitle}
                    defaultValue={props.title}
                    required
                    spellCheck
                    lang={language}
                    onInput={(e) => setTitle(e.currentTarget.value)}
                  />
                </h1>
              </div>
              <div className="write-actions">
                <p className={`save-status ${statusTone}`} role="status">
                  {saveStatus}
                </p>
                <button type="submit" className="small-button" disabled={pending} aria-keyshortcuts="Control+S" title={`${WRITE.save} (${shortcutHint("S")})`}>
                  {WRITE.save}
                </button>
                <a href="#history" className="icon-button tip" aria-label={WRITE.versionHistory} data-tooltip={WRITE.versionHistory}>
                  <HistoryIcon />
                </a>
                <ContextRailToggle rail={rail} controls={contextId} />
                <TextAppearanceMenu />
                <div className="menu-wrap">
                  <button
                    type="button"
                    className="icon-button tip tip-end"
                    aria-label={WRITE.more}
                    data-tooltip={WRITE.more}
                    aria-expanded={menuOpen}
                    aria-controls={`${idPrefix}-menu`}
                    onClick={() => setMenuOpen((open) => !open)}
                  >
                    <MoreIcon />
                  </button>
                  <ul
                    id={`${idPrefix}-menu`}
                    className="tool-menu right"
                    hidden={!menuOpen}
                    onClick={() => setMenuOpen(false)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        setMenuOpen(false);
                      }
                    }}
                  >
                    <li>
                      <a className="menu-item" href="#record-status">
                        {RECORD.statusHeading}
                      </a>
                    </li>
                    <li>
                      <a className="menu-item" href="#record-protection">
                        {RECORD.protectionHeading}
                      </a>
                    </li>
                    <li>
                      <a className="menu-item" href="#history">
                        {RECORD.historyHeading}
                      </a>
                    </li>
                    <li>
                      <a className="menu-item" href="#compare">
                        {RECORD.compareHeading}
                      </a>
                    </li>
                    <li>
                      <a className="menu-item" href={`#${idPrefix}-fields`}>
                        {WRITE.structuredFields}
                      </a>
                    </li>
                    <li>
                      <button
                        type="button"
                        className="menu-item"
                        disabled={!editable}
                        title={editable ? undefined : WRITE.loadNotEditable}
                        onClick={() => fileRef.current?.click()}
                      >
                        {WRITE.loadFromFile}
                      </button>
                    </li>
                    <li>
                      <button
                        type="button"
                        className="menu-item"
                        disabled={!editable}
                        title={editable ? undefined : WRITE.tidyNotEditable}
                        onClick={tidy}
                      >
                        {WRITE.tidy}
                      </button>
                    </li>
                  </ul>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".md,.markdown,.txt,text/markdown,text/plain"
                    hidden
                    aria-label={WRITE.loadFromFile}
                    onChange={(e) => void loadFile(e)}
                  />
                </div>
              </div>
            </div>
            {!state.ok ? <IssueList issues={state.issues ?? []} /> : null}
            {!state.ok && state.message ? <div className="banner error">{state.message}</div> : null}
            {loadNote && (loadNote.tone !== "info" || dirty) ? (
              <div className={`banner ${loadNote.tone === "error" ? "error" : ""} load-note`} role="status">
                {loadNote.text}
              </div>
            ) : null}
            {props.isProtected ? (
              <div className="protect-bar">
                <label className="inline" key={props.revision}>
                  <input type="checkbox" name="unlockProtected" checked={unlocked} onChange={(e) => setUnlocked(e.target.checked)} />
                  {RECORD.unlockProtected}
                </label>
              </div>
            ) : null}
            <EditorToolbar
              editorId={editorId}
              textareaRef={bodyRef}
              text={text}
              selection={selection}
              editable={editable}
              onFormat={format}
              onHistory={readSelection}
              findId={findId}
              findOpen={findOpen}
              onToggleFind={() => (findOpen ? setFindOpen(false) : openFind())}
              spellId={spellId}
              spellOpen={spellOpen}
              onToggleSpell={() => setSpellOpen((open) => !open)}
              focusMode={focusMode}
              onToggleFocus={() => toggleFocus(!focusMode)}
              linkRequest={linkRequest}
            />
            <div id={findId} hidden={!findOpen} className="tool-panel">
              <FindReplace
                textareaRef={bodyRef}
                text={text}
                selection={selection}
                canReplace={editable}
                onUnlock={() => setUnlocked(true)}
                directUndo={directUndo}
                onDirectUndoChange={setDirectUndo}
                initial={props.initialFind}
              />
            </div>
            <div id={spellId} hidden={!spellOpen} className="tool-panel">
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
            </div>
          </header>

          <div className="write-column">
            {focusMode ? <p className="focus-hint small muted">{WRITE.focusHint}</p> : null}
            <span className="spell-field">
              <textarea
                ref={bodyRef}
                id={editorId}
                name="body"
                className="document manuscript-text"
                aria-label={WRITE.editorLabel}
                defaultValue={props.body}
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
            <details className="write-fields" id={`${idPrefix}-fields`}>
              <summary>{WRITE.structuredFields}</summary>
              <textarea
                name="fields"
                aria-label={WRITE.structuredFields}
                className="mono"
                defaultValue={props.fieldsJson}
                style={{ minHeight: "6rem" }}
                spellCheck={false}
                onInput={(e) => setFields(e.currentTarget.value)}
              />
            </details>
          </div>

          <footer className="write-footer">
            <WordCounts
              text={text}
              selection={selection}
              isChapter
              otherChaptersWords={props.otherChaptersWords}
              documentLabel={documentLabel}
            />
            <SpellingLanguageSelect value={language} onChange={setLanguage} />
          </footer>
        </form>
        <div className="write-details">{props.details}</div>
      </div>

      <ContextRail id={contextId} labelledBy={`${contextId}-title`} rail={rail} focusOnOverlayOpen>
        <WriteContext
          id={contextId}
          projectId={props.projectId}
          recordId={props.recordId}
          recordTitle={props.title}
          isProtected={props.isProtected}
          notes={props.notes}
          linked={props.linked}
          choices={props.choices}
          sources={props.sources}
          attachableSources={props.attachableSources}
          draftScopeId={props.draftScopeId}
          initialPins={props.initialPins}
          overlay={!rail.wide}
          onClose={rail.close}
          proofreader={
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
          }
        />
      </ContextRail>
    </div>
  );
}
