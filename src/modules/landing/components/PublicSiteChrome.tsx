import { useRef, useState } from "react";
import { ArrowRight, Menu, X } from "lucide-react";

const navigation = [
  { label: "Platform", href: "/#platform" },
  { label: "Industries", href: "/#industries" },
  { label: "About", href: "/about" },
  { label: "Pricing", href: "/pricing" },
  { label: "Contact", href: "/contact" },
] as const;

export function PublicSiteHeader() {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement | null>(null);
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => toggle.current?.focus());
  };
  return <header className="lp-header">
    <nav className="lp-nav lp-container" aria-label="Main navigation">
      <a href="/" className="lp-brand" aria-label="ServeFlow home" onClick={() => close()}><img src="/serveflowlogo.png" alt="" width="36" height="36"/><span>ServeFlow</span></a>
      <div className="lp-desktop-nav">{navigation.map((item) => <a key={item.href} href={item.href}>{item.label}</a>)}</div>
      <div className="lp-desktop-actions"><a className="lp-text-link" href="/staff-login">Sign in</a><a className="lp-button lp-button-small" href="/sign-up">Get started</a></div>
      <button ref={toggle} type="button" className="lp-menu-toggle" aria-label={open ? "Close navigation menu" : "Open navigation menu"} aria-expanded={open} aria-controls="public-mobile-navigation" onClick={() => setOpen((value) => !value)} onKeyDown={(event) => { if (open && event.key === "Escape") { event.preventDefault(); close(true); } }}>{open ? <X aria-hidden="true"/> : <Menu aria-hidden="true"/>}</button>
    </nav>
    {open && <div id="public-mobile-navigation" className="lp-mobile-menu" onKeyDown={(event) => { if (event.key === "Escape") close(true); }}><div className="lp-container">
      {navigation.map((item) => <a key={item.href} href={item.href} onClick={() => close()}>{item.label}</a>)}
      <a href="/staff-login" onClick={() => close()}>Sign in</a><a className="lp-button" href="/sign-up" onClick={() => close()}>Get started <ArrowRight aria-hidden="true" size={18}/></a>
    </div></div>}
  </header>;
}

export function PublicSiteFooter() {
  return <footer className="lp-footer"><div className="lp-container lp-footer-content">
    <a href="/" className="lp-brand" aria-label="ServeFlow home"><img src="/serveflowlogo.png" alt="" width="32" height="32"/><span>ServeFlow</span></a>
    <p>One platform for connected hospitality operations.</p>
    <div className="lp-footer-links"><a href="/#platform">Platform</a><a href="/#industries">Industries</a><a href="/about">About</a><a href="/pricing">Pricing</a><a href="/contact">Contact</a><a href="/staff-login">Sign in</a></div>
  </div></footer>;
}
