-- Persist retrieval audit (tool calls, omissions, unsaved-prose flag) per answer.
ALTER TABLE "AssistantMessage" ADD COLUMN "retrievalJson" TEXT;
