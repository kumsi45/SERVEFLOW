import { useEffect, useMemo, useState } from "react";
import { fetchOrderingMenuData } from "../services/orderingService";
import type { OrderingCategory, OrderingMenuItem, OrderingRestaurant } from "../types";

type OrderingMenuState = {
  restaurant: OrderingRestaurant | null;
  categories: OrderingCategory[];
  items: OrderingMenuItem[];
  loading: boolean;
  error: string | null;
};

export function useOrderingMenu(restaurantSlug: string) {
  const [state, setState] = useState<OrderingMenuState>({
    restaurant: null,
    categories: [],
    items: [],
    loading: true,
    error: null,
  });
  const [activeCategoryId, setActiveCategoryId] = useState("all");

  useEffect(() => {
    let active = true;

    setState((current) => ({ ...current, loading: true, error: null }));

    fetchOrderingMenuData(restaurantSlug)
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
    () =>
      state.items.filter(
        (item) => activeCategoryId === "all" || item.category_id === activeCategoryId
      ),
    [activeCategoryId, state.items]
  );

  return {
    ...state,
    visibleItems,
    activeCategoryId,
    setActiveCategoryId,
  };
}
