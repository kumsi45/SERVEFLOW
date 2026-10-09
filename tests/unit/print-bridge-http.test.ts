import { describe, expect, it } from "vitest";
import { errorResponse, pairingResponse, smallJson } from "../../supabase/functions/_shared/printBridgeHttp";
import { PairingError } from "../../supabase/functions/_shared/printBridgePairingCore";
import { trustedSource } from "../../supabase/functions/_shared/printBridgeRateLimit";

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

  it("uses only a transport peer identity and fails closed without one", () => {
    expect(trustedSource("192.0.2.7")).toBe("192.0.2.7");
    expect(() => trustedSource(undefined)).toThrow();
    expect(() => trustedSource("forged-source")).toThrow();
  });

  it("returns uniform no-store errors without leaking internal failures", async () => {
    const invalid = errorResponse(new PairingError("PAIRING_UNAVAILABLE", 409,
      "Pairing is unavailable."));
    const internal = errorResponse(new Error("secret database failure"));
    expect(invalid.status).toBe(409);
    expect(internal.status).toBe(503);
    expect(await internal.text()).not.toContain("secret database failure");
    expect(internal.headers.get("Cache-Control")).toContain("no-store");
  });
});
