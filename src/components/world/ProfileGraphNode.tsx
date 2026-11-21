import type { ReactElement } from "react";

/** Circular profile node for relationship SVG diagrams: primary image or initials placeholder. */

const PLACEHOLDER_FILL = "var(--color-surface-sunken)";
const PLACEHOLDER_STROKE = "var(--color-border-strong)";
const FOCUS_RING = "var(--color-accent)";

function initialsFromTitle(title: string): string {
  const parts = title.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]!.slice(0, 1)}${parts[parts.length - 1]!.slice(0, 1)}`.toUpperCase();
}

export function profileGraphNode(
  id: string,
  x: number,
  y: number,
  radius: number,
  title: string,
  profileImageUrl: string | null | undefined,
  focused: boolean,
): ReactElement {
  const uid = id.replace(/[^a-zA-Z0-9_-]/g, "");
  const clipId = `profile-clip-${uid}`;
  const size = radius * 2;
  const px = x - radius;
  const py = y - radius;

  if (profileImageUrl) {
    return (
      <g key={id} className={focused ? "relationship-node focus" : "relationship-node"}>
        <defs>
          <clipPath id={clipId}>
            <circle cx={x} cy={y} r={radius} />
          </clipPath>
        </defs>
        {focused ? <circle cx={x} cy={y} r={radius + 2} fill="none" stroke={FOCUS_RING} strokeWidth={2} /> : null}
        <image
          href={profileImageUrl}
          x={px}
          y={py}
          width={size}
          height={size}
          preserveAspectRatio="xMidYMid slice"
          clipPath={`url(#${clipId})`}
        />
        <circle cx={x} cy={y} r={radius} fill="none" stroke={focused ? FOCUS_RING : PLACEHOLDER_STROKE} strokeWidth={1.25} />
        <title>{title}</title>
      </g>
    );
  }

  return (
    <g key={id} className={focused ? "relationship-node focus" : "relationship-node"}>
      <circle cx={x} cy={y} r={radius} fill={PLACEHOLDER_FILL} stroke={focused ? FOCUS_RING : PLACEHOLDER_STROKE} strokeWidth={1.5} />
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central" className="relationship-node-initials">
        {initialsFromTitle(title)}
      </text>
      <title>{title}</title>
    </g>
  );
}