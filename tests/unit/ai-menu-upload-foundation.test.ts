import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MENU_IMPORT_MAX_FILE_MB,
  getMenuImportMaxFileBytes,
  normalizeMenuImportMime,
  validateMenuImportFile,
} from "../../src/modules/setup-wizard/services/menuImportFileValidation";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const wizard = read(
  "src/modules/setup-wizard/pages/RestaurantSetupWizardPage.tsx",
);
const uploadStep = read(
  "src/modules/setup-wizard/components/AiMenuUploadStep.tsx",
);
const uploadService = read(
  "src/modules/setup-wizard/services/menuImportDraftService.ts",
);
const migration = read(
  "supabase/migrations/187_phase9_8_1_ai_menu_upload_foundation.sql",
);
const css = read(
  "src/modules/setup-wizard/pages/restaurantSetupWizard.css",
);

describe("Phase 9.8.1 AI Menu Builder upload foundation", () => {
  it("uses the five-step menu-first onboarding flow", () => {
    const flow = [
      "Business Information",
      "Choose Your Smart Menu Library",
      "Review Your Menu",
      "Brand Your Menu",
      "Preview & Publish",
    ];
    let previousIndex = -1;
    for (const label of flow) {
      const index = wizard.indexOf(`"${label}"`);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
    expect(wizard).not.toContain('"Staff"');
    expect(wizard).not.toContain('"Payment Accounts"');
    expect(wizard).toContain("Step {step + 1} of {STEPS.length}");
    expect(wizard).toContain("starter_template_keys: []");
    expect(wizard).toContain("staff_invitations_payload: []");
    expect(wizard).toContain("SmartMenuLibraryStep");
    expect(wizard).not.toContain("AiMenuUploadStep");
  });

  it.each([
    ["menu.pdf", "application/pdf"],
    ["menu.png", "image/png"],
    ["menu.jpg", "image/jpeg"],
    ["menu.jpeg", "image/jpeg"],
    ["menu.webp", "image/webp"],
    [
      "menu.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
  ])("accepts %s", (name, type) => {
    const file = { name, type, size: 1024 };
    expect(validateMenuImportFile(file, 2048)).toBeNull();
    expect(normalizeMenuImportMime(file)).toBe(type);
  });

  it("rejects unsupported, empty, mismatched, and oversized files", () => {
    expect(
      validateMenuImportFile(
        { name: "menu.txt", type: "text/plain", size: 100 },
        1000,
      ),
    ).toContain("unsupported");
    expect(
      validateMenuImportFile(
        { name: "menu.pdf", type: "image/png", size: 100 },
        1000,
      ),
    ).toContain("unsupported");
    expect(
      validateMenuImportFile(
        { name: "menu.pdf", type: "application/pdf", size: 0 },
        1000,
      ),
    ).toContain("empty");
    expect(
      validateMenuImportFile(
        { name: "menu.pdf", type: "application/pdf", size: 1001 },
        1000,
      ),
    ).toContain("too large");
  });

  it("provides a configurable, storage-capped maximum file size", () => {
    expect(getMenuImportMaxFileBytes()).toBe(
      DEFAULT_MENU_IMPORT_MAX_FILE_MB * 1024 * 1024,
    );
    expect(getMenuImportMaxFileBytes("8")).toBe(8 * 1024 * 1024);
    expect(getMenuImportMaxFileBytes("500")).toBe(50 * 1024 * 1024);
  });

  it("supports multiple browse/drop uploads, progress, preview, replace, and delete", () => {
    expect(uploadStep).toContain("multiple");
    expect(uploadStep).toContain("onDrop={handleDrop}");
    expect(uploadStep).toContain("Choose Menu");
    expect(uploadStep).toContain('role="progressbar"');
    expect(uploadStep).toContain("Preview");
    expect(uploadStep).toContain("Replace");
    expect(uploadStep).toContain("Delete");
    expect(uploadService).toContain('request.upload.addEventListener("progress"');
    expect(uploadService).toContain(".createSignedUrl(");
  });

  it("stores private owner-scoped import drafts only", () => {
    expect(migration).toContain("create table if not exists public.menu_import_drafts");
    expect(migration).toContain("'menu-import-drafts'");
    expect(migration).toContain("false,");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain(
      "array['owner']::public.restaurant_staff_role[]",
    );
    expect(uploadService).toContain('.from("menu_import_drafts")');
    expect(uploadService).not.toMatch(
      /\.from\("(menu_items|categories|inventory_items|recipes|orders|payments)"\)/,
    );
  });

  it("keeps upload storage isolated while handing off to the existing review and publish flow", () => {
    expect(uploadStep).not.toMatch(/openai|anthropic|gemini|vision api|tesseract/i);
    expect(uploadService).not.toMatch(/generateImage|publishMenu/i);
    expect(wizard).toContain('mode="review"');
    expect(wizard).toContain('mode="preview"');
    expect(uploadStep).toContain("Start With Smart Starter Menu");
  });

  it("keeps the upload surface responsive and accessible", () => {
    expect(css).toContain("@media (max-width: 720px)");
    expect(css).toContain("@media (max-width: 420px)");
    expect(css).toContain("min-height: 44px");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(uploadStep).toContain('aria-live="polite"');
    expect(uploadStep).toContain('aria-label="Choose menu files to upload"');
  });
});
