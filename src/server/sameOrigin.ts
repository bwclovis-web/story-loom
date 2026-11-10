/**
 * Route handlers have no built-in cross-site protection (server actions do).
 * Refuses requests from other sites, so a web page cannot make this app send
 * paid assistant requests. JSON-only bodies also force a CORS preflight,
 * which this app never answers.
 */
export function rejectCrossSite(request: Request): Response | null {
  const forbidden = () => Response.json({ error: { code: "FORBIDDEN", message: "Cross-site requests are refused." } }, { status: 403 });
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return forbidden();
  const origin = request.headers.get("origin");
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return forbidden();
    }
    if (originHost !== request.headers.get("host")) return forbidden();
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: { code: "UNSUPPORTED", message: "Send JSON." } }, { status: 415 });
  }
  return null;
}
