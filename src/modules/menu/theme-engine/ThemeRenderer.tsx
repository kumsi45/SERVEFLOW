import { useEffect, useMemo, useState } from "react";
import { useMenuTheme } from "./hooks/useMenuTheme";
import {
  buildThemeCustomizationSurface,
  normalizeThemeCustomization,
  readThemeCustomization,
  resolveThemeCustomization,
  THEME_CUSTOMIZATION_CHANGED_EVENT,
  themeCustomizationStorageKey,
  ThemeCustomizationContext,
  type ThemeCustomization,
  type ThemeCustomizationChangedDetail,
} from "./customization/themeCustomization";
import type { ThemeRendererProps } from "./ThemeTypes";
import "./customization/themeCustomization.css";

export function ThemeRenderer(props: ThemeRendererProps) {
  const { theme, definition } = useMenuTheme();
  const Component = definition.component;
  const persistedCustomization = useMemo(
    () => readThemeCustomization(props.restaurant.ordering_settings),
    [props.restaurant.id, props.restaurant.ordering_settings],
  );
  const [customization, setCustomization] = useState<ThemeCustomization>(
    persistedCustomization,
  );

  useEffect(() => {
    setCustomization(persistedCustomization);
  }, [persistedCustomization]);

  useEffect(() => {
    const handleCustomization = (event: Event) => {
      const detail = (
        event as CustomEvent<ThemeCustomizationChangedDetail>
      ).detail;
      if (detail?.restaurantId === props.restaurant.id) {
        setCustomization(normalizeThemeCustomization(detail.customization));
      }
    };
    const handleStorage = (event: StorageEvent) => {
      if (
        event.key !== themeCustomizationStorageKey(props.restaurant.id) ||
        !event.newValue
      ) {
        return;
      }
      try {
        const detail = JSON.parse(
          event.newValue,
        ) as ThemeCustomizationChangedDetail;
        if (detail.restaurantId === props.restaurant.id) {
          setCustomization(normalizeThemeCustomization(detail.customization));
        }
      } catch {
        // Ignore malformed cross-tab presentation updates.
      }
    };
    window.addEventListener(
      THEME_CUSTOMIZATION_CHANGED_EVENT,
      handleCustomization,
    );
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(
        THEME_CUSTOMIZATION_CHANGED_EVENT,
        handleCustomization,
      );
      window.removeEventListener("storage", handleStorage);
    };
  }, [props.restaurant.id]);

  const surface = useMemo(
    () => buildThemeCustomizationSurface(theme, customization),
    [customization, theme],
  );
  const contextValue = useMemo(
    () => ({
      customization,
      effective: resolveThemeCustomization(theme, customization),
    }),
    [customization, theme],
  );

  return (
    <ThemeCustomizationContext.Provider value={contextValue}>
      <div
        className={surface.className}
        style={surface.style}
        {...surface.attributes}
      >
        <Component {...props} theme={theme} />
      </div>
    </ThemeCustomizationContext.Provider>
  );
}
