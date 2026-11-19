"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { helpHref } from "@/help/outline";
import { ONBOARDING, NAV, WORLD, DRAFT, WRITE } from "@/ui/labels";
import { ONBOARDING_COOKIE, ONBOARDING_VERSION, writePreference } from "./preferences";

function readDismissed(): boolean {
  if (typeof document === "undefined") return true;
  const match = document.cookie.match(new RegExp(`(?:^|; )${ONBOARDING_COOKIE}=([^;]*)`));
  if (!match) return false;
  try {
    return decodeURIComponent(match[1]!) === ONBOARDING_VERSION;
  } catch {
    return match[1] === ONBOARDING_VERSION;
  }
}

/**
 * Skippable checklist for optional Story Loom features. Dismissal is per
 * browser (cookie); it never writes project data.
 */
export function ProjectOnboarding({ projectId }: { projectId: string }) {
  const [dismissed, setDismissed] = useState(true);
  const [ready, setReady] = useState(false);
  const base = `/projects/${encodeURIComponent(projectId)}`;

  useEffect(() => {
    setDismissed(readDismissed());
    setReady(true);
  }, []);

  if (!ready) return null;

  if (dismissed) {
    return (
      <p className="small muted onboarding-restore">
        <button
          type="button"
          className="linkish"
          onClick={() => {
            writePreference(ONBOARDING_COOKIE, "");
            setDismissed(false);
          }}
        >
          {ONBOARDING.showAgain}
        </button>
      </p>
    );
  }

  const items = [
    {
      href: `${base}/upgrade`,
      help: "upgrade-project" as const,
      title: ONBOARDING.upgrade,
      hint: ONBOARDING.upgradeHint,
      label: NAV.upgradeProject,
    },
    {
      href: `${base}/write`,
      help: "scene-context" as const,
      title: ONBOARDING.pins,
      hint: ONBOARDING.pinsHint,
      label: WRITE.pinnedReferences,
    },
    {
      href: `${base}/world/boards`,
      help: "world-boards" as const,
      title: ONBOARDING.boards,
      hint: ONBOARDING.boardsHint,
      label: WORLD.boards,
    },
    {
      href: `${base}/world/maps`,
      help: "world-maps" as const,
      title: ONBOARDING.maps,
      hint: ONBOARDING.mapsHint,
      label: WORLD.maps,
    },
    {
      href: `${base}/write`,
      help: "author-rewrite" as const,
      title: ONBOARDING.rewrite,
      hint: ONBOARDING.rewriteHint,
      label: DRAFT.startRewrite,
    },
  ];

  return (
    <section className="panel onboarding-panel" aria-labelledby="onboarding-heading">
      <div className="row" style={{ justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
        <h2 id="onboarding-heading" style={{ margin: 0 }}>
          {ONBOARDING.heading}
        </h2>
        <div className="row" style={{ gap: "0.5rem" }}>
          <button
            type="button"
            className="secondary small-button"
            onClick={() => {
              writePreference(ONBOARDING_COOKIE, ONBOARDING_VERSION);
              setDismissed(true);
            }}
          >
            {ONBOARDING.skip}
          </button>
          <button
            type="button"
            className="secondary small-button"
            onClick={() => {
              writePreference(ONBOARDING_COOKIE, ONBOARDING_VERSION);
              setDismissed(true);
            }}
          >
            {ONBOARDING.dismiss}
          </button>
        </div>
      </div>
      <p className="small muted">{ONBOARDING.lead}</p>
      <ol className="onboarding-list">
        {items.map((item) => (
          <li key={item.help}>
            <Link href={item.href}>{item.title}</Link>
            <span className="small muted"> — {item.hint} </span>
            <Link className="small" href={helpHref(item.help)}>
              How to use: {item.label}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
