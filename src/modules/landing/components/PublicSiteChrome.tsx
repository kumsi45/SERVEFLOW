import { useRef, useState } from "react";
import { ArrowRight, Menu, X } from "lucide-react";
import { WHATSAPP_SUPPORT_URL } from "../publicContact";

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
      <a className="lp-mobile-signin" href="/staff-login">Sign in</a>
      <button ref={toggle} type="button" className="lp-menu-toggle" aria-label={open ? "Close navigation menu" : "Open navigation menu"} aria-expanded={open} aria-controls="public-mobile-navigation" onClick={() => setOpen((value) => !value)} onKeyDown={(event) => { if (open && event.key === "Escape") { event.preventDefault(); close(true); } }}>{open ? <X aria-hidden="true"/> : <Menu aria-hidden="true"/>}</button>
    </nav>
    {open && <div id="public-mobile-navigation" className="lp-mobile-menu" onKeyDown={(event) => { if (event.key === "Escape") close(true); }}><div className="lp-container">
      {navigation.map((item) => <a key={item.href} href={item.href} onClick={() => close()}>{item.label}</a>)}
      <a href="/staff-login" onClick={() => close()}>Sign in</a><a className="lp-button" href="/sign-up" onClick={() => close()}>Get started <ArrowRight aria-hidden="true" size={18}/></a>
    </div></div>}
  </header>;
}

export function PublicSiteFooter() {
  const groups = [
    { title: "Product", links: [
      ["Features", "/#platform"], ["Industries", "/#industries"],
      ["Pricing", "/pricing"], ["Request a trial", "/contact"],
    ] },
    { title: "Company & Support", links: [
      ["About ServeFlow", "/about"], ["Contact", "/contact"],
      ["Contact support", WHATSAPP_SUPPORT_URL],
    ] },
    { title: "Legal", links: [
      ["Privacy Policy", "/privacy"], ["Terms of Service", "/terms"],
      ["Cookie Policy", "/cookies"], ["Acceptable Use", "/acceptable-use"],
    ] },
  ];

  return <footer className="lp-footer" aria-label="ServeFlow site footer">
    <div className="lp-container">
      <div className="lp-footer-main">
        <div className="lp-footer-intro">
          <p className="lp-footer-tagline">Better operations.<br />Better hospitality.</p>
          <p>Connected tools for hospitality teams.</p>
        </div>
        <div className="lp-footer-groups">
          {groups.map(({ title, links }) => <nav key={title} className="lp-footer-group" aria-label={`Footer ${title}`}>
            <h2>{title}</h2>
            <ul>{links.map(([label, href]) => <li key={label}>
              <a href={href} {...(href.startsWith("https:") ? { target: "_blank", rel: "noreferrer" } : {})}>{label}</a>
            </li>)}</ul>
          </nav>)}
        </div>
      </div>
      <div className="lp-footer-utility">
        <a href="/" className="lp-brand" aria-label="ServeFlow home"><img src="/serveflowlogo.png" alt="" width="32" height="32" /><span>ServeFlow</span></a>
        <p>© {new Date().getFullYear()} ServeFlow</p>
        <a href="/staff-login" className="lp-footer-signin">Sign in <ArrowRight size={16} aria-hidden="true" /></a>
      </div>
    </div>
  </footer>;
}
