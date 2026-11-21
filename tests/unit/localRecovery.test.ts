import { describe, expect, it } from "vitest";
import { parseRecoveryDraft, recoveryDiffers, recoveryKey } from "@/writing/localRecovery";

describe("local recovery drafts", () => {
  it("keys a copy by record and revision", () => {
    expect(recoveryKey("rec_1", 4)).toBe("storyloom-recovery:rec_1:4");
  });

  it("keeps a copy only when title, text, or fields differ", () => {
    const saved = { title: "One", body: "Saved", fields: "{}" };
    expect(recoveryDiffers(saved, saved)).toBe(false);
    expect(recoveryDiffers(saved, { ...saved, body: "Typed" })).toBe(true);
  });

  it("rejects a stored value that is not a draft", () => {
    expect(parseRecoveryDraft(null)).toBeNull();
    expect(parseRecoveryDraft("{")).toBeNull();
    expect(parseRecoveryDraft(JSON.stringify({ title: "A" }))).toBeNull();
    expect(parseRecoveryDraft(JSON.stringify({ title: "A", body: "B", fields: "{}" }))).toEqual({
      title: "A",
      body: "B",
      fields: "{}",
      savedAt: "",
    });
  });
});
