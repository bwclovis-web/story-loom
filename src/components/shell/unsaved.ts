/*
 * Which open forms hold text the server has not acknowledged. Nothing here
 * stores the text itself; it only lets navigation ask before leaving.
 */

import { WRITE } from "@/ui/labels";

const unsaved = new Set<string>();

export function setUnsaved(key: string, on: boolean) {
  if (on) unsaved.add(key);
  else unsaved.delete(key);
}

export function hasUnsaved(): boolean {
  return unsaved.size > 0;
}

/** True when it is fine to leave: nothing unsaved, or the author confirmed. */
export function confirmLeave(): boolean {
  return !hasUnsaved() || window.confirm(WRITE.leaveUnsaved);
}

/** In-app link clicks that would replace the current page (not new tabs, downloads or same-page anchors). */
export function isLeavingClick(event: MouseEvent): boolean {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const anchor = (event.target as Element | null)?.closest?.("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return false;
  if (anchor.target && anchor.target !== "_self") return false;
  if (anchor.hasAttribute("download")) return false;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return false;
  return url.pathname !== window.location.pathname || url.search !== window.location.search;
}
