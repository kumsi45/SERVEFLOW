import { useState } from "react";

export function NavSection() {
  const [open, setOpen] = useState(false);

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    setOpen(false);
  }

  return (
    <nav className="lp-nav" aria-label="Main navigation">
      <div className="lp-container lp-nav-inner">
        <a href="/" className="lp-logo" aria-label="ServeFlow home">
          <img className="lp-logo-icon" src="/serveflowlogo.png" alt="" />
          <span className="lp-logo-text">ServeFlow</span>
        </a>

        <ul className="lp-nav-links" role="list">
          {(["features", "how-it-works", "pricing", "contact"] as const).map((id) => (
            <li key={id}>
              <a href={`#${id}`} onClick={(e) => { e.preventDefault(); scrollTo(id); }}>
                {id === "how-it-works" ? "How It Works" : id.charAt(0).toUpperCase() + id.slice(1)}
              </a>
            </li>
          ))}
        </ul>

        <div className="lp-nav-actions">
          <a href="/staff-login" className="lp-btn-ghost">Sign In</a>
          <a href="/sign-up" className="lp-btn-primary">Get Started</a>
          <button
            className="lp-nav-mobile-toggle"
            aria-label="Toggle menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "✕" : "☰"}
          </button>
        </div>
      </div>

      {open && (
        <div className="lp-nav-mobile-menu">
          {["features", "how-it-works", "pricing", "contact"].map((id) => (
            <button key={id} onClick={() => scrollTo(id)}>
              {id === "how-it-works" ? "How It Works" : id.charAt(0).toUpperCase() + id.slice(1)}
            </button>
          ))}
          <a href="/sign-up" className="lp-btn-primary" style={{ marginTop: 8 }}>Get Started</a>
        </div>
      )}
    </nav>
  );
}
