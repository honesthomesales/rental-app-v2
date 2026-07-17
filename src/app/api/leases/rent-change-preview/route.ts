import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabase-server";

import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";

import { getBusinessDate } from "@/lib/business-date";

import {

  buildRentChangePreview,

  getProspectiveEffectiveDateOptions,

  type InvoiceForRentChange,

} from "@/lib/rent-change";

import { partitionPaymentsByAsOf } from "@/lib/payment-eligibility";



/**

 * Read-only prospective rent-change preview for existing invoices.

 * Never writes. Never deletes payments or invoices.

 */

export async function GET(request: Request) {

  const auth = await requireApiAuth(request);

  if (isAuthError(auth)) return auth;



  try {

    const { searchParams } = new URL(request.url);

    const leaseId = searchParams.get("leaseId");

    const newRentRaw = searchParams.get("newRent");

    const effectiveDateParam = searchParams.get("effectiveDate");

    const addressQuery = searchParams.get("address");



    let resolvedLeaseId = leaseId;



    if (!resolvedLeaseId && addressQuery) {

      const { data: props } = await supabaseServer

        .from("RENT_properties")

        .select("id, name, address")

        .ilike("address", `%${addressQuery}%`);



      if (!props || props.length === 0) {

        return NextResponse.json(

          { error: "No property matched address query", previewOnly: true },

          { status: 404 },

        );

      }



      const propertyIds = props.map((p) => p.id);

      const { data: leases } = await supabaseServer

        .from("RENT_leases")

        .select(

          "id, rent, rent_cadence, status, property_id, RENT_properties(name, address)",

        )

        .in("property_id", propertyIds)

        .in("status", ["occupied", "eviction"])

        .order("created_at", { ascending: false });



      if (!leases || leases.length === 0) {

        return NextResponse.json(

          {

            error: "No occupied/eviction lease for matched address",

            matchedProperties: props.map((p) => ({

              id: p.id,

              address: p.address,

            })),

            previewOnly: true,

          },

          { status: 404 },

        );

      }



      resolvedLeaseId = leases[0].id;

    }



    if (!resolvedLeaseId) {

      return NextResponse.json(

        { error: "leaseId or address is required" },

        { status: 400 },

      );

    }



    const newRent =

      newRentRaw != null ? Number(newRentRaw) : Number.NaN;

    if (!Number.isFinite(newRent)) {

      return NextResponse.json(

        { error: "newRent is required and must be a number" },

        { status: 400 },

      );

    }



    const { data: lease, error: leaseError } = await supabaseServer

      .from("RENT_leases")

      .select(

        "id, rent, rent_cadence, rent_due_day, lease_start_date, status, property_id, tenant_id, lease_end_date, RENT_properties(name, address), RENT_tenants(full_name, first_name, last_name)",

      )

      .eq("id", resolvedLeaseId)

      .single();



    if (leaseError || !lease) {

      return NextResponse.json({ error: "Lease not found" }, { status: 404 });

    }



    const businessDate = getBusinessDate();

    const effectiveDate =

      effectiveDateParam && String(effectiveDateParam).trim() !== ""

        ? String(effectiveDateParam).split("T")[0]

        : businessDate;



    const { data: invoices, error: invError } = await supabaseServer

      .from("RENT_invoices")

      .select(

        "id, due_date, status, amount_rent, amount_late, amount_other, amount_total, amount_paid, balance_due",

      )

      .eq("lease_id", resolvedLeaseId)

      .order("due_date", { ascending: true });



    if (invError) {

      return NextResponse.json(

        { error: "Failed to fetch invoices", details: invError.message },

        { status: 500 },

      );

    }



    const { data: payments } = await supabaseServer

      .from("RENT_payments")

      .select("invoice_id, amount, payment_date, status")

      .eq("lease_id", resolvedLeaseId)

      .eq("status", "completed")

      .not("invoice_id", "is", null);



    const { eligible } = partitionPaymentsByAsOf(

      (payments || []) as Array<{

        invoice_id: string;

        amount: number;

        payment_date: string;

        status: string;

      }>,

      businessDate,

    );



    const paidByInvoice = new Map<string, number>();

    for (const p of eligible) {

      if (!p.invoice_id) continue;

      paidByInvoice.set(

        p.invoice_id,

        (paidByInvoice.get(p.invoice_id) || 0) +

          (parseFloat(String(p.amount)) || 0),

      );

    }



    const invoiceRows: InvoiceForRentChange[] = (invoices || []).map((inv) => {

      const actualPaid = paidByInvoice.has(inv.id)

        ? paidByInvoice.get(inv.id)!

        : Number(inv.amount_paid) || 0;

      return {

        id: inv.id,

        due_date: inv.due_date,

        status: inv.status,

        amount_rent: Number(inv.amount_rent) || 0,

        amount_late: Number(inv.amount_late) || 0,

        amount_other: Number(inv.amount_other) || 0,

        amount_total: Number(inv.amount_total) || 0,

        amount_paid: actualPaid,

        balance_due: Number(inv.balance_due) || 0,

      };

    });



    const preview = buildRentChangePreview({

      invoices: invoiceRows,

      oldRent: Number(lease.rent) || 0,

      newRent,

      effectiveDate,

      businessDate,

    });



    const effectiveDateOptions = getProspectiveEffectiveDateOptions({

      businessDate,

      leaseStartDate: lease.lease_start_date || businessDate,

      rentCadence: lease.rent_cadence || "monthly",

      rentDueDay: lease.rent_due_day,

    });



    const prop = Array.isArray(lease.RENT_properties)

      ? lease.RENT_properties[0]

      : lease.RENT_properties;

    const tenant = Array.isArray(lease.RENT_tenants)

      ? lease.RENT_tenants[0]

      : lease.RENT_tenants;



    return NextResponse.json({
      previewOnly: true,
      writePerformed: false,
      leaseId: resolvedLeaseId,
      currentRent: lease.rent,
      effectiveDateOptions,
      property: prop
        ? { name: (prop as { name?: string }).name, address: (prop as { address?: string }).address }
        : null,
      tenant: tenant
        ? {
            name:
              (tenant as { full_name?: string }).full_name ||
              [
                (tenant as { first_name?: string }).first_name,
                (tenant as { last_name?: string }).last_name,
              ]
                .filter(Boolean)
                .join(" "),
          }
        : null,
      ...preview,
    });
  } catch (error) {

    console.error("rent-change-preview error:", error);

    return NextResponse.json(

      { error: "Failed to build rent-change preview" },

      { status: 500 },

    );

  }

}


