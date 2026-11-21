"use client";

import { useEffect, useId, useMemo, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { REFERENCE_FORM } from "@/ui/labels";
import { referenceTemplate, reviewTemplateMapping, type ReferenceTemplateKey } from "@/world/referenceTemplates";

/** Confirms heading insertion. Choosing a template does not change the body until Add. */
export function HeadingReviewDialog({
  open,
  templateKey,
  body,
  onClose,
  onApply,
}: {
  open: boolean;
  templateKey: ReferenceTemplateKey | null;
  body: string;
  onClose: () => void;
  onApply: (nextBody: string) => void;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const mapping = useMemo(
    () => (templateKey ? reviewTemplateMapping(referenceTemplate(templateKey), body, []) : null),
    [templateKey, body],
  );

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open || !mapping) return null;
  const count = mapping.missing.length;

  return (
    <div className="reference-dialog-backdrop">
      <div
        ref={panelRef}
        className="reference-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <h2 id={titleId}>{count ? REFERENCE_FORM.reviewHeadings : REFERENCE_FORM.allPresent}</h2>
        {count ? (
          <>
            <p>
              <strong>{REFERENCE_FORM.alreadyPresent}:</strong>{" "}
              {mapping.matched.length ? mapping.matched.map((row) => row.heading).join(", ") : "—"}
            </p>
            <p>
              <strong>{REFERENCE_FORM.willAdd}:</strong>
            </p>
            <ul>
              {mapping.missing.map((heading) => (
                <li key={heading}>{heading}</li>
              ))}
            </ul>
            <p className="small muted">{REFERENCE_FORM.headingsUnchanged}</p>
          </>
        ) : (
          <p>{REFERENCE_FORM.allPresent}</p>
        )}
        <div className="reference-dialog-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            {REFERENCE_FORM.cancel}
          </Button>
          {count ? (
            <Button type="button" onClick={() => onApply(mapping.proposedBody)}>
              {REFERENCE_FORM.addMissing(count)}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
