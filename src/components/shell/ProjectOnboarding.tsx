"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
  if (typeof document === "undefined") return { kind: "done" };
  const match = document.cookie.match(new RegExp(`(?:^|; )${ONBOARDING_COOKIE}=([^;]*)`));
  return parseWalkthroughCookie(match?.[1]);
}

function persist(state: WalkthroughState) {
  writePreference(ONBOARDING_COOKIE, walkthroughCookieValue(state));
}

/**
 * Optional one-task-at-a-time walkthrough. Cookie-only; never writes project data.
 */
export function ProjectOnboarding({ projectId }: { projectId: string }) {
  const [state, setState] = useState<WalkthroughState>({ kind: "done" });
  const [ready, setReady] = useState(false);
  const base = `/projects/${encodeURIComponent(projectId)}`;

  useEffect(() => {
    setState(readState());
    setReady(true);
  }, []);

  const stepIndex = state.kind === "active" ? Math.min(state.step, STEPS.length - 1) : 0;
  const step = STEPS[stepIndex]!;
  const isLast = stepIndex >= STEPS.length - 1;

  const setActive = (next: WalkthroughState) => {
    persist(next);
    setState(next);
  };

  const advance = () => {
    if (isLast) setActive({ kind: "done" });
    else setActive({ kind: "active", step: stepIndex + 1 });
  };

  const restoreLabel = useMemo(() => {
    if (state.kind === "done") return ONBOARDING.showAgain;
    return ONBOARDING.resume;
  }, [state.kind]);

  if (!ready) return null;

  if (state.kind === "done") {
    return (
      <p className="small muted onboarding-restore">
        <button
          type="button"
          className="linkish"
          onClick={() => setActive({ kind: "active", step: 0 })}
        >
          {restoreLabel}
        </button>
      </p>
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
          <button type="button" className="secondary small-button" onClick={() => setActive({ kind: "done" })}>
            {ONBOARDING.skip}
          </button>
          <button type="button" className="secondary small-button" onClick={() => setActive({ kind: "done" })}>
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
