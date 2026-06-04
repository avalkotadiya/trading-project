import { CtaSection } from "@/components/landing/cta-section";
import { FeatureGrid } from "@/components/landing/feature-grid";
import { LandingHero } from "@/components/landing/landing-hero";
import { PricingSection } from "@/components/landing/pricing-section";
import { SiteFooter } from "@/components/landing/site-footer";
import { PageMotion } from "@/components/layout/page-motion";
import { TopNav } from "@/components/layout/top-nav";
import { isClerkConfigured } from "@/lib/env";

export default function HomePage() {
  const clerkEnabled = isClerkConfigured();

  return (
    <div className="min-h-screen bg-background">
      <TopNav clerkEnabled={clerkEnabled} />
      <PageMotion>
        <LandingHero />
        <FeatureGrid />
        <PricingSection />
        <CtaSection />
        <SiteFooter />
      </PageMotion>
    </div>
  );
}
