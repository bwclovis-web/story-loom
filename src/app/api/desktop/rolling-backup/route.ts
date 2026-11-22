import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { runRollingBackup } from "@/server/rollingBackup";

function authorized(request: Request): boolean {
  const expected = process.env.STORYLOOM_DESKTOP_TOKEN?.trim();
  if (!expected) return process.env.STORYLOOM_ELECTRON === "1";
  const header = request.headers.get("x-storyloom-desktop-token");
  return header === expected;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as { label?: string };
  const db = getDb();
  const outcome = await runRollingBackup(db, { label: typeof body.label === "string" ? body.label : undefined });
  if (!outcome.ok) return NextResponse.json(outcome, { status: 400 });
  return NextResponse.json(outcome);
}