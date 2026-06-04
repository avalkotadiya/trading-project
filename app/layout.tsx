import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { AmbientBackground } from "@/components/layout/ambient-background";
import { SiteBootLoader } from "@/components/layout/site-boot-loader";
import { Providers } from "@/components/providers";
import { APP_NAME } from "@/lib/constants";
import { isClerkConfigured } from "@/lib/env";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s | ${APP_NAME}`
  },
  description: "AI-powered trading intelligence, scanners, options analytics, and alerting for active traders.",
  icons: {
    icon: "/sahara-mark.svg"
  }
};

export const viewport: Viewport = {
  themeColor: "#030711"
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const clerkPublishableKey = isClerkConfigured()
    ? process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    : undefined;

  // Read nonce injected by middleware for CSP-compliant script loading
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" className="dark" data-scroll-behavior="smooth">
      <body className="font-sans antialiased">
        <AmbientBackground />
        <SiteBootLoader />
        <Providers clerkPublishableKey={clerkPublishableKey} nonce={nonce}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
