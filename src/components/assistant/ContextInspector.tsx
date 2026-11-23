"use client";

import { useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Atoms/Button";
import { Checkbox } from "@/components/ui/Atoms/Checkbox";
import type { ContextInspectReport } from "@/server/services/assistantContextInspect";
import { ASSISTANT } from "@/ui/labels";

const fmt = (n: number) => n.toLocaleString("en-US");

export function ContextInspector({
  report,
  disabledIds,
  onToggle,
  onClose,
  onConfirmSend,
  busy,
}: {
  report: ContextInspectReport;
  disabledIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onClose: () => void;
  onConfirmSend?: () => void;
  busy?: boolean;
}) {
  const activeChars = report.items
    .filter((item) => !item.toggleable || !disabledIds.has(item.id))
    .reduce((n, item) => n + item.chars, 0);
  const est = Math.ceil(activeChars / 4);

  return (
    <div className="stack panel" role="region" aria-label={ASSISTANT.inspectHeading}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "0.5rem" }}>
        <h3 style={{ margin: 0 }}>{ASSISTANT.inspectHeading}</h3>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          {ASSISTANT.inspectClose}
        </Button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {ASSISTANT.inspectIntro}
      </p>
      <p className="small" style={{ margin: 0 }}>
        {ASSISTANT.inspectTotals(fmt(activeChars), fmt(est), report.model ?? "—")}
        {report.overLimit ? ` ${ASSISTANT.inspectOverLimit}` : ""}
      </p>
      <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: "0.35rem" }}>
        {report.items.map((item) => {
          const off = item.toggleable && disabledIds.has(item.id);
          return (
            <li key={item.id} className="stack" style={{ gap: "0.15rem" }}>
              {item.toggleable ? (
                <Checkbox
                  checked={!off}
                  disabled={busy}
                  onChange={() => onToggle(item.id)}
                  label={
                    <span>
                      <strong>{item.label}</strong>{" "}
                      <span className="muted small">({fmt(item.chars)} chars)</span>
                    </span>
                  }
                />
              ) : (
                <span className="inline" style={{ gap: "0.4rem" }}>
                  <span aria-hidden="true" style={{ width: "1rem", display: "inline-block" }} />
                  <span>
                    <strong>{item.label}</strong>{" "}
                    <span className="muted small">({fmt(item.chars)} chars)</span>
                  </span>
                </span>
              )}
              {item.preview ? (
                <p className="small muted" style={{ margin: "0 0 0 1.5rem" }}>
                  {off ? ASSISTANT.inspectOmitted : item.preview}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Banner tone="info">{ASSISTANT.inspectPrivacy}</Banner>
      {onConfirmSend ? (
        <Button type="button" size="sm" disabled={busy || report.overLimit} onClick={onConfirmSend}>
          {ASSISTANT.inspectSend}
        </Button>
      ) : null}
    </div>
  );
}

/** Local state helper for toggle sets. */
export function useDisabledInspectIds() {
  const [disabledIds, setDisabledIds] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => {
    setDisabledIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const reset = () => setDisabledIds(new Set());
  return { disabledIds, toggle, reset, setDisabledIds };
}
