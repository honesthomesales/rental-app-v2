import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { isAuthError, requireApiAuth } from "@/lib/auth/api-auth";
import { getBusinessDate } from "@/lib/business-date";

/**
 * Read-only list of leases needing manual review:
 * past lease_end_date, status empty, tenant/property still attached.
 * Never writes.
 */
export async function GET(request: Request) {
  const auth = await requireApiAuth(request);
  if (isAuthError(auth)) return auth;

  try {
    const businessDate = getBusinessDate();

    const { data: leases, error } = await supabaseServer
      .from("RENT_leases")
      .select(
        `
        id,
        status,
        lease_start_date,
        lease_end_date,
        rent,
        rent_cadence,
        property_id,
        tenant_id,
        RENT_properties(id, name, address),
        RENT_tenants(id, full_name, first_name, last_name)
      `,
      )
      .eq("status", "empty")
      .not("lease_end_date", "is", null)
      .lt("lease_end_date", businessDate)
      .not("property_id", "is", null)
      .not("tenant_id", "is", null)
      .order("lease_end_date", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch leases", details: error.message },
        { status: 500 },
      );
    }

    const rows = (leases || []).map((lease) => {
      const prop = Array.isArray(lease.RENT_properties)
        ? lease.RENT_properties[0]
        : lease.RENT_properties;
      const tenant = Array.isArray(lease.RENT_tenants)
        ? lease.RENT_tenants[0]
        : lease.RENT_tenants;
      return {
        leaseId: lease.id,
        status: lease.status,
        leaseStartDate: lease.lease_start_date,
        leaseEndDate: lease.lease_end_date,
        rent: lease.rent,
        rentCadence: lease.rent_cadence,
        property: prop
          ? {
              id: (prop as { id: string }).id,
              name: (prop as { name?: string }).name,
              address: (prop as { address?: string }).address,
            }
          : null,
        tenant: tenant
          ? {
              id: (tenant as { id: string }).id,
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
      };
    });

    return NextResponse.json({
      previewOnly: true,
      writePerformed: false,
      businessDate,
      count: rows.length,
      leases: rows,
    });
  } catch (error) {
    console.error("manual-review leases error:", error);
    return NextResponse.json(
      { error: "Failed to list leases for manual review" },
      { status: 500 },
    );
  }
}
