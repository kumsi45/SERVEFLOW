import type { ReactNode } from "react";
import { usePublicHashScroll } from "../hooks/usePublicHashScroll";
import { PublicSiteFooter, PublicSiteHeader } from "./PublicSiteChrome";
import "../styles/landing.css";

export function PublicPageLayout({ children }: { children: ReactNode }) {
  usePublicHashScroll();
  return <div className="lp-root">
    <a className="lp-skip-link" href="#main-content">Skip to content</a>
    <PublicSiteHeader />
    <main id="main-content" tabIndex={-1} className="lp-public-main">{children}</main>
    <PublicSiteFooter />
  </div>;
}
