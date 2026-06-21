import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const faqs = [
  { q: "How does QR ordering work?", a: "Each table has a unique QR code. When a customer scans it, they see your digital menu in their browser — no app download needed. They add items, select a payment method, and submit the order directly." },
  { q: "Do customers need an app?", a: "No. ServeFlow works entirely in the browser. Customers scan the QR code and the menu opens instantly on any smartphone." },
  { q: "Can I manage multiple staff members?", a: "Yes. Owners can create accounts for cashiers and kitchen staff with role-based access. Each staff member only sees what they need for their role." },
  { q: "Is ServeFlow cloud-based?", a: "Fully. All your data lives securely in the cloud. You can access your dashboards from any device with a browser — phone, tablet, or desktop." },
  { q: "Can I use it for a cafe or hotel?", a: "Absolutely. ServeFlow is designed for any food service business — cafes, full-service restaurants, hotel F&B outlets, food courts, and fast-food counters." },
];

export function FaqSection() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section className="lp-faq" id="faq" aria-labelledby="faq-heading">
      <div className="lp-container">
        <div className="lp-section-header">
          <span className="lp-section-eyebrow">FAQ</span>
          <h2 id="faq-heading">Frequently Asked Questions</h2>
        </div>
        <div className="lp-faq-list" role="list">
          {faqs.map((faq, i) => (
            <div key={i} className="lp-faq-item" role="listitem">
              <button
                className="lp-faq-trigger"
                aria-expanded={open === i}
                onClick={() => setOpen(open === i ? null : i)}
              >
                <span>{faq.q}</span>
                <span className="lp-faq-icon" aria-hidden="true">{open === i ? "−" : "+"}</span>
              </button>
              <AnimatePresence initial={false}>
                {open === i && (
                  <motion.div
                    className="lp-faq-answer"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.28 }}
                  >
                    <p>{faq.a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
