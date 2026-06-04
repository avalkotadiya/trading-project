import { NextResponse } from "next/server";
import type { ApiFailure, ApiSuccess } from "@/types/api";
import { UnauthorizedError } from "@/lib/auth";
import { DhanError } from "@/services/dhan/dhanClient";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json<ApiSuccess<T>>({ ok: true, data }, init);
}

export function fail(code: string, message: string, status = 400, details?: unknown) {
  return NextResponse.json<ApiFailure>(
    {
      ok: false,
      error: {
        code,
        message,
        details
      }
    },
    { status }
  );
}

/**
 * Convert an unknown error thrown inside a Dhan-backed route handler into a
 * proper API failure response. `UnauthorizedError` becomes 401; everything
 * else is treated as a `DhanError` and carries its status/code/details
 * through (falling back to the supplied code at HTTP 500).
 *
 * This exists because the previous pattern (`error as DhanError; fail(...,
 * err.status || 500)`) returned 500 on auth failures since `UnauthorizedError`
 * has no `.status` field, hiding the real reason from the client.
 */
export function failFromDhanRouteError(error: unknown, fallbackCode: string) {
  if (error instanceof UnauthorizedError) {
    return fail("UNAUTHORIZED", error.message, 401);
  }
  const err = error as DhanError;
  return fail(err.code || fallbackCode, err.message, err.status || 500, err.details);
}
