import { describe, expect, it } from "vitest";
import { draftFingerprint, draftManager, saveStateLabel, workflowErrorMessage } from "../../src/modules/setup-wizard/services/draftManager";
import type { MenuReviewState } from "../../src/modules/setup-wizard/services/menuReviewTypes";

const state = { schemaVersion: 2, restaurantName: { value: "Cafe", confidence: 1 }, categories: [], items: [], unrecognizedText: [] } as unknown as MenuReviewState;

describe("Phase 9.15 draft manager", () => {
  it("uses a stable fingerprint and skips structurally identical states", () => {
    const reordered = { ...state, categories: [...state.categories] };
    draftManager.hydrate("draft-1", state, 4);
    expect(draftFingerprint(reordered)).toBe(draftFingerprint(state));
    expect(draftManager.isChanged("draft-1", reordered)).toBe(false);
  });

  it("exposes only the standardized save lifecycle labels", () => {
    expect(saveStateLabel("dirty")).toBe("Editing");
    expect(saveStateLabel("saving")).toBe("Syncing...");
    expect(saveStateLabel("saved")).toBe("Synced");
    expect(saveStateLabel("saved", true)).toBe("Saved");
  });

  it("replaces technical transport and revision errors with useful guidance", () => {
    expect(workflowErrorMessage(new Error("Edge Function returned a non-2xx status code"), "Publish failed")).toBe("Publish failed");
    expect(workflowErrorMessage(new Error("This draft changed in another session"), "Sync failed")).toContain("updated elsewhere");
  });
});
