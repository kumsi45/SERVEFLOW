import { memo, useMemo } from "react";
import { useQRMenu } from "../../../qr-menu/hooks/useQRMenu";
import { ThemeProvider } from "../ThemeProvider";
import { ThemeRenderer } from "../ThemeRenderer";
import type { MenuTheme } from "../ThemeTypes";
import { ModernFoodView } from "../themes/modern/ModernFoodView";
import {
  createStoredThemeCustomization,
  type ThemeCustomization,
} from "./themeCustomization";

type ThemeLivePreviewProps = {
  restaurantSlug: string;
  theme: MenuTheme;
  customization: ThemeCustomization;
};

export const ThemeLivePreview = memo(function ThemeLivePreview({
  restaurantSlug,
  theme,
  customization,
}: ThemeLivePreviewProps) {
  const {
    restaurant,
    categories,
    groups,
    items,
    activeCategoryId,
    searchTerm,
    loading,
    error,
    setActiveCategoryId,
    setSearchTerm,
  } = useQRMenu(restaurantSlug);

  const previewRestaurant = useMemo(() => {
    if (!restaurant) return null;
    return {
      ...restaurant,
      menu_theme: theme,
      ordering_settings: {
        ...(restaurant.ordering_settings ?? {}),
        theme_customization:
          createStoredThemeCustomization(customization, "preview"),
      },
    };
  }, [customization, restaurant, theme]);

  if (loading) {
    return (
      <section className="theme-live-preview-state" role="status">
        <span aria-hidden="true" />
        <strong>Preparing live preview</strong>
        <p>Loading the restaurant’s current menu.</p>
      </section>
    );
  }

  if (error || !previewRestaurant) {
    return (
      <section className="theme-live-preview-state error" role="status">
        <strong>Preview unavailable</strong>
        <p>{error || "The restaurant menu could not be loaded."}</p>
      </section>
    );
  }

  return (
    <div className="theme-live-preview-viewport" aria-label="Live menu preview">
      <div className="theme-live-preview-canvas">
        <ThemeProvider restaurant={previewRestaurant}>
          <ThemeRenderer
            restaurant={previewRestaurant}
            categories={categories}
            menu={items}
            cart={{
              items: [],
              itemCount: 1,
              subtotal: 0,
              visible: false,
            }}
            order={{ activeSession: null, submittedOrder: null }}
            theme={theme}
          >
            <main className="qr-menu-page modern-food-page">
              <ModernFoodView
                restaurant={previewRestaurant}
                tableNumber="12"
                categories={categories}
                groups={groups}
                activeCategoryId={activeCategoryId}
                searchTerm={searchTerm}
                cartItemCount={1}
                cartSubtotal={0}
                hasActiveOrder={false}
                onSearchChange={setSearchTerm}
                onCategoryChange={setActiveCategoryId}
                onAddToCart={() => undefined}
                onOpenInfo={() => undefined}
                onOpenCart={() => undefined}
                onOpenOrders={() => undefined}
              />
            </main>
          </ThemeRenderer>
        </ThemeProvider>
      </div>
    </div>
  );
});
