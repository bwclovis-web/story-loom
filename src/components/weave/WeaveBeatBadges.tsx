import type { WeaveBeatSignals } from "@/weave/beatCardSignals";
import { CONTINUITY, SCENE_META, WEAVE } from "@/ui/labels";

export function WeaveBeatBadges({
  signals,
  compact = false,
}: {
  signals: WeaveBeatSignals;
  compact?: boolean;
}) {
  const bits: { key: string; label: string; className: string }[] = [];
  if (signals.setupCount > 0) {
    bits.push({
      key: "setup",
      label: compact ? WEAVE.badgeSetupShort : WEAVE.badgeSetup(signals.setupCount),
      className: "weave-beat-badge weave-beat-badge--setup",
    });
  }
  if (signals.payoffCount > 0) {
    bits.push({
      key: "payoff",
      label: compact ? WEAVE.badgePayoffShort : WEAVE.badgePayoff(signals.payoffCount),
      className: "weave-beat-badge weave-beat-badge--payoff",
    });
  }
  if (signals.continuityOpen > 0) {
    bits.push({
      key: "continuity",
      label: compact
        ? WEAVE.badgeContinuityShort(signals.continuityOpen)
        : WEAVE.badgeContinuity(signals.continuityOpen),
      className: "weave-beat-badge weave-beat-badge--continuity",
    });
  }
  if (signals.worldCiteCount > 0 && !compact) {
    bits.push({
      key: "world",
      label: WEAVE.badgeWorld(signals.worldCiteCount),
      className: "weave-beat-badge weave-beat-badge--world",
    });
  }
  if (signals.sceneStatus) {
    bits.push({
      key: "status",
      label: SCENE_META[signals.sceneStatus],
      className: `weave-beat-badge weave-beat-badge--status weave-beat-badge--status-${signals.sceneStatus}`,
    });
  }
  if (!bits.length) return null;
  return (
    <ul className="weave-beat-badges" aria-label={WEAVE.beatSignalsAria}>
      {bits.map((bit) => (
        <li key={bit.key} className={bit.className} title={bit.key === "continuity" ? CONTINUITY.writeBadgeHint : undefined}>
          {bit.label}
        </li>
      ))}
    </ul>
  );
}
