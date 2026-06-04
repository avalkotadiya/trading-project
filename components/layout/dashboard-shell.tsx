import type { ReactNode } from "react";
import { MobileNav } from "@/components/layout/mobile-nav";
import { PageMotion } from "@/components/layout/page-motion";
import { Sidebar } from "@/components/layout/sidebar";
import { TopNav } from "@/components/layout/top-nav";

type DashboardShellProps = {
  children: ReactNode;
  clerkEnabled: boolean;
  isAdmin?: boolean;
};

export function DashboardShell({ children, clerkEnabled, isAdmin = false }: DashboardShellProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <Sidebar isAdmin={isAdmin} />
      <div className="min-h-screen md:ml-60">
        <TopNav dashboard clerkEnabled={clerkEnabled} />
        <main className="relative z-10 px-4 pb-28 pt-5 md:px-6 md:pb-10">
          <PageMotion>{children}</PageMotion>
        </main>
      </div>
      <MobileNav isAdmin={isAdmin} />
    </div>
  );
}
