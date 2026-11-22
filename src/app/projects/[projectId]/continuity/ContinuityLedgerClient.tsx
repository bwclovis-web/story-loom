"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { EmptyState } from "@/components/ui/EmptyState";
import type { ContinuityCategory, ContinuityItem, ContinuityKind, ContinuitySeverity } from "@/server/services/continuityService";
import { CONTINUITY } from "@/ui/labels";
import { clearContinuitySuppressionAction, suppressContinuityAction } from "./actions";

const KIND_ORDER: ContinuityKind[] = [
  "timeline_cycle",
  "draft_in_canon",
  "dangling_weave",
  "timeline_order",
  "character_state_conflict",
  "missing_ref",
  "fact",
  "story_evidence",
  "unresolved",
  "continuity_note",
  "character_knowledge",
  "character_limitation",
  "forgotten_arc",
  "character_identity",
  "open_question",
  "comment",
  "review",
];

const CATEGORIES: { id: ContinuityCategory | "all"; label: string }[] = [
  { id: "all", label: CONTINUITY.filterAll },
  { id: "bible", label: CONTINUITY.filterBible },
  { id: "stale", label: CONTINUITY.filterStale },
  { id: "timeline", label: CONTINUITY.filterTimeline },
  { id: "weave", label: CONTINUITY.filterWeave },
  { id: "manuscript", label: CONTINUITY.filterManuscript },
];

const SEVERITIES: { id: ContinuitySeverity | "all"; label: string }[] = [
  { id: "all", label: CONTINUITY.severityAll },
  { id: "error", label: CONTINUITY.severityError },
  { id: "warn", label: CONTINUITY.severityWarn },
  { id: "info", label: CONTINUITY.severityInfo },
];

function kindHeading(kind: ContinuityKind): string {
  return CONTINUITY.kinds[kind];
}

export function ContinuityLedgerClient({
  projectId,
  items,
}: {
  projectId: string;
  items: ContinuityItem[];
}) {
  const [category, setCategory] = useState<ContinuityCategory | "all">("all");
  const [severity, setSeverity] = useState<ContinuitySeverity | "all">("all");
  const [showSuppressed, setShowSuppressed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => {
    return items.filter((item) => {
      if (!showSuppressed && item.suppressed) return false;
      if (category !== "all" && item.category !== category) return false;
      if (severity !== "all" && item.severity !== severity) return false;
      return true;
    });
  }, [items, category, severity, showSuppressed]);

  const grouped = useMemo(() => {
    return KIND_ORDER.map((kind) => ({
      kind,
      rows: visible.filter((i) => i.kind === kind),
    })).filter((g) => g.rows.length > 0);
  }, [visible]);

  const onSuppress = (issueKey: string, reason: "intentional" | "ignored") =>
    startTransition(async () => {
      setError(null);
      const result = await suppressContinuityAction(projectId, issueKey, reason);
      if (!result.ok) setError(result.message ?? CONTINUITY.actionFailed);
    });

  const onClear = (issueKey: string) =>
    startTransition(async () => {
      setError(null);
      const result = await clearContinuitySuppressionAction(projectId, issueKey);
      if (!result.ok) setError(result.message ?? CONTINUITY.actionFailed);
    });

  return (
    <div className="stack">
      <div className="panel stack">
        <div className="row" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
          <label className="inline">
            {CONTINUITY.filterCategory}
            <select value={category} onChange={(e) => setCategory(e.target.value as ContinuityCategory | "all")} disabled={pending}>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="inline">
            {CONTINUITY.filterSeverity}
            <select value={severity} onChange={(e) => setSeverity(e.target.value as ContinuitySeverity | "all")} disabled={pending}>
              {SEVERITIES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <Checkbox
            checked={showSuppressed}
            onChange={(e) => setShowSuppressed(e.target.checked)}
            disabled={pending}
            label={CONTINUITY.showSuppressed}
          />
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {CONTINUITY.ledgerNote}
        </p>
        {items.some((item) => item.kind.startsWith("character_") || item.kind === "forgotten_arc") ? (
          <p className="small muted" style={{ margin: 0 }}>
            {CONTINUITY.characterLead}
          </p>
        ) : null}
      </div>

      {error ? <Banner tone="error">{error}</Banner> : null}

      {grouped.length === 0 ? (
        <EmptyState>{CONTINUITY.none}</EmptyState>
      ) : (
        grouped.map((group) => (
          <section key={group.kind} className="panel" aria-labelledby={`continuity-${group.kind}`}>
            <h2 id={`continuity-${group.kind}`}>{kindHeading(group.kind)}</h2>
            <ul className="stack" style={{ listStyle: "none", padding: 0, gap: "0.75rem" }}>
              {group.rows.map((row) => (
                <li key={row.key} className="stack" style={{ gap: "0.25rem" }}>
                  <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem", alignItems: "baseline" }}>
                    <span className={`small continuity-sev continuity-sev-${row.severity}`} title={row.severity}>
                      {CONTINUITY.severityBadge[row.severity]}
                    </span>
                    <Link href={row.href}>{row.title}</Link>
                    {row.suppressed ? (
                      <span className="small muted">
                        ({row.suppressReason === "intentional" ? CONTINUITY.markedIntentional : CONTINUITY.markedIgnored})
                      </span>
                    ) : null}
                  </div>
                  {row.detail ? <p className="small muted" style={{ margin: 0 }}>{row.detail}</p> : null}
                  <div className="row" style={{ gap: "0.35rem" }}>
                    {row.suppressed ? (
                      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => onClear(row.key)}>
                        {CONTINUITY.restore}
                      </Button>
                    ) : (
                      <>
                        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => onSuppress(row.key, "intentional")}>
                          {CONTINUITY.markIntentional}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => onSuppress(row.key, "ignored")}>
                          {CONTINUITY.markIgnored}
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
