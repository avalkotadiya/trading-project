"use client";

import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";

type ProvidersProps = {
  children: ReactNode;
  clerkPublishableKey?: string;
  nonce?: string;
};

export function Providers({ children, clerkPublishableKey, nonce }: ProvidersProps) {
  if (!clerkPublishableKey) {
    return <>{children}</>;
  }

  return (
    <ClerkProvider
      publishableKey={clerkPublishableKey}
      nonce={nonce}
      appearance={{
        variables: {
          colorPrimary: "#38e8ff",
          colorBackground: "#07111f",
          colorText: "#f8fafc",
          colorInputBackground: "#0b1728",
          colorInputText: "#f8fafc",
          borderRadius: "0.5rem"
        },
        elements: {
          cardBox: "shadow-none",
          footerActionLink: "text-cyan-300"
        }
      }}
    >
      {children}
    </ClerkProvider>
  );
}
