import { NavSection } from "../sections/NavSection";
import { HeroSection } from "../sections/HeroSection";
import { TrustSection } from "../sections/TrustSection";
import { FeaturesSection } from "../sections/FeaturesSection";
import { HowItWorksSection } from "../sections/HowItWorksSection";
import { DashboardPreviewSection } from "../sections/DashboardPreviewSection";
import { BenefitsSection } from "../sections/BenefitsSection";
import { TestimonialsSection } from "../sections/TestimonialsSection";
import { PricingSection } from "../sections/PricingSection";
import { FaqSection } from "../sections/FaqSection";
import { ContactSection } from "../sections/ContactSection";
import { FooterSection } from "../sections/FooterSection";
import "../styles/landing.css";

export function LandingPage() {
  return (
    <div className="lp-root">
      <NavSection />
      <main>
        <HeroSection />
        <TrustSection />
        <FeaturesSection />
        <HowItWorksSection />
        <DashboardPreviewSection />
        <BenefitsSection />
        <TestimonialsSection />
        <PricingSection />
        <FaqSection />
        <ContactSection />
      </main>
      <FooterSection />
    </div>
  );
}
