import { describe, expect, it } from "vitest";
import { statusTone } from "../../src/modules/super-admin/PlatformAdminWorkspace";

describe("platform admin status semantics", () => {
  it("reserves amber for pending work and does not present unknown health as success", () => {
    expect(statusTone("pending")).toBe("attention");
    expect(statusTone("unclassified")).toBe("neutral");
    expect(statusTone("Unknown")).toBe("neutral");
    expect(statusTone("Unavailable")).toBe("neutral");
    expect(statusTone("demo")).toBe("neutral");
    expect(statusTone("approved")).toBe("positive");
    expect(statusTone("failed")).toBe("negative");
  });
});
