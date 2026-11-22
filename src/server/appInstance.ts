import "server-only";
import { randomUUID } from "node:crypto";

/**
 * Stable for one Node process. Used by the library lock so a restart on the
 * same machine can tell "this app" from another copy.
 */
const globalForInstance = globalThis as unknown as { __storyLoomAppInstanceId?: string };

export function appInstanceId(): string {
  if (!globalForInstance.__storyLoomAppInstanceId) {
    globalForInstance.__storyLoomAppInstanceId = randomUUID();
  }
  return globalForInstance.__storyLoomAppInstanceId;
}
