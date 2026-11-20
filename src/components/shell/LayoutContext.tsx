"use client";

import { createContext, useContext } from "react";
import type { WriteMode } from "@/writing/writeMode";
import type { LayoutPreference } from "./preferences";

export interface LayoutControls {
  layout: LayoutPreference;
  /** Saves layout choices in this browser. */
  updateLayout: (patch: Partial<LayoutPreference>) => void;
  /** Shows a width while a panel is being dragged, without saving it. */
  previewWidth: (key: "secondaryWidth" | "contextWidth", px: number) => void;
  /** Manuscript layout. Other pages keep their own panel choices. */
  writeMode: WriteMode;
  setWriteMode: (mode: WriteMode) => void;
  /** True while a chapter or scene editor is mounted. */
  writeScreen: boolean;
  setWriteScreen: (on: boolean) => void;
  /** Opens the narrow-screen navigation drawer. */
  openMainMenu: () => void;
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
