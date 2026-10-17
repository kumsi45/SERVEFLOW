import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const harness = require("../../supabase/audits/sa33c-fresh-install-verify.cjs") as {
  checkSource: () => {
    databaseExecuted: boolean;
    migrationCount: number;
    range: [number, number];
    originalHashes: Record<string, string>;
    candidateHashes: Record<string, string>;
  };
};

describe("SA3.3C migration source contract", () => {
  it("keeps the reviewed fixes and coherent migration history without database execution", () => {
    const result = harness.checkSource();

    expect(result.databaseExecuted).toBe(false);
    expect(result.migrationCount).toBe(278);
    expect(result.range).toEqual([1, 278]);
    expect(result.originalHashes).not.toEqual(result.candidateHashes);
  });
});
