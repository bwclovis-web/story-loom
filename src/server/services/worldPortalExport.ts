import "server-only";
import JSZip from "jszip";
import type { DbOrTx } from "@/server/db";
import { findProject } from "@/server/services/projectService";
import { loadProjectRelationshipGraph } from "@/server/services/relationshipGraphService";
import { NotFoundError } from "@/server/services/errors";
import { listWorldMaps } from "@/server/services/worldMapService";
import {
  buildReferencesWikiZip,
  type WorldBibleFile,
} from "@/server/services/worldBibleExport";
import type { WorldBiblePolicy, WorldBibleSelection } from "@/server/services/worldBibleModel";
import { writeAudit } from "@/server/services/auditService";

export type WorldPortalMode = "private" | "publicSafe";

export function isWorldPortalMode(value: string): value is WorldPortalMode {
  return value === "private" || value === "publicSafe";
}

function policyForMode(mode: WorldPortalMode): WorldBiblePolicy {
  if (mode === "publicSafe") {
    return { mode: "point", approvedOnly: true };
  }
  return { mode: "full", approvedOnly: false };
}

function exportSlug(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "world-portal";
}

function exportDateStamp(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Static World Portal ZIP: wiki articles (from world bible), relationship graph
 * snapshot, and map catalogue. Reader-facing `publicSafe` uses point mode +
 * approved-only. Never includes revision history, scene notes, or assistant
 * secrets. Audited as world_portal.export.
 */
export async function buildWorldPortalZip(
  db: DbOrTx,
  projectId: string,
  input: {
    mode: WorldPortalMode;
    selection?: WorldBibleSelection;
  },
  now = new Date(),
): Promise<WorldBibleFile> {
  const project = await findProject(db, projectId);
  if (!project) throw new NotFoundError(`Project ${projectId} not found`);

  const mode = input.mode;
  const policy = policyForMode(mode);
  const selection = input.selection ?? { recordIds: [] };
  const wiki = await buildReferencesWikiZip(db, projectId, selection, policy, now);
  const zip = await JSZip.loadAsync(wiki.bytes);

  const [graph, maps] = await Promise.all([
    loadProjectRelationshipGraph(db, projectId),
    listWorldMaps(db, projectId),
  ]);

  const safeNodes = graph.nodes.map((node) => ({
    id: node.id,
    title: node.title,
    typeLabel: node.typeLabel,
    homeLabel: node.homeLabel,
    worldScope: node.worldScope,
  }));
  const safeEdges = graph.edges.map((edge) => ({
    id: edge.id,
    fromRecordId: edge.fromRecordId,
    toRecordId: edge.toRecordId,
    kind: edge.kind,
    kindLabel: edge.kindLabel,
    family: edge.family,
  }));

  // Public-safe portals only keep graph endpoints that are approved in this project.
  let nodes = safeNodes;
  let edges = safeEdges;
  if (mode === "publicSafe") {
    const approvedIds = new Set(
      (
        await db.record.findMany({
          where: { projectId, trashedAt: null, authorityStatus: "approved" },
          select: { id: true },
        })
      ).map((row) => row.id),
    );
    nodes = safeNodes.filter((node) => approvedIds.has(node.id));
    const keep = new Set(nodes.map((n) => n.id));
    edges = safeEdges.filter((edge) => keep.has(edge.fromRecordId) && keep.has(edge.toRecordId));
  }

  zip.file(
    "data/relationships.json",
    JSON.stringify(
      {
        projectId,
        projectTitle: project.title,
        mode,
        generatedAt: now.toISOString(),
        nodeCount: nodes.length,
        edgeCount: edges.length,
        nodes,
        edges,
      },
      null,
      2,
    ),
  );

  const mapCatalog = maps.map((map) => ({
    id: map.id,
    title: map.title,
    classification: map.classification,
    hostRecordTitle: map.hostRecordTitle,
    hostRecordId: map.hostRecordId,
    imageName: map.imageName,
    pinCount: map.pinCount,
    updatedAt: map.updatedAt.toISOString(),
  }));
  zip.file(
    "data/maps.json",
    JSON.stringify(
      {
        projectId,
        projectTitle: project.title,
        mode,
        generatedAt: now.toISOString(),
        maps: mapCatalog,
        note:
          mode === "publicSafe"
            ? "Map catalogue only. Open maps in Story Loom for the interactive canvas; this portal does not embed basemap image bytes for public-safe packages."
            : "Map catalogue for this project. Interactive layers stay in Story Loom; pin counts are included for orientation.",
      },
      null,
      2,
    ),
  );

  const hub = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(project.title)} — World Portal</title>
<link rel="stylesheet" href="assets/wiki.css" />
</head>
<body class="wiki-portal">
<header>
  <p class="eyebrow">Story Loom · World Portal</p>
  <h1>${escapeHtml(project.title)}</h1>
  <p>${mode === "publicSafe" ? "Public-safe snapshot (approved references, drafting redaction)." : "Private editorial snapshot (full world bible mode)."}</p>
</header>
<nav>
  <ul>
    <li><a href="index.html">World wiki index</a></li>
    <li><a href="data/relationships.json">Relationships (JSON)</a></li>
    <li><a href="data/maps.json">Maps catalogue (JSON)</a></li>
    <li><a href="PORTAL-README.txt">Portal notes</a></li>
  </ul>
</nav>
<p class="muted">Generated ${escapeHtml(now.toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" }))}. This folder is read-only and does not sync back into Story Loom.</p>
</body>
</html>`;
  zip.file("portal.html", hub);

  zip.file(
    "PORTAL-README.txt",
    [
      `World Portal for “${project.title}”`,
      `Mode: ${mode}`,
      `Generated: ${now.toISOString()}`,
      "",
      "Contents",
      "- portal.html — entry hub",
      "- index.html / pages/ — static wiki from the World Bible exporter",
      "- data/relationships.json — place and record relations (no revision history)",
      "- data/maps.json — map titles, hosts, and pin counts (no basemap bytes in public-safe)",
      "- SPOILER-CEILING.txt — when a spoiler policy applied",
      "",
      "Privacy",
      "- Scene notes, margin comments, synopses, revision tables, Trash, and assistant secrets are not included.",
      "- Author workspace backups remain the place for IDs, provenance, and full history.",
      mode === "publicSafe"
        ? "- publicSafe uses point mode with approved-only references and drafting-style redaction."
        : "- private uses full editorial world bible mode; still omits manuscript private notes.",
      "",
      "This static package does not run Story Loom continuity rules.",
    ].join("\n"),
  );

  await writeAudit(db, {
    projectId,
    action: "world_portal.export",
    actor: "author",
    summary: `Exported World Portal (${mode}) for "${project.title}"`,
    details: {
      mode,
      documentCount: wiki.documentCount,
      mapCount: mapCatalog.length,
      relationshipNodes: nodes.length,
      relationshipEdges: edges.length,
    },
  });

  const bytes = Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  return {
    filename: `${exportSlug(project.title)}-world-portal-${mode}-${exportDateStamp(now)}.zip`,
    bytes,
    documentCount: wiki.documentCount,
    contentType: "application/zip",
  };
}
