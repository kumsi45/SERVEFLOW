import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveOwnerQrOrderingUrl } from "../../src/core/config/appUrl";

const path = "/r/grand-royal/order?t=1&qr=existing-token";
const staleUrl = "http://10.61.145.181:5173" + path;

describe("Owner development QR URL resolution", () => {
  it.each([
    "http://192.168.1.25:5173",
    "http://restaurant-demo.local:5173",
  ])("uses the current non-loopback development origin %s with the canonical path", (browserOrigin) => {
    expect(resolveOwnerQrOrderingUrl({ qrUrl: staleUrl, qrPath: path, browserOrigin, development: true }))
      .toEqual({ url: browserOrigin + path, unavailableMessage: null });
  });

  it("ignores a stale persisted absolute URL in development without changing the path capability", () => {
    const result = resolveOwnerQrOrderingUrl({ qrUrl: staleUrl, qrPath: path, browserOrigin: "http://10.212.64.251:5173", development: true });
    expect(result.url).toBe("http://10.212.64.251:5173" + path);
    expect(result.url).toContain(path);
    expect(result.url).not.toContain("10.61.145.181");
  });

  it.each(["http://localhost:5173", "http://127.0.0.1:5173", "http://[::1]:5173"])("rejects loopback development origin %s", (browserOrigin) => {
    const result = resolveOwnerQrOrderingUrl({ qrUrl: staleUrl, qrPath: path, browserOrigin, development: true });
    expect(result.url).toBeNull();
    expect(result.unavailableMessage).toBe("Open ServeFlow using your computer's Network URL to test this QR from another device.");
    expect(result.unavailableMessage).not.toContain("existing-token");
  });

  it("does not use an arbitrary browser origin in production", () => {
    expect(resolveOwnerQrOrderingUrl({ qrUrl: staleUrl, qrPath: path, browserOrigin: "http://192.168.1.25:5173", development: false }))
      .toEqual({ url: staleUrl, unavailableMessage: null });
  });

  it("does not invent a capability when the canonical path is absent", () => {
    expect(resolveOwnerQrOrderingUrl({ qrUrl: staleUrl, qrPath: null, browserOrigin: "http://192.168.1.25:5173", development: true }))
      .toEqual({ url: null, unavailableMessage: "This table QR code is unavailable." });
  });

  it("routes Owner QR presentation through the central resolver without diagnostics containing the URL", () => {
    const ownerPage = readFileSync("src/modules/owner/pages/OwnerDashboardPage.tsx", "utf8");
    expect(ownerPage).toContain("resolveOwnerQrOrderingUrl");
    expect(ownerPage).toContain("function openQrPreview");
    expect(ownerPage).not.toContain("generatedQrUrl: url");
  });
});
