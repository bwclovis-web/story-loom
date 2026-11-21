export interface ScaleReading {
  value: number;
  unit: string;
}

/** Reads a leading number from an author-written scale caption such as "10 miles". */
export function parseScaleLabel(label: string): { amount: number; unit: string } | null {
  const match = label.trim().match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, unit: (match[2] ?? "").trim() };
}

/**
 * Length in fractions of the image width. Vertical distance is scaled by the
 * image's height/width so a tall map does not stretch the scale bar.
 */
export function normalizedLength(
  points: readonly { x: number; y: number }[],
  image: { width: number; height: number },
): number {
  const ratio = image.width > 0 && image.height > 0 ? image.height / image.width : 1;
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const point = points[index]!;
    total += Math.hypot(point.x - previous.x, (point.y - previous.y) * ratio);
  }
  return total;
}

/** Converts a width-fraction length using the author's scale bar. Null when the bar or caption cannot be read. */
export function distanceFromScale(
  lengthNorm: number,
  scaleBarLength: number | null,
  scaleLabel: string,
): ScaleReading | null {
  const scale = parseScaleLabel(scaleLabel);
  if (!scale || scaleBarLength == null || !(scaleBarLength > 0) || !Number.isFinite(lengthNorm)) return null;
  return { value: (lengthNorm / scaleBarLength) * scale.amount, unit: scale.unit };
}

export function formatScaleValue(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value) >= 100) return String(Math.round(value));
  return String(Math.round(value * 10) / 10);
}

export function hiddenLayerIdsForPreset(
  layers: readonly { id: string; legacyGroup: string | null }[],
  preset: "all" | "none" | { group: string },
): string[] {
  if (preset === "all") return [];
  if (preset === "none") return layers.map((layer) => layer.id);
  return layers.filter((layer) => layer.legacyGroup !== preset.group).map((layer) => layer.id);
}

export function annotatedMapSvg(input: {
  title: string;
  pins: readonly { title: string; kind: string; x: number; y: number; points: readonly { x: number; y: number }[] }[];
  scaleLabel: string;
  scaleBarLength: number | null;
}): string {
  const shapes = input.pins
    .map((pin) => {
      const title = escapeXml(pin.title);
      if ((pin.kind === "route" || pin.kind === "area") && pin.points.length >= 2) {
        const points = pin.points.map((point) => `${point.x * 100},${point.y * 100}`).join(" ");
        const tag = pin.kind === "area" && pin.points.length >= 3 ? "polygon" : "polyline";
        return `<${tag} points="${points}" fill="none" stroke="currentColor" stroke-width="0.6"><title>${title}</title></${tag}>`;
      }
      return `<circle cx="${pin.x * 100}" cy="${pin.y * 100}" r="1.1"><title>${title}</title></circle><text x="${pin.x * 100 + 1.6}" y="${pin.y * 100}" font-size="3">${title}</text>`;
    })
    .join("");
  const bar =
    input.scaleLabel && input.scaleBarLength != null
      ? `<line x1="4" y1="96" x2="${4 + input.scaleBarLength * 100}" y2="96" stroke="currentColor" stroke-width="0.8"/><text x="4" y="94" font-size="3">${escapeXml(input.scaleLabel)} · estimated from the author's scale bar</text>`
      : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="${escapeXml(input.title)}">${shapes}${bar}</svg>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
