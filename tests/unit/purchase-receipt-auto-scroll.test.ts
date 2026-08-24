import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/modules/purchasing/pages/PurchaseOrderDraftsPage.tsx", "utf8");
const styles = readFileSync("src/modules/purchasing/styles/purchaseOrderDrafts.css", "utf8");

describe("purchase receipt modal navigation", () => {
  it("opens receiving in an accessible modal instead of relying on page scroll", () => {
    expect(page).toContain("const receiptEditorRef = useRef<HTMLElement | null>(null)");
    expect(page).toContain("ref={receiptEditorRef}");
    expect(page).toContain('role="dialog"');
    expect(page).toContain('aria-modal="true"');
    expect(page).not.toContain("scrollIntoView");
  });

  it("moves keyboard focus to the first received quantity field", () => {
    expect(page).toContain("querySelector<HTMLInputElement>");
    expect(page).toContain("?.focus({ preventScroll: true })");
  });

  it("uses a mobile bottom sheet and honors reduced motion", () => {
    expect(styles).toContain("align-items: end");
    expect(styles).toContain(".po-backdrop");
    expect(styles).toContain("prefers-reduced-motion: reduce");
  });
});
