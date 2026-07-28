import { useCallback, useEffect, useMemo, useState } from "react";
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

type CachedQRMenu = Pick<QRMenuState, "restaurant" | "categories" | "items"> & {
  cachedAt: number;
};

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function menuCacheKey(slug: string) {
  return `serveflow:public-menu:${slug}`;
}

function categoryCacheKey(slug: string) {
  return `serveflow:public-menu-category:${slug}`;
}

function readCachedMenu(slug: string): CachedQRMenu | null {
  try {
    const raw = window.localStorage.getItem(menuCacheKey(slug));
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedQRMenu;
    if (
      !cached.restaurant?.id ||
      !Array.isArray(cached.categories) ||
      !Array.isArray(cached.items) ||
      Date.now() - cached.cachedAt > CACHE_MAX_AGE_MS
    ) return null;
    return cached;
  } catch {
    return null;
  }
}

function writeCachedMenu(slug: string, value: Omit<CachedQRMenu, "cachedAt">) {
  try {
    window.localStorage.setItem(menuCacheKey(slug), JSON.stringify({ ...value, cachedAt: Date.now() }));
  } catch {
    // Browsers may disable storage; the live menu remains fully functional.
  }
}

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
  const [activeCategoryId, setActiveCategoryIdState] = useState(() => {
    try { return window.localStorage.getItem(categoryCacheKey(restaurantSlug)) || "all"; }
    catch { return "all"; }
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  const [usingCachedMenu, setUsingCachedMenu] = useState(false);

  const retry = useCallback(() => setRetryCount((count) => count + 1), []);
  const setActiveCategoryId = useCallback((categoryId: string) => {
    setActiveCategoryIdState(categoryId);
    try { window.localStorage.setItem(categoryCacheKey(restaurantSlug), categoryId); }
    catch { /* Navigation preference is optional. */ }
  }, [restaurantSlug]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearchTerm(searchTerm), 160);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    let active = true;

    setState((current) => ({ ...current, loading: true, error: null }));
    setUsingCachedMenu(false);

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
        writeCachedMenu(restaurantSlug, data);
      })
      .catch((error: Error) => {
        if (!active) {
          return;
        }

        const cached = readCachedMenu(restaurantSlug);
        if (cached) {
          setState({ ...cached, loading: false, error: null });
          setUsingCachedMenu(true);
        } else {
          setState({ restaurant: null, categories: [], items: [], loading: false, error: error.message });
        }
      });

    return () => {
      active = false;
    };
  }, [restaurantSlug, retryCount]);

  useEffect(() => {
    const retryWhenOnline = () => retry();
    window.addEventListener("online", retryWhenOnline);
    return () => window.removeEventListener("online", retryWhenOnline);
  }, [retry]);

  useEffect(() => {
    if (!state.loading && state.restaurant && activeCategoryId !== "all" && !state.categories.some(({ id }) => id === activeCategoryId)) {
      setActiveCategoryId("all");
    }
  }, [activeCategoryId, setActiveCategoryId, state.categories, state.loading, state.restaurant]);

  const localized = useMemo(
    () => localizeMenuPresentation(state.categories, state.items, language),
    [language, state.categories, state.items],
  );

  const visibleItems = useMemo(
    () => filterMenuItems(localized.items, debouncedSearchTerm, activeCategoryId),
    [activeCategoryId, debouncedSearchTerm, localized.items]
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
    usingCachedMenu,
    retry,
    setActiveCategoryId,
    setSearchTerm,
  };
}
