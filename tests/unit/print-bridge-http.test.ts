import { describe, expect, it } from "vitest";
import { pairingResponse, smallJson } from "../../supabase/functions/_shared/printBridgeHttp";

describe("print bridge HTTP boundary", () => {
  it("returns a bodyless Owner preflight response with exact-origin CORS", async () => {
    const response = pairingResponse(204, {}, "https://owner.example.test");
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("Access-Control-Allow-Origin"))
      .toBe("https://owner.example.test");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("rejects oversized bodies before JSON parsing", async () => {
    const request = new Request("https://example.test", {
      method: "POST", body: JSON.stringify({ value: "x".repeat(2048) }),
    });
    await expect(smallJson(request)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
});
