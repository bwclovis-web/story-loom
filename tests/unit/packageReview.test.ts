import { describe, expect, it, vi } from "vitest";
import { errorIssue } from "@/domain/issues";
import {
  canSubmit,
  foldUnchanged,
  initialReviewState,
  reviewReducer,
  reviewRecords,
  reviewSummary,
  sideBySideSegments,
  singleFlight,
  unifiedSegments,
  validationState,
  type ReviewState,
} from "@/ui/packageReview";
import { appliedResult as result, op, preview } from "../reviewFixtures";

const noCanon = { canonRequired: false };

describe("review records and summary", () => {
  it("groups operations by record and describes what changes", () => {
    const p = preview({
      operations: [
        op({ index: 0, fieldDiffs: [{ key: "age", change: "changed", before: 30, after: 31 }] }),
        op({ index: 1, op: "set_authority_status", bodyChanged: false, bodyDiff: [], statusBefore: "draft", statusAfter: "approved" }),
        op({
          index: 2,
          op: "create_record",
          recordId: "rec_invented_new",
          titleBefore: null,
          titleAfter: "The Lamp Office",
          type: "worldbuilding",
          expectedRevision: null,
          currentRevision: null,
          statusBefore: null,
          statusAfter: "proposed",
        }),
      ],
    });
    const records = reviewRecords(p);
    expect(records.map((r) => r.recordId)).toEqual(["rec_invented_a1", "rec_invented_new"]);
    expect(records[0].changes).toEqual(["Text", "1 field", "Status: draft → approved"]);
    expect(records[0].operations).toHaveLength(2);
    expect(records[1]).toMatchObject({ isNew: true, changes: ["New record", "Status: proposed"] });

    const s = reviewSummary(p);
    expect(s).toMatchObject({ recordCount: 2, updatedCount: 1, createdCount: 1, staleCount: 0 });
    expect(s.manuscriptRecords).toEqual([]);
    expect(s.revisionChecks).toEqual([{ recordId: "rec_invented_a1", title: "Ilse Marrow", expected: 2, current: 2, ok: true }]);
  });

  it("reports manuscript records only when an operation changes them", () => {
    const reference = reviewSummary(
      preview({
        potentialEffects: [
          {
            recordId: "rec_invented_ch1",
            title: "Chapter One",
            type: "manuscript_chapter",
            contentClass: "manuscript",
            protected: true,
            matchedTerms: ["Ilse"],
            triggeredByRecordId: "rec_invented_a1",
            triggeredByTitle: "Ilse Marrow",
          },
        ],
      }),
    );
    expect(reference.manuscriptRecords).toEqual([]);
    expect(reference.manuscriptMentions).toBe(1);

    const manuscript = reviewSummary(
      preview({
        requiresProtectedConfirmation: true,
        operations: [
          op({ recordId: "rec_invented_ch1", type: "manuscript_chapter", contentClass: "manuscript", protected: true, usesProtectedOverride: true }),
        ],
      }),
    );
    expect(manuscript.manuscriptRecords.map((r) => r.recordId)).toEqual(["rec_invented_ch1"]);
    expect(manuscript.protectedRecords).toEqual([{ recordId: "rec_invented_ch1", title: "Ilse Marrow", override: true }]);
  });

  it("marks stale records and the stale validation state", () => {
    const stale = errorIssue("STALE_REVISION", "Record is at revision 3, but the change expected revision 2.", {
      operationIndex: 0,
      recordId: "rec_invented_a1",
    });
    const p = preview({ status: "invalid", canApply: false, issues: [stale], operations: [op({ currentRevision: 3, issues: [stale] })] });
    expect(validationState(p)).toBe("stale");
    expect(reviewRecords(p)[0].stale).toBe(true);
    expect(reviewSummary(p).revisionChecks[0]).toMatchObject({ expected: 2, current: 3, ok: false });
  });

  it("distinguishes not approved, invalid and already applied", () => {
    expect(validationState(preview())).toBe("ready");
    expect(validationState(preview({ status: "invalid", canApply: false, issues: [errorIssue("NOT_APPROVED", "x")] }))).toBe("not_approved");
    expect(
      validationState(preview({ status: "invalid", canApply: false, issues: [errorIssue("NOT_APPROVED", "x"), errorIssue("SCOPE_VIOLATION", "y")] })),
    ).toBe("invalid");
    expect(validationState(preview({ status: "already_applied", canApply: false, operations: [], previousResult: result }))).toBe("already_applied");
  });
});

describe("text comparison", () => {
  const parts = [{ value: "Keeper of " }, { value: "lamps", removed: true }, { value: "bells", added: true }, { value: ".\n" }];

  it("splits into before and after columns without dropping text", () => {
    const { before, after } = sideBySideSegments(parts);
    expect(before.map((s) => s.text).join("")).toBe("Keeper of lamps.\n");
    expect(after.map((s) => s.text).join("")).toBe("Keeper of bells.\n");
    expect(before.find((s) => s.kind === "removed")?.text).toBe("lamps");
    expect(after.find((s) => s.kind === "added")?.text).toBe("bells");
    expect(unifiedSegments(parts).map((s) => s.kind)).toEqual(["same", "removed", "added", "same"]);
  });

  it("folds long unchanged stretches and keeps every character", () => {
    const long = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n");
    const segments = foldUnchanged([{ kind: "same", text: `${long}\n` }, { kind: "added", text: "new line\n" }, { kind: "same", text: long }]);
    expect(segments.map((s) => s.text).join("")).toBe(`${long}\nnew line\n${long}`);
    const folded = segments.filter((s) => s.kind === "folded");
    expect(folded).toHaveLength(2);
    expect(segments[0].kind).toBe("folded");
    expect(segments.at(-1)?.kind).toBe("folded");
  });

  it("leaves short unchanged text alone", () => {
    const segments = foldUnchanged([{ kind: "same", text: "a\nb\n" }, { kind: "added", text: "c" }]);
    expect(segments).toEqual([{ kind: "same", text: "a\nb\n" }, { kind: "added", text: "c" }]);
  });
});

describe("review screen state", () => {
  const two = preview({
    operations: [op({ index: 0 }), op({ index: 1, recordId: "rec_invented_b2", titleBefore: "Bell Tower", titleAfter: "Bell Tower" })],
  });

  it("selecting a record changes which diff is shown, never the package", () => {
    let s = initialReviewState(two);
    expect(s.selectedId).toBe("rec_invented_a1");
    s = reviewReducer(s, { type: "select", recordId: "rec_invented_b2" });
    expect(s.selectedId).toBe("rec_invented_b2");
    expect(s.preview.operations).toHaveLength(2);
    s = reviewReducer(s, { type: "move", by: 1 });
    expect(s.selectedId).toBe("rec_invented_b2");
    s = reviewReducer(s, { type: "move", by: -1 });
    expect(s.selectedId).toBe("rec_invented_a1");
    s = reviewReducer(s, { type: "last" });
    expect(s.selectedId).toBe("rec_invented_b2");
    expect(reviewReducer(s, { type: "select", recordId: "rec_not_in_package" })).toBe(s);
  });

  it("accepts one submission at a time", () => {
    const s = initialReviewState(two);
    const applying = reviewReducer(s, { type: "submit" });
    expect(applying.phase.kind).toBe("applying");
    expect(canSubmit(applying, noCanon)).toBe(false);
    expect(reviewReducer(applying, { type: "submit" })).toBe(applying);
  });

  it("calls the server once for overlapping apply requests", async () => {
    let release: (v: string) => void = () => {};
    const server = vi.fn(() => new Promise<string>((resolve) => (release = resolve)));
    const run = singleFlight(server);
    const first = run();
    const second = run();
    expect(await second).toBeNull();
    release("done");
    expect(await first).toBe("done");
    expect(server).toHaveBeenCalledTimes(1);
    const third = run();
    release("again");
    expect(await third).toBe("again");
    expect(server).toHaveBeenCalledTimes(2);
  });

  it("requires the protected confirmation when the package uses overrides", () => {
    const p = preview({ requiresProtectedConfirmation: true, operations: [op({ protected: true, usesProtectedOverride: true })] });
    let s = initialReviewState(p);
    expect(canSubmit(s, noCanon)).toBe(false);
    expect(reviewReducer(s, { type: "submit" })).toBe(s);
    s = reviewReducer(s, { type: "confirmProtected", value: true });
    expect(canSubmit(s, noCanon)).toBe(true);
  });

  it("requires canon confirmation only when asked to", () => {
    const s = initialReviewState(two);
    expect(canSubmit(s, { canonRequired: true })).toBe(false);
    expect(canSubmit(reviewReducer(s, { type: "confirmCanon", value: true }), { canonRequired: true })).toBe(true);
  });

  it("records applied, already applied, rejected and failed responses", () => {
    const applying = reviewReducer(initialReviewState(two), { type: "submit" });
    expect(reviewReducer(applying, { type: "response", response: { status: "applied", result, warnings: [] } }).phase.kind).toBe("applied");
    expect(reviewReducer(applying, { type: "response", response: { status: "already_applied", result } }).phase.kind).toBe("already_applied");
    const rejected = reviewReducer(applying, {
      type: "response",
      response: { status: "rejected", issues: [errorIssue("STALE_REVISION", "changed")] },
    });
    expect(rejected.phase).toEqual({ kind: "rejected", issues: [errorIssue("STALE_REVISION", "changed")] });
    expect(canSubmit(rejected, noCanon)).toBe(true);
    const failed = reviewReducer(applying, { type: "response", response: { status: "failed", message: "Network error" } });
    expect(failed.phase).toEqual({ kind: "failed", message: "Network error" });
    const done = reviewReducer(applying, { type: "response", response: { status: "applied", result, warnings: [] } });
    expect(canSubmit(done, noCanon)).toBe(false);
  });

  it("stops offering Apply when a check finds the package stale, and keeps expected revisions", () => {
    const stale = errorIssue("STALE_REVISION", "changed", { operationIndex: 0, recordId: "rec_invented_a1" });
    const checked = preview({
      status: "invalid",
      canApply: false,
      issues: [stale],
      operations: [op({ currentRevision: 3, issues: [stale] }), two.operations[1]],
    });
    let s: ReviewState = reviewReducer(initialReviewState(two), { type: "checking" });
    expect(canSubmit(s, noCanon)).toBe(false);
    s = reviewReducer(s, { type: "checked", preview: checked, at: 5 });
    expect(s.becameStale).toBe(true);
    expect(validationState(s.preview)).toBe("stale");
    expect(canSubmit(s, noCanon)).toBe(false);
    expect(s.preview.operations[0].expectedRevision).toBe(2);
    expect(s.checkedAt).toBe(5);
  });

  it("clears the protected confirmation when the protected records change", () => {
    const p = preview({ requiresProtectedConfirmation: true, operations: [op({ protected: true, usesProtectedOverride: true })] });
    let s = reviewReducer(initialReviewState(p), { type: "confirmProtected", value: true });
    s = reviewReducer(s, { type: "checked", preview: p, at: 1 });
    expect(s.confirmProtected).toBe(true);
    const other = preview({
      requiresProtectedConfirmation: true,
      operations: [op({ protected: true, usesProtectedOverride: true }), op({ index: 1, recordId: "rec_invented_b2", protected: true, usesProtectedOverride: true })],
    });
    s = reviewReducer(s, { type: "checked", preview: other, at: 2 });
    expect(s.confirmProtected).toBe(false);
  });

  it("shows an already applied package as finished after an uncertain failure", () => {
    const failed = reviewReducer(reviewReducer(initialReviewState(two), { type: "submit" }), {
      type: "response",
      response: { status: "failed", message: "Lost connection" },
    });
    const s = reviewReducer(failed, {
      type: "checked",
      preview: preview({ status: "already_applied", canApply: false, operations: [], previousResult: result }),
      at: 3,
    });
    expect(s.phase).toEqual({ kind: "already_applied", result });
  });
});
