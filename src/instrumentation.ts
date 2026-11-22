/**
 * Next.js startup hook. Node-only APIs live in instrumentation.node.ts and
 * are imported only when NEXT_RUNTIME is nodejs (Edge must not see process.*).
 * @see https://nextjs.org/docs/app/guides/open-telemetry
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation.node");
  }
}
