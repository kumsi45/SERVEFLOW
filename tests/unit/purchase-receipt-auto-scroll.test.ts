import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/modules/purchasing/pages/PurchaseOrderDraftsPage.tsx", "utf8");
const styles = readFileSync("src/modules/purchasing/styles/purchaseOrderDrafts.css", "utf8");

describe("purchase receipt automatic navigation", () => {
  it("scrolls the newly opened receipt editor into view", () => {
    expect(page).toContain("const receiptEditorRef = useRef<HTMLElement | null>(null)");
    expect(page).toContain("ref={receiptEditorRef}");
    expect(page).toContain('editor.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" })');
    expect(page).toContain("[receipt?.purchaseOrderId]");
  });

  it("moves keyboard focus to the first received quantity field", () => {
    expect(page).toContain("querySelector<HTMLInputElement>");
    expect(page).toContain("?.focus({ preventScroll: true })");
  });

  it("honors reduced motion and leaves room for the mobile header", () => {
    expect(page).toContain("prefers-reduced-motion: reduce");
    expect(styles).toContain(".po-receipt-editor");
    expect(styles).toContain("scroll-margin-top: 76px");
  });
});
