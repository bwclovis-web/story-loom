"use client";

import { createContext, useContext } from "react";
import type { LayoutPreference } from "./preferences";

export interface LayoutControls {
  layout: LayoutPreference;
  /** Saves layout choices in this browser. */
  updateLayout: (patch: Partial<LayoutPreference>) => void;
  /** Shows a width while a panel is being dragged, without saving it. */
  previewWidth: (key: "secondaryWidth" | "contextWidth", px: number) => void;
  focusMode: boolean;
  setFocusMode: (on: boolean) => void;
}

export const LayoutContext = createContext<LayoutControls | null>(null);

export function useLayout(): LayoutControls {
  const value = useContext(LayoutContext);
  if (!value) throw new Error("useLayout must be used inside AppShell");
  return value;
}

export const WIDTH_VARIABLES = {
  secondaryWidth: "--secondary-width",
  contextWidth: "--context-width",
} as const;
