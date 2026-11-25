"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { SectionTagBadge } from "@/components/Badges";
import { REFERENCE_FORM } from "@/ui/labels";
import { splitStatusTag } from "@/writing/sections";
import { cn } from "@/ui/cn";

export type DocumentHeading = {
  id: string;
  level: number;
  text: string;
};

/**
 * “On this page” navigation generated from rendered Markdown headings.
 * Sticky on wide layouts; disclosure on narrow. Highlights the visible section
 * without forcing scroll when the highlight changes.
 */
export function DocumentSectionNav({
  headings,
  title = REFERENCE_FORM.onThisPage,
  className,
}: {
  headings: readonly DocumentHeading[];
  /** Defaults to “On this page”; profile tabs pass their own section label. */
  title?: string;
  className?: string;
}) {
  const labelId = useId();
  const [activeId, setActiveId] = useState<string | null>(headings[0]?.id ?? null);
  const topLevel = useMemo(
    () => (headings.length ? Math.min(...headings.map((h) => h.level)) : 1),
    [headings],
  );

  useEffect(() => {
    if (!headings.length) return;
    const elements = headings
      .map((h) => document.getElementById(h.id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (!elements.length) return;

    const ratios = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          ratios.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0);
        }
        let bestId: string | null = null;
        let bestRatio = 0;
        for (const heading of headings) {
          const ratio = ratios.get(heading.id) ?? 0;
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestId = heading.id;
          }
        }
        if (bestId) setActiveId(bestId);
      },
      {
        // Account for sticky app chrome without scrolling the page on highlight changes.
        rootMargin: "-20% 0px -55% 0px",
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
      },
    );
    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, [headings]);

  if (!headings.length) return null;

  const list = (
    <ol className="doc-contents reference-on-page-list">
      {headings.map((h) => {
        const { title, tag } = splitStatusTag(h.text);
        const active = h.id === activeId;
        return (
          <li
            key={h.id}
            className={cn("reference-on-page-item", active && "is-active")}
            style={{ paddingLeft: `${(h.level - topLevel) * 0.85}rem` }}
          >
            <a
              href={`#${h.id}`}
              aria-current={active ? "location" : undefined}
              onClick={(event) => {
                const target = document.getElementById(h.id);
                if (!target) return;
                event.preventDefault();
                const reduce =
                  typeof window !== "undefined" &&
                  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                // Smooth scroll for Document and profile section navs; honor reduced motion.
                target.scrollIntoView({
                  behavior: reduce ? "auto" : "smooth",
                  block: "start",
                  inline: "nearest",
                });
                history.replaceState(null, "", `#${h.id}`);
                setActiveId(h.id);
                if (typeof target.focus === "function") {
                  target.focus({ preventScroll: true });
                }
              }}
            >
              {title || "(untitled heading)"}
            </a>
            {tag ? (
              <>
                {" "}
                <SectionTagBadge tag={tag} />
              </>
            ) : null}
          </li>
        );
      })}
    </ol>
  );

  return (
    <nav className={cn("reference-on-page", className)} aria-labelledby={labelId}>
      <p id={labelId} className="reference-on-page-title">
        {title}
      </p>
      <div className="reference-on-page-desktop">{list}</div>
      <details className="reference-on-page-mobile">
        <summary>{title}</summary>
        {list}
      </details>
    </nav>
  );
}
