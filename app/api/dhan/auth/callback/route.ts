import { NextRequest, NextResponse } from "next/server";
import { dhanAuthService } from "@/services/dhan/dhanAuth";

export async function GET(request: NextRequest) {
  const tokenId = request.nextUrl.searchParams.get("tokenId") ?? request.nextUrl.searchParams.get("code") ?? "";
  const redirectTarget = new URL("/settings", request.nextUrl.origin);

  try {
    const result = await dhanAuthService.consumeConsentToken(tokenId);
    redirectTarget.searchParams.set("dhanAuth", "success");
    redirectTarget.searchParams.set("expires", result.expiryTime ?? "unknown");
    return NextResponse.redirect(redirectTarget);
  } catch (error) {
    redirectTarget.searchParams.set("dhanAuth", "failed");
    redirectTarget.searchParams.set("error", error instanceof Error ? error.message : "Token exchange failed");
    return NextResponse.redirect(redirectTarget);
  }
}

