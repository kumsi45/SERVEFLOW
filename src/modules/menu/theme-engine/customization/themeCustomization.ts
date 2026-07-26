import { createContext, useContext, type CSSProperties } from "react";
import type { Restaurant } from "../../../qr-menu/types";
import type { MenuTheme } from "../ThemeTypes";

export const THEME_CUSTOMIZATION_VERSION = 1;
export const THEME_CUSTOMIZATION_CHANGED_EVENT =
  "serveflow:theme-customization-changed";

export const FONT_PRESETS = [
  {
    id: "modern_sans",
    label: "Modern Sans",
    stack:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  {
    id: "elegant_serif",
    label: "Elegant Serif",
    stack: 'Georgia, "Times New Roman", serif',
  },
  {
    id: "editorial_serif",
    label: "Editorial",
    stack: '"Iowan Old Style", "Palatino Linotype", Georgia, serif',
  },
  {
    id: "rounded_sans",
    label: "Rounded Sans",
    stack: '"Trebuchet MS", Avenir, ui-sans-serif, system-ui, sans-serif',
  },
] as const;

export type ThemeFontPreset = (typeof FONT_PRESETS)[number]["id"];
export type ThemeHeroLayout = "large" | "medium" | "compact";
export type ThemeCardRadius = "rounded" | "soft_rounded" | "square";
export type ThemeCardShadow = "shadow" | "shadowless";
export type ThemeCardImageSize = "large" | "medium" | "small";
export type ThemeCardBorder = "minimal" | "elevated" | "outline";
export type ThemeButtonStyle = "filled" | "outline";
export type ThemeButtonShape = "rounded" | "pill" | "square";
export type ThemeAnimationLevel = "off" | "minimal" | "standard" | "premium";
export type ThemeColorMode = "auto" | "dark" | "light";

export type ThemeCustomization = {
  branding?: {
    logoUrl?: string;
    coverUrl?: string;
    backgroundImageUrl?: string;
    accentColor?: string;
    secondaryColor?: string;
  };
  typography?: {
    headingFont?: ThemeFontPreset;
    bodyFont?: ThemeFontPreset;
    fontSize?: number;
    letterSpacing?: number;
    headingWeight?: number;
    bodyWeight?: number;
  };
  heroLayout?: ThemeHeroLayout;
  card?: {
    radius?: ThemeCardRadius;
    shadow?: ThemeCardShadow;
    imageSize?: ThemeCardImageSize;
    border?: ThemeCardBorder;
  };
  buttons?: {
    style?: ThemeButtonStyle;
    shape?: ThemeButtonShape;
    accentColor?: string;
  };
  spacing?: {
    card?: number;
    section?: number;
    header?: number;
    image?: number;
  };
  animation?: ThemeAnimationLevel;
  colorMode?: ThemeColorMode;
};

export type EffectiveThemeCustomization = {
  branding: {
    logoUrl: string;
    coverUrl: string;
    backgroundImageUrl: string;
    accentColor: string;
    secondaryColor: string;
  };
  typography: {
    headingFont: ThemeFontPreset;
    bodyFont: ThemeFontPreset;
    fontSize: number;
    letterSpacing: number;
    headingWeight: number;
    bodyWeight: number;
  };
  heroLayout: ThemeHeroLayout;
  card: {
    radius: ThemeCardRadius;
    shadow: ThemeCardShadow;
    imageSize: ThemeCardImageSize;
    border: ThemeCardBorder;
  };
  buttons: {
    style: ThemeButtonStyle;
    shape: ThemeButtonShape;
    accentColor: string;
  };
  spacing: {
    card: number;
    section: number;
    header: number;
    image: number;
  };
  animation: ThemeAnimationLevel;
  colorMode: ThemeColorMode;
};

export type StoredThemeCustomization = {
  version: typeof THEME_CUSTOMIZATION_VERSION;
  published: ThemeCustomization;
  published_at: string;
};

export type ThemeCustomizationChangedDetail = {
  restaurantId: string;
  theme: MenuTheme;
  customization: ThemeCustomization;
};

type ThemeCustomizationContextValue = {
  customization: ThemeCustomization;
  effective: EffectiveThemeCustomization;
};

const EMPTY_CUSTOMIZATION: ThemeCustomization = Object.freeze({});

export const ThemeCustomizationContext =
  createContext<ThemeCustomizationContextValue | null>(null);

export function useThemeCustomization() {
  return (
    useContext(ThemeCustomizationContext) ?? {
      customization: EMPTY_CUSTOMIZATION,
      effective: getThemeCustomizationDefaults("modern"),
    }
  );
}

const THEME_DEFAULTS: Record<MenuTheme, EffectiveThemeCustomization> = {
  modern: {
    branding: {
      logoUrl: "",
      coverUrl: "",
      backgroundImageUrl: "",
      accentColor: "#f4511e",
      secondaryColor: "#2437d9",
    },
    typography: {
      headingFont: "modern_sans",
      bodyFont: "modern_sans",
      fontSize: 14,
      letterSpacing: 0,
      headingWeight: 800,
      bodyWeight: 500,
    },
    heroLayout: "medium",
    card: {
      radius: "rounded",
      shadow: "shadow",
      imageSize: "large",
      border: "minimal",
    },
    buttons: {
      style: "filled",
      shape: "pill",
      accentColor: "#f4511e",
    },
    spacing: { card: 12, section: 34, header: 18, image: 10 },
    animation: "standard",
    colorMode: "light",
  },
  luxury: {
    branding: {
      logoUrl: "",
      coverUrl: "",
      backgroundImageUrl: "",
      accentColor: "#d7b56d",
      secondaryColor: "#ead49c",
    },
    typography: {
      headingFont: "elegant_serif",
      bodyFont: "modern_sans",
      fontSize: 14,
      letterSpacing: 0.2,
      headingWeight: 500,
      bodyWeight: 500,
    },
    heroLayout: "large",
    card: {
      radius: "rounded",
      shadow: "shadow",
      imageSize: "large",
      border: "outline",
    },
    buttons: {
      style: "filled",
      shape: "pill",
      accentColor: "#d7b56d",
    },
    spacing: { card: 13, section: 34, header: 24, image: 10 },
    animation: "premium",
    colorMode: "dark",
  },
  premium_grid: {
    branding: {
      logoUrl: "",
      coverUrl: "",
      backgroundImageUrl: "",
      accentColor: "#68150f",
      secondaryColor: "#d6ae58",
    },
    typography: {
      headingFont: "modern_sans",
      bodyFont: "modern_sans",
      fontSize: 14,
      letterSpacing: 0,
      headingWeight: 800,
      bodyWeight: 500,
    },
    heroLayout: "medium",
    card: {
      radius: "rounded",
      shadow: "shadow",
      imageSize: "large",
      border: "minimal",
    },
    buttons: {
      style: "filled",
      shape: "rounded",
      accentColor: "#68150f",
    },
    spacing: { card: 13, section: 30, header: 22, image: 10 },
    animation: "standard",
    colorMode: "light",
  },
  coffee: {
    branding: {
      logoUrl: "",
      coverUrl: "",
      backgroundImageUrl: "",
      accentColor: "#493426",
      secondaryColor: "#aa7541",
    },
    typography: {
      headingFont: "elegant_serif",
      bodyFont: "modern_sans",
      fontSize: 14,
      letterSpacing: 0,
      headingWeight: 500,
      bodyWeight: 500,
    },
    heroLayout: "compact",
    card: {
      radius: "soft_rounded",
      shadow: "shadow",
      imageSize: "large",
      border: "minimal",
    },
    buttons: {
      style: "filled",
      shape: "rounded",
      accentColor: "#493426",
    },
    spacing: { card: 15, section: 28, header: 20, image: 10 },
    animation: "standard",
    colorMode: "light",
  },
};

const FONT_IDS = new Set(FONT_PRESETS.map((preset) => preset.id));
const HERO_LAYOUTS = new Set<ThemeHeroLayout>(["large", "medium", "compact"]);
const CARD_RADII = new Set<ThemeCardRadius>([
  "rounded",
  "soft_rounded",
  "square",
]);
const CARD_SHADOWS = new Set<ThemeCardShadow>(["shadow", "shadowless"]);
const IMAGE_SIZES = new Set<ThemeCardImageSize>(["large", "medium", "small"]);
const CARD_BORDERS = new Set<ThemeCardBorder>([
  "minimal",
  "elevated",
  "outline",
]);
const BUTTON_STYLES = new Set<ThemeButtonStyle>(["filled", "outline"]);
const BUTTON_SHAPES = new Set<ThemeButtonShape>([
  "rounded",
  "pill",
  "square",
]);
const ANIMATIONS = new Set<ThemeAnimationLevel>([
  "off",
  "minimal",
  "standard",
  "premium",
]);
const COLOR_MODES = new Set<ThemeColorMode>(["auto", "dark", "light"]);
const WEIGHTS = new Set([400, 500, 600, 700, 800, 900]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalString(value: unknown, maxLength = 2048) {
  return typeof value === "string" && value.length <= maxLength
    ? value.trim()
    : undefined;
}

function optionalColor(value: unknown) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : undefined;
}

function optionalNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  allowed?: ReadonlySet<number>,
) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum &&
    (!allowed || allowed.has(value))
    ? value
    : undefined;
}

function withoutEmptySections(
  customization: ThemeCustomization,
): ThemeCustomization {
  return Object.fromEntries(
    Object.entries(customization).filter(([, value]) => {
      if (value === undefined) return false;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return Object.keys(value).length > 0;
      }
      return true;
    }),
  ) as ThemeCustomization;
}

function defined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

export function normalizeThemeCustomization(
  value: unknown,
): ThemeCustomization {
  const source = record(value);
  const branding = record(source.branding);
  const typography = record(source.typography);
  const card = record(source.card);
  const buttons = record(source.buttons);
  const spacing = record(source.spacing);

  const headingFont = FONT_IDS.has(typography.headingFont as ThemeFontPreset)
    ? (typography.headingFont as ThemeFontPreset)
    : undefined;
  const bodyFont = FONT_IDS.has(typography.bodyFont as ThemeFontPreset)
    ? (typography.bodyFont as ThemeFontPreset)
    : undefined;

  return withoutEmptySections({
    branding: defined({
      logoUrl: optionalString(branding.logoUrl),
      coverUrl: optionalString(branding.coverUrl),
      backgroundImageUrl: optionalString(branding.backgroundImageUrl),
      accentColor: optionalColor(branding.accentColor),
      secondaryColor: optionalColor(branding.secondaryColor),
    }),
    typography: defined({
      headingFont,
      bodyFont,
      fontSize: optionalNumber(typography.fontSize, 13, 20),
      letterSpacing: optionalNumber(typography.letterSpacing, -1, 3),
      headingWeight: optionalNumber(
        typography.headingWeight,
        400,
        900,
        WEIGHTS,
      ),
      bodyWeight: optionalNumber(
        typography.bodyWeight,
        400,
        900,
        WEIGHTS,
      ),
    }),
    heroLayout: HERO_LAYOUTS.has(source.heroLayout as ThemeHeroLayout)
      ? (source.heroLayout as ThemeHeroLayout)
      : undefined,
    card: defined({
      radius: CARD_RADII.has(card.radius as ThemeCardRadius)
        ? (card.radius as ThemeCardRadius)
        : undefined,
      shadow: CARD_SHADOWS.has(card.shadow as ThemeCardShadow)
        ? (card.shadow as ThemeCardShadow)
        : undefined,
      imageSize: IMAGE_SIZES.has(card.imageSize as ThemeCardImageSize)
        ? (card.imageSize as ThemeCardImageSize)
        : undefined,
      border: CARD_BORDERS.has(card.border as ThemeCardBorder)
        ? (card.border as ThemeCardBorder)
        : undefined,
    }),
    buttons: defined({
      style: BUTTON_STYLES.has(buttons.style as ThemeButtonStyle)
        ? (buttons.style as ThemeButtonStyle)
        : undefined,
      shape: BUTTON_SHAPES.has(buttons.shape as ThemeButtonShape)
        ? (buttons.shape as ThemeButtonShape)
        : undefined,
      accentColor: optionalColor(buttons.accentColor),
    }),
    spacing: defined({
      card: optionalNumber(spacing.card, 6, 40),
      section: optionalNumber(spacing.section, 12, 72),
      header: optionalNumber(spacing.header, 8, 56),
      image: optionalNumber(spacing.image, 0, 32),
    }),
    animation: ANIMATIONS.has(source.animation as ThemeAnimationLevel)
      ? (source.animation as ThemeAnimationLevel)
      : undefined,
    colorMode: COLOR_MODES.has(source.colorMode as ThemeColorMode)
      ? (source.colorMode as ThemeColorMode)
      : undefined,
  });
}

export function getThemeCustomizationDefaults(
  theme: MenuTheme,
): EffectiveThemeCustomization {
  return structuredClone(THEME_DEFAULTS[theme]);
}

export function resolveThemeCustomization(
  theme: MenuTheme,
  customization: ThemeCustomization,
): EffectiveThemeCustomization {
  const defaults = getThemeCustomizationDefaults(theme);
  return {
    branding: { ...defaults.branding, ...customization.branding },
    typography: { ...defaults.typography, ...customization.typography },
    heroLayout: customization.heroLayout ?? defaults.heroLayout,
    card: { ...defaults.card, ...customization.card },
    buttons: { ...defaults.buttons, ...customization.buttons },
    spacing: { ...defaults.spacing, ...customization.spacing },
    animation: customization.animation ?? defaults.animation,
    colorMode: customization.colorMode ?? defaults.colorMode,
  };
}

export function readThemeCustomization(
  orderingSettings: Record<string, unknown> | null | undefined,
): ThemeCustomization {
  const stored = record(orderingSettings?.theme_customization);
  return normalizeThemeCustomization(stored.published ?? stored);
}

export function createStoredThemeCustomization(
  customization: ThemeCustomization,
  publishedAt = new Date().toISOString(),
): StoredThemeCustomization {
  return {
    version: THEME_CUSTOMIZATION_VERSION,
    published: normalizeThemeCustomization(customization),
    published_at: publishedAt,
  };
}

export function hasThemeCustomization(
  customization: ThemeCustomization,
): boolean {
  return Object.keys(normalizeThemeCustomization(customization)).length > 0;
}

function fontStack(preset: ThemeFontPreset) {
  return (
    FONT_PRESETS.find((candidate) => candidate.id === preset)?.stack ??
    FONT_PRESETS[0].stack
  );
}

function contrastColor(hex: string) {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  const luminance =
    (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.58 ? "#241c16" : "#ffffff";
}

export type ThemeCustomizationSurface = {
  className: string;
  style: CSSProperties;
  attributes: Record<string, string | undefined>;
};

export function buildThemeCustomizationSurface(
  theme: MenuTheme,
  customization: ThemeCustomization,
): ThemeCustomizationSurface {
  const normalized = normalizeThemeCustomization(customization);
  const effective = resolveThemeCustomization(theme, normalized);
  const customized = hasThemeCustomization(normalized);
  const style = {
    "--theme-accent": effective.branding.accentColor,
    "--theme-accent-contrast": contrastColor(effective.branding.accentColor),
    "--theme-secondary": effective.branding.secondaryColor,
    "--theme-button-accent":
      effective.buttons.accentColor || effective.branding.accentColor,
    "--theme-button-contrast": contrastColor(
      effective.buttons.accentColor || effective.branding.accentColor,
    ),
    "--theme-heading-font": fontStack(effective.typography.headingFont),
    "--theme-body-font": fontStack(effective.typography.bodyFont),
    "--theme-body-size": `${effective.typography.fontSize}px`,
    "--theme-letter-spacing": `${effective.typography.letterSpacing}px`,
    "--theme-heading-weight": String(effective.typography.headingWeight),
    "--theme-body-weight": String(effective.typography.bodyWeight),
    "--theme-card-spacing": `${effective.spacing.card}px`,
    "--theme-section-spacing": `${effective.spacing.section}px`,
    "--theme-header-spacing": `${effective.spacing.header}px`,
    "--theme-image-spacing": `${effective.spacing.image}px`,
    "--theme-background-image": effective.branding.backgroundImageUrl
      ? `url(${JSON.stringify(effective.branding.backgroundImageUrl)})`
      : undefined,
  } as CSSProperties;

  return {
    className: `theme-customization-surface theme-customization-${theme}`,
    style,
    attributes: {
      "data-theme-customized": customized ? "true" : undefined,
      "data-hero-layout": customized ? effective.heroLayout : undefined,
      "data-card-radius": customized ? effective.card.radius : undefined,
      "data-card-shadow": customized ? effective.card.shadow : undefined,
      "data-card-image": customized ? effective.card.imageSize : undefined,
      "data-card-border": customized ? effective.card.border : undefined,
      "data-button-style": customized ? effective.buttons.style : undefined,
      "data-button-shape": customized ? effective.buttons.shape : undefined,
      "data-animation": customized ? effective.animation : undefined,
      "data-color-mode": customized ? effective.colorMode : undefined,
    },
  };
}

export function applyThemeBranding(
  restaurant: Restaurant,
  customization: ThemeCustomization,
): Restaurant {
  const branding = customization.branding;
  if (!branding || (!("logoUrl" in branding) && !("coverUrl" in branding))) {
    return restaurant;
  }
  return {
    ...restaurant,
    logo_url:
      "logoUrl" in branding ? branding.logoUrl?.trim() || null : restaurant.logo_url,
    cover_url:
      "coverUrl" in branding
        ? branding.coverUrl?.trim() || null
        : restaurant.cover_url,
  };
}

export const themeCustomizationStorageKey = (restaurantId: string) =>
  `serveflow.theme-customization:${restaurantId}`;

export const themeCustomizationDraftKey = (restaurantId: string) =>
  `serveflow.theme-customization-draft:${restaurantId}`;

export function publishThemeCustomizationSelection(
  restaurantId: string,
  theme: MenuTheme,
  customization: ThemeCustomization,
) {
  if (typeof window === "undefined" || !restaurantId) return;
  const detail: ThemeCustomizationChangedDetail = {
    restaurantId,
    theme,
    customization: normalizeThemeCustomization(customization),
  };
  try {
    window.localStorage.setItem(
      themeCustomizationStorageKey(restaurantId),
      JSON.stringify(detail),
    );
  } catch {
    // Live propagation should not make publishing fail when storage is blocked.
  }
  window.dispatchEvent(
    new CustomEvent<ThemeCustomizationChangedDetail>(
      THEME_CUSTOMIZATION_CHANGED_EVENT,
      { detail },
    ),
  );
}
