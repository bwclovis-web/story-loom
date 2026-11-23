"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/Atoms/Button";
import { useEffect, useRef, useState } from "react";
import { helpHref, type HelpAnchor } from "@/help/outline";
import { ONBOARDING } from "@/ui/labels";
import { BookIcon } from "./icons";
import { isProjectLandingPath, parseProjectPath } from "@/ui/navigation";
import {
  ONBOARDING_COOKIE,
  parseWalkthroughCookie,
  walkthroughCookieValue,
  writePreference,
  type WalkthroughState,
} from "./preferences";

type WalkStep = {
  id: string;
  title: string;
  hint: string;
  href: (base: string) => string;
  help: HelpAnchor;
};

const STEPS: WalkStep[] = [
  {
    id: "write",
    title: ONBOARDING.taskWrite,
    hint: ONBOARDING.taskWriteHint,
    href: (base) => `${base}/write`,
    help: "draft-comparison",
  },
  {
    id: "import",
    title: ONBOARDING.taskImport,
    hint: ONBOARDING.taskImportHint,
    href: (base) => `${base}/import-chapters`,
    help: "import-chapters",
  },
  {
    id: "codex",
    title: ONBOARDING.taskCodex,
    hint: ONBOARDING.taskCodexHint,
    href: (base) => `${base}/write`,
    help: "scene-context",
  },
  {
    id: "beats",
    title: ONBOARDING.taskBeats,
    hint: ONBOARDING.taskBeatsHint,
    href: (base) => `${base}/plan/weave`,
    help: "weave-templates",
  },
  {
    id: "world",
    title: ONBOARDING.taskWorld,
    hint: ONBOARDING.taskWorldHint,
    href: (base) => `${base}/world`,
    help: "world-kinds",
  },
  {
    id: "map",
    title: ONBOARDING.taskMap,
    hint: ONBOARDING.taskMapHint,
    href: (base) => `${base}/world/maps`,
    help: "optional-maps",
  },
  {
    id: "board",
    title: ONBOARDING.taskBoard,
    hint: ONBOARDING.taskBoardHint,
    href: (base) => `${base}/world/boards`,
    help: "optional-boards",
  },
  {
    id: "continuity",
    title: ONBOARDING.taskContinuity,
    hint: ONBOARDING.taskContinuityHint,
    href: (base) => `${base}/continuity`,
    help: "world-continuity",
  },
  {
    id: "assistant",
    title: ONBOARDING.taskAssistant,
    hint: ONBOARDING.taskAssistantHint,
    href: (base) => `${base}/assistant`,
    help: "assistant",
  },
  {
    id: "publish",
    title: ONBOARDING.taskPublish,
    hint: ONBOARDING.taskPublishHint,
    href: (base) => `${base}/export-pdf`,
    help: "pdf-export",
  },
];

function readState(): WalkthroughState {
  if (typeof document === "undefined") return { kind: "dismissed" };
  const match = document.cookie.match(new RegExp(`(?:^|; )${ONBOARDING_COOKIE}=([^;]*)`));
  return parseWalkthroughCookie(match?.[1]);
}

function persist(state: WalkthroughState) {
  writePreference(ONBOARDING_COOKIE, walkthroughCookieValue(state));
}

function stepOf(state: WalkthroughState): number {
  if (state.kind === "dismissed") return 0;
  return Math.min(state.step, STEPS.length - 1);
}

/**
 * On-demand guided checklist. Cookie-only; never writes project data.
 * Skip for now pauses at the current task; Resume restores it. Don't show again
 * is a distinct permanent dismissal.
 */
export function ProjectOnboarding({
  projectId,
  quiet = false,
  empty = false,
  marked = false,
}: {
  projectId: string;
  quiet?: boolean;
  /** A new manuscript: open the quiet tasks instead of hiding them. */
  empty?: boolean;
  /** Book icon beside Getting started. */
  marked?: boolean;
}) {
  const pathname = usePathname();
  const parsed = parseProjectPath(pathname);
  const landing = parsed ? isProjectLandingPath(parsed.rest) : false;
  const [state, setState] = useState<WalkthroughState>({ kind: "dismissed" });
  const [ready, setReady] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const bannerObserver = useRef<ResizeObserver | null>(null);
  const base = `/projects/${encodeURIComponent(projectId)}`;

  useEffect(() => {
    const next = readState();
    setState(next);
    setTasksOpen(empty && next.kind === "open");
    setReady(true);
  }, [empty]);

  useEffect(() => () => {
    bannerObserver.current?.disconnect();
    document.documentElement.style.removeProperty("--write-banner-h");
  }, []);

  const setBanner = (node: HTMLElement | null) => {
    bannerObserver.current?.disconnect();
    bannerObserver.current = null;
    if (!node || getComputedStyle(node).display === "none") {
      document.documentElement.style.removeProperty("--write-banner-h");
      return;
    }
    const apply = () => {
      document.documentElement.style.setProperty("--write-banner-h", `${Math.ceil(node.getBoundingClientRect().height)}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    bannerObserver.current = observer;
  };

  const setWalk = (next: WalkthroughState) => {
    persist(next);
    setState(next);
  };

  if (!quiet && landing) return null;
  if (!ready) return null;

  const stepIndex = stepOf(state);
  const step = STEPS[stepIndex]!;
  const isLast = stepIndex >= STEPS.length - 1;

  const advance = () => {
    if (isLast) setWalk({ kind: "dismissed" });
    else setWalk({ kind: "open", step: stepIndex + 1 });
  };

  if (quiet) {
    return (
      <details
        className="outline-getting-started"
        open={tasksOpen}
        onToggle={(event) => setTasksOpen(event.currentTarget.open)}
      >
        <summary>
          {marked ? <BookIcon /> : null}
          {ONBOARDING.gettingStarted}
        </summary>
        {state.kind === "dismissed" ? (
          <p className="small">
            <button type="button" className="linkish" onClick={() => setWalk({ kind: "open", step: 0 })}>
              {ONBOARDING.showAgain}
            </button>
          </p>
        ) : null}
        {state.kind === "paused" ? (
          <div className="row" role="status">
            <Button type="button" size="sm" onClick={() => setWalk({ kind: "open", step: stepIndex })}>
              {ONBOARDING.resume}
            </Button>
            <span className="small muted">{ONBOARDING.progress(stepIndex + 1, STEPS.length)}</span>
            <button type="button" className="linkish small" onClick={() => setWalk({ kind: "dismissed" })}>
              {ONBOARDING.dismiss}
            </button>
          </div>
        ) : null}
        {state.kind === "open" ? (
          <article className="walkthrough-task" aria-labelledby="walkthrough-task-title">
            <p className="small muted">{ONBOARDING.progress(stepIndex + 1, STEPS.length)}</p>
            <h3 id="walkthrough-task-title">{step.title}</h3>
            <p>{step.hint}</p>
            <div className="row walkthrough-actions">
              <ButtonLink href={step.href(base)}>{ONBOARDING.openTask}</ButtonLink>
              <Button type="button" size="sm" onClick={advance}>
                {isLast ? ONBOARDING.finish : ONBOARDING.next}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setWalk({ kind: "paused", step: stepIndex })}>
                {ONBOARDING.skip}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setWalk({ kind: "dismissed" })}>
                {ONBOARDING.dismiss}
              </Button>
              <Link className="small" href={helpHref(step.help)}>
                {ONBOARDING.howTo}
              </Link>
            </div>
          </article>
        ) : null}
      </details>
    );
  }

  if (state.kind === "dismissed") {
    return (
      <p className="small muted onboarding-restore" ref={setBanner}>
        <button type="button" className="linkish" onClick={() => setWalk({ kind: "open", step: 0 })}>
          {ONBOARDING.showAgain}
        </button>
      </p>
    );
  }

  if (state.kind === "paused") {
    return (
      <div className="onboarding-chip row" role="status" ref={setBanner}>
        <Button type="button" size="sm" onClick={() => setWalk({ kind: "open", step: stepIndex })}>
          {ONBOARDING.resume}
        </Button>
        <span className="small muted">{ONBOARDING.progress(stepIndex + 1, STEPS.length)}</span>
        <button type="button" className="linkish small" onClick={() => setWalk({ kind: "dismissed" })}>
          {ONBOARDING.dismiss}
        </button>
      </div>
    );
  }

  return (
    <section className="panel onboarding-panel walkthrough-panel" aria-labelledby="walkthrough-heading" ref={setBanner}>
      <div className="row walkthrough-head">
        <div>
          <h2 id="walkthrough-heading" style={{ margin: 0 }}>
            {ONBOARDING.heading}
          </h2>
          <p className="small muted" style={{ margin: "0.2rem 0 0" }}>
            {ONBOARDING.progress(stepIndex + 1, STEPS.length)}
          </p>
        </div>
        <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
          <Button
            type="button"
            variant="secondary" size="sm"
            onClick={() => setWalk({ kind: "paused", step: stepIndex })}
          >
            {ONBOARDING.skip}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => setWalk({ kind: "dismissed" })}>
            {ONBOARDING.dismiss}
          </Button>
        </div>
      </div>
      <p className="small muted">{ONBOARDING.lead}</p>

      <article className="walkthrough-task" aria-labelledby="walkthrough-task-title">
        <h3 id="walkthrough-task-title">{step.title}</h3>
        <p>{step.hint}</p>
        <div className="row walkthrough-actions">
          <ButtonLink href={step.href(base)}>{ONBOARDING.openTask}</ButtonLink>
          <Button type="button" size="sm" onClick={advance}>
            {isLast ? ONBOARDING.finish : ONBOARDING.next}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={advance}>
            {ONBOARDING.skipTask}
          </Button>
          <Link className="small" href={helpHref(step.help)}>
            {ONBOARDING.howTo}
          </Link>
        </div>
      </article>
    </section>
  );
}
