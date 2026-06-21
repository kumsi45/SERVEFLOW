import { motion } from "framer-motion";

const items = [
  { icon: "📱", name: "QR Ordering", desc: "Customers order instantly by scanning a table QR code." },
  { icon: "💳", name: "Cashier Operations", desc: "Approve payments and manage all customer transactions." },
  { icon: "👨‍🍳", name: "Kitchen Workflow", desc: "Real-time order queue from paid to preparing to ready." },
  { icon: "👥", name: "Multi-Staff Management", desc: "Role-based access for owners, cashiers and kitchen staff." },
  { icon: "⚡", name: "Real-Time Updates", desc: "Every status change reflects instantly across dashboards." },
  { icon: "☁️", name: "Cloud-Based Access", desc: "Manage your restaurant from any device, anywhere." },
];

export function TrustSection() {
  return (
    <section className="lp-trust" id="features" aria-label="Built for modern restaurants">
      <div className="lp-container">
        <p className="lp-trust-label">Built for Modern Restaurants</p>
        <div className="lp-trust-grid">
          {items.map((item, i) => (
            <motion.div
              key={item.name}
              className="lp-trust-item"
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: i * 0.07 }}
            >
              <span className="lp-trust-icon">{item.icon}</span>
              <span className="lp-trust-name">{item.name}</span>
              <span className="lp-trust-desc">{item.desc}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
