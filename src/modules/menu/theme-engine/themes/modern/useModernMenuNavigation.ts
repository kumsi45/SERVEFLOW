import { useCallback, useEffect, useState } from "react";

export type ModernMenuPage = "home" | "orders";

function pageFromLocation(): ModernMenuPage {
  return window.location.hash === "#orders" ? "orders" : "home";
}

export function useModernMenuNavigation() {
  const [page, setPage] = useState<ModernMenuPage>(pageFromLocation);

  useEffect(() => {
    const syncPage = () => setPage(pageFromLocation());
    window.addEventListener("popstate", syncPage);
    window.addEventListener("hashchange", syncPage);
    return () => {
      window.removeEventListener("popstate", syncPage);
      window.removeEventListener("hashchange", syncPage);
    };
  }, []);

  const navigate = useCallback((nextPage: ModernMenuPage) => {
    if (nextPage === page) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const nextUrl = `${window.location.pathname}${window.location.search}${nextPage === "orders" ? "#orders" : ""}`;
    window.history.pushState({ serveflowMenuPage: nextPage }, "", nextUrl);
    setPage(nextPage);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [page]);

  return { page, navigate } as const;
}
