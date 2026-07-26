import { memo, type ReactNode } from "react";
import {
  FONT_PRESETS,
  normalizeThemeCustomization,
  resolveThemeCustomization,
  type ThemeAnimationLevel,
  type ThemeButtonShape,
  type ThemeButtonStyle,
  type ThemeCardBorder,
  type ThemeCardImageSize,
  type ThemeCardRadius,
  type ThemeCardShadow,
  type ThemeColorMode,
  type ThemeCustomization,
  type ThemeHeroLayout,
} from "./themeCustomization";
import type { MenuTheme } from "../ThemeTypes";

type ThemeCustomizationPanelProps = {
  theme: MenuTheme;
  customization: ThemeCustomization;
  disabled?: boolean;
  onChange: (customization: ThemeCustomization) => void;
};

type Choice<T extends string> = {
  value: T;
  label: string;
};

function ControlSection({
  title,
  description,
  children,
  open = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details className="tcs-control-section" open={open}>
      <summary>
        <span>
          <strong>{title}</strong>
          <small>{description}</small>
        </span>
        <span aria-hidden="true">+</span>
      </summary>
      <div className="tcs-control-body">{children}</div>
    </details>
  );
}

function ChoiceGroup<T extends string>({
  label,
  value,
  choices,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  choices: readonly Choice<T>[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="tcs-choice-field">
      <legend>{label}</legend>
      <div className="tcs-choice-row">
        {choices.map((choice) => (
          <label
            className={value === choice.value ? "selected" : ""}
            key={choice.value}
          >
            <input
              type="radio"
              checked={value === choice.value}
              disabled={disabled}
              onChange={() => onChange(choice.value)}
            />
            <span>{choice.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function RangeControl({
  label,
  value,
  minimum,
  maximum,
  step = 1,
  suffix = "px",
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="tcs-range-control">
      <span>
        <strong>{label}</strong>
        <output>
          {value}
          {suffix}
        </output>
      </span>
      <input
        type="range"
        min={minimum}
        max={maximum}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

const HERO_CHOICES: readonly Choice<ThemeHeroLayout>[] = [
  { value: "large", label: "Large" },
  { value: "medium", label: "Medium" },
  { value: "compact", label: "Compact" },
];

const RADIUS_CHOICES: readonly Choice<ThemeCardRadius>[] = [
  { value: "rounded", label: "Rounded" },
  { value: "soft_rounded", label: "Soft Rounded" },
  { value: "square", label: "Square" },
];

const SHADOW_CHOICES: readonly Choice<ThemeCardShadow>[] = [
  { value: "shadow", label: "Shadow" },
  { value: "shadowless", label: "Shadowless" },
];

const IMAGE_CHOICES: readonly Choice<ThemeCardImageSize>[] = [
  { value: "large", label: "Large Image" },
  { value: "medium", label: "Medium Image" },
  { value: "small", label: "Small Image" },
];

const BORDER_CHOICES: readonly Choice<ThemeCardBorder>[] = [
  { value: "minimal", label: "Minimal" },
  { value: "elevated", label: "Elevated" },
  { value: "outline", label: "Outline" },
];

const BUTTON_STYLE_CHOICES: readonly Choice<ThemeButtonStyle>[] = [
  { value: "filled", label: "Filled" },
  { value: "outline", label: "Outline" },
];

const BUTTON_SHAPE_CHOICES: readonly Choice<ThemeButtonShape>[] = [
  { value: "rounded", label: "Rounded" },
  { value: "pill", label: "Pill" },
  { value: "square", label: "Square" },
];

const ANIMATION_CHOICES: readonly Choice<ThemeAnimationLevel>[] = [
  { value: "off", label: "Off" },
  { value: "minimal", label: "Minimal" },
  { value: "standard", label: "Standard" },
  { value: "premium", label: "Premium" },
];

const MODE_CHOICES: readonly Choice<ThemeColorMode>[] = [
  { value: "auto", label: "Auto" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

export const ThemeCustomizationPanel = memo(
  function ThemeCustomizationPanel({
    theme,
    customization,
    disabled = false,
    onChange,
  }: ThemeCustomizationPanelProps) {
    const effective = resolveThemeCustomization(theme, customization);

    function updateSection(
      section:
        | "branding"
        | "typography"
        | "card"
        | "buttons"
        | "spacing",
      patch: Record<string, unknown>,
    ) {
      onChange(
        normalizeThemeCustomization({
          ...customization,
          [section]: {
            ...(customization[section] ?? {}),
            ...patch,
          },
        }),
      );
    }

    function updateRoot(
      key: "heroLayout" | "animation" | "colorMode",
      value: string,
    ) {
      onChange(
        normalizeThemeCustomization({ ...customization, [key]: value }),
      );
    }

    return (
      <aside className="tcs-customization-panel" aria-label="Theme controls">
        <ControlSection
          title="Branding"
          description="Images and restaurant colors"
          open
        >
          <div className="tcs-field-grid">
            <label className="wide">
              <span>Restaurant Logo URL</span>
              <input
                type="url"
                value={customization.branding?.logoUrl ?? ""}
                placeholder="Use the restaurant logo"
                disabled={disabled}
                onChange={(event) =>
                  updateSection("branding", { logoUrl: event.target.value })
                }
              />
            </label>
            <label className="wide">
              <span>Cover Image URL</span>
              <input
                type="url"
                value={customization.branding?.coverUrl ?? ""}
                placeholder="Use the restaurant cover"
                disabled={disabled}
                onChange={(event) =>
                  updateSection("branding", { coverUrl: event.target.value })
                }
              />
            </label>
            <label className="wide">
              <span>Background Image URL</span>
              <input
                type="url"
                value={customization.branding?.backgroundImageUrl ?? ""}
                placeholder="Optional"
                disabled={disabled}
                onChange={(event) =>
                  updateSection("branding", {
                    backgroundImageUrl: event.target.value,
                  })
                }
              />
            </label>
            <label>
              <span>Accent Color</span>
              <input
                type="color"
                value={effective.branding.accentColor}
                disabled={disabled}
                onChange={(event) =>
                  updateSection("branding", {
                    accentColor: event.target.value,
                  })
                }
              />
            </label>
            <label>
              <span>Secondary Color</span>
              <input
                type="color"
                value={effective.branding.secondaryColor}
                disabled={disabled}
                onChange={(event) =>
                  updateSection("branding", {
                    secondaryColor: event.target.value,
                  })
                }
              />
            </label>
          </div>
          <div
            className="tcs-brand-color-preview"
            aria-label="Brand color preview"
          >
            <span style={{ background: effective.branding.accentColor }} />
            <span style={{ background: effective.branding.secondaryColor }} />
            <strong>Brand Color Preview</strong>
          </div>
        </ControlSection>

        <ControlSection
          title="Typography"
          description="Fonts, size, spacing, and weight"
        >
          <div className="tcs-field-grid">
            <label>
              <span>Heading Font</span>
              <select
                value={effective.typography.headingFont}
                disabled={disabled}
                onChange={(event) =>
                  updateSection("typography", {
                    headingFont: event.target.value,
                  })
                }
              >
                {FONT_PRESETS.map((preset) => (
                  <option value={preset.id} key={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Body Font</span>
              <select
                value={effective.typography.bodyFont}
                disabled={disabled}
                onChange={(event) =>
                  updateSection("typography", {
                    bodyFont: event.target.value,
                  })
                }
              >
                {FONT_PRESETS.map((preset) => (
                  <option value={preset.id} key={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <RangeControl
            label="Font Size"
            value={effective.typography.fontSize}
            minimum={13}
            maximum={20}
            disabled={disabled}
            onChange={(value) =>
              updateSection("typography", { fontSize: value })
            }
          />
          <RangeControl
            label="Letter Spacing"
            value={effective.typography.letterSpacing}
            minimum={-1}
            maximum={3}
            step={0.1}
            disabled={disabled}
            onChange={(value) =>
              updateSection("typography", { letterSpacing: value })
            }
          />
          <div className="tcs-field-grid">
            <label>
              <span>Heading Weight</span>
              <select
                value={effective.typography.headingWeight}
                disabled={disabled}
                onChange={(event) =>
                  updateSection("typography", {
                    headingWeight: Number(event.target.value),
                  })
                }
              >
                {[400, 500, 600, 700, 800, 900].map((weight) => (
                  <option value={weight} key={weight}>
                    {weight}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Body Weight</span>
              <select
                value={effective.typography.bodyWeight}
                disabled={disabled}
                onChange={(event) =>
                  updateSection("typography", {
                    bodyWeight: Number(event.target.value),
                  })
                }
              >
                {[400, 500, 600, 700, 800, 900].map((weight) => (
                  <option value={weight} key={weight}>
                    {weight}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </ControlSection>

        <ControlSection
          title="Hero Layout"
          description="Choose the menu header size"
        >
          <ChoiceGroup
            label="Hero size"
            value={effective.heroLayout}
            choices={HERO_CHOICES}
            disabled={disabled}
            onChange={(value) => updateRoot("heroLayout", value)}
          />
        </ControlSection>

        <ControlSection
          title="Food Cards"
          description="Shape, depth, image, and border"
        >
          <ChoiceGroup
            label="Corner style"
            value={effective.card.radius}
            choices={RADIUS_CHOICES}
            disabled={disabled}
            onChange={(value) => updateSection("card", { radius: value })}
          />
          <ChoiceGroup
            label="Shadow"
            value={effective.card.shadow}
            choices={SHADOW_CHOICES}
            disabled={disabled}
            onChange={(value) => updateSection("card", { shadow: value })}
          />
          <ChoiceGroup
            label="Image size"
            value={effective.card.imageSize}
            choices={IMAGE_CHOICES}
            disabled={disabled}
            onChange={(value) => updateSection("card", { imageSize: value })}
          />
          <ChoiceGroup
            label="Card border"
            value={effective.card.border}
            choices={BORDER_CHOICES}
            disabled={disabled}
            onChange={(value) => updateSection("card", { border: value })}
          />
        </ControlSection>

        <ControlSection
          title="Buttons"
          description="Fill, shape, color, and hover preview"
        >
          <ChoiceGroup
            label="Button style"
            value={effective.buttons.style}
            choices={BUTTON_STYLE_CHOICES}
            disabled={disabled}
            onChange={(value) => updateSection("buttons", { style: value })}
          />
          <ChoiceGroup
            label="Button shape"
            value={effective.buttons.shape}
            choices={BUTTON_SHAPE_CHOICES}
            disabled={disabled}
            onChange={(value) => updateSection("buttons", { shape: value })}
          />
          <label className="tcs-color-control">
            <span>Button Accent Color</span>
            <input
              type="color"
              value={effective.buttons.accentColor}
              disabled={disabled}
              onChange={(event) =>
                updateSection("buttons", {
                  accentColor: event.target.value,
                })
              }
            />
          </label>
          <button
            className="tcs-hover-preview"
            type="button"
            disabled={disabled}
            style={{
              background:
                effective.buttons.style === "filled"
                  ? effective.buttons.accentColor
                  : "transparent",
              borderColor: effective.buttons.accentColor,
              color:
                effective.buttons.style === "filled"
                  ? "#ffffff"
                  : effective.buttons.accentColor,
              borderRadius:
                effective.buttons.shape === "pill"
                  ? "999px"
                  : effective.buttons.shape === "square"
                    ? "0"
                    : "13px",
            }}
          >
            Hover Preview
          </button>
        </ControlSection>

        <ControlSection
          title="Spacing"
          description="Tune whitespace throughout the menu"
        >
          <RangeControl
            label="Card Spacing"
            value={effective.spacing.card}
            minimum={6}
            maximum={40}
            disabled={disabled}
            onChange={(value) => updateSection("spacing", { card: value })}
          />
          <RangeControl
            label="Section Spacing"
            value={effective.spacing.section}
            minimum={12}
            maximum={72}
            disabled={disabled}
            onChange={(value) => updateSection("spacing", { section: value })}
          />
          <RangeControl
            label="Header Spacing"
            value={effective.spacing.header}
            minimum={8}
            maximum={56}
            disabled={disabled}
            onChange={(value) => updateSection("spacing", { header: value })}
          />
          <RangeControl
            label="Image Spacing"
            value={effective.spacing.image}
            minimum={0}
            maximum={32}
            disabled={disabled}
            onChange={(value) => updateSection("spacing", { image: value })}
          />
        </ControlSection>

        <ControlSection
          title="Animations"
          description="Motion intensity with reduced-motion support"
        >
          <ChoiceGroup
            label="Animation level"
            value={effective.animation}
            choices={ANIMATION_CHOICES}
            disabled={disabled}
            onChange={(value) => updateRoot("animation", value)}
          />
        </ControlSection>

        <ControlSection
          title="Dark / Light"
          description="Choose how supported themes render"
        >
          <ChoiceGroup
            label="Color mode"
            value={effective.colorMode}
            choices={MODE_CHOICES}
            disabled={disabled}
            onChange={(value) => updateRoot("colorMode", value)}
          />
        </ControlSection>
      </aside>
    );
  },
);
