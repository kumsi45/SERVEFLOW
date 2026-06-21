import { motion } from "framer-motion";

const plans = [
  {
    name: "Starter",
    price: "$49",
    period: "/mo",
    desc: "Perfect for single-location cafes and small restaurants.",
    features: ["1 Restaurant", "Up to 3 staff accounts", "QR ordering", "Cashier dashboard", "Kitchen dashboard", "Email support"],
    cta: "Start Free",
    popular: false,
  },
  {
    name: "Growth",
    price: "$99",
    period: "/mo",
    desc: "For growing restaurants that need more power and flexibility.",
    features: ["Up to 3 Restaurants", "Unlimited staff accounts", "Everything in Starter", "Advanced analytics", "Real-time notifications", "Priority support"],
    cta: "Start Free Trial",
    popular: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    desc: "For hotel chains, food courts, and large restaurant groups.",
    features: ["Unlimited restaurants", "Unlimited staff", "Everything in Growth", "Dedicated account manager", "Custom integrations", "SLA & 24/7 support"],
    cta: "Contact Sales",
    popular: false,
  },
];

export function PricingSection() {
  return (
    <section className="lp-pricing" id="pricing" aria-labelledby="pricing-heading">
      <div className="lp-container">
        <div className="lp-section-header">
          <span className="lp-section-eyebrow">Pricing</span>
          <h2 id="pricing-heading">Fair Pricing for Every Stage</h2>
          <p>Start free. Scale as you grow. No hidden fees.</p>
        </div>
        <div className="lp-pricing-grid">
          {plans.map((p, i) => (
            <motion.div
              key={p.name}
              className={`lp-pricing-card${p.popular ? " lp-pricing-popular" : ""}`}
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: i * 0.1 }}
            >
              {p.popular && <div className="lp-pricing-badge">Most Popular</div>}
              <div className="lp-pricing-name">{p.name}</div>
              <div className="lp-pricing-price">
                <span className="lp-pricing-amount">{p.price}</span>
                {p.period && <span className="lp-pricing-period">{p.period}</span>}
              </div>
              <p className="lp-pricing-desc">{p.desc}</p>
              <ul className="lp-pricing-features" role="list">
                {p.features.map((f) => (
                  <li key={f}><span className="lp-pricing-check" aria-hidden="true">✓</span>{f}</li>
                ))}
              </ul>
              <a href="/sign-up" className={p.popular ? "lp-btn-primary lp-pricing-cta" : "lp-btn-ghost lp-pricing-cta"}>
                {p.cta}
              </a>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
