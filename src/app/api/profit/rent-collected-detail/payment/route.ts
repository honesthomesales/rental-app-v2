import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";
import { parsePaymentUuid } from "@/lib/payments/payment-id";
import {
  getDeferredSelectedInvoiceId,
  withDeferredSelectedInvoiceNote,
} from "@/lib/payments/post-allocated-payment";
import {
  assertPaymentInProfitRentCollectedDetail,
  RentCollectedDetailAccessError,
} from "@/lib/profit/rent-collected-detail-access";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function readScopedParams(request: Request) {
  const { searchParams } = new URL(request.url);
  const propertyId = searchParams.get("propertyId")?.trim() || "";
  return {
    paymentId: parsePaymentUuid(searchParams.get("paymentId")),
    propertyId: propertyId.length > 0 ? propertyId : null,
    month: searchParams.get("month")?.trim() || "",
  };
}

function accessErrorResponse(error: RentCollectedDetailAccessError) {
  return NextResponse.json({ error: error.message }, { status: error.status });
}

export async function DELETE(request: Request) {
  const auth = await requireApiAuth(request, { write: true });
  if (isAuthError(auth)) return auth;

  try {
    const { paymentId, propertyId, month } = readScopedParams(request);

    if (!paymentId || !propertyId || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json(
        {
          error:
            "paymentId (UUID), propertyId, and month (YYYY-MM) are required",
        },
        { status: 400 },
      );
    }

    await assertPaymentInProfitRentCollectedDetail({
      paymentId,
      propertyId,
      month,
    });

    const { data: existing, error: lookupError } = await supabaseServer
      .from("RENT_payments")
      .select("id")
      .eq("id", paymentId)
      .maybeSingle();

    if (lookupError) {
      return NextResponse.json(
        { error: "Failed to verify payment", details: lookupError.message },
        { status: 500 },
      );
    }

    if (!existing) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    const { error: deleteError } = await supabaseServer
      .from("RENT_payments")
      .delete()
      .eq("id", paymentId);

    if (deleteError) {
      return NextResponse.json(
        { error: "Failed to delete payment", details: deleteError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      deletedPaymentId: paymentId,
    });
  } catch (error) {
    if (error instanceof RentCollectedDetailAccessError) {
      return accessErrorResponse(error);
    }
    console.error("Error in profit rent-collected payment DELETE:", error);
    return NextResponse.json(
      {
        error: "Failed to delete payment",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const auth = await requireApiAuth(request, { write: true });
  if (isAuthError(auth)) return auth;

  try {
    const { paymentId, propertyId, month } = readScopedParams(request);
    const body = await request.json();

    if (!paymentId || !propertyId || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json(
        {
          error:
            "paymentId (UUID), propertyId, and month (YYYY-MM) are required",
        },
        { status: 400 },
      );
    }

    await assertPaymentInProfitRentCollectedDetail({
      paymentId,
      propertyId,
      month,
    });

    const updateData: Record<string, unknown> = {};
    if (body.payment_date !== undefined) {
      updateData.payment_date = body.payment_date;
    }
    if (body.amount !== undefined) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json(
          { error: "Amount must be greater than 0" },
          { status: 400 },
        );
      }
      updateData.amount = amount;
    }
    if (body.payment_type !== undefined) {
      updateData.payment_type = body.payment_type;
    }
    if (body.notes !== undefined) {
      const { data: existingPayment } = await supabaseServer
        .from("RENT_payments")
        .select("notes")
        .eq("id", paymentId)
        .maybeSingle();
      const deferredInvoiceId = existingPayment
        ? getDeferredSelectedInvoiceId(existingPayment.notes)
        : null;
      updateData.notes = deferredInvoiceId
        ? withDeferredSelectedInvoiceNote(
            String(body.notes || ""),
            deferredInvoiceId,
          )
        : body.notes;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 },
      );
    }

    const { error: updateError } = await supabaseServer
      .from("RENT_payments")
      .update(updateData)
      .eq("id", paymentId);

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to update payment", details: updateError.message },
        { status: 500 },
      );
    }

    const { data: updatedPayment } = await supabaseServer
      .from("RENT_payments")
      .select(
        "id, lease_id, property_id, tenant_id, invoice_id, payment_date, amount, payment_type, payment_method, status, notes, created_at",
      )
      .eq("id", paymentId)
      .maybeSingle();

    return NextResponse.json({
      success: true,
      payment: updatedPayment,
    });
  } catch (error) {
    if (error instanceof RentCollectedDetailAccessError) {
      return accessErrorResponse(error);
    }
    console.error("Error in profit rent-collected payment PUT:", error);
    return NextResponse.json(
      {
        error: "Failed to update payment",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
