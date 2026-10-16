import { useEffect } from "react";

/** Resolve initial hashes after React has rendered the public page. */
export function usePublicHashScroll() {
  useEffect(() => {
    const scrollToHash = () => {
      if (!window.location.hash) return;
      let id: string;
      try {
        id = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        return;
      }
      document.getElementById(id)?.scrollIntoView({ block: "start" });
    };
    const frame = window.requestAnimationFrame(scrollToHash);
    window.addEventListener("hashchange", scrollToHash);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", scrollToHash);
    };
  }, []);
}
