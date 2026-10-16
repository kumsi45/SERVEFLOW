import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const STORAGE_KEY = "serveflow.public-theme";
type Theme = "light" | "dark";

function savedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function preferredTheme(): Theme {
  return savedTheme() ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

export function PublicThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => typeof window === "undefined" ? "light" : preferredTheme());

  useEffect(() => {
    document.documentElement.dataset.publicTheme = theme;
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setTheme(preferredTheme());
    media.addEventListener("change", sync);
    window.addEventListener("storage", sync);
    return () => {
      media.removeEventListener("change", sync);
      window.removeEventListener("storage", sync);
      delete document.documentElement.dataset.publicTheme;
    };
  }, []);

  const next = theme === "dark" ? "light" : "dark";
  const label = `Switch to ${next} mode`;
  return <button type="button" className="lp-theme-toggle" aria-label={label} title={label} onClick={() => {
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* Keep the toggle usable if storage is unavailable. */ }
    setTheme(next);
  }}>
    {theme === "dark" ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
  </button>;
}
