export const MENU_LANGUAGES = ["en", "om", "am"] as const;

export type MenuLanguage = (typeof MENU_LANGUAGES)[number];
export type DetectedMenuLanguage = MenuLanguage | "mixed" | "unknown";

export const DEFAULT_MENU_LANGUAGE: MenuLanguage = "en";

export const MENU_LANGUAGE_OPTIONS: ReadonlyArray<{
  code: MenuLanguage;
  label: string;
  nativeLabel: string;
  htmlLang: string;
}> = [
  { code: "en", label: "English", nativeLabel: "English", htmlLang: "en" },
  {
    code: "om",
    label: "Afaan Oromoo",
    nativeLabel: "Afaan Oromoo",
    htmlLang: "om",
  },
  { code: "am", label: "Amharic", nativeLabel: "አማርኛ", htmlLang: "am" },
];

export type MenuLocalizationValue = {
  name?: string | null;
  description?: string | null;
  name_owner_edited?: boolean;
  description_owner_edited?: boolean;
};

export type MenuLocalizationMap = Partial<
  Record<MenuLanguage, MenuLocalizationValue>
>;

export function isMenuLanguage(value: unknown): value is MenuLanguage {
  return typeof value === "string"
    && MENU_LANGUAGES.includes(value as MenuLanguage);
}

export function normalizeDetectedMenuLanguage(
  value: unknown,
): DetectedMenuLanguage {
  if (isMenuLanguage(value) || value === "mixed" || value === "unknown") {
    return value;
  }
  return "unknown";
}

export function detectMenuTextScript(value: string | null) {
  const text = value?.trim() ?? "";
  if (!text) return "unknown" as const;
  const hasEthiopic = /[\u1200-\u137F]/u.test(text);
  const hasLatin = /[A-Za-z]/u.test(text);
  if (hasEthiopic && hasLatin) return "mixed" as const;
  if (hasEthiopic) return "am" as const;
  // English and Afaan Oromoo both use Latin script. They remain unknown
  // unless the extraction provider supplies a language classification.
  return "unknown" as const;
}

export function resolveLocalizedMenuText(
  localizations: MenuLocalizationMap | null | undefined,
  language: MenuLanguage,
  field: "name" | "description",
  sourceFallback: string | null | undefined,
) {
  const localized = localizations?.[language]?.[field];
  if (typeof localized === "string" && localized.trim()) return localized;
  return sourceFallback ?? "";
}

export function menuLanguageHtmlTag(language: MenuLanguage) {
  return MENU_LANGUAGE_OPTIONS.find((option) => option.code === language)
    ?.htmlLang ?? "en";
}

