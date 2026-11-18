import "dotenv/config";
import { redirectConsoleToStderr } from "../src/mcp/stderrLog";

redirectConsoleToStderr();

void import("../src/mcp/stdioMain")
  .then(({ main }) => main())
  .catch((error: unknown) => {
    process.stderr.write(`Story Loom MCP adapter failed to start: ${error instanceof Error ? error.name : "Error"}\n`);
    process.exit(1);
  });
