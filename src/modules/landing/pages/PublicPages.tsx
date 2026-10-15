import { ArrowRight, CheckCircle2, ExternalLink, MessageCircle, Send } from "lucide-react";
import { useEffect } from "react";
import { PublicSiteFooter, PublicSiteHeader } from "../components/PublicSiteChrome";
import "../styles/landing.css";

const WHATSAPP = "https://wa.me/251990069892";
const messages = {
  trial: "Hello KumsiTech, I would like to request a ServeFlow trial for my hospitality business.",
  pricing: "Hello KumsiTech, I would like to discuss ServeFlow pricing for my business.",
  general: "Hello KumsiTech, I have a question about ServeFlow.",
};
const whatsapp = (message: string) => `${WHATSAPP}?text=${encodeURIComponent(message)}`;

function useMetadata(title: string, description: string) {
  useEffect(() => {
    document.title = title;
    const meta = document.querySelector('meta[name="description"]') ?? document.head.appendChild(document.createElement("meta"));
    meta.setAttribute("name", "description"); meta.setAttribute("content", description);
  }, [title, description]);
}

function PublicPage({ children }: { children: React.ReactNode }) {
  return <div className="lp-root"><a className="lp-skip-link" href="#main-content">Skip to content</a><PublicSiteHeader/><main id="main-content" className="lp-public-main">{children}</main><PublicSiteFooter/></div>;
}

export function AboutPage() {
  useMetadata("About KumsiTech | ServeFlow", "Learn about KumsiTech and its vision for practical, connected hospitality operations.");
  return <PublicPage><section className="lp-page-hero"><div className="lp-container lp-page-hero-grid"><div><p className="lp-eyebrow">About ServeFlow</p><h1>Built by KumsiTech. Designed for Hospitality.</h1><p>ServeFlow is a hospitality management platform built by KumsiTech, a technology company founded by Abdulhayi Alo Abdulahi and based in Shashemene, Ethiopia.</p></div><img src="/contact.jpg" alt="KumsiTech founder portrait"/></div></section><section className="lp-page-section"><div className="lp-container lp-prose"><h2>Practical technology for real business needs.</h2><p>KumsiTech builds practical digital solutions designed around real business needs. Our goal is to help businesses organize their work, improve everyday processes, and make better use of technology.</p><h2>Why ServeFlow?</h2><p>Hospitality businesses coordinate many activities every day, from customer orders and staff communication to kitchen operations, payments, inventory, and reporting. When these activities are difficult to manage, it can affect both business performance and the customer experience.</p><p>ServeFlow is being developed to help hospitality businesses manage essential food-and-beverage operations through connected digital workflows.</p><h2>Our vision</h2><p>We see an opportunity to make hospitality management more connected and accessible through technology. Our long-term ambition is to expand ServeFlow into a more comprehensive hospitality ERP platform that can support additional workflows over time.</p><p className="lp-callout">Hotel reservations, room-service ordering, and other hotel-management functions belong to our future vision and are not currently available features.</p><h2>Our commitment</h2><p>We believe useful technology starts with real problems. Through KumsiTech, we aim to build solutions that help businesses operate more effectively and create opportunities for growth.</p><p>ServeFlow is built by KumsiTech, with a vision to help hospitality businesses move forward.</p><div className="lp-actions"><a className="lp-button" href="/#platform">Explore ServeFlow <ArrowRight aria-hidden="true" size={18}/></a><a className="lp-button lp-button-secondary" href="/contact">Contact us</a></div></div></section></PublicPage>;
}

export function PricingPage() {
  useMetadata("Pricing | ServeFlow", "Discuss a ServeFlow setup and pricing arrangement with KumsiTech for your hospitality business.");
  return <PublicPage><section className="lp-page-hero lp-page-hero-plain"><div className="lp-container lp-narrow"><p className="lp-eyebrow">Pricing</p><h1>Pricing That Starts With Your Business</h1><p>Every hospitality business has different needs. Contact KumsiTech to discuss your business, your team, and the ServeFlow setup that may suit your operations.</p></div></section><section className="lp-page-section"><div className="lp-container lp-narrow"><h2>Let’s discuss your business.</h2><ul className="lp-detail-list">{["Your hospitality business type and size.", "The number of staff members who need access.", "The workflows you need to manage.", "Your onboarding and training requirements."].map((item) => <li key={item}><CheckCircle2 aria-hidden="true" size={20}/>{item}</li>)}</ul><div className="lp-pricing-note"><h2>Interested in trying ServeFlow?</h2><p>Trial requests are reviewed before access is approved and activated. Contact us on WhatsApp to introduce your business and discuss the next steps.</p><p>Trial access is not automatic, and eligibility and activation arrangements will be confirmed directly.</p></div><p>We will discuss pricing and suitable arrangements with you directly. Specific prices, plan limits, and commercial terms will be confirmed during that conversation.</p><div className="lp-actions"><a className="lp-button" href={whatsapp(messages.pricing)} target="_blank" rel="noreferrer">Discuss pricing on WhatsApp <MessageCircle aria-hidden="true" size={18}/></a><a className="lp-button lp-button-secondary" href={whatsapp(messages.trial)} target="_blank" rel="noreferrer">Request a trial on WhatsApp <ArrowRight aria-hidden="true" size={18}/></a></div></div></section></PublicPage>;
}

export function ContactPage() {
  useMetadata("Contact KumsiTech | ServeFlow", "Discuss ServeFlow, pricing, or a trial request with KumsiTech through WhatsApp or Telegram.");
  return <PublicPage><section className="lp-page-hero lp-page-hero-plain"><div className="lp-container lp-narrow"><p className="lp-eyebrow">Contact KumsiTech</p><h1>Let’s Talk About Your Hospitality Business</h1><p>Have a question about ServeFlow? Want to discuss pricing, request a trial, or explore how the platform could fit your business? Get in touch with KumsiTech.</p></div></section><section className="lp-page-section"><div className="lp-container lp-contact-options"><article className="lp-contact-primary"><MessageCircle aria-hidden="true" size={30}/><p className="lp-eyebrow">Primary contact</p><h2>WhatsApp</h2><p>Tell us about your hospitality business and what you would like to manage with ServeFlow. Trial requests are reviewed before access is approved and activated.</p><div className="lp-actions"><a className="lp-button" href={whatsapp(messages.trial)} target="_blank" rel="noreferrer">Request a trial <ArrowRight aria-hidden="true" size={18}/></a><a className="lp-button lp-button-secondary" href={whatsapp(messages.pricing)} target="_blank" rel="noreferrer">Discuss pricing</a></div></article><aside className="lp-contact-secondary"><Send aria-hidden="true" size={24}/><h2>Other questions</h2><p>Contact us about the product, a demonstration, or an existing ServeFlow account.</p><a className="lp-text-link" href={whatsapp(messages.general)} target="_blank" rel="noreferrer">Ask on WhatsApp <ExternalLink aria-hidden="true" size={15}/></a><a className="lp-text-link" href="https://t.me/kumsitech" target="_blank" rel="noreferrer">Telegram <ExternalLink aria-hidden="true" size={15}/></a><p className="lp-location">Shashemene, Ethiopia</p></aside></div></section></PublicPage>;
}
