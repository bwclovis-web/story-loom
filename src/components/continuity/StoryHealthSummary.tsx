import Link from "next/link";
import type { ContinuityCategory, ContinuitySeverity, StoryHealthSummary as Health } from "@/domain/storyHealth";
import { CONTINUITY } from "@/ui/labels";

const SEVERITY_CHIPS: ContinuitySeverity[] = ["error", "warn", "info"];
const CATEGORY_CHIPS: { id: ContinuityCategory; label: string }[] = [
  { id: "bible", label: CONTINUITY.filterBible },
  { id: "stale", label: CONTINUITY.filterStale },
  { id: "timeline", label: CONTINUITY.filterTimeline },
  { id: "weave", label: CONTINUITY.filterWeave },
  { id: "manuscript", label: CONTINUITY.filterManuscript },
];

export function StoryHealthSummary({
  health,
  onFilterSeverity,
  onFilterCategory,
  compact = false,
  reviewHref,
}: {
  health: Health;
  onFilterSeverity?: (severity: ContinuitySeverity | "all") => void;
  onFilterCategory?: (category: ContinuityCategory | "all") => void;
  compact?: boolean;
  /** When set (Write landing), link to the full Story Health page. */
  reviewHref?: string;
}) {
  const statusLabel =
    health.status === "healthy"
      ? CONTINUITY.healthHealthy
      : health.status === "critical"
        ? CONTINUITY.healthCritical(health.openCount)
        : CONTINUITY.healthAttention(health.openCount);

  return (
    <section
      className={`panel story-health story-health--${health.status}${compact ? " story-health--compact" : ""}`}
      aria-labelledby="story-health-heading"
    >
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
        <h2 id="story-health-heading" style={{ margin: 0, fontSize: "1rem" }}>
          {CONTINUITY.healthHeading}
        </h2>
        {reviewHref ? (
          <Link className="small" href={reviewHref}>
            {CONTINUITY.writeStripReview}
          </Link>
        ) : null}
      </div>
      <p className="story-health-status" style={{ margin: "0.35rem 0 0" }}>
        {statusLabel}
      </p>
      <ul className="story-health-stats">
        <li>
          <span className="muted small">{CONTINUITY.healthOpen}</span> {health.openCount}
        </li>
        <li>
          <span className="muted small">{CONTINUITY.healthSuppressed}</span> {health.suppressedCount}
        </li>
        <li>
          <span className="muted small">{CONTINUITY.healthRecords}</span> {health.affectedRecordCount}
        </li>
      </ul>
      {!compact ? (
        <>
          <div className="story-health-chips" role="group" aria-label={CONTINUITY.filterSeverity}>
            {SEVERITY_CHIPS.map((severity) => {
              const count = health.bySeverity[severity];
              if (!count) return null;
              const label = `${CONTINUITY.severityBadge[severity]} (${count})`;
              return onFilterSeverity ? (
                <button
                  key={severity}
                  type="button"
                  className={`story-health-chip story-health-chip--${severity}`}
                  onClick={() => onFilterSeverity(severity)}
                >
                  {label}
                </button>
              ) : (
                <span key={severity} className={`story-health-chip story-health-chip--${severity}`}>
                  {label}
                </span>
              );
            })}
          </div>
          <div className="story-health-chips" role="group" aria-label={CONTINUITY.filterCategory}>
            {CATEGORY_CHIPS.map(({ id, label }) => {
              const count = health.byCategory[id];
              if (!count) return null;
              const text = `${label} (${count})`;
              return onFilterCategory ? (
                <button key={id} type="button" className="story-health-chip" onClick={() => onFilterCategory(id)}>
                  {text}
                </button>
              ) : (
                <span key={id} className="story-health-chip">
                  {text}
                </span>
              );
            })}
          </div>
          {onFilterSeverity || onFilterCategory ? (
            <p className="small muted" style={{ margin: 0 }}>
              {CONTINUITY.healthFilterHint}
            </p>
          ) : null}
        </>
      ) : null}
      {health.next ? (
        <div className="story-health-next">
          <p className="small" style={{ margin: 0 }}>
            <strong>{CONTINUITY.healthNext}</strong>
          </p>
          <p className="small muted" style={{ margin: 0 }}>
            {CONTINUITY.healthNextHint}
          </p>
          <p style={{ margin: "0.35rem 0 0" }}>
            <span className={`small continuity-sev continuity-sev-${health.next.severity}`}>
              {CONTINUITY.severityBadge[health.next.severity]}
            </span>{" "}
            <Link href={health.next.href}>{health.next.title}</Link>
            {health.next.detail ? <span className="small muted"> — {health.next.detail.slice(0, 140)}</span> : null}
          </p>
        </div>
      ) : null}
    </section>
  );
}
