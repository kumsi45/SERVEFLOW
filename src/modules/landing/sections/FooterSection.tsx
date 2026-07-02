export function FooterSection() {
  return (
    <footer className="lp-footer" aria-label="Site footer">
      <div className="lp-container">
        <div className="lp-footer-top">
          <div className="lp-footer-brand">
            <div className="lp-logo">
              <img className="lp-logo-icon" src="/serveflowlogo.png" alt="" />
              <span className="lp-logo-text">ServeFlow</span>
            </div>
            <p className="lp-footer-tagline">
              The cloud restaurant operations platform for modern food businesses.
            </p>
          </div>
          <div className="lp-footer-links">
            <div className="lp-footer-col">
              <span className="lp-footer-col-title">Product</span>
              <a href="#features">Features</a>
              <a href="#pricing">Pricing</a>
              <a href="#how-it-works">How It Works</a>
            </div>
            <div className="lp-footer-col">
              <span className="lp-footer-col-title">Company</span>
              <a href="#contact">Contact</a>
              <a href="#faq">FAQ</a>
            </div>
            <div className="lp-footer-col">
              <span className="lp-footer-col-title">Legal</span>
              <a href="#">Privacy Policy</a>
              <a href="#">Terms of Service</a>
            </div>
          </div>
        </div>
        <div className="lp-footer-bottom">
          <span>© 2026 ServeFlow. All rights reserved.</span>
          <div className="lp-footer-socials" aria-label="Social links">
            <a href="#" aria-label="Twitter">𝕏</a>
            <a href="#" aria-label="LinkedIn">in</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
