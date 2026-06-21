import { motion } from "framer-motion";

const benefits = [
  { icon: "⚡", title: "Faster Service", desc: "Reduce order-to-kitchen time from minutes to seconds with instant digital workflows." },
  { icon: "✅", title: "Fewer Order Mistakes", desc: "Digital orders eliminate handwriting errors and miscommunications between staff." },
  { icon: "😊", title: "Better Customer Experience", desc: "Customers enjoy fast, contactless ordering from their own phones at any time." },
  { icon: "👁️", title: "Real-Time Visibility", desc: "Everyone sees the same live data — owners, cashiers, and kitchen staff alike." },
  { icon: "🔒", title: "Staff Accountability", desc: "Role-based access ensures every action is tied to a verified staff member." },
  { icon: "📈", title: "Scalable Operations", desc: "Add more restaurants, staff, or locations without changing your workflow." },
];

export function BenefitsSection() {
  return (
    <section className="lp-benefits" aria-labelledby="benefits-heading">
      <div className="lp-container">
        <div className="lp-section-header">
          <span className="lp-section-eyebrow">Why ServeFlow</span>
          <h2 id="benefits-heading">Everything Your Restaurant Needs</h2>
          <p>Designed to make restaurant operations faster, smarter, and more reliable every day.</p>
        </div>
        <div className="lp-benefits-grid">
          {benefits.map((b, i) => (
            <motion.div
              key={b.title}
              className="lp-benefit-item"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.07 }}
            >
              <div className="lp-benefit-icon">{b.icon}</div>
              <div>
                <h3>{b.title}</h3>
                <p>{b.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
