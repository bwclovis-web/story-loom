import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PackagePreview } from "@/server/services/changePackageService";
import { REVIEW } from "@/ui/labels";
import { initialReviewState, reviewReducer, type ReviewAction, type ReviewState } from "@/ui/packageReview";
import { appliedResult, header, op, preview } from "../reviewFixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));

const { PackageReviewView } = await import("@/components/review/PackageReview");
type ViewProps = Parameters<typeof PackageReviewView>[0];

function render(state: ReviewState, over: Partial<ViewProps> = {}): string {
  const html = renderToStaticMarkup(
    createElement(PackageReviewView, {
      state,
      dispatch: () => {},
      projectId: "prj_invented",
      kind: "package",
      conversation: null,
      back: { label: REVIEW.backToPackageText, onClick() {} },
      mounted: false,
      onApply() {},
      onCheck() {},
      ...over,
    }),
  );
  return html.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
}

function applyButton(html: string): { tag: string; label: string } | null {
  const m = html.match(/<button([^>]*class="review-apply"[^>]*)>([\s\S]*?)<\/button>/);
  return m ? { tag: m[1], label: m[2] } : null;
}

const run = (state: ReviewState, ...actions: ReviewAction[]) => actions.reduce((s, a) => reviewReducer(s, a), state);
const at = Date.UTC(2026, 9, 26, 12);

const twoRecords = preview({
  header: header(),
  operations: [
    op({ index: 0 }),
    op({
      index: 1,
      recordId: "rec_invented_b2",
      titleBefore: "Orrin Vale",
      titleAfter: "Orrin Vale",
      bodyDiff: [{ value: "A ferryman." }],
      bodyChanged: false,
      fieldDiffs: [{ key: "age", change: "changed", before: 40, after: 41 }],
      expectedRevision: 5,
      currentRevision: 5,
    }),
  ],
});

describe("review screen: selecting records", () => {
  it("shows the first record's comparison and lists every record", () => {
    const html = render(initialReviewState(twoRecords, at));
    expect(html).toContain("Changes to Ilse Marrow");
    expect(html).not.toContain("Changes to Orrin Vale");
    expect(html).toContain("Orrin Vale");
    expect(html).toContain(REVIEW.position(1, 2));
    expect(html).toMatch(/aria-current="true"[^>]*>.*?Ilse Marrow/);
  });

  it("shows the selected record's diff without removing anything from the package", () => {
    const html = render(run(initialReviewState(twoRecords, at), { type: "select", recordId: "rec_invented_b2" }));
    expect(html).toContain("Changes to Orrin Vale");
    expect(html).not.toContain("Changes to Ilse Marrow");
    expect(html).toContain(REVIEW.position(2, 2));
    expect(html).toMatch(/aria-current="true"[^>]*>.*?Orrin Vale/);
    expect(html).toContain("<code>age</code>");
    expect(html).toContain(REVIEW.textUnchanged);
    expect(applyButton(html)?.label).toBe(REVIEW.apply(2));
    expect(html).not.toMatch(/type="checkbox"[^>]*rec_invented/);
  });

  it("keeps details apart from the text and labels removals and additions in words", () => {
    const html = render(initialReviewState(preview({ header: header(), operations: [op({ fieldDiffs: [{ key: "role", change: "added", after: "keeper" }] })] }), at));
    const details = html.indexOf(`>${REVIEW.detailsHeading}<`);
    const text = html.indexOf(`>${REVIEW.textHeading}<`);
    expect(details).toBeGreaterThan(-1);
    expect(text).toBeGreaterThan(details);
    expect(html.indexOf("<code>role</code>")).toBeGreaterThan(details);
    expect(html.indexOf("<code>role</code>")).toBeLessThan(text);
    expect(html).toContain(`[${REVIEW.removed}: </span>lamps`);
    expect(html).toContain(`[${REVIEW.added}: </span>bells`);
    expect(html).toContain('class="review-sbs"');
    expect(html).toContain('class="review-unified"');
    expect(html).toContain(REVIEW.current(2));
    expect(html).toContain(REVIEW.afterApplying);
  });

  it("renders record content as text, never as markup", () => {
    const html = render(
      initialReviewState(preview({ header: header(), operations: [op({ bodyDiff: [{ value: "<script>alert(1)</script>\n  indented", added: true }] })] }), at),
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;\n  indented");
  });

  it("has explicit new-record and empty-text states", () => {
    const created = render(
      initialReviewState(
        preview({ header: header(), operations: [op({ titleBefore: null, statusBefore: null, expectedRevision: null, currentRevision: null, bodyDiff: [] })] }),
        at,
      ),
    );
    expect(created).toContain(REVIEW.newRecordBefore);
    expect(created).toContain(REVIEW.newRecordNoText);
    expect(created).toContain(REVIEW.revisionsNone);

    const filled = render(initialReviewState(preview({ header: header(), operations: [op({ bodyDiff: [{ value: "First words.", added: true }] })] }), at));
    expect(filled).toContain(`>${REVIEW.emptyText}<`);

    const emptied = render(initialReviewState(preview({ header: header(), operations: [op({ bodyDiff: [{ value: "All of it.", removed: true }] })] }), at));
    expect(emptied).toContain(REVIEW.allTextRemoved);
  });
});

describe("review screen: summary", () => {
  it("says the manuscript is unchanged only when no operation touches it", () => {
    expect(render(initialReviewState(twoRecords, at))).toContain(REVIEW.manuscriptUnchanged);
    const chapter = render(
      initialReviewState(
        preview({ header: header({ scope: "manuscript" }), operations: [op({ type: "manuscript_chapter", contentClass: "manuscript", titleBefore: "Chapter One", titleAfter: "Chapter One" })] }),
        at,
      ),
    );
    expect(chapter).not.toContain(REVIEW.manuscriptUnchanged);
    expect(chapter).toContain(REVIEW.manuscriptChanged(1));
  });

  it("reports the revision check from the validation", () => {
    expect(render(initialReviewState(twoRecords, at))).toContain(REVIEW.revisionsVerified);
  });
});

describe("review screen: protected records", () => {
  const protectedPreview = preview({
    header: header({ scope: "manuscript", protectedOverrides: ["rec_invented_a1"] }),
    requiresProtectedConfirmation: true,
    operations: [op({ protected: true, usesProtectedOverride: true })],
  });

  it("requires the author's tick before Apply is available", () => {
    const html = render(initialReviewState(protectedPreview, at));
    expect(html).toContain(REVIEW.confirmProtected);
    expect(html).toMatch(/type="checkbox"(?![^>]*checked)/);
    expect(applyButton(html)?.tag).toContain('disabled=""');
    expect(html).toContain(REVIEW.protectedOverride);

    const confirmed = render(run(initialReviewState(protectedPreview, at), { type: "confirmProtected", value: true }));
    expect(applyButton(confirmed)?.tag).not.toContain("disabled");
  });

  it("is never pre-ticked, and a protected record without an override cannot be applied", () => {
    expect(initialReviewState(protectedPreview, at).confirmProtected).toBe(false);
    const blocked = preview({
      header: header(),
      canApply: false,
      issues: [{ code: "PROTECTED_RECORD", severity: "error", message: "Record rec_invented_a1 is protected." }],
      operations: [op({ protected: true, issues: [{ code: "PROTECTED_RECORD", severity: "error", message: "Record rec_invented_a1 is protected." }] })],
    });
    const html = render(initialReviewState(blocked, at));
    expect(applyButton(html)).toBeNull();
    expect(html).toContain(REVIEW.protectedNoOverride);
    expect(html).toContain(REVIEW.invalidExplanation);
  });

  it("requires the canon tick for assistant proposals", () => {
    const canon = preview({ header: header(), operations: [op({ statusBefore: "proposed", statusAfter: "approved" })] });
    const html = render(initialReviewState(canon, at), { kind: "proposal" });
    expect(html).toContain(REVIEW.confirmCanon);
    expect(applyButton(html)?.tag).toContain('disabled=""');
    const state = reviewReducer(initialReviewState(canon, at), { type: "confirmCanon", value: true }, { canonRequired: true });
    expect(applyButton(render(state, { kind: "proposal" }))?.tag).not.toContain("disabled");
  });
});

describe("review screen: applying", () => {
  it("shows progress and cannot be pressed again while applying", () => {
    const applying = run(initialReviewState(twoRecords, at), { type: "submit" });
    expect(run(applying, { type: "submit" })).toBe(applying);
    const html = render(applying);
    const button = applyButton(html);
    expect(button?.label).toBe(REVIEW.applying);
    expect(button?.tag).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
  });

  it("explains a refused apply and a lost response", () => {
    const rejected = run(initialReviewState(twoRecords, at), { type: "submit" }, {
      type: "response",
      response: { status: "rejected", issues: [{ code: "STALE_REVISION", severity: "error", message: "Record changed." }] },
    });
    const rejectedHtml = render(rejected);
    expect(rejectedHtml).toContain(REVIEW.rejected);
    expect(rejectedHtml).toContain("Record changed.");
    expect(rejectedHtml).toContain('role="alert"');

    const failed = run(initialReviewState(twoRecords, at), { type: "submit" }, { type: "response", response: { status: "failed", message: REVIEW.failed } });
    expect(render(failed)).toContain(REVIEW.failed);
  });

  it("shows applied and already-applied results without an Apply button", () => {
    const applied = run(initialReviewState(twoRecords, at), { type: "submit" }, { type: "response", response: { status: "applied", result: appliedResult, warnings: [] } });
    const appliedHtml = render(applied);
    expect(appliedHtml).toContain(REVIEW.applied);
    expect(appliedHtml).toContain(REVIEW.stateApplied);
    expect(applyButton(appliedHtml)).toBeNull();

    const again: PackagePreview = preview({ header: header(), status: "already_applied", canApply: false, operations: [], previousResult: appliedResult });
    const againHtml = render(initialReviewState(again, at));
    expect(againHtml).toContain(REVIEW.stateAlreadyApplied);
    expect(applyButton(againHtml)).toBeNull();
  });
});

describe("review screen: out-of-date packages", () => {
  const stale = preview({
    header: header(),
    canApply: false,
    issues: [{ code: "STALE_REVISION", severity: "error", message: "Expected revision 2, found 3." }],
    operations: [op({ currentRevision: 3, issues: [{ code: "STALE_REVISION", severity: "error", message: "Expected revision 2, found 3." }] })],
  });

  it("is never shown as ready and points to the existing workflow", () => {
    const html = render(initialReviewState(stale, at));
    expect(applyButton(html)).toBeNull();
    expect(html).toContain(REVIEW.stateStale);
    expect(html).not.toContain(REVIEW.stateReady);
    expect(html).toContain(REVIEW.staleExplanation);
    expect(html).toContain(REVIEW.staleImport);
    expect(html).toContain(REVIEW.staleRecord(2, 3));
    expect(render(initialReviewState(stale, at), { kind: "proposal" })).toContain(REVIEW.staleProposal);
  });

  it("says so when the package goes out of date while open", () => {
    const html = render(run(initialReviewState(twoRecords, at), { type: "checked", preview: stale, at: at + 1000 }));
    expect(html).toContain(REVIEW.becameStale);
    expect(applyButton(html)).toBeNull();
  });
});

describe("review screen: back action", () => {
  it("returns to the discussion only when there is one", () => {
    const withConversation = render(initialReviewState(twoRecords, at), {
      conversation: { id: "asc_invented1", title: "Lamp talk" },
      back: { label: REVIEW.backToDiscussion, href: "/projects/prj_invented/assistant?c=asc_invented1" },
    });
    expect(withConversation).toContain('href="/projects/prj_invented/assistant?c=asc_invented1"');
    expect(withConversation).toContain(REVIEW.backToDiscussion);
    expect(withConversation).toContain("Lamp talk");

    const without = render(initialReviewState(twoRecords, at));
    expect(without).toContain(REVIEW.backToPackageText);
    expect(without).not.toContain(REVIEW.backToDiscussion);
  });
});
