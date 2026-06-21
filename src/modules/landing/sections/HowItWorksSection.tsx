import { motion } from "framer-motion";

const steps = [
  { n: "01", icon: "📱", title: "Customer Scans QR Code", desc: "The customer scans the QR code on their table to open the digital menu instantly." },
  { n: "02", icon: "🛒", title: "Customer Places Order", desc: "They browse the menu, add items to cart, and submit their order with payment details." },
  { n: "03", icon: "💳", title: "Cashier Approves Payment", desc: "The cashier sees the order, verifies payment, and marks it as paid in the dashboard." },
  { n: "04", icon: "👨‍🍳", title: "Kitchen Prepares Food", desc: "The kitchen receives the paid order, starts preparation, and marks it ready when done." },
  { n: "05", icon: "✅", title: "Order Ready for Service", desc: "The order is marked ready and the team delivers it to the customer's table." },
];

export function HowItWorksSection() {
  return (
    <section className="lp-hiw" id="how-it-works" aria-labelledby="hiw-heading">
      <div className="lp-container">
        <div className="lp-section-header">
          <span className="lp-section-eyebrow">How It Works</span>
          <h2 id="hiw-heading">Your Path to Modernization</h2>
          <p>From QR scan to table delivery — a seamless 5-step workflow your whole team can follow.</p>
        </div>
        <div className="lp-hiw-timeline">
          {steps.map((s, i) => (
            <motion.div
              key={s.n}
              className="lp-hiw-step"
              initial={{ opacity: 0, x: i % 2 === 0 ? -32 : 32 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
            >
              <div className="lp-hiw-step-num">{s.n}</div>
              <div className="lp-hiw-step-icon">{s.icon}</div>
              <div className="lp-hiw-step-content">
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </div>
            </motion.div>
          ))}
          <div className="lp-hiw-line" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
