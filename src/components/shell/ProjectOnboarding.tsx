"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { helpHref, type HelpAnchor } from "@/help/outline";
import { ONBOARDING } from "@/ui/labels";
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
    id: "continue",
    title: ONBOARDING.taskContinue,
    hint: ONBOARDING.taskContinueHint,
    href: (base) => `${base}/write`,
    help: "write-page",
  },
  {
    id: "pin",
    title: ONBOARDING.taskPin,
    hint: ONBOARDING.taskPinHint,
    href: (base) => `${base}/write`,
    help: "scene-context",
  },
  {
    id: "board",
    title: ONBOARDING.taskBoard,
    hint: ONBOARDING.taskBoardHint,
    href: (base) => `${base}/world/boards`,
    help: "world-boards",
  },
  {
    id: "map",
    title: ONBOARDING.taskMap,
    hint: ONBOARDING.taskMapHint,
    href: (base) => `${base}/world/maps`,
    help: "world-maps",
  },
  {
    id: "weave",
    title: ONBOARDING.taskWeave,
    hint: ONBOARDING.taskWeaveHint,
    href: (base) => `${base}/plan/weave`,
    help: "plan-weave",
  },
  {
    id: "assistant",
    title: ONBOARDING.taskAssistant,
    hint: ONBOARDING.taskAssistantHint,
    href: (base) => `${base}/assistant`,
    help: "assistant",
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
export function ProjectOnboarding({ projectId }: { projectId: string }) {
  const [state, setState] = useState<WalkthroughState>({ kind: "dismissed" });
  const [ready, setReady] = useState(false);
  const base = `/projects/${encodeURIComponent(projectId)}`;

  useEffect(() => {
    setState(readState());
    setReady(true);
  }, []);

  const setWalk = (next: WalkthroughState) => {
    persist(next);
    setState(next);
  };

  if (!ready) return null;

  const stepIndex = stepOf(state);
  const step = STEPS[stepIndex]!;
  const isLast = stepIndex >= STEPS.length - 1;

  const advance = () => {
    if (isLast) setWalk({ kind: "dismissed" });
    else setWalk({ kind: "open", step: stepIndex + 1 });
  };

  if (state.kind === "dismissed") {
    return (
      <p className="small muted onboarding-restore">
        <button type="button" className="linkish" onClick={() => setWalk({ kind: "open", step: 0 })}>
          {ONBOARDING.showAgain}
        </button>
      </p>
    );
  }

  if (state.kind === "paused") {
    return (
      <div className="onboarding-chip row" role="status">
        <button type="button" className="small-button" onClick={() => setWalk({ kind: "open", step: stepIndex })}>
          {ONBOARDING.resume}
        </button>
        <span className="small muted">{ONBOARDING.progress(stepIndex + 1, STEPS.length)}</span>
        <button type="button" className="linkish small" onClick={() => setWalk({ kind: "dismissed" })}>
          {ONBOARDING.dismiss}
        </button>
      </div>
    );
  }

  return (
    <section className="panel onboarding-panel walkthrough-panel" aria-labelledby="walkthrough-heading">
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
          <button
            type="button"
            className="secondary small-button"
            onClick={() => setWalk({ kind: "paused", step: stepIndex })}
          >
            {ONBOARDING.skip}
          </button>
          <button type="button" className="secondary small-button" onClick={() => setWalk({ kind: "dismissed" })}>
            {ONBOARDING.dismiss}
          </button>
        </div>
      </div>
      <p className="small muted">{ONBOARDING.lead}</p>

      <article className="walkthrough-task" aria-labelledby="walkthrough-task-title">
        <h3 id="walkthrough-task-title">{step.title}</h3>
        <p>{step.hint}</p>
        <div className="row walkthrough-actions">
          <Link className="button-link" href={step.href(base)}>
            {ONBOARDING.openTask}
          </Link>
          <button type="button" className="small-button" onClick={advance}>
            {isLast ? ONBOARDING.finish : ONBOARDING.next}
          </button>
          <button type="button" className="secondary small-button" onClick={advance}>
            {ONBOARDING.skipTask}
          </button>
          <Link className="small" href={helpHref(step.help)}>
            {ONBOARDING.howTo}
          </Link>
        </div>
      </article>
    </section>
  );
}
