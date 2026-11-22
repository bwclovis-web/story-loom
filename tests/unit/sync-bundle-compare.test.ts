import { describe, expect, it } from "vitest";
import { SYNC_BUNDLE_FORMAT, SYNC_BUNDLE_FORMAT_VERSION, type SyncBundleV1 } from "@/backup/syncBundle.v1";
import { sha256, stableStringify } from "@/domain/json";
import { parseJsonObject } from "@/domain/json";
import { snapshotHash, toRecordView } from "@/domain/records";
import { compareSyncBundle, parseSyncBundle } from "@/server/syncBundleService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

function checksum(body: Omit<SyncBundleV1, "checksum">): string {
  return sha256(stableStringify(body));
}

describe("sync bundle compare", () => {
  it("parses and detects matching records", async () => {
    let t: TestDb | undefined;
    try {
      t = await createTestDb();
      await seedProject(t.db);
      const record = await t.db.record.findFirst({ where: { projectId: IDS.project } });
      expect(record).toBeTruthy();
      const view = toRecordView(record!);
      const body: Omit<SyncBundleV1, "checksum"> = {
        format: SYNC_BUNDLE_FORMAT,
        formatVersion: SYNC_BUNDLE_FORMAT_VERSION,
        workspaceId: IDS.workspace,
        workspaceName: "Test workspace",
        exportedAt: new Date().toISOString(),
        projects: [{ id: IDS.project, title: "Test project" }],
        records: [
          {
            id: record!.id,
            projectId: IDS.project,
            type: record!.type as SyncBundleV1["records"][number]["type"],
            title: record!.title,
            currentRevision: record!.currentRevision,
            contentHash: snapshotHash({
              title: record!.title,
              body: record!.body,
              fields: parseJsonObject(record!.fields),
              authorityStatus: view.authorityStatus,
              supersededByRecordId: record!.supersededByRecordId,
            }),
            authorityStatus: view.authorityStatus,
            body: record!.body,
            fields: parseJsonObject(record!.fields),
            protected: record!.protected,
          },
        ],
      };
      const bundle: SyncBundleV1 = { ...body, checksum: checksum(body) };
      const parsed = parseSyncBundle(bundle);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const compare = await compareSyncBundle(t.db, IDS.workspace, parsed.bundle);
      expect(compare.rows.filter((r) => r.kind === "match").length).toBeGreaterThan(0);
    } finally {
      await t?.cleanup();
    }
  });
});