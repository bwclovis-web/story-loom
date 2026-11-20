"use client";

import { useEffect } from "react";

/** Sets a session-start cookie so “this session” progress counts revisions since first Write visit today in the browser. */
export function WritingSessionInit() {
  useEffect(() => {
    const key = "wordly-writing-session";
    if (document.cookie.split("; ").some((part) => part.startsWith(`${key}=`))) return;
    const value = encodeURIComponent(new Date().toISOString());
    document.cookie = `${key}=${value}; path=/; max-age=86400; SameSite=Lax`;
  }, []);
  return null;
}