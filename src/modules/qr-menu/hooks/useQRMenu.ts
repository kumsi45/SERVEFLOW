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

type CachedMenuState = Omit<QRMenuState, "loading" | "error"> & {
  storedAt: number;
};

const MENU_CACHE_TTL_MS = 30_000;
const menuCache = new Map<string, CachedMenuState>();
const menuRequests = new Map<string, Promise<CachedMenuState>>();

function categoryCacheKey(slug: string) {
  return `serveflow:public-menu-category:${slug}`;
}

function menuCacheKey(slug: string) {
  return slug.trim().toLowerCase();
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
    const cacheKey = menuCacheKey(restaurantSlug);
    const cached = menuCache.get(cacheKey);
    const cacheIsFresh =
      cached && Date.now() - cached.storedAt < MENU_CACHE_TTL_MS;

    if (cacheIsFresh) {
      setState({
        restaurant: cached.restaurant,
        categories: cached.categories,
        items: cached.items,
        loading: false,
        error: null,
      });
      setUsingCachedMenu(true);
    } else {
      setState((current) => ({ ...current, loading: true, error: null }));
      setUsingCachedMenu(false);
    }

    const request =
      menuRequests.get(cacheKey) ??
      fetchQRMenuData(restaurantSlug)
        .then((data) => ({
          restaurant: data.restaurant,
          categories: data.categories,
          items: data.items,
          storedAt: Date.now(),
        }))
        .finally(() => menuRequests.delete(cacheKey));
    menuRequests.set(cacheKey, request);

    request
      .then((data) => {
        if (!active) {
          return;
        }

        menuCache.set(cacheKey, data);

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

        if (cached) {
          setState({
            restaurant: cached.restaurant,
            categories: cached.categories,
            items: cached.items,
            loading: false,
            error: null,
          });
          setUsingCachedMenu(true);
          return;
        }

        setState({ restaurant: null, categories: [], items: [], loading: false, error: error.message });
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
