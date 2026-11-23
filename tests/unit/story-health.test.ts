import { describe, expect, it } from "vitest";
import {
  summarizeStoryHealth,
  type ContinuityItem,
} from "@/server/services/continuityService";

function item(partial: Partial<ContinuityItem> & Pick<ContinuityItem, "key" | "kind" | "severity" | "category">): ContinuityItem {
  return {
    title: partial.title ?? partial.key,
    detail: partial.detail ?? "",
    href: partial.href ?? "/projects/p/continuity",
    recordId: partial.recordId ?? null,
    suppressed: partial.suppressed ?? false,
    suppressReason: partial.suppressReason ?? null,
    ...partial,
  };
}

describe("summarizeStoryHealth", () => {
  it("reports healthy when every finding is suppressed", () => {
    const summary = summarizeStoryHealth([
      item({
        key: "unresolved:a",
        kind: "unresolved",
        category: "bible",
        severity: "info",
        suppressed: true,
        suppressReason: "intentional",
        recordId: "rec_a",
      }),
    ]);
    expect(summary.status).toBe("healthy");
    expect(summary.openCount).toBe(0);
    expect(summary.suppressedCount).toBe(1);
    expect(summary.next).toBeNull();
  });

  it("prefers errors for next best action and counts categories", () => {
    const summary = summarizeStoryHealth([
      item({
        key: "fact:1",
        kind: "fact",
        category: "stale",
        severity: "warn",
        title: "Pending quay bell",
        recordId: "rec_fact",
      }),
      item({
        key: "timeline_cycle:1",
        kind: "timeline_cycle",
        category: "timeline",
        severity: "error",
        title: "Cycle in harbour eras",
        recordId: "rec_evt",
        href: "/projects/p/world/events",
      }),
      item({
        key: "open_question:1",
        kind: "open_question",
        category: "bible",
        severity: "info",
        recordId: "rec_fact",
      }),
      item({
        key: "review:1",
        kind: "review",
        category: "manuscript",
        severity: "info",
        suppressed: true,
        suppressReason: "ignored",
      }),
    ]);
    expect(summary.status).toBe("critical");
    expect(summary.openCount).toBe(3);
    expect(summary.suppressedCount).toBe(1);
    expect(summary.bySeverity).toEqual({ error: 1, warn: 1, info: 1 });
    expect(summary.byCategory.timeline).toBe(1);
    expect(summary.byCategory.stale).toBe(1);
    expect(summary.byCategory.bible).toBe(1);
    expect(summary.affectedRecordCount).toBe(2);
    expect(summary.next?.key).toBe("timeline_cycle:1");
    expect(summary.next?.href).toContain("/world/events");
  });

  it("orders same-severity findings by kind priority", () => {
    const summary = summarizeStoryHealth([
      item({
        key: "fact:1",
        kind: "fact",
        category: "stale",
        severity: "warn",
        title: "Fact",
      }),
      item({
        key: "draft:1",
        kind: "draft_in_canon",
        category: "bible",
        severity: "warn",
        title: "Draft cite",
      }),
    ]);
    expect(summary.status).toBe("attention");
    expect(summary.next?.kind).toBe("draft_in_canon");
  });
});
