import { NextRequest, NextResponse } from "next/server";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";
import { getBusinessDate } from "@/lib/business-date";
import { supabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAuth(request, { write: true });
  if (isAuthError(auth)) return auth;

  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    if (body.confirmed !== true) {
      return NextResponse.json(
        { error: "Explicit waiver confirmation is required" },
        { status: 400 },
      );
    }

    const businessDate = getBusinessDate();
    const { data, error } = await supabaseServer.rpc("rent_waive_late_fee", {
      p_invoice_id: id,
      p_business_date: businessDate,
    });
    if (error) {
      return NextResponse.json(
        {
          error: "Late fee was not waived",
          details: error.message,
          writePerformed: false,
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        ...(data && typeof data === "object" ? data : {}),
        writePerformed: true,
      },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to waive late fee",
        details: error instanceof Error ? error.message : "Unknown error",
        writePerformed: false,
      },
      { status: 500 },
    );
  }
}
