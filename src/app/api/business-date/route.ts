import { NextResponse } from "next/server";
import { getBusinessDate, BUSINESS_TIMEZONE } from "@/lib/business-date";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";

export async function GET(request: Request) {
  const auth = await requireApiAuth(request);
  if (isAuthError(auth)) return auth;
  const businessDate = getBusinessDate();
  return NextResponse.json({
    businessDate,
    timezone: BUSINESS_TIMEZONE,
  });
}
