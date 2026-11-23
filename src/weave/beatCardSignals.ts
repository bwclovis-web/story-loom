import type { ContinuityItem } from "@/domain/storyHealth";
import type { WeaveBeatView, WeaveSetupPayoffView } from "@/server/services/weaveService";
import type { ManuscriptSceneStatus } from "@/writing/manuscriptStructure";
import type { WeaveLinkFilter } from "@/weave/beatLinkFilter";
import { beatMatchesLinkFilter } from "@/weave/beatLinkFilter";

/** Extra board filters beyond decision + link (character / place / POV). */
export type WeaveBoardExtraFilter = {
  sceneStatus: ManuscriptSceneStatus | "all" | "unset";
  continuity: "all" | "open" | "clear";
};

export type WeaveBeatSignals = {
  setupCount: number;
  payoffCount: number;
  continuityOpen: number;
  worldCiteCount: number;
  sceneStatus: ManuscriptSceneStatus | "";
};

export function continuityOpenByRecord(items: readonly ContinuityItem[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    if (item.suppressed || !item.recordId) continue;
    map.set(item.recordId, (map.get(item.recordId) ?? 0) + 1);
  }
  return map;
}

export function beatSignals(
  beat: WeaveBeatView,
  setupPayoffs: readonly WeaveSetupPayoffView[],
  continuityByRecord: ReadonlyMap<string, number>,
): WeaveBeatSignals {
  let setupCount = 0;
  let payoffCount = 0;
  for (const link of setupPayoffs) {
    if (link.fromBeatId === beat.id) setupCount += 1;
    if (link.toBeatId === beat.id) payoffCount += 1;
  }
  return {
    setupCount,
    payoffCount,
    continuityOpen: beat.manuscriptRecordId ? continuityByRecord.get(beat.manuscriptRecordId) ?? 0 : 0,
    worldCiteCount: beat.worldRefs.filter((ref) => !ref.unavailable).length,
    sceneStatus: beat.manuscriptSceneStatus,
  };
}

export function beatMatchesBoardFilters(
  beat: WeaveBeatView,
  options: {
    decisionFilter: string;
    linkFilter: WeaveLinkFilter;
    extra: WeaveBoardExtraFilter;
    signals: WeaveBeatSignals;
  },
): boolean {
  if (!beatMatchesLinkFilter(beat, options.linkFilter)) return false;
  if (options.decisionFilter !== "all") {
    if (options.decisionFilter === "unset") {
      if (beat.decision) return false;
    } else if (beat.decision !== options.decisionFilter) {
      return false;
    }
  }
  if (options.extra.sceneStatus !== "all") {
    if (options.extra.sceneStatus === "unset") {
      if (options.signals.sceneStatus) return false;
    } else if (options.signals.sceneStatus !== options.extra.sceneStatus) {
      return false;
    }
  }
  if (options.extra.continuity === "open" && options.signals.continuityOpen <= 0) return false;
  if (options.extra.continuity === "clear" && options.signals.continuityOpen > 0) return false;
  return true;
}
