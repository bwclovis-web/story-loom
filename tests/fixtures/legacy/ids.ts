/*
 * IDs, file names and exact prose of the frozen legacy fixture (see
 * generate.ts). Invented content. The test reads the same constants so it can
 * check exact text, not only hashes.
 */

export const L = {
  workspace: "wsp_legacy_fixture",
  project: "prj_legacy_lantern",
  ch01: "rec_legacy_ch01",
  ch02: "rec_legacy_ch02",
  ch03: "rec_legacy_ch03",
  sc01: "rec_legacy_sc01",
  sc02: "rec_legacy_sc02",
  sc03: "rec_legacy_sc03",
  note01: "rec_legacy_note01",
  dossier: "rec_legacy_dossier",
  world: "rec_legacy_world",
  decision: "rec_legacy_decision",
  decisionV2: "rec_legacy_decision_v2",
  outline: "rec_legacy_outline",
  trashed: "rec_legacy_trashed",
  appliedPackage: "pkg_legacy_0001_ivo_age",
  stalePackage: "pkg_legacy_0004_stale",
  protectedReferencePackage: "pkg_legacy_0005_protected_reference",
  protectedManuscriptPackage: "pkg_legacy_0006_protected_manuscript",
  futurePackage: "pkg_legacy_0007_future_version",
  files: {
    fullBackup: "legacy-workspace.v1.backup.json",
    earlyBackup: "early-shape.v1.backup.json",
    expectedInventory: "expected-inventory.json",
    expectedEarlyInventory: "expected-inventory.early.json",
    applied: "package-01-applied.json",
    duplicate: "package-02-duplicate-reformatted.json",
    conflict: "package-03-conflict-same-id.json",
    stale: "package-04-stale.json",
    protectedReference: "package-05-protected-reference-scope.json",
    protectedManuscript: "package-06-protected-manuscript-unconfirmed.json",
    unsupportedVersion: "package-07-unsupported-version.json",
  },
} as const;

export const EARLY = {
  workspace: "wsp_legacy_early",
  project: "prj_legacy_early",
  chapter: "rec_legacy_early_ch01",
  dossier: "rec_legacy_early_dossier",
  package: "pkg_legacy_early_0001",
} as const;

/** Exact text, including curly quotes, dashes, accents, a hard line break and trailing newlines. */
export const PROSE = {
  ch01v1: "The harbour emptied at low water.\n\nIvo Marsh waited on the quay.\n",
  ch01v2:
    "The harbour emptied at low water, as it did twice a day — once for the tide, once for the tax.\n\n" +
    "“Eleven rings,” Ivo Marsh said.  \nNobody on the quay answered; even Renée kept her eyes on the bells.\n",
  ch02: "The wardens came at slack tide with their tally sticks.\n",
  ch03: "Salt road ran inland from the mill, white as a ledger page.\n",
  dossierV1: "Harbour clerk. Thirty-eight.",
  dossierV2: "Harbour clerk. Forty-one. Counts the mooring rings every morning.",
} as const;

export const FILES = {
  glossary: {
    filename: "Bell_Warden_Glossary_APPROVED_v1.md",
    content: "# Bell Warden glossary\n\n- **Slack bell**: rung at slack water.\n- **Tally stick**: a record of unpaid crossings.\n",
  },
  chapter4: {
    filename: "04-Tide_Mill_DRAFT_v1.md",
    content: "# Tide Mill\n\nThe mill wheel turned only when the sea allowed it.\n",
  },
} as const;
