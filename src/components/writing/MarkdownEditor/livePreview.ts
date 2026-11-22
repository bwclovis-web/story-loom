import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";

/**
 * Collapses Markdown punctuation so the manuscript reads as formatted prose.
 * Uses Decoration.replace (not opacity/font-size tricks) so selection highlight
 * does not paint a second ghost copy of the same words.
 *
 * Caret on a line: that line keeps raw marks for editing.
 * Range selection: marks stay collapsed everywhere so a selected passage stays
 * one live-formatted block.
 */
const hideMark = Decoration.replace({});

const MARK_NODES = new Set([
  "EmphasisMark",
  "StrongMark",
  "StrikethroughMark",
  "CodeMark",
  "HeaderMark",
  "QuoteMark",
  "ListMark",
  "LinkMark",
  "URL",
]);

function buildLiveDecorations(view: EditorView): DecorationSet {
  const sel = view.state.selection.main;
  const rangeSelected = sel.from !== sel.to;
  const caretLine = view.state.doc.lineAt(sel.head);
  const revealFrom = rangeSelected ? -1 : caretLine.from;
  const revealTo = rangeSelected ? -1 : caretLine.to;

  const ranges: { from: number; to: number }[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (!MARK_NODES.has(node.name)) return;
        const onRevealLine = !rangeSelected && node.from >= revealFrom && node.to <= revealTo;
        if (onRevealLine || node.from >= node.to) return;
        ranges.push({ from: node.from, to: node.to });
      },
    });
  }

  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  let lastTo = -1;
  for (const range of ranges) {
    const from = Math.max(range.from, lastTo);
    if (from >= range.to) continue;
    builder.add(from, range.to, hideMark);
    lastTo = range.to;
  }
  return builder.finish();
}

export function livePreviewExtension(enabled: boolean): Extension {
  if (!enabled) return [];
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = buildLiveDecorations(view);
        }
        update(update: ViewUpdate) {
          if (update.docChanged || update.selectionSet || update.viewportChanged) {
            this.decorations = buildLiveDecorations(update.view);
          }
        }
      },
      { decorations: (v) => v.decorations },
    ),
  ];
}
