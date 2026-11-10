/**
 * MCP stdio uses stdout for protocol messages. Application logs go to stderr.
 * Import and call this before any other application module.
 */

function writeStderr(args: unknown[]): void {
  const line = args.map((arg) => (typeof arg === "string" ? arg : String(arg))).join(" ");
  process.stderr.write(line.endsWith("\n") ? line : `${line}\n`);
}

export function redirectConsoleToStderr(): void {
  console.log = (...args: unknown[]) => writeStderr(args);
  console.info = (...args: unknown[]) => writeStderr(args);
  console.debug = (...args: unknown[]) => writeStderr(args);
  console.warn = (...args: unknown[]) => writeStderr(args);
}
