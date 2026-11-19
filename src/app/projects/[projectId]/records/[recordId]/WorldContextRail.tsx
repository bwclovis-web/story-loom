"use client";

import { createContext, useContext, useId, type ReactNode } from "react";
import {
  ContextRail,
  ContextRailToggle,
  useContextRail,
  type ContextRailApi,
} from "@/components/shell/ContextRail";
import { CloseIcon } from "@/components/shell/icons";
import { IconButton } from "@/components/ui/IconButton";
import { WRITE, WORLD } from "@/ui/labels";

const WorldRailCtx = createContext<{ rail: ContextRailApi; railId: string; titleId: string } | null>(null);

function useWorldRail() {
  const value = useContext(WorldRailCtx);
  if (!value) throw new Error("World context rail controls must be used inside WorldContextProvider");
  return value;
}

/** Shares Write-style collapse / resize / overlay state across the World page chrome. */
export function WorldContextProvider({ children }: { children: ReactNode }) {
  const idPrefix = useId();
  const railId = `${idPrefix}-world-context`;
  const titleId = `${railId}-title`;
  const rail = useContextRail();
  return <WorldRailCtx.Provider value={{ rail, railId, titleId }}>{children}</WorldRailCtx.Provider>;
}

export function WorldContextToggle() {
  const { rail, railId } = useWorldRail();
  return <ContextRailToggle rail={rail} controls={railId} />;
}

/**
 * World / reference page context rail: same collapse, resize, overlay, and Escape
 * behaviour as Write. Children are the existing ContextSection blocks.
 */
export function WorldContextAside({ children }: { children: ReactNode }) {
  const { rail, railId, titleId } = useWorldRail();
  return (
    <ContextRail id={railId} labelledBy={titleId} rail={rail} className="reference-context">
      <div
        className="context-inner"
        onKeyDown={(e) => {
          if (!rail.wide && e.key === "Escape" && !e.defaultPrevented) {
            e.preventDefault();
            rail.close();
          }
        }}
      >
        <div className="context-head">
          <h2 className="context-title" id={titleId}>
            {WORLD.context}
          </h2>
          {!rail.wide ? (
            <IconButton tip="end" aria-label={WRITE.closeContext} onClick={rail.close}>
              <CloseIcon />
            </IconButton>
          ) : null}
        </div>
        <div className="context-body world-context-body">{children}</div>
      </div>
    </ContextRail>
  );
}
