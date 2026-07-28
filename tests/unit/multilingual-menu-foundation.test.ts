import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MENU_LANGUAGE,
  MENU_LANGUAGE_OPTIONS,
  detectMenuTextScript,
  resolveLocalizedMenuText,
} from "../../src/core/menu/menuLanguage";
import {
  createMenuReviewLocalization,
  resolveMenuReviewText,
} from "../../src/modules/setup-wizard/services/menuReviewState";
import { localizeMenuPresentation } from "../../src/modules/qr-menu/services/menuLocalization";
import type {
  MenuCategory,
  MenuItem,
} from "../../src/modules/qr-menu/types";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const extractionContract = read(
  "supabase/functions/menu-ocr-extract/contracts.ts",
);
const extractionProvider = read(
  "supabase/functions/menu-ocr-extract/providers/openai.ts",
);
const studio = read(
  "src/modules/setup-wizard/components/AiMenuReviewStudio.tsx",
);
const card = read(
  "src/modules/setup-wizard/components/AiMenuReviewItemCard.tsx",
);
const qrPage = read(
  "src/modules/qr-menu/pages/QRMenuPage.tsx",
);
const themeRenderer = read(
  "src/modules/menu/theme-engine/ThemeRenderer.tsx",
);
const themeTypes = read(
  "src/modules/menu/theme-engine/ThemeTypes.ts",
);
const customization = read(
  "src/modules/menu/theme-engine/customization/themeCustomization.ts",
);
const migration = read(
  "supabase/migrations/190_phase9_8_4_multilingual_menu_foundation.sql",
);

describe("Phase 9.8.4 multilingual menu foundation", () => {
  it("supports exactly English, Afaan Oromoo, and Amharic", () => {
    expect(MENU_LANGUAGE_OPTIONS.map((option) => option.code)).toEqual([
      "en",
      "om",
      "am",
    ]);
    expect(MENU_LANGUAGE_OPTIONS.map((option) => option.nativeLabel)).toEqual([
      "English",
      "Afaan Oromoo",
      "አማርኛ",
    ]);
    expect(DEFAULT_MENU_LANGUAGE).toBe("en");
  });

  it("preserves source text and populates only its detected language", () => {
    const amharic = { value: "ቁርስ", confidence: 0.99 };
    const amharicLocalization = createMenuReviewLocalization(amharic, {
      value: "am",
      confidence: 0.98,
    });
    expect(amharicLocalization.values.am.value).toBe("ቁርስ");
    expect(amharicLocalization.values.en.value).toBeNull();
    expect(amharicLocalization.values.om.value).toBeNull();
    expect(resolveMenuReviewText(amharic, amharicLocalization)).toBe("ቁርስ");

    const oromo = { value: "Buna", confidence: 0.97 };
    const oromoLocalization = createMenuReviewLocalization(oromo, {
      value: "om",
      confidence: 0.94,
    });
    expect(oromoLocalization.values.om.value).toBe("Buna");
    expect(oromoLocalization.values.en.value).toBeNull();
    expect(oromoLocalization.values.am.value).toBeNull();
  });

  it("detects Ethiopic and mixed scripts without guessing Latin language", () => {
    expect(detectMenuTextScript("ቁርስ")).toBe("am");
    expect(detectMenuTextScript("Breakfast ቁርስ")).toBe("mixed");
    expect(detectMenuTextScript("Buna")).toBe("unknown");
  });

  it("makes extraction language-aware without translation instructions", () => {
    for (const field of [
      "restaurantNameLanguage",
      "categoryLanguage",
      "nameLanguage",
      "descriptionLanguage",
      "optionalNotesLanguage",
    ]) {
      expect(extractionContract).toContain(field);
    }
    expect(extractionContract).toContain('"mixed"');
    expect(extractionProvider).toContain(
      "Do not infer, complete, translate, transliterate",
    );
    expect(extractionProvider).toContain(
      "Language classification must never change or replace the extracted text",
    );
    expect(extractionProvider).not.toMatch(
      /Google Translate|DeepL|translate into|translated output/i,
    );
  });

  it("provides language tabs and owner-edit protection in Review Studio", () => {
    expect(card).toContain("MENU_LANGUAGE_OPTIONS");
    expect(card).toContain("Not translated yet.");
    expect(card).toContain("Source preserved");
    expect(studio).toContain("ownerEdited");
    expect(studio).toContain("CategoryLocalizedEditor");
    expect(studio).toContain("New category language");
    expect(studio).toContain("Read-only draft access");
  });

  it("resolves multilingual presentation without duplicating canonical items", () => {
    const category: MenuCategory = {
      id: "category-1",
      restaurant_id: "restaurant-1",
      name: "Breakfast",
      localizations: {
        am: { name: "ቁርስ", description: null },
      },
    };
    const item: MenuItem = {
      id: "item-1",
      restaurant_id: "restaurant-1",
      category_id: "category-1",
      name: "Coffee",
      description: "Hot drink",
      price: 50,
      available: true,
      localizations: {
        am: { name: "ቡና", description: "ትኩስ መጠጥ" },
      },
    };
    const localized = localizeMenuPresentation([category], [item], "am");
    expect(localized.categories).toHaveLength(1);
    expect(localized.items).toHaveLength(1);
    expect(localized.categories[0].id).toBe(category.id);
    expect(localized.items[0].id).toBe(item.id);
    expect(localized.categories[0].name).toBe("ቁርስ");
    expect(localized.items[0].name).toBe("ቡና");
    expect(resolveLocalizedMenuText(item.localizations, "om", "name", item.name))
      .toBe("Coffee");
  });

  it("provides one persisted QR/theme language boundary", () => {
    expect(qrPage).toContain("MENU_LANGUAGE_OPTIONS.map");
    expect(qrPage).toContain("setMenuLanguage(option.code)");
    expect(qrPage).toContain("language={menuLanguage}");
    expect(qrPage).not.toMatch(/Google Translate/i);
    expect(themeTypes).toContain("language?: MenuLanguage");
    expect(themeRenderer).toContain("data-menu-language");
    expect(themeRenderer).toContain("menuLanguageHtmlTag");
    expect(customization).not.toMatch(
      /menuLanguage|translation|localization/i,
    );
  });

  it("creates normalized localization tables with future empty-only safeguards", () => {
    expect(migration).toContain(
      "create table if not exists public.menu_item_localizations",
    );
    expect(migration).toContain(
      "primary key (menu_item_id, language)",
    );
    expect(migration).toContain(
      "create table if not exists public.menu_category_localizations",
    );
    expect(migration).toContain("name_owner_edited boolean");
    expect(migration).toContain("description_owner_edited boolean");
    expect(migration).toContain("'ai_translation'");
    expect(migration).toContain("'localizations'");
    expect(migration).not.toMatch(
      /insert into public\.(menu_items|categories|recipes|inventory_items|orders|payments)/i,
    );
  });
});
