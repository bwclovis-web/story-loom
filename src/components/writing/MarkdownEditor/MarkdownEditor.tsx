"use client";

import { defaultKeymap, history, historyKeymap, redo, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import { Annotation, Compartment, EditorState, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, drawSelection, EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { SpellFlag } from "@/spelling/dictionary";
import type { CodexEntry } from "@/writing/codexSuggest";
import type { EditorSurface } from "../EditorSurface";
import { codexHoverExtension } from "./codexHover";
import { livePreviewExtension } from "./livePreview";
import { setSpellFlagsEffect, spellDecorationExtension } from "./spellDecorations";
import { manuscriptTheme } from "./theme";
import {
  chapterOffsetToDoc,
  chapterWithoutScenes,
  composeChapterWithScenes,
  docOffsetToChapter,
  sceneBodiesFromDoc,
  type LockedRange,
} from "@/writing/nestedSceneTail";

export type EditorChrome = "live" | "raw";

export interface MarkdownEditorProps {
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  initialDoc: string;
  /**
   * Ranges in `initialDoc` that stay visible but are omitted from `value` and
   * `onChange`, so a chapter save does not store scene text.
   */
  lockedRanges?: readonly LockedRange[];
  editable?: boolean;
  language?: string;
  chrome?: EditorChrome;
  placeholder?: string;
  spellFlags?: readonly SpellFlag[];
  currentSpellFlag?: SpellFlag | null;
  codexEntries?: readonly CodexEntry[];
  onChange?: (doc: string) => void;
  onSelectionChange?: (selection: { start: number; end: number }) => void;
  onDomKeyDown?: (event: KeyboardEvent) => void;
}

const replaceWholeDoc = Annotation.define<boolean>();

const setLockedRanges = StateEffect.define<readonly LockedRange[]>();

/** Map locked scene ranges through a doc change without throwing on stale positions. */
export function mapLockedRangesThroughChange(
  ranges: readonly LockedRange[],
  changes: { length: number; mapPos: (pos: number, assoc?: number) => number },
  nextLength: number,
): LockedRange[] {
  const fromLen = changes.length;
  const out: LockedRange[] = [];
  for (const range of ranges) {
    if (range.end <= 0 || range.start >= fromLen) continue;
    const from = Math.max(0, Math.min(range.start, fromLen));
    const to = Math.max(from, Math.min(range.end, fromLen));
    const start = Math.max(0, Math.min(changes.mapPos(from, 1), nextLength));
    const end = Math.max(start, Math.min(changes.mapPos(to, -1), nextLength));
    if (end > start) out.push({ start, end });
  }
  return out;
}

const lockedRangesField = StateField.define<readonly LockedRange[]>({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setLockedRanges)) return effect.value;
    if (!tr.docChanged) return value;
    return mapLockedRangesThroughChange(value, tr.changes, tr.state.doc.length);
  },
});

function rangesOf(state: EditorState): readonly LockedRange[] {
  return state.field(lockedRangesField, false) ?? [];
}

function hitsLocked(from: number, to: number, ranges: readonly LockedRange[]): boolean {
  return ranges.some((range) => from < range.end && to > range.start);
}

const sceneMark = Decoration.mark({
  class: "cm-nested-scene",
  attributes: { title: "Scene. Edit it on its own page. It is not saved with the chapter." },
});

function sceneDecorations(ranges: readonly LockedRange[]) {
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of ranges) {
    if (range.end > range.start) builder.add(range.start, range.end, sceneMark);
  }
  return builder.finish();
}

const nestedSceneMarks = StateField.define({
  create(state) {
    return sceneDecorations(state.field(lockedRangesField, false) ?? []);
  },
  update(_value, tr) {
    return sceneDecorations(tr.state.field(lockedRangesField, false) ?? []);
  },
  provide: (field) => EditorView.decorations.from(field),
});

function flagsInDoc(flags: readonly SpellFlag[], current: SpellFlag | null, ranges: readonly LockedRange[]) {
  const map = (flag: SpellFlag): SpellFlag => ({
    ...flag,
    start: chapterOffsetToDoc(flag.start, ranges),
    end: chapterOffsetToDoc(flag.end, ranges),
  });
  return { flags: flags.map(map), current: current ? map(current) : null };
}

const mdHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "600" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: "var(--color-accent)" },
  { tag: tags.url, color: "var(--color-text-muted)" },
  { tag: tags.quote, color: "var(--color-text-muted)", fontStyle: "italic" },
  { tag: tags.monospace, fontFamily: "var(--font-mono, ui-monospace, monospace)" },
]);

function createSurface(view: EditorView, host: HTMLElement): EditorSurface {
  return {
    get value() {
      return chapterWithoutScenes(view.state.doc.toString(), rangesOf(view.state));
    },
    set value(next: string) {
      const current = view.state.doc.toString();
      const ranges = rangesOf(view.state);
      const composed = composeChapterWithScenes(
        next,
        sceneBodiesFromDoc(current, ranges).map((body) => ({ body })),
      );
      if (composed.doc === current) return;
      view.dispatch({
        changes: { from: 0, to: current.length, insert: composed.doc },
        effects: setLockedRanges.of(composed.locked),
        annotations: replaceWholeDoc.of(true),
        userEvent: "input",
      });
    },
    get selectionStart() {
      return docOffsetToChapter(view.state.selection.main.from, rangesOf(view.state));
    },
    get selectionEnd() {
      return docOffsetToChapter(view.state.selection.main.to, rangesOf(view.state));
    },
    setSelectionRange(start, end) {
      const ranges = rangesOf(view.state);
      const len = view.state.doc.length;
      const from = Math.max(0, Math.min(chapterOffsetToDoc(start, ranges), len));
      const to = Math.max(0, Math.min(chapterOffsetToDoc(end, ranges), len));
      view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
    },
    focus(options) {
      if (options?.preventScroll) view.contentDOM.focus({ preventScroll: true });
      else view.focus();
    },
    blur() {
      view.contentDOM.blur();
    },
    get scrollTop() {
      return view.scrollDOM.scrollTop;
    },
    set scrollTop(value: number) {
      view.scrollDOM.scrollTop = value;
    },
    get clientHeight() {
      return view.scrollDOM.clientHeight;
    },
    get clientWidth() {
      return view.scrollDOM.clientWidth;
    },
    applyEdit(edit) {
      const current = view.state.doc.toString();
      const ranges = rangesOf(view.state);
      const chapter = chapterWithoutScenes(current, ranges);
      const start = Math.max(0, Math.min(edit.start, chapter.length));
      const end = Math.max(start, Math.min(edit.end, chapter.length));
      const next = chapter.slice(0, start) + edit.text + chapter.slice(end);
      const composed = composeChapterWithScenes(
        next,
        sceneBodiesFromDoc(current, ranges).map((body) => ({ body })),
      );
      view.focus();
      view.dispatch({
        changes: { from: 0, to: current.length, insert: composed.doc },
        effects: setLockedRanges.of(composed.locked),
        annotations: replaceWholeDoc.of(true),
        selection: { anchor: chapterOffsetToDoc(start + edit.text.length, composed.locked) },
        userEvent: "input.type",
      });
      return "native";
    },
    undo() {
      return undo(view);
    },
    redo() {
      return redo(view);
    },
    containsElement(el) {
      return el instanceof Node && host.contains(el);
    },
    setComposedChapter(chapter, scenes) {
      const composed = composeChapterWithScenes(chapter, scenes);
      const current = view.state.doc.toString();
      if (composed.doc === current) {
        view.dispatch({ effects: setLockedRanges.of(composed.locked) });
        return;
      }
      view.dispatch({
        changes: { from: 0, to: current.length, insert: composed.doc },
        effects: setLockedRanges.of(composed.locked),
        annotations: replaceWholeDoc.of(true),
        userEvent: "input",
      });
    },
  };
}

export const MarkdownEditor = forwardRef<EditorSurface, MarkdownEditorProps>(function MarkdownEditor(
  {
    id,
    className,
    "aria-label": ariaLabel,
    "aria-describedby": ariaDescribedBy,
    initialDoc,
    lockedRanges = [],
    editable = true,
    language = "en",
    chrome = "live",
    placeholder,
    spellFlags = [],
    currentSpellFlag = null,
    codexEntries = [],
    onChange,
    onSelectionChange,
    onDomKeyDown,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const surfaceRef = useRef<EditorSurface | null>(null);
  const chromeCompartment = useRef(new Compartment());
  const editableCompartment = useRef(new Compartment());
  const attrsCompartment = useRef(new Compartment());
  const codexCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onSelectionRef = useRef(onSelectionChange);
  const onKeyDownRef = useRef(onDomKeyDown);
  onChangeRef.current = onChange;
  onSelectionRef.current = onSelectionChange;
  onKeyDownRef.current = onDomKeyDown;

  useImperativeHandle(ref, () => {
    const live = () => surfaceRef.current;
    return {
      get value() {
        return live()?.value ?? "";
      },
      set value(next: string) {
        const surface = live();
        if (surface) surface.value = next;
      },
      get selectionStart() {
        return live()?.selectionStart ?? 0;
      },
      get selectionEnd() {
        return live()?.selectionEnd ?? 0;
      },
      setSelectionRange(start, end, direction) {
        live()?.setSelectionRange(start, end, direction);
      },
      focus(options) {
        live()?.focus(options);
      },
      blur() {
        live()?.blur?.();
      },
      get scrollTop() {
        return live()?.scrollTop ?? 0;
      },
      set scrollTop(value: number) {
        const surface = live();
        if (surface) surface.scrollTop = value;
      },
      get clientHeight() {
        return live()?.clientHeight ?? 0;
      },
      get clientWidth() {
        return live()?.clientWidth ?? 0;
      },
      applyEdit(edit) {
        return live()?.applyEdit?.(edit) ?? "direct";
      },
      undo() {
        return live()?.undo?.() ?? false;
      },
      redo() {
        return live()?.redo?.() ?? false;
      },
      containsElement(el) {
        return live()?.containsElement?.(el) ?? false;
      },
    };
  }, []);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const state = EditorState.create({
      doc: initialDoc,
      extensions: [
        lockedRangesField.init(() => lockedRanges),
        nestedSceneMarks,
        EditorView.baseTheme({
          ".cm-nested-scene": {
            backgroundColor: "color-mix(in srgb, var(--color-accent) 16%, transparent)",
            borderRadius: "2px",
          },
        }),
        history(),
        markdown(),
        drawSelection(),
        syntaxHighlighting(mdHighlight),
        manuscriptTheme,
        spellDecorationExtension(),
        EditorState.changeFilter.of((tr) => {
          if (!tr.docChanged || tr.annotation(replaceWholeDoc)) return true;
          const ranges = tr.startState.field(lockedRangesField, false) ?? [];
          if (ranges.length === 0) return true;
          let allowed = true;
          tr.changes.iterChanges((from, to) => {
            if (hitsLocked(from, to, ranges)) allowed = false;
          });
          return allowed;
        }),
        chromeCompartment.current.of(livePreviewExtension(chrome === "live")),
        codexCompartment.current.of(codexHoverExtension(codexEntries)),
        editableCompartment.current.of(EditorView.editable.of(editable)),
        attrsCompartment.current.of(
          EditorView.contentAttributes.of({
            id: id ?? "",
            role: "textbox",
            "aria-multiline": "true",
            "aria-label": ariaLabel ?? "",
            "aria-describedby": ariaDescribedBy ?? "",
            lang: language,
            spellcheck: "false",
          }),
        ),
        keymap.of([...historyKeymap, ...defaultKeymap, ...searchKeymap]),
        EditorView.lineWrapping,
        placeholder ? cmPlaceholder(placeholder) : [],
        EditorView.updateListener.of((update) => {
          const ranges = rangesOf(update.state);
          if (update.docChanged) onChangeRef.current?.(chapterWithoutScenes(update.state.doc.toString(), ranges));
          if (update.selectionSet || update.docChanged) {
            const sel = update.state.selection.main;
            onSelectionRef.current?.({
              start: docOffsetToChapter(sel.from, ranges),
              end: docOffsetToChapter(sel.to, ranges),
            });
          }
        }),
        EditorView.domEventHandlers({
          keydown(event) {
            onKeyDownRef.current?.(event);
            return false;
          },
        }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    surfaceRef.current = createSurface(view, host);
    view.dispatch({
      effects: setSpellFlagsEffect.of(flagsInDoc(spellFlags, currentSpellFlag, lockedRanges)),
    });

    return () => {
      view.destroy();
      viewRef.current = null;
      surfaceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once; updates via compartments
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: chromeCompartment.current.reconfigure(livePreviewExtension(chrome === "live")),
    });
  }, [chrome]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: editableCompartment.current.reconfigure(EditorView.editable.of(editable)),
    });
  }, [editable]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: attrsCompartment.current.reconfigure(
        EditorView.contentAttributes.of({
          id: id ?? "",
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": ariaLabel ?? "",
          "aria-describedby": ariaDescribedBy ?? "",
          lang: language,
          spellcheck: "false",
        }),
      ),
    });
  }, [id, ariaLabel, ariaDescribedBy, language]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: setSpellFlagsEffect.of(flagsInDoc(spellFlags, currentSpellFlag, rangesOf(view.state))),
    });
  }, [spellFlags, currentSpellFlag]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: codexCompartment.current.reconfigure(codexHoverExtension(codexEntries)),
    });
  }, [codexEntries]);

  return (
    <div
      ref={hostRef}
      className={`markdown-editor manuscript-text ${className ?? ""}`.trim()}
      data-chrome={chrome}
    />
  );
});
