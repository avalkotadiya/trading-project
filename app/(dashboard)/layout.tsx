import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { getAuthenticatedUser, UnauthorizedError } from "@/lib/auth";
import { isClerkConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function ProtectedDashboardLayout({ children }: { children: ReactNode }) {
  const clerkEnabled = isClerkConfigured();
  let isAdmin = false;

  try {
    const user = await getAuthenticatedUser();
    isAdmin = user.role === "OWNER" || user.role === "ADMIN";
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect("/sign-in?redirect_url=/dashboard");
    }

    throw error;
  }

  return <DashboardShell clerkEnabled={clerkEnabled} isAdmin={isAdmin}>{children}</DashboardShell>;
}
