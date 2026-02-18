import { BranchingDemoIsland } from "@/app/components/landing/BranchingDemoIsland";
import { HeroSection } from "@/app/components/landing/HeroSection";
import { LandingFooter } from "@/app/components/landing/LandingFooter";
import { ProductScreenshotSection } from "@/app/components/landing/ProductScreenshotSection";
import { TopBarClient } from "@/app/components/landing/TopBarClient";
import type { LandingLinks } from "@/app/components/landing/types";
import { ValueStrip } from "@/app/components/landing/ValueStrip";

interface LandingShellProps {
  links: LandingLinks;
}

export function LandingShell({ links }: LandingShellProps) {
  return (
    <div className="app-shell min-h-screen text-foreground">
      <TopBarClient links={links} />
      <main>
        <HeroSection links={links} />
        <ProductScreenshotSection />
        <BranchingDemoIsland />
        <ValueStrip />
      </main>
      <LandingFooter links={links} />
    </div>
  );
}
