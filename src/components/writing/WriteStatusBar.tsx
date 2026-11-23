"use client";

import { Check, CircleAlert, CircleOff, LoaderCircle, Minus, SpellCheck } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { Button } from "@/components/ui/Atoms/Button";
import { SPELLING } from "@/ui/labels";
import type { SpellChecker } from "@/writing/spelling";
import { spellingFooterKind, type SpellcheckRunStatus, type SpellingFooterKind } from "@/writing/spellingStatus";

const KIND_LABEL: Record<Exclude<SpellingFooterKind, "issues">, string> = {
  checking: SPELLING.footerChecking,
  disabled: SPELLING.footerDisabled,
  unavailable: SPELLING.footerUnavailable,
  failed: SPELLING.footerFailed,
  clear: SPELLING.footerClear,
};

function statusIcon(kind: SpellingFooterKind): ReactNode {
  const props = { "aria-hidden": true as const, strokeWidth: 1.75 };
  if (kind === "clear") return <Check {...props} />;
  if (kind === "issues") return <SpellCheck {...props} />;
  if (kind === "failed") return <CircleAlert {...props} />;
  if (kind === "unavailable") return <CircleOff {...props} />;
  if (kind === "disabled") return <Minus {...props} />;
  return <LoaderCircle {...props} className="spelling-status-spin" />;
}

/** Word counts, language, and the live spelling result. One bar in every layout. */
export function WriteStatusBar({
  statusRef,
  counts,
  language,
  checker,
  status,
  issueCount,
  checkCompleted,
  spellOpen,
  spellId,
  onToggleSpell,
}: {
  statusRef?: Ref<HTMLElement>;
  counts: ReactNode;
  language: ReactNode;
  checker: SpellChecker;
  status: SpellcheckRunStatus;
  issueCount: number;
  checkCompleted: boolean;
  spellOpen: boolean;
  spellId: string;
  onToggleSpell: () => void;
}) {
  const kind = spellingFooterKind({ checker, status, issueCount, checkCompleted });
  const label = kind === "issues" ? SPELLING.footerIssues(issueCount) : KIND_LABEL[kind];
  return (
    <footer ref={statusRef} className="write-footer write-status">
      {counts}
      <div className="write-status-end">
        {language}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={`spelling-status is-${kind}`}
          aria-expanded={spellOpen}
          aria-controls={spellId}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onToggleSpell}
          icon={statusIcon(kind)}
        >
          <span role="status">{label}</span>
        </Button>
      </div>
    </footer>
  );
}
