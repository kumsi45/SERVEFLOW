import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_MENU_LANGUAGE,
  type MenuLanguage,
} from "../../../core/menu/menuLanguage";
import { fetchQRMenuData } from "../services/qrMenuService";
import { filterMenuItems, groupMenuItemsByCategory } from "../services/menuGrouping";
import { localizeMenuPresentation } from "../services/menuLocalization";
import type { MenuCategory, MenuGroup, MenuItem, Restaurant } from "../types";

type QRMenuState = {
  restaurant: Restaurant | null;
  categories: MenuCategory[];
  items: MenuItem[];
  loading: boolean;
  error: string | null;
};

export function useQRMenu(
  restaurantSlug: string,
  language: MenuLanguage = DEFAULT_MENU_LANGUAGE,
) {
  const [state, setState] = useState<QRMenuState>({
    restaurant: null,
    categories: [],
    items: [],
    loading: true,
    error: null,
  });
  const [activeCategoryId, setActiveCategoryId] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    let active = true;

    setState((current) => ({ ...current, loading: true, error: null }));

    fetchQRMenuData(restaurantSlug)
      .then((data) => {
        if (!active) {
          return;
        }

        setState({
          restaurant: data.restaurant,
          categories: data.categories,
          items: data.items,
          loading: false,
          error: null,
        });
      })
      .catch((error: Error) => {
        if (!active) {
          return;
        }

        setState({
          restaurant: null,
          categories: [],
          items: [],
          loading: false,
          error: error.message,
        });
      });

    return () => {
      active = false;
    };
  }, [restaurantSlug]);

  const localized = useMemo(
    () => localizeMenuPresentation(state.categories, state.items, language),
    [language, state.categories, state.items],
  );

  const visibleItems = useMemo(
    () => filterMenuItems(localized.items, searchTerm, activeCategoryId),
    [activeCategoryId, localized.items, searchTerm]
  );

  const groups: MenuGroup[] = useMemo(
    () => groupMenuItemsByCategory(localized.categories, visibleItems),
    [localized.categories, visibleItems]
  );

  return {
    ...state,
    categories: localized.categories,
    items: localized.items,
    groups,
    language,
    activeCategoryId,
    searchTerm,
    setActiveCategoryId,
    setSearchTerm,
  };
}
