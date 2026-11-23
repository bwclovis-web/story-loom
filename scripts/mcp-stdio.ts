import "dotenv/config";
import { redirectConsoleToStderr } from "../src/mcp/stderrLog";

redirectConsoleToStderr();

// Exit before loading the SDK, database, or handlers. Under suite load those
// imports alone can exceed the disabled-child budget (recorded ~22s cold start).
const disabled = process.env.WORDLY_MCP_DISABLED?.trim().toLowerCase();
if (disabled === "1" || disabled === "true" || disabled === "yes") {
  process.stderr.write(
    "Story Loom MCP adapter is disabled (WORDLY_MCP_DISABLED). No protocol output was started.\n",
  );
  process.exit(1);
}

void import("../src/mcp/stdioMain")
  .then(({ main }) => main())
  .catch((error: unknown) => {
    process.stderr.write(`Story Loom MCP adapter failed to start: ${error instanceof Error ? error.name : "Error"}\n`);
    process.exit(1);
  });
