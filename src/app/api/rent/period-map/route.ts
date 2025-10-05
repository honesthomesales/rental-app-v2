import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { PeriodMapRequest, PeriodMapResponse, PeriodInvoiceRow } from '@/types/rent';

export async function POST(request: NextRequest) {
  try {
    // Log request details for debugging
    const url = request.url;
    const method = request.method;
    const headers = Object.fromEntries(request.headers.entries());
    console.log('🔍 API Request Details:', { url, method, contentType: headers['content-type'], contentLength: headers['content-length'] });

    // Parse JSON with better error handling
    let body: PeriodMapRequest;
    try {
      const rawBody = await request.text();
      console.log('📝 Raw request body:', rawBody.substring(0, 200) + (rawBody.length > 200 ? '...' : ''));
      
      if (!rawBody.trim()) {
        console.error('❌ Empty request body received');
        return NextResponse.json(
          { error: 'Request body is empty' },
          { status: 400 }
        );
      }
      
      body = JSON.parse(rawBody);
    } catch (jsonError) {
      console.error('❌ JSON parsing error:', jsonError);
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }
    
    const { leaseIds, from, to } = body;

    // Validate input
    if (!leaseIds || !Array.isArray(leaseIds) || leaseIds.length === 0) {
      return NextResponse.json(
        { error: 'leaseIds must be a non-empty array' },
        { status: 400 }
      );
    }

    if (!from || !to) {
      return NextResponse.json(
        { error: 'from and to dates are required (YYYY-MM-DD format)' },
        { status: 400 }
      );
    }

    // Validate date format and range
    const fromDate = new Date(from);
    const toDate = new Date(to);
    
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return NextResponse.json(
        { error: 'Invalid date format. Use YYYY-MM-DD' },
        { status: 400 }
      );
    }

    if (fromDate > toDate) {
      return NextResponse.json(
        { error: 'from date must be less than or equal to to date' },
        { status: 400 }
      );
    }

    // Validate lease count (prevent excessive load)
    const maxLeaseIds = 500;
    if (leaseIds.length > maxLeaseIds) {
      return NextResponse.json(
        { error: `Too many lease IDs. Maximum allowed: ${maxLeaseIds}` },
        { status: 400 }
      );
    }

    // Validate date range (prevent excessive data)
    const maxMonths = 18;
    const monthsDiff = (toDate.getFullYear() - fromDate.getFullYear()) * 12 + 
                      (toDate.getMonth() - fromDate.getMonth());
    if (monthsDiff > maxMonths) {
      return NextResponse.json(
        { error: `Date range too large. Maximum allowed: ${maxMonths} months` },
        { status: 400 }
      );
    }

    // Validate UUID format for lease IDs (more lenient validation)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const invalidLeaseIds = leaseIds.filter(id => !uuidRegex.test(id));
    if (invalidLeaseIds.length > 0) {
      return NextResponse.json(
        { error: `Invalid lease ID format: ${invalidLeaseIds.slice(0, 3).join(', ')}` },
        { status: 400 }
      );
    }

    console.info(`Payments2.0 batch load: leases=${leaseIds.length}, range=${from}..${to}`);

    try {
      // Call the RPC function with correct parameter names
      const { data, error } = await supabaseServer.rpc(
        'RENT_period_invoice_map_many',
        {
          lease_ids: leaseIds,
          from_date: fromDate.toISOString().split('T')[0], // YYYY-MM-DD
          to_date: toDate.toISOString().split('T')[0]      // YYYY-MM-DD
        }
      );

      if (error) {
        console.error('RPC call failed:', error);
        return NextResponse.json(
          { error: `RPC call failed: ${error.message}` },
          { status: 500 }
        );
      }

      // Normalize the response data
      const rows: PeriodInvoiceRow[] = (data || []).map((row: Record<string, unknown>) => ({
        lease_id: row.lease_id,
        property_id: row.property_id,
        tenant_id: row.tenant_id,
        cadence: row.cadence,
        period_start: row.period_start,
        period_end: row.period_end,
        due_date: row.due_date,
        invoice_id: row.invoice_id,
        billed_total: Number(row.billed_total || 0),
        paid_to_rent: Number(row.paid_to_rent || 0),
        paid_to_late: Number(row.paid_to_late || 0),
        balance_due: Number(row.balance_due || 0),
        is_missing_invoice: Boolean(row.is_missing_invoice)
      }));

      console.info(`Payments2.0 batch load: leases=${leaseIds.length}, range=${from}..${to}, rows=${rows.length}`);

      const response: PeriodMapResponse = { rows };
      return NextResponse.json(response);

    } catch (error) {
      console.error('Error calling RPC:', error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unknown RPC error' },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('API route error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
