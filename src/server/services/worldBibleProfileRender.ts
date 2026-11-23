/**
 * Human-readable Living World Profile rendering for W7C/W8C world-bible exports.
 * Format writers consume these strings; field ownership lives in worldBibleModel.
 */

import "server-only";
import type { WorldBibleEntry, WorldBibleExportModel, WorldBibleGroup } from "./worldBibleModel";
import { escapeHtml } from "./manuscriptExportMarkdown";

export function worldBibleLegacyBodyNote(body: string, mode: "full" | "point"): string {
  if (mode !== "point" || !body.trim()) return body;
  return `**Legacy background (uncertain chronology)**\n\n${body}`;
}

export function worldBibleAuthorityLabel(status: string): string {
  return status === "approved" ? "Approved (canon)" : `${status} (not canon)`;
}

export function renderWorldBibleEntryMetaLine(entry: WorldBibleEntry): string {
  const parts = [
    entry.categoryLabel + (entry.subcategoryLabel ? ` · ${entry.subcategoryLabel}` : ""),
    worldBibleAuthorityLabel(entry.record.authorityStatus),
  ];
  if (entry.homeLabel) parts.push(`Home: ${entry.homeLabel}`);
  return parts.join(" · ");
}

export function renderWorldBibleProfileMarkdown(
  entry: WorldBibleEntry,
  model: Pick<WorldBibleExportModel, "pageById" | "mode" | "spoilerNote">,
): string {
  const lines: string[] = [];
  lines.push(`# ${entry.record.title}`);
  lines.push("");
  if (model.spoilerNote) {
    lines.push(`> ${model.spoilerNote}`);
    lines.push("");
  }
  lines.push(`*${renderWorldBibleEntryMetaLine(entry)}*`);
  lines.push("");

  if (entry.fields.length) {
    lines.push("## Profile");
    lines.push("");
    for (const field of entry.fields) {
      if (field.hrefRecordId) {
        const page = model.pageById.get(field.hrefRecordId);
        const title = field.value;
        lines.push(
          page
            ? `- **${field.label}:** [${title}](${page}.md)`
            : `- **${field.label}:** ${title}`,
        );
      } else {
        lines.push(`- **${field.label}:** ${field.value}`);
      }
    }
    lines.push("");
  }

  if (entry.relations.length) {
    lines.push("## Relationships");
    lines.push("");
    for (const rel of entry.relations) {
      const page = model.pageById.get(rel.targetRecordId);
      lines.push(
        page
          ? `- **${rel.label}:** [${rel.targetTitle}](${page}.md)`
          : `- **${rel.label}:** ${rel.targetTitle}`,
      );
    }
    lines.push("");
  }

  if (entry.facts.length) {
    lines.push("## Established facts");
    lines.push("");
    for (const fact of entry.facts) lines.push(`- ${fact}`);
    lines.push("");
  }

  if (entry.characterSlice?.trim()) {
    lines.push("## Character");
    lines.push("");
    lines.push(entry.characterSlice.trim());
    lines.push("");
  }

  const body = worldBibleLegacyBodyNote(entry.body, model.mode).trim();
  if (body) {
    lines.push("## Notes");
    lines.push("");
    lines.push(body);
    lines.push("");
  }

  if (entry.secondaryListings.length) {
    lines.push("## Also listed under");
    lines.push("");
    for (const secondary of entry.secondaryListings) {
      const label = secondary.subcategoryLabel
        ? `${secondary.categoryLabel} / ${secondary.subcategoryLabel}`
        : secondary.categoryLabel;
      lines.push(`- ${label}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function renderWorldBibleIndexMarkdown(model: WorldBibleExportModel): string {
  const lines: string[] = [`# ${model.projectTitle}`, ""];
  if (model.spoilerNote) {
    lines.push(`> ${model.spoilerNote}`);
    lines.push("");
  }
  for (const group of model.groups) {
    const heading = group.subcategoryLabel
      ? `## ${group.categoryLabel} · ${group.subcategoryLabel}`
      : `## ${group.categoryLabel}`;
    lines.push(heading);
    lines.push("");
    for (const entry of group.entries) {
      lines.push(`- [${entry.record.title}](${entry.pageId}.md)`);
    }
    for (const see of group.seeAlso) {
      lines.push(`- See also: [${see.title}](${see.pageId}.md)`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Profile / relation / fact lines for key-value tables.
 * Character slices are rendered separately so PDF/EPUB do not duplicate them.
 */
export function renderWorldBibleProfilePlainLines(entry: WorldBibleEntry): string[] {
  const lines: string[] = [];
  for (const field of entry.fields) {
    lines.push(`${field.label}: ${field.value}`);
  }
  for (const rel of entry.relations) {
    lines.push(`${rel.label}: ${rel.targetTitle}`);
  }
  for (const fact of entry.facts) {
    lines.push(`Fact: ${fact}`);
  }
  return lines;
}

export function renderWorldBibleProfileHtml(
  entry: WorldBibleEntry,
  model: Pick<WorldBibleExportModel, "pageById" | "mode" | "linkTerms" | "spoilerNote">,
  opts: { linkHref: (pageId: string) => string; wikiLinkify?: (html: string) => string },
): string {
  const parts: string[] = [];
  parts.push(`<h1>${escapeHtml(entry.record.title)}</h1>`);
  if (model.spoilerNote) {
    parts.push(`<p class="scope-note"><em>${escapeHtml(model.spoilerNote)}</em></p>`);
  }
  parts.push(`<p class="meta">${escapeHtml(renderWorldBibleEntryMetaLine(entry))}</p>`);

  if (entry.fields.length) {
    parts.push("<h2>Profile</h2><dl class=\"profile\">");
    for (const field of entry.fields) {
      let valueHtml = escapeHtml(field.value);
      if (field.hrefRecordId) {
        const page = model.pageById.get(field.hrefRecordId);
        if (page) valueHtml = `<a href="${escapeHtml(opts.linkHref(page))}">${valueHtml}</a>`;
      }
      parts.push(`<dt>${escapeHtml(field.label)}</dt><dd>${valueHtml}</dd>`);
    }
    parts.push("</dl>");
  }

  if (entry.relations.length) {
    parts.push("<h2>Relationships</h2><ul>");
    for (const rel of entry.relations) {
      const page = model.pageById.get(rel.targetRecordId);
      const target = page
        ? `<a href="${escapeHtml(opts.linkHref(page))}">${escapeHtml(rel.targetTitle)}</a>`
        : escapeHtml(rel.targetTitle);
      parts.push(`<li><strong>${escapeHtml(rel.label)}:</strong> ${target}</li>`);
    }
    parts.push("</ul>");
  }

  if (entry.facts.length) {
    parts.push("<h2>Established facts</h2><ul>");
    for (const fact of entry.facts) parts.push(`<li>${escapeHtml(fact)}</li>`);
    parts.push("</ul>");
  }

  if (entry.characterSlice?.trim()) {
    parts.push("<h2>Character</h2>");
    parts.push(`<pre class="character-slice">${escapeHtml(entry.characterSlice.trim())}</pre>`);
  }

  const body = worldBibleLegacyBodyNote(entry.body, model.mode).trim();
  if (body) {
    parts.push("<h2>Notes</h2>");
    const escaped = escapeHtml(body).replace(/\n/g, "<br/>");
    parts.push(opts.wikiLinkify ? opts.wikiLinkify(`<p>${escaped}</p>`) : `<p>${escaped}</p>`);
  }

  return parts.join("\n");
}

export function renderWorldBibleGroupHeading(group: WorldBibleGroup): string {
  return group.subcategoryLabel
    ? `${group.categoryLabel} · ${group.subcategoryLabel}`
    : group.categoryLabel;
}
