import { SignUp } from "@clerk/nextjs";
import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { hasUnsafeQueryParams, sanitizeAuthSearchParams } from "@/lib/auth-url";
import { isClerkConfigured } from "@/lib/env";

type SignUpPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  noStore();
  const clerkEnabled = isClerkConfigured();
  const params = await searchParams;
  const urlParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params ?? {})) {
    if (Array.isArray(value)) {
      value.forEach((item) => urlParams.append(key, item));
    } else if (value) {
      urlParams.set(key, value);
    }
  }

  if (hasUnsafeQueryParams(urlParams, true)) {
    const cleanParams = sanitizeAuthSearchParams(urlParams).toString();
    redirect(`/sign-up${cleanParams ? `?${cleanParams}` : ""}`);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <Link href="/" className="absolute left-6 top-6 text-sm font-semibold uppercase tracking-[0.18em] text-cyan-soft">
        Sahara
      </Link>
      {clerkEnabled ? (
        <SignUp path="/sign-up" routing="path" signInUrl="/sign-in" fallbackRedirectUrl="/dashboard" />
      ) : (
        <AuthForm mode="sign-up" redirectUrl={typeof params?.redirect_url === "string" ? params.redirect_url : undefined} />
      )}
    </main>
  );
}
