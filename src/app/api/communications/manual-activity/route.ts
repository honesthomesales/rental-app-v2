import { NextResponse } from 'next/server'
import { isAuthError, requireApiAuth } from '@/lib/auth/api-auth'
import { supabaseServer } from '@/lib/supabase-server'
import { areCommunicationTablesReady } from '@/lib/communications/schema'
import { normalizeToE164 } from '@/lib/communications/phone'

const KINDS = new Set([
  'text_prepared',
  'message_copied',
  'sms_app_opened',
  'manually_sent',
  'canceled',
])

/**
 * POST /api/communications/manual-activity
 * Records manual Text Tenant workflow events. Never marks provider delivery.
 * Works even when Twilio/provider flags are off, when communications tables exist.
 */
export async function POST(request: Request) {
  const auth = await requireApiAuth(request)
  if (isAuthError(auth)) return auth

  try {
    const body = await request.json()
    const tenantId = String(body.tenantId || '')
    const kind = String(body.kind || '')
    if (!tenantId || !KINDS.has(kind)) {
      return NextResponse.json(
        { error: 'tenantId and valid kind are required' },
        { status: 400 },
      )
    }

    const ready = await areCommunicationTablesReady()
    if (!ready) {
      return NextResponse.json({
        ok: true,
        recorded: false,
        reason: 'communications_schema_unavailable',
      })
    }

    const { data: tenant, error: tenantError } = await supabaseServer
      .from('RENT_tenants')
      .select('id, phone')
      .eq('id', tenantId)
      .maybeSingle()

    if (tenantError || !tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
    }

    const message = String(body.message || '').slice(0, 2000)
    const templateKey = body.templateKey ? String(body.templateKey) : null
    const phoneE164 = normalizeToE164(tenant.phone)

    const { data, error } = await supabaseServer
      .from('RENT_communications')
      .insert({
        tenant_id: tenantId,
        property_id: body.propertyId || null,
        lease_id: body.leaseId || null,
        direction: 'outbound',
        channel: 'sms_manual',
        body: message || `[manual activity: ${kind}]`,
        template_key: templateKey,
        status: `manual_${kind}`,
        phone_e164: phoneE164,
        metadata: {
          manual: true,
          kind,
          deliveryStatus: 'manual_unverified',
          note: 'Opening SMS or marking manually sent does not prove delivery',
        },
      })
      .select('id')
      .maybeSingle()

    if (error) {
      // Soft-fail if column set differs; do not block the UI workflow
      return NextResponse.json({
        ok: true,
        recorded: false,
        reason: error.message,
      })
    }

    return NextResponse.json({ ok: true, recorded: true, id: data?.id || null })
  } catch {
    return NextResponse.json({ error: 'Failed to record activity' }, { status: 500 })
  }
}
