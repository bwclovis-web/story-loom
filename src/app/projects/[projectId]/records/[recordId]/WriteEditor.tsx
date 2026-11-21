"use client";
import { Button } from "@/components/ui/Button";

import Link from "next/link";
import { ArrowLeft, Menu, SlidersHorizontal } from "lucide-react";
import {
  useActionState,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { IssueList } from "@/components/IssueList";
import { type DraftOption } from "@/components/drafts/DraftControls";
import { StoryLoomMark } from "@/components/library/StoryLoomMark";
import { ContextRail, useContextRail } from "@/components/shell/ContextRail";
import { Banner } from "@/components/ui/Banner";
import { LabeledSwitch } from "@/components/ui/LabeledSwitch";
import { IconAnchor, IconButton } from "@/components/ui/IconButton";
import { HistoryIcon, MoreIcon } from "@/components/shell/icons";
import { useLayout } from "@/components/shell/LayoutContext";
import { setUnsaved } from "@/components/shell/unsaved";
import { submitWithoutReset } from "@/components/submitWithoutReset";
import { EditorToolbar, linkSeedFrom, shortcutHint, type FormatCommand, type LinkSeed } from "@/components/writing/EditorToolbar";
import { FindReplace, type DirectUndo } from "@/components/writing/FindReplace";
import { StyleCheckPanel } from "@/components/writing/StyleCheckPanel";
import { Proofreader, type ProofreadConfig } from "@/components/writing/Proofreader";
import { SelectionAssister } from "@/components/writing/SelectionAssister";
import { SpellingLanguageSelect } from "@/components/writing/SpellingLanguageSelect";
import { SpellOverlay } from "@/components/writing/SpellOverlay";
import { applyTextareaEdit, scrollTextareaToSelection, selectRange } from "@/components/writing/textareaEdit";
import { flagAt, SpellingPanel } from "@/components/writing/SpellingPanel";
import { useSpellcheck } from "@/components/writing/useSpellcheck";
import { WordCounts } from "@/components/writing/WordCounts";
import type { AuthorityStatus } from "@/domain/statuses";
import { normalizeNewlines } from "@/proofread/anchors";
import type { DictionaryWord } from "@/spelling/dictionary";
import { WriteModeSwitch } from "@/components/writing/WriteModeSwitch";
import { WriteProtectionRow } from "@/components/writing/WriteProtectionRow";
import { WriteSplitPane, type ManuscriptSplitOption } from "@/components/writing/WriteSplitPane";
import { useTypewriterScroll } from "@/components/writing/useTypewriterScroll";
import { WriteStatusBar } from "@/components/writing/WriteStatusBar";
import {
  ManuscriptSynopsisPanel,
  MarginCommentsPanel,
} from "@/components/writing/ManuscriptAnnotationPanels";
import type { MarginCommentView } from "@/server/services/manuscriptAnnotationService";
import { ASSISTANT, NAV, RECORD, SHELL, tidySummary, WRITE, WRITING } from "@/ui/labels";
import type { WriteMode } from "@/writing/writeMode";
import { invertEdit } from "@/writing/findReplace";
import { minimalEdit, toggleInline } from "@/writing/markdownFormat";
import { tidyText } from "@/writing/tidy";
import { styleRangeHighlightEnd } from "@/writing/styleCheck";
import type { SpellChecker, SpellingLanguage } from "@/writing/spelling";
import { saveRecordAction, type FormResult } from "../../actions";
import {
  WriteContext,
  type AttachableSource,
  type ChoiceItem,
  type LinkedItem,
  type NoteItem,
  type PlotBeatItem,
  type SourceItem,
} from "./WriteContext";

const LOADABLE_FILE = /\.(md|markdown|txt)$/i;
const LOAD_MAX_BYTES = 5 * 1024 * 1024;

export function WriteEditor(props: {
  projectId: string;
  projectTitle: string;
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
  initialStyleRange: { start: number; end: number } | null;
  otherChaptersWords: number | null;
  spellingLanguage: SpellingLanguage;
  spellChecker: SpellChecker;
  dictionaryWords: DictionaryWord[];
  proofread: ProofreadConfig;
  notes: NoteItem[];
  linked: LinkedItem[];
  sceneLocations: import("@/server/services/sceneLocationService").SceneLocationSet;
  choices: ChoiceItem[];
  sources: SourceItem[];
  attachableSources: AttachableSource[];
  draftScopeId: string | null;
  drafts?: DraftOption[];
  initialPins: import("@/server/services/readingPinService").ReadingPinView[];
  plotBeats: PlotBeatItem[];
  manuscriptSplitOptions: ManuscriptSplitOption[];
  styleCheckNames: readonly string[];
  synopsisBody: string;
  marginComments: MarginCommentView[];
  /** Status, protection, history and compare, rendered by the server below the text. */
  details: ReactNode;
}) {
  const idPrefix = useId();
  const editorId = `${idPrefix}-text`;
  const contextId = `${idPrefix}-context`;
  const findId = `${idPrefix}-find`;
  const spellId = `${idPrefix}-spell`;
  const styleId = `${idPrefix}-style`;
  const { layout, updateLayout, writeMode, setWriteMode, setWriteScreen, openMainMenu } = useLayout();
  const chromeRef = useRef<HTMLElement>(null);
  const topbarRef = useRef<HTMLDivElement>(null);
  const insetRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLElement>(null);
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
  const [styleOpen, setStyleOpen] = useState(props.initialStyleRange !== null);
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
  const splitPeers = props.manuscriptSplitOptions.filter((o) => o.id !== props.recordId);
  const splitRecordId = layout.writeSplitRecordId;
  const splitOpen =
    writeMode !== "companion" &&
    splitRecordId !== null &&
    splitRecordId !== props.recordId &&
    splitPeers.some((o) => o.id === splitRecordId);
  const setSplitOpen = (on: boolean) => {
    if (!on) {
      updateLayout({ writeSplitRecordId: null });
      return;
    }
    const remembered =
      splitRecordId && splitRecordId !== props.recordId && splitPeers.some((o) => o.id === splitRecordId)
        ? splitRecordId
        : null;
    const next = remembered ?? splitPeers[0]?.id ?? null;
    if (next) updateLayout({ writeSplitRecordId: next });
  };
  useEffect(() => {
    if (!splitRecordId) return;
    const valid = props.manuscriptSplitOptions.some((o) => o.id === splitRecordId && o.id !== props.recordId);
    if (!valid) updateLayout({ writeSplitRecordId: null });
  }, [splitRecordId, props.recordId, props.manuscriptSplitOptions, updateLayout]);
  useTypewriterScroll(bodyRef, writeMode === "focus" && layout.typewriterScroll);
  useLayoutEffect(() => {
    const range = props.initialStyleRange;
    if (!range) return;
    const ta = bodyRef.current;
    if (!ta) return;
    const end = Math.min(styleRangeHighlightEnd(range.start, range.end), ta.value.length);
    const start = Math.min(range.start, end);
    selectRange(ta, start, end);
    scrollTextareaToSelection(ta);
  }, [props.initialStyleRange]);
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

  // Layout changes hide panels with CSS only, so the text box, its selection and its undo history stay mounted.
  const savedSelection = useRef<{ start: number; end: number } | null>(null);
  const returnMode = useRef<WriteMode>(writeMode === "focus" ? "desk" : writeMode);
  const selectMode = (mode: WriteMode) => {
    const ta = bodyRef.current;
    if (ta) savedSelection.current = { start: ta.selectionStart, end: ta.selectionEnd };
    if (mode === writeMode) {
      if (mode === "companion" && !rail.visible) rail.toggle();
      return;
    }
    if (mode !== "focus") returnMode.current = mode;
    setWriteMode(mode);
  };
  useLayoutEffect(() => {
    setWriteScreen(true);
    return () => setWriteScreen(false);
  }, [setWriteScreen]);
  useLayoutEffect(() => {
    const chrome = chromeRef.current;
    const topbar = topbarRef.current;
    const inset = insetRef.current;
    const status = statusRef.current;
    if (!chrome) return;
    const apply = () => {
      const topbarH = topbar?.offsetHeight ?? 0;
      const insetH = inset?.offsetHeight ?? 0;
      document.documentElement.style.setProperty("--write-topbar-h", `${topbarH}px`);
      document.documentElement.style.setProperty("--write-chrome-h", `${topbarH + insetH}px`);
      if (status) document.documentElement.style.setProperty("--write-status-h", `${status.offsetHeight}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(chrome);
    if (topbar) observer.observe(topbar);
    if (inset) observer.observe(inset);
    if (status) observer.observe(status);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--write-chrome-h");
      document.documentElement.style.removeProperty("--write-topbar-h");
      document.documentElement.style.removeProperty("--write-status-h");
    };
  }, []);
  useEffect(() => {
    const ta = bodyRef.current;
    const sel = savedSelection.current;
    if (!ta || !sel) return;
    savedSelection.current = null;
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(sel.start, sel.end);
  }, [writeMode]);
  useEffect(() => {
    if (writeMode !== "focus") return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        selectMode(returnMode.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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
      selectMode(writeMode === "focus" ? returnMode.current : "focus");
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

          <header className="write-header write-chrome" ref={chromeRef}>
            <div className="write-topbar" ref={topbarRef}>
              <div className="write-brand">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="write-menu"
                  aria-label={SHELL.openMenu}
                  onClick={openMainMenu}
                  icon={<Menu size={18} strokeWidth={1.75} />}
                />
                <Link href="/" className="brand write-brand-link" aria-label={NAV.brand}>
                  <StoryLoomMark className="brand-mark" />
                  <span className="brand-text">{NAV.brand}</span>
                </Link>
                <span className="write-project-sep" aria-hidden="true">
                  |
                </span>
                <span className="write-project-name">{props.projectTitle}</span>
              </div>
              <div className="write-actions">
                <p className={`save-status ${statusTone}`} role="status">
                  {saveStatus}
                </p>
                <Button type="submit" disabled={pending} aria-keyshortcuts="Control+S" title={`${WRITE.save} (${shortcutHint("S")})`} size="sm">
                  {WRITE.save}
                </Button>
                <IconAnchor tip="tip" href="#history" aria-label={WRITE.versionHistory}>
                  <HistoryIcon />
                </IconAnchor>
                <div className="menu-wrap">
                  <IconButton
                    tip="end"
                    aria-label={WRITE.more}
                    aria-expanded={menuOpen}
                    aria-controls={`${idPrefix}-menu`}
                    onClick={() => setMenuOpen((open) => !open)}
                  >
                    <MoreIcon />
                  </IconButton>
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
            <div className="write-chrome-inset" ref={insetRef}>
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
              <div className="write-title-tools">
                {splitPeers.length > 0 ? (
                  <LabeledSwitch label={WRITE.splitView} checked={splitOpen} onCheckedChange={setSplitOpen} />
                ) : null}
                <WriteModeSwitch mode={writeMode} onChange={selectMode} />
              </div>
            </div>
            <WriteProtectionRow
              drafts={props.drafts ?? []}
              activeDraftId={props.draftScopeId}
              isProtected={props.isProtected}
              unlocked={unlocked}
              onUnlocked={setUnlocked}
            />
            {!state.ok ? <IssueList issues={state.issues ?? []} /> : null}
            {!state.ok && state.message ? <Banner tone="error">{state.message}</Banner> : null}
            {loadNote && (loadNote.tone !== "info" || dirty) ? (
              <Banner tone={loadNote.tone === "error" ? "error" : "info"} className="load-note">
                {loadNote.text}
              </Banner>
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
              styleId={styleId}
              styleOpen={styleOpen}
              onToggleStyle={() => setStyleOpen((open) => !open)}
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
            <div id={styleId} hidden={!styleOpen} className="tool-panel">
              <StyleCheckPanel
                textareaRef={bodyRef}
                text={text}
                characterNames={props.styleCheckNames}
                projectId={props.projectId}
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
            </div>
          </header>

          <div className={`write-panes${splitOpen ? " is-split" : ""}`}>
          <div className={`write-column${writeMode === "desk" ? " has-tools" : ""}`}>
            {writeMode === "desk" ? (
              <div className="write-tools-launch">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  icon={<SlidersHorizontal size={16} strokeWidth={1.75} />}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectMode("companion")}
                >
                  {WRITE.tools}
                </Button>
              </div>
            ) : null}
            {writeMode === "focus" ? (
              <p id={`${idPrefix}-focus-hint`} className="sr-only">
                {WRITE.focusHint}
              </p>
            ) : null}
            <span className="spell-field">
              <textarea
                ref={bodyRef}
                id={editorId}
                name="body"
                className="document manuscript-text"
                aria-label={WRITE.editorLabel}
                aria-describedby={writeMode === "focus" ? `${idPrefix}-focus-hint` : undefined}
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
          {splitOpen && splitRecordId ? (
            <WriteSplitPane
              projectId={props.projectId}
              recordId={props.recordId}
              splitRecordId={splitRecordId}
              options={props.manuscriptSplitOptions}
              onSelectSplit={(id) => updateLayout({ writeSplitRecordId: id })}
            />
          ) : null}
          </div>

          {writeMode === "focus" ? (
            <div className="exit-focus-bar">
              <Button
                type="button"
                variant="outline"
                size="sm"
                icon={<ArrowLeft size={16} strokeWidth={1.75} />}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectMode(returnMode.current)}
              >
                {WRITE.exitFocus}
              </Button>
              <LabeledSwitch
                label={WRITE.typewriterScroll}
                hint={WRITE.typewriterScrollHint}
                checked={layout.typewriterScroll}
                onCheckedChange={(on) => updateLayout({ typewriterScroll: on })}
              />
            </div>
          ) : null}
          <WriteStatusBar
            statusRef={statusRef}
            counts={
              <WordCounts
                text={text}
                selection={selection}
                isChapter
                otherChaptersWords={props.otherChaptersWords}
                documentLabel={documentLabel}
              />
            }
            language={<SpellingLanguageSelect value={language} onChange={setLanguage} />}
            checker={checker}
            status={spell.status}
            issueCount={flags.length}
            checkCompleted={spell.lastCheckMs !== null}
            spellOpen={spellOpen}
            spellId={spellId}
            onToggleSpell={() => setSpellOpen((open) => !open)}
          />
        </form>
        <ManuscriptSynopsisPanel projectId={props.projectId} recordId={props.recordId} initialBody={props.synopsisBody} />
        <MarginCommentsPanel
          projectId={props.projectId}
          recordId={props.recordId}
          revision={props.revision}
          dirty={dirty}
          textareaRef={bodyRef}
          initialComments={props.marginComments}
        />
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
          sceneLocations={props.sceneLocations}
          choices={props.choices}
          sources={props.sources}
          attachableSources={props.attachableSources}
          draftScopeId={props.draftScopeId}
          initialPins={props.initialPins}
          plotBeats={props.plotBeats}
          editorText={text}
          editorDirty={dirty}
          editorSelection={selection}
          draftLabel={props.drafts?.find((d) => d.id === props.draftScopeId)?.label ?? ASSISTANT.draftScopeNone}
          assistantConfigured={props.proofread.configured}
          assistantProblems={props.proofread.problems ?? []}
          overlay={!rail.wide}
          onClose={rail.close}
          proofreader={
            <>
              <SelectionAssister
                projectId={props.projectId}
                recordId={props.recordId}
                revision={props.revision}
                savedText={savedText}
                text={text}
                selection={selection}
                scopeDraftId={props.draftScopeId ?? ""}
                textareaRef={bodyRef}
                editable={editable}
                onUnlock={() => setUnlocked(true)}
                onTextChange={setText}
                config={props.proofread}
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
            </>
          }
        />
      </ContextRail>
    </div>
  );
}
