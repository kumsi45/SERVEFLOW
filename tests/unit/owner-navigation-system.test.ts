import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/modules/owner/pages/OwnerDashboardPage.tsx", "utf8");
const styles = readFileSync("src/modules/owner/styles/ownerDashboard.css", "utf8");
const aiAdvisor = readFileSync("src/modules/owner/components/ai/OwnerAiAdvisor.tsx", "utf8");
const router = readFileSync("src/app/router/AppRouter.tsx", "utf8");
const ownerGuard = readFileSync("src/modules/staff-auth/pages/ProtectedOwnerRoute.tsx", "utf8");

describe("Owner navigation architecture", () => {
  it("uses the complete desktop business information architecture without duplicate modules", () => {
    const desktop = source.slice(source.indexOf("const NAV_SECTIONS"), source.indexOf("const MOBILE_SECONDARY_NAV"));
    for (const section of ["Overview", "Operations", "People", "Money", "Business"]) expect(desktop).toContain(`label: "${section}"`);
    for (const item of ["Dashboard", "Orders", "Tables", "Menu", "Kitchen", "Inventory", "Staff", "Customers", "Finance", "Reports", "Settings"]) expect(desktop).toContain(`label: "${item}"`);
    expect(desktop).not.toContain('label: "Printing"');
    expect(desktop).not.toContain('label: "QR & Tables"');
    expect(source).toContain("NAV_SECTIONS.map");
  });

  it("provides a flat secondary mobile drawer without primary-navigation duplication", () => {
    const secondary = source.slice(source.indexOf("const MOBILE_SECONDARY_NAV"), source.indexOf("const MOBILE_PRIMARY_NAV"));
    for (const label of ["Kitchen", "Inventory", "Staff", "Customers", "Reports", "Settings"]) expect(secondary).toContain(`label: "${label}"`);
    for (const label of ["Home", "Orders", "Tables", "Finance", "Menu"]) expect(secondary).not.toContain(`label: "${label}"`);
    expect(source).toContain('aria-label="Owner secondary navigation"');
    expect(source).not.toContain("od-mobile-menu-group");
    expect(source).toContain("Subscription");
    expect(source).toContain("Help &amp; Support");
    expect(source).toContain("About ServeFlow");
  });

  it("keeps exactly five operational mobile destinations", () => {
    const primary = source.slice(source.indexOf("const MOBILE_PRIMARY_NAV"), source.indexOf("const OWNER_SECTION_NAV"));
    expect(primary.match(/label: "/g)).toHaveLength(5);
    for (const label of ["Home", "Orders", "Tables", "Finance", "Menu"]) expect(primary).toContain(`label: "${label}"`);
  });

  it("uses canonical Owner paths and keeps tables backed by the existing QR workspace", () => {
    for (const path of ["/owner/dashboard", "/owner/orders", "/owner/tables", "/owner/menu", "/owner/kitchen", "/owner/staff", "/owner/customers", "/owner/analytics", "/owner/reports", "/owner/settings"]) expect(source).toContain(path);
    expect(source).toContain('tables: "qr"');
    expect(source).toContain('nav === "qr"');
    expect(router).toContain('"kitchen", "staff", "customers"');
    expect(source).toContain("window.dispatchEvent(new PopStateEvent(\"popstate\"))");
  });

  it("keeps the drawer accessible across dismissal and responsive mode changes", () => {
    expect(source).toContain('role="dialog" aria-modal="true"');
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain('document.body.style.overflow = "hidden"');
    expect(source).toContain('window.addEventListener("resize", closeAtDesktop)');
    expect(source).toContain("mobileMenuButtonRef.current?.focus()");
    expect(source).toContain('aria-current={nav === item.id ? "page" : undefined}');
  });

  it("keeps notification left of the right-edge menu and uses compact drawer treatment", () => {
    const mobileHeader = source.slice(source.indexOf('className="od-mobile-appbar"'), source.indexOf("{mobileMenuOpen &&"));
    expect(mobileHeader).toContain('<ServeFlowBrand variant="compact" />');
    expect(mobileHeader).not.toContain("{restaurantName}");
    expect(mobileHeader).not.toContain("{currentNavLabel}");
    expect(mobileHeader.indexOf('aria-label="Notifications"')).toBeLessThan(mobileHeader.indexOf('aria-label="Open owner navigation"'));
    expect(styles).toContain("width: min(84vw, 360px)");
    expect(styles).toContain("min-height: 52px");
    expect(styles).toContain("background: transparent");
    expect(styles).toContain("animation: od-owner-drawer-in .18s ease-out both");
  });

  it("retains the owner-only route guard and tenant check", () => {
    expect(ownerGuard).toContain('.eq("restaurant_id", resolvedRestaurantId)');
    expect(ownerGuard).toContain('.eq("role", "owner")');
    expect(ownerGuard).toContain('.eq("active", true)');
  });

  it("provides a global non-navigating AI assistant shell", () => {
    expect(source).toContain("<OwnerAiAdvisor");
    expect(aiAdvisor).toContain("sf-ai-launcher");
    expect(aiAdvisor).toContain("SfSidePanel");
    expect(source).toContain("setAiAssistantOpen(true)");
    expect(styles).toContain(".od-sidebar.collapsed");
    expect(styles).toContain("@media(min-width:761px) and (max-width:1080px)");
  });

  it("includes the full Help, About, and Feedback UI shells", () => {
    for (const topic of ["Getting Started", "Orders", "Menu", "Kitchen", "Inventory", "Finance", "Printing", "Frequently Asked Questions", "Video Tutorials", "Contact Support"]) expect(source).toContain(topic);
    expect(source).toContain("KumsiTech");
    expect(source).toContain("Abdulhayi Alo");
    expect(source).toContain("v1.0.0");
    expect(source).toContain("Report Bug");
    expect(source).toContain("Suggest Feature");
    expect(source).toContain("Rate Experience");
  });
});
