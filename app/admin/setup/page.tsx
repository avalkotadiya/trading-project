"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function AdminSetupPage() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const router = useRouter();

  async function handleClaimOwner() {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/auth/setup-admin", {
        method: "POST"
      });
      const data = await response.json();

      if (data.ok) {
        setMessage({ text: data.message, isError: false });
        setTimeout(() => router.push("/dashboard"), 1500);
      } else {
        setMessage({ text: data.error, isError: true });
      }
    } catch {
      setMessage({ text: "An unexpected error occurred.", isError: true });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen w-full items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Initial Admin Setup</CardTitle>
          <CardDescription>
            Claim the OWNER role for your account. This action can only be performed once.
            If an owner already exists, this route will be locked.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {message && (
            <div className={`p-3 rounded-md text-sm ${message.isError ? "bg-red-500/10 text-red-500" : "bg-green-500/10 text-green-500"}`}>
              {message.text}
            </div>
          )}
          <Button className="w-full" onClick={handleClaimOwner} disabled={loading}>
            {loading ? "Claiming..." : "Claim OWNER Role"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
