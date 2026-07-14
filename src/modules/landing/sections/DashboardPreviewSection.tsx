import { motion } from "framer-motion";

export function DashboardPreviewSection() {
  return (
    <section className="lp-preview" aria-label="Dashboard previews">
      <div className="lp-container">
        <div className="lp-section-header">
          <span className="lp-section-eyebrow">Dashboard Previews</span>
          <h2>Control in Every Click</h2>
          <p>Beautifully designed dashboards built for speed, clarity, and real restaurant workflows.</p>
        </div>
        <div className="lp-preview-grid">
          <motion.div className="lp-preview-card lp-preview-main"
            initial={{ opacity: 0, y: 32 }} whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }} transition={{ duration: 0.55 }}>
            <div className="lp-preview-card-header">
              <div className="lp-preview-dots">
                <span style={{ background: "#ff5f57" }} /><span style={{ background: "#febc2e" }} /><span style={{ background: "#28c840" }} />
              </div>
              <span className="lp-preview-card-label">Cashier Dashboard</span>
            </div>
            <div className="lp-preview-card-body">
              <div className="lp-preview-stat-row">
                <div className="lp-preview-stat"><div className="lp-preview-stat-val green">48,320</div><div className="lp-preview-stat-label">Today's Revenue</div></div>
                <div className="lp-preview-stat"><div className="lp-preview-stat-val">247</div><div className="lp-preview-stat-label">Total Orders</div></div>
                <div className="lp-preview-stat"><div className="lp-preview-stat-val yellow">12</div><div className="lp-preview-stat-label">Pending Payment</div></div>
              </div>
              <div className="lp-preview-orders">
                {["#A14 · Doro Wat · 280", "#A15 · Tibs · 250", "#A16 · Beyaynetu · 200"].map((o) => (
                  <div key={o} className="lp-preview-order-row">
                    <span style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{o}</span>
                    <span className="lp-hero-badge lp-badge-yellow">Pending</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          <div className="lp-preview-side">
            <motion.div className="lp-preview-card"
              initial={{ opacity: 0, y: 32 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }} transition={{ duration: 0.55, delay: 0.15 }}>
              <div className="lp-preview-card-header">
                <div className="lp-preview-dots"><span style={{ background: "#ff5f57" }} /><span style={{ background: "#febc2e" }} /><span style={{ background: "#28c840" }} /></div>
                <span className="lp-preview-card-label">Kitchen Queue</span>
              </div>
              <div className="lp-preview-card-body">
                {[
                  { id: "#A12", step: "Preparing", c: "lp-badge-yellow" },
                  { id: "#A13", step: "Ready ✓", c: "lp-badge-green" },
                  { id: "#A14", step: "Paid", c: "lp-badge-blue" },
                ].map((o) => (
                  <div key={o.id} className="lp-preview-order-row">
                    <span style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{o.id}</span>
                    <span className={`lp-hero-badge ${o.c}`}>{o.step}</span>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div className="lp-preview-card"
              initial={{ opacity: 0, y: 32 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }} transition={{ duration: 0.55, delay: 0.28 }}>
              <div className="lp-preview-card-header">
                <div className="lp-preview-dots"><span style={{ background: "#ff5f57" }} /><span style={{ background: "#febc2e" }} /><span style={{ background: "#28c840" }} /></div>
                <span className="lp-preview-card-label">Owner Overview</span>
              </div>
              <div className="lp-preview-card-body">
                <div className="lp-preview-staff-list">
                  {[
                    { name: "Cashier Staff", role: "cashier", active: true },
                    { name: "Kitchen Staff", role: "kitchen", active: true },
                    { name: "Owner", role: "owner", active: true },
                  ].map((u) => (
                    <div key={u.name} className="lp-preview-staff-row">
                      <div className="lp-preview-staff-avatar">{u.name[0]}</div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{u.name}</div>
                        <div style={{ fontSize: 11, color: "var(--lp-muted)" }}>{u.role}</div>
                      </div>
                      <span className="lp-hero-badge lp-badge-green" style={{ marginLeft: "auto" }}>Active</span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}

