import { NextRequest } from "next/server";
import { POST as placeOrder } from "@/app/api/dhan/orders/route";

export async function POST(request: NextRequest) {
  return placeOrder(request);
}

