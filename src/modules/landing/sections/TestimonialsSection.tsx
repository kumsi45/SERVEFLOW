import { motion } from "framer-motion";

const testimonials = [
  { name: "Tigist Haile", role: "Owner, Buna Coffee House, Addis Ababa", quote: "ServeFlow transformed how we handle orders. Our cashiers spend less time on the phone and more time serving guests. Revenue is up 30% since we launched.", avatar: "T" },
  { name: "Samuel Bekele", role: "Manager, Gusto Restaurant, Bahir Dar", quote: "The kitchen dashboard is a game changer. My cooks can see exactly what's next in the queue without anyone shouting. It's calm, organized, and fast.", avatar: "S" },
  { name: "Meron Alemu", role: "Owner, Desta Cafe, Hawassa", quote: "Customers love scanning the QR code. No app needed, no confusion. Orders come in directly and everything is tracked. I'd recommend ServeFlow to every cafe owner.", avatar: "M" },
  { name: "Dawit Girma", role: "F&B Director, Sapphire Hotel, Adama", quote: "We run three restaurants in the hotel and ServeFlow handles all of them from one platform. The multi-staff management feature is exactly what we needed.", avatar: "D" },
];

export function TestimonialsSection() {
  return (
    <section className="lp-testimonials" aria-labelledby="testimonials-heading">
      <div className="lp-container">
        <div className="lp-section-header">
          <span className="lp-section-eyebrow">Customer Stories</span>
          <h2 id="testimonials-heading">Trusted by Restaurant Owners</h2>
          <p>Real feedback from real operators who use ServeFlow every day.</p>
        </div>
        <div className="lp-testimonials-grid">
          {testimonials.map((t, i) => (
            <motion.div
              key={t.name}
              className="lp-testimonial-card"
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: i * 0.1 }}
            >
              <div className="lp-testimonial-stars" aria-label="5 stars">★★★★★</div>
              <blockquote className="lp-testimonial-quote">"{t.quote}"</blockquote>
              <div className="lp-testimonial-author">
                <div className="lp-testimonial-avatar">{t.avatar}</div>
                <div>
                  <div className="lp-testimonial-name">{t.name}</div>
                  <div className="lp-testimonial-role">{t.role}</div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
