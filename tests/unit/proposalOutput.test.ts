import { describe, expect, it } from "vitest";
import { canonChanges } from "@/assistant/canon";
import { findFieldTextDisagreements } from "@/assistant/fieldText";
import {
  draftToPackage,
  parseProposalDraft,
  PROPOSAL_OUTPUT_JSON_SCHEMA,
  type ProposalDraft,
  type TrustedPackageValues,
} from "@/assistant/proposalOutput";
import { parseChangePackage } from "@/changePackage/parse";
import type { OperationPreview } from "@/server/services/changePackageService";

/* Invented content only. */

/** Keywords Structured Outputs rejects in strict mode, or that fine-tuned models do not support. */
const AVOIDED_KEYWORDS = [
  "allOf", "not", "if", "then", "else", "dependentRequired", "dependentSchemas", "patternProperties",
  "minLength", "maxLength", "pattern", "format", "minimum", "maximum", "multipleOf", "minItems", "maxItems", "default", "$ref",
];

function walk(node: unknown, depth: number, visit: (schema: Record<string, unknown>, depth: number) => void) {
  if (!node || typeof node !== "object") return;
  const schema = node as Record<string, unknown>;
  visit(schema, depth);
  const props = schema.properties as Record<string, unknown> | undefined;
  for (const child of Object.values(props ?? {})) walk(child, depth + 1, visit);
  if (schema.items) walk(schema.items, depth + 1, visit);
  for (const alt of (schema.anyOf as unknown[] | undefined) ?? []) walk(alt, depth, visit);
}

describe("proposal output schema (Structured Outputs, strict)", () => {
  it("uses only the strict-mode subset", () => {
    expect(PROPOSAL_OUTPUT_JSON_SCHEMA.type).toBe("object");
    expect(PROPOSAL_OUTPUT_JSON_SCHEMA).not.toHaveProperty("anyOf");
    let maxDepth = 0;
    let enumValues = 0;
    walk(PROPOSAL_OUTPUT_JSON_SCHEMA, 1, (schema, depth) => {
      maxDepth = Math.max(maxDepth, depth);
      for (const k of AVOIDED_KEYWORDS) expect(schema, `keyword ${k}`).not.toHaveProperty(k);
      if (Array.isArray(schema.enum)) enumValues += schema.enum.length;
      const isObject = schema.type === "object" || (Array.isArray(schema.type) && schema.type.includes("object"));
      if (isObject) {
        expect(schema.additionalProperties).toBe(false);
        expect([...(schema.required as string[])].sort()).toEqual(Object.keys(schema.properties as object).sort());
      }
    });
    expect(maxDepth).toBeLessThanOrEqual(10);
    expect(enumValues).toBeLessThan(1000);
  });

  it("has no fields for approval, scope, overrides, package IDs or revisions", () => {
    const text = JSON.stringify(PROPOSAL_OUTPUT_JSON_SCHEMA);
    for (const word of ["approval", "protectedOverrides", "scope", "packageId", "workspaceId", "projectId", "expectedRevision", "newRecordId"]) {
      expect(text).not.toContain(`"${word}"`);
    }
    expect(text).not.toContain("manuscript_chapter");
  });
});

const trusted = (sent: Record<string, number>): TrustedPackageValues => {
  let n = 0;
  return {
    packageId: "pkg_test_proposal_1",
    workspaceId: "wsp_test",
    projectId: "prj_test_novel",
    conversationLabel: "Assistant proposal apr_x",
    sentRevisions: new Map(Object.entries(sent)),
    newRecordId: () => `rec_new_record_${++n}`,
  };
};

const baseDraft = (operations: ProposalDraft["operations"]): ProposalDraft => ({
  summary: "Invented change.",
  operations,
  relatedRecords: [],
  fieldTextDisagreements: [],
});

describe("parsing and converting drafts", () => {
  it("rejects anything outside the draft shape instead of repairing it", () => {
    expect(parseProposalDraft("not json")).toMatchObject({ ok: false });
    expect(parseProposalDraft("{}")).toMatchObject({ ok: false });
    const withApproval = { ...baseDraft([]), approval: { status: "approved" } };
    expect(parseProposalDraft(JSON.stringify(withApproval))).toMatchObject({ ok: false });
    const withRevision = baseDraft([
      { op: "set_authority_status", recordId: "rec_test_a1", status: "draft", supersededBy: null, note: null },
    ]);
    (withRevision.operations[0] as Record<string, unknown>).expectedRevision = 9;
    expect(parseProposalDraft(JSON.stringify(withRevision))).toMatchObject({ ok: false });
  });

  it("assigns trusted values and passes the full package schema", () => {
    const converted = draftToPackage(
      baseDraft([
        { op: "update_record", recordId: "rec_test_a1", title: null, body: "New text.", setFields: [{ key: "age", valueJson: "34" }, { key: "aliases", valueJson: '["Mara"]' }], unsetFields: ["old"], authorityStatus: null, note: " because " },
        { op: "create_record", type: "reference_note", title: "Salt calendar", body: "Invented.", fields: [], authorityStatus: "proposed", note: null },
      ]),
      trusted({ rec_test_a1: 3 }),
    );
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    const pkg = converted.pkg;
    expect(pkg).toMatchObject({ packageId: "pkg_test_proposal_1", scope: "reference", protectedOverrides: [], approval: { status: "proposed" } });
    expect(pkg.operations[0]).toEqual({
      op: "update_record",
      recordId: "rec_test_a1",
      expectedRevision: 3,
      changes: { body: { replace: "New text." }, fields: { set: { age: 34, aliases: ["Mara"] }, unset: ["old"] } },
      note: "because",
    });
    expect(pkg.operations[1]).toMatchObject({ op: "create_record", newRecordId: "rec_new_record_1", fields: {} });
    expect(parseChangePackage(pkg).ok).toBe(true);
  });

  it("refuses records that were not sent, bad field JSON and duplicate fields", () => {
    const result = draftToPackage(
      {
        ...baseDraft([
          { op: "update_record", recordId: "rec_test_a1", title: null, body: null, setFields: [{ key: "age", valueJson: "thirty" }, { key: "x", valueJson: "1" }, { key: "x", valueJson: "2" }], unsetFields: [], authorityStatus: null, note: null },
          { op: "set_authority_status", recordId: "rec_unsent_1", status: "draft", supersededBy: null, note: null },
        ]),
        relatedRecords: [{ recordId: "rec_unsent_2", note: "check" }],
      },
      trusted({ rec_test_a1: 1 }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toMatch(/"age" is not valid JSON/);
    expect(result.problems.join("\n")).toMatch(/"x" is set twice/);
    expect(result.problems.join("\n")).toMatch(/rec_unsent_1.*not among the records sent/);
    expect(result.problems.join("\n")).toMatch(/rec_unsent_2/);
  });

  it("refuses a new body for a record sent only as sections, but allows its fields and status", () => {
    const partial = { ...trusted({ rec_test_a1: 2 }), partialRecords: new Set(["rec_test_a1"]) };
    const replaceBody = draftToPackage(
      baseDraft([{ op: "update_record", recordId: "rec_test_a1", title: null, body: "Only one section.", setFields: [], unsetFields: [], authorityStatus: null, note: null }]),
      partial,
    );
    expect(replaceBody.ok).toBe(false);
    if (!replaceBody.ok) expect(replaceBody.problems.join("\n")).toMatch(/only some of its sections were sent/);

    const fieldsOnly = draftToPackage(
      baseDraft([
        { op: "update_record", recordId: "rec_test_a1", title: null, body: null, setFields: [{ key: "era", valueJson: '"late"' }], unsetFields: [], authorityStatus: null, note: null },
      ]),
      partial,
    );
    expect(fieldsOnly.ok).toBe(true);
  });
});

describe("field/text disagreements", () => {
  it("flags a changed field the text still contradicts, including spelled-out numbers", () => {
    const findings = findFieldTextDisagreements(
      { body: "Archivist. Thirty years old.", fields: { age: 30 } },
      { body: "Archivist. Thirty years old.", fields: { age: 31 } },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toMatch(/still says "thirty"/i);
  });

  it("accepts text that was updated with the field", () => {
    expect(
      findFieldTextDisagreements(
        { body: "Archivist. Thirty years old.", fields: { age: 30 } },
        { body: "Archivist. Thirty-four years old.", fields: { age: 34 } },
      ),
    ).toEqual([]);
  });

  it("flags text that drops a value the unchanged field still holds", () => {
    const findings = findFieldTextDisagreements(
      { body: "Lives in Vell harbour.", fields: { home: "Vell" } },
      { body: "Lives by the sea.", fields: { home: "Vell" } },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].field).toBe("home");
  });
});

describe("canon changes", () => {
  const op = (o: Partial<OperationPreview>): OperationPreview =>
    ({
      index: 0, op: "update_record", recordId: "rec_test_a1", titleBefore: "A", titleAfter: "A", bodyChanged: false, fieldDiffs: [],
      statusBefore: "proposed", statusAfter: "proposed", ...o,
    }) as OperationPreview;

  it("lists creations as approved, promotions and edits of approved records only", () => {
    expect(canonChanges([op({ statusBefore: null, statusAfter: "approved" })])[0].reason).toBe("created_approved");
    expect(canonChanges([op({ statusBefore: "proposed", statusAfter: "approved" })])[0].reason).toBe("promoted");
    expect(canonChanges([op({ statusBefore: "approved", statusAfter: "approved", bodyChanged: true })])[0].reason).toBe("approved_content_changed");
    expect(canonChanges([op({ statusBefore: "approved", statusAfter: "superseded" })])).toEqual([]);
    expect(canonChanges([op({ statusBefore: null, statusAfter: "proposed" })])).toEqual([]);
  });
});
