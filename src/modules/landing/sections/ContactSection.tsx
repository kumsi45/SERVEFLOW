import { motion } from "framer-motion";

export function ContactSection() {
  return (
    <section className="lp-contact" id="contact" aria-labelledby="contact-heading">
      <div className="lp-container">
        <motion.div
          className="lp-contact-inner"
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55 }}
        >
          <span className="lp-section-eyebrow" style={{ display: "block", marginBottom: 16 }}>Get in Touch</span>
          <h2 id="contact-heading">Ready to Transform Your Restaurant?</h2>
          <p>Book a free demo with our team and see ServeFlow in action for your business.</p>

          <div className="lp-contact-person">
            <img className="lp-contact-avatar" src="/contact.jpg" alt="Abdulhayi Alo"/>
            <div>
              <div className="lp-contact-name">Abdulhayi Alo</div>
              <div className="lp-contact-title">ServeFlow Founder &amp; Sales</div>
              <div className="lp-contact-phones">
                <a href="tel:0990069892" className="lp-contact-phone">📞 0990069892</a>
                <a href="tel:0965254377" className="lp-contact-phone">📞 0965254377</a>
              </div>
            </div>
          </div>

          <div className="lp-contact-ctas">
            <a href="tel:0990069892" className="lp-btn-hero-primary">Book a Demo</a>
            <a href="/sign-up" className="lp-btn-hero-ghost">Start Free Trial</a>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
