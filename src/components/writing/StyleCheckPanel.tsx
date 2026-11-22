"use client";

import { useMemo, type RefObject } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { STYLE_CHECK } from "@/ui/labels";
import { runStyleCheck, styleIssueSelectionEnd, type StyleCheckKind, type StyleIssue } from "@/writing/styleCheck";
import { scrollTextareaToSelection, selectRange } from "./textareaEdit";

const KIND_LABEL: Record<StyleCheckKind, string> = {
  echo: STYLE_CHECK.kindEcho,
  filter: STYLE_CHECK.kindFilter,
  adverb: STYLE_CHECK.kindAdverb,
  long_sentence: STYLE_CHECK.kindLongSentence,
  name_repeat: STYLE_CHECK.kindName,
  passive: STYLE_CHECK.kindPassive,
  weak_verb: STYLE_CHECK.kindWeakVerb,
};

export function StyleCheckPanel({
  textareaRef,
  text,
  characterNames,
  projectId,
}: {
  textareaRef: RefObject<import("@/components/writing/EditorSurface").EditorSurface | HTMLTextAreaElement | null>;
  text: string;
  characterNames: readonly string[];
  projectId: string;
}) {
  const issues = useMemo(() => runStyleCheck(text, { characterNames }), [text, characterNames]);
  const byKind = useMemo(() => {
    const map = new Map<StyleCheckKind, StyleIssue[]>();
    for (const issue of issues) {
      map.set(issue.kind, [...(map.get(issue.kind) ?? []), issue]);
    }
    return map;
  }, [issues]);

  const jump = (issue: StyleIssue) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const end = styleIssueSelectionEnd(issue);
    const safeEnd = Math.min(end, ta.value.length);
    const safeStart = Math.min(issue.start, safeEnd);
    selectRange(ta, safeStart, safeEnd);
    scrollTextareaToSelection(ta);
  };

  return (
    <div className="style-check-panel stack small">
      <p className="muted" style={{ margin: 0 }}>
        {STYLE_CHECK.panelNote}
      </p>
      <p className="small">
        <ButtonLink href={`/projects/${encodeURIComponent(projectId)}/write/style`} variant="secondary" size="sm">
          {STYLE_CHECK.manuscriptPass}
        </ButtonLink>
      </p>
      {issues.length === 0 ? <p className="muted">{STYLE_CHECK.none}</p> : null}
      {[...byKind.entries()].map(([kind, list]) => (
        <details key={kind} open={list.length <= 12}>
          <summary>
            {KIND_LABEL[kind]} <span className="muted">({list.length})</span>
          </summary>
          <ul className="style-check-list">
            {list.map((issue, i) => (
              <li key={`${kind}-${issue.start}-${issue.end}-${i}`}>
                <button type="button" className="linklike menu-item" onClick={() => jump(issue)}>
                  {issue.detail}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}