import { motion } from "framer-motion";

const fadeUp = { hidden: { opacity: 0, y: 32 }, show: { opacity: 1, y: 0 } };

export function HeroSection() {
  return (
    <section className="lp-hero" aria-label="Hero">
      <div className="lp-container">
        <motion.div initial="hidden" animate="show" variants={fadeUp} transition={{ duration: 0.6 }}>
          <p className="lp-hero-eyebrow">🚀 Cloud Restaurant Operations Platform</p>
          <h1>
            Run Your Restaurant<br />
            <em>Smarter</em> with ServeFlow
          </h1>
          <p className="lp-hero-sub">
            Accept QR orders, manage payments, coordinate your kitchen, and serve customers faster
            from one powerful platform.
          </p>
          <div className="lp-hero-ctas">
            <a href="/sign-up" className="lp-btn-hero-primary">
              Start Free Trial →
            </a>
            <a href="#how-it-works" className="lp-btn-hero-ghost"
              onClick={(e) => { e.preventDefault(); document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" }); }}>
              ▶ Watch Demo
            </a>
          </div>
        </motion.div>

        <motion.div
          className="lp-hero-visual"
          initial={{ opacity: 0, y: 48 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.25 }}
        >
          {/* Card 1 — QR Orders */}
          <div className="lp-hero-card">
            <div className="lp-hero-card-header">
              <div className="lp-hero-card-dot" style={{ background: "#00c896" }} />
              <span className="lp-hero-card-title">QR Orders</span>
            </div>
            <div className="lp-hero-card-body">
              <div className="lp-hero-stat"><div className="lp-hero-stat-label">Today's Orders</div><div className="lp-hero-stat-value green">247</div></div>
              <div className="lp-hero-stat"><div className="lp-hero-stat-label">Avg. Scan Time</div><div className="lp-hero-stat-value">8s</div></div>
              <div className="lp-hero-stat"><div className="lp-hero-stat-label">Revenue</div><div className="lp-hero-stat-value green">ETB 48,320</div></div>
            </div>
          </div>

          {/* Card 2 — Cashier */}
          <div className="lp-hero-card">
            <div className="lp-hero-card-header">
              <div className="lp-hero-card-dot" style={{ background: "#3b82f6" }} />
              <span className="lp-hero-card-title">Cashier Dashboard</span>
            </div>
            <div className="lp-hero-card-body">
              {[
                { id: "#A14", status: "Pending", badge: "lp-badge-yellow" },
                { id: "#A15", status: "Paid", badge: "lp-badge-green" },
                { id: "#A16", status: "Paid", badge: "lp-badge-green" },
                { id: "#A17", status: "Pending", badge: "lp-badge-yellow" },
              ].map((o) => (
                <div key={o.id} className="lp-hero-order-row">
                  <span style={{ color: "#fff", fontWeight: 700 }}>{o.id}</span>
                  <span className={`lp-hero-badge ${o.badge}`}>{o.status}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Card 3 — Kitchen */}
          <div className="lp-hero-card">
            <div className="lp-hero-card-header">
              <div className="lp-hero-card-dot" style={{ background: "#f59e0b" }} />
              <span className="lp-hero-card-title">Kitchen Queue</span>
            </div>
            <div className="lp-hero-card-body">
              {[
                { id: "#A12", step: "Preparing", badge: "lp-badge-yellow" },
                { id: "#A13", step: "Ready", badge: "lp-badge-green" },
                { id: "#A14", step: "Paid", badge: "lp-badge-blue" },
                { id: "#A15", step: "Preparing", badge: "lp-badge-yellow" },
              ].map((o) => (
                <div key={o.id} className="lp-hero-order-row">
                  <span style={{ color: "#fff", fontWeight: 700 }}>{o.id}</span>
                  <span className={`lp-hero-badge ${o.badge}`}>{o.step}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
