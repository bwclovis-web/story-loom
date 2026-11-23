import { describe, expect, it } from "vitest";
import type { ContinuityItem } from "@/server/services/continuityService";
import type { WeaveBeatView, WeaveSetupPayoffView } from "@/server/services/weaveService";
import {
  beatMatchesBoardFilters,
  beatSignals,
  continuityOpenByRecord,
} from "@/weave/beatCardSignals";

function beat(partial: Partial<WeaveBeatView> & Pick<WeaveBeatView, "id" | "title">): WeaveBeatView {
  return {
    gridId: "wvg_1",
    body: "",
    decision: "",
    decisionLabel: "",
    manuscriptRecordId: null,
    manuscriptTitle: null,
    manuscriptTypeLabel: null,
    manuscriptUnavailable: false,
    manuscriptPov: "",
    manuscriptSceneStatus: "",
    threadId: null,
    planningRowId: null,
    cellOrder: 0,
    contentRevision: 1,
    x: 0,
    y: 0,
    width: 160,
    height: 80,
    zIndex: 0,
    worldRefs: [],
    ...partial,
  };
}

describe("beat card signals", () => {
  it("counts open continuity findings per manuscript record", () => {
    const items: ContinuityItem[] = [
      {
        key: "a",
        kind: "unresolved",
        title: "A",
        detail: "",
        href: "/a",
        category: "bible",
        severity: "info",
        recordId: "rec_1",
        suppressed: false,
        suppressReason: null,
      },
      {
        key: "b",
        kind: "fact",
        title: "B",
        detail: "",
        href: "/b",
        category: "stale",
        severity: "warn",
        recordId: "rec_1",
        suppressed: true,
        suppressReason: "ignored",
      },
      {
        key: "c",
        kind: "review",
        title: "C",
        detail: "",
        href: "/c",
        category: "manuscript",
        severity: "info",
        recordId: "rec_2",
        suppressed: false,
        suppressReason: null,
      },
    ];
    const map = continuityOpenByRecord(items);
    expect(map.get("rec_1")).toBe(1);
    expect(map.get("rec_2")).toBe(1);
  });

  it("derives setup, payoff, status, and continuity signals", () => {
    const setupPayoffs: WeaveSetupPayoffView[] = [
      {
        id: "1",
        fromBeatId: "beat_setup",
        fromTitle: "Setup",
        fromGridId: "g",
        fromProjectId: "p",
        fromProjectTitle: "P",
        toBeatId: "beat_pay",
        toTitle: "Pay",
        toGridId: "g",
        toProjectId: "p",
        toProjectTitle: "P",
        note: "",
        createdAt: new Date(0),
      },
    ];
    const continuity = new Map([["rec_ms", 2]]);
    const signals = beatSignals(
      beat({
        id: "beat_setup",
        title: "Gun",
        manuscriptRecordId: "rec_ms",
        manuscriptSceneStatus: "rough",
        worldRefs: [
          {
            id: "wr",
            recordId: "rec_w",
            title: "Quay",
            type: "worldbuilding",
            typeLabel: "Worldbuilding",
            worldKind: "place",
            unavailable: false,
          },
        ],
      }),
      setupPayoffs,
      continuity,
    );
    expect(signals).toEqual({
      setupCount: 1,
      payoffCount: 0,
      continuityOpen: 2,
      worldCiteCount: 1,
      sceneStatus: "rough",
    });
  });

  it("filters by draft status and continuity", () => {
    const open = beat({
      id: "1",
      title: "Open",
      manuscriptRecordId: "rec_a",
      manuscriptSceneStatus: "outline",
    });
    const clear = beat({
      id: "2",
      title: "Clear",
      manuscriptRecordId: "rec_b",
      manuscriptSceneStatus: "final",
    });
    const continuity = new Map([["rec_a", 1]]);
    const openSignals = beatSignals(open, [], continuity);
    const clearSignals = beatSignals(clear, [], continuity);

    expect(
      beatMatchesBoardFilters(open, {
        decisionFilter: "all",
        linkFilter: { kind: "all" },
        extra: { sceneStatus: "outline", continuity: "open" },
        signals: openSignals,
      }),
    ).toBe(true);
    expect(
      beatMatchesBoardFilters(clear, {
        decisionFilter: "all",
        linkFilter: { kind: "all" },
        extra: { sceneStatus: "all", continuity: "open" },
        signals: clearSignals,
      }),
    ).toBe(false);
    expect(
      beatMatchesBoardFilters(clear, {
        decisionFilter: "all",
        linkFilter: { kind: "all" },
        extra: { sceneStatus: "final", continuity: "clear" },
        signals: clearSignals,
      }),
    ).toBe(true);
  });
});
