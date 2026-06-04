import { NextRequest } from "next/server";
import { GET as callbackHandler } from "@/app/api/dhan/auth/callback/route";

export async function GET(request: NextRequest) {
  return callbackHandler(request);
}

