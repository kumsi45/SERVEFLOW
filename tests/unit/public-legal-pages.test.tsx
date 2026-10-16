import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicLegalPage, type PublicLegalPageId } from "../../src/modules/landing/pages/PublicLegalPages";
import { publicWhatsAppLink } from "../../src/modules/landing/publicContact";

describe("public legal drafts", () => {
  it.each<PublicLegalPageId>(["privacy", "terms", "cookies", "acceptable-use"])("renders %s as a substantive draft with shared navigation", documentId => {
    const html = renderToStaticMarkup(createElement(PublicLegalPage, { documentId }));
    expect(html).toContain("Draft for review");
    expect(html).toContain("qualified legal review");
    expect(html).toContain('aria-label="ServeFlow site footer"');
    expect(html.match(/<section /g)?.length).toBeGreaterThanOrEqual(5);
    expect(html).not.toMatch(/mailto:|href="#"|registered company|GDPR compliant|fully secure/i);
  });

  it("keeps commercial dates and pricing subject to direct confirmation", () => {
    const html = renderToStaticMarkup(createElement(PublicLegalPage, { documentId: "terms" }));
    expect(html).toContain("must be confirmed directly");
    expect(html).not.toMatch(/automatically renew|automatically expires|guaranteed access/i);
  });

  it("encodes WhatsApp inquiry text without changing the supplied destination", () => {
    const url = new URL(publicWhatsAppLink("Setup & pricing? Café"));
    expect(url.origin + url.pathname).toBe("https://wa.me/251990069892");
    expect(url.searchParams.get("text")).toBe("Setup & pricing? Café");
  });
});
