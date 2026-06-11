import { useEffect, useMemo, useState } from "react";
import { fetchQRMenuData } from "../services/qrMenuService";
import { filterMenuItems, groupMenuItemsByCategory } from "../services/menuGrouping";
import type { MenuCategory, MenuGroup, MenuItem, Restaurant } from "../types";

type QRMenuState = {
  restaurant: Restaurant | null;
  categories: MenuCategory[];
  items: MenuItem[];
  loading: boolean;
  error: string | null;
};

export function useQRMenu(restaurantSlug: string) {
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

  const visibleItems = useMemo(
    () => filterMenuItems(state.items, searchTerm, activeCategoryId),
    [activeCategoryId, searchTerm, state.items]
  );

  const groups: MenuGroup[] = useMemo(
    () => groupMenuItemsByCategory(state.categories, visibleItems),
    [state.categories, visibleItems]
  );

  return {
    ...state,
    groups,
    activeCategoryId,
    searchTerm,
    setActiveCategoryId,
    setSearchTerm,
  };
}
