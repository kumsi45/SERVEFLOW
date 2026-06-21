import { motion } from "framer-motion";

const features = [
  { icon: "📱", title: "QR Ordering", desc: "Customers scan a table QR code, browse the digital menu, and place orders instantly — no app needed." },
  { icon: "💳", title: "Cashier Dashboard", desc: "Approve payments, manage customer orders, and keep all transactions organized in one view." },
  { icon: "👨‍🍳", title: "Kitchen Dashboard", desc: "Track paid orders, start preparation, and mark meals ready in real time with a clean queue view." },
  { icon: "👥", title: "Staff Management", desc: "Owners can manage cashiers and kitchen staff with role-based access control and secure logins." },
  { icon: "⚡", title: "Live Order Tracking", desc: "Every order moves through a clear workflow from customer to cashier to kitchen — fully visible." },
  { icon: "☁️", title: "Cloud Management", desc: "Access your entire restaurant operations securely from any device, anywhere in the world." },
];

export function FeaturesSection() {
  return (
    <section className="lp-features" aria-labelledby="features-heading">
      <div className="lp-container">
        <div className="lp-section-header">
          <span className="lp-section-eyebrow">Platform Features</span>
          <h2 id="features-heading">Everything Your Restaurant Needs</h2>
          <p>A complete operations platform built for modern restaurants, cafes, hotels, and food courts.</p>
        </div>
        <div className="lp-features-grid">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              className="lp-feature-card"
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: i * 0.08 }}
            >
              <div className="lp-feature-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
