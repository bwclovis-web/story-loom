import { RangeSetBuilder, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { SpellFlag } from "@/spelling/dictionary";

export const setSpellFlagsEffect = StateEffect.define<{
  flags: readonly SpellFlag[];
  current: SpellFlag | null;
}>();

const flagMark = Decoration.mark({ class: "cm-spell-flag" });
const currentMark = Decoration.mark({ class: "cm-spell-flag cm-spell-flag-current" });

function decorationsFor(flags: readonly SpellFlag[], current: SpellFlag | null, docLength: number) {
  const builder = new RangeSetBuilder<Decoration>();
  for (const flag of flags) {
    if (flag.start < 0 || flag.end > docLength || flag.start >= flag.end) continue;
    const isCurrent =
      current !== null && current.start === flag.start && current.end === flag.end;
    builder.add(flag.start, flag.end, isCurrent ? currentMark : flagMark);
  }
  return builder.finish();
}

const spellField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSpellFlagsEffect)) {
        return decorationsFor(effect.value.flags, effect.value.current, tr.state.doc.length);
      }
    }
    if (tr.docChanged) {
      // Offsets shift with typing; the React layer pushes fresh flags shortly.
      return value.map(tr.changes);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function spellDecorationExtension(): Extension {
  return [
    spellField,
    EditorView.baseTheme({
      ".cm-spell-flag": {
        textDecorationLine: "underline",
        textDecorationStyle: "wavy",
        textDecorationColor: "var(--color-danger)",
        textUnderlineOffset: "0.15em",
      },
      ".cm-spell-flag-current": {
        backgroundColor: "color-mix(in srgb, var(--color-danger) 12%, transparent)",
      },
    }),
  ];
}
