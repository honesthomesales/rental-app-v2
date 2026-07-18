import { NextResponse } from "next/server";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";
import { getBusinessDate } from "@/lib/business-date";
import { supabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAuth(request, { write: true });
  if (isAuthError(auth)) return auth;

  try {
    const { id } = await context.params;
    const body = await request.json();
    if (body.confirmed !== true) {
      return NextResponse.json(
        { error: "Explicit correction confirmation is required" },
        { status: 400 },
      );
    }

    const amountRent = Number(body.amountRent);
    const amountLate = Number(body.amountLate);
    const amountOther = Number(body.amountOther);
    if (
      ![amountRent, amountLate, amountOther].every(
        (value) => Number.isFinite(value) && value >= 0,
      )
    ) {
      return NextResponse.json(
        { error: "Rent, late fee, and other charge must be non-negative numbers" },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseServer.rpc(
      "rent_correct_single_invoice",
      {
        p_invoice_id: id,
        p_amount_rent: amountRent,
        p_amount_late: amountLate,
        p_amount_other: amountOther,
        p_business_date: getBusinessDate(),
        p_waive_late_fee: body.waiveLateFee === true,
      },
    );

    if (error) {
      return NextResponse.json(
        { error: "Invoice correction failed", details: error.message },
        { status: 409 },
      );
    }

    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Invoice correction failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
