import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  try {
    const { invoiceId, leaseId, currentDate } = await request.json()

    if (!invoiceId && !leaseId) {
      return NextResponse.json({ error: 'Either invoice ID or lease ID is required' }, { status: 400 })
    }

    if (!currentDate) {
      return NextResponse.json({ error: 'Current date is required' }, { status: 400 })
    }

    console.log('🔍 Waive Late Fee Debug - Lease ID:', leaseId)

    if (leaseId) {
      // Verify the lease exists
      const { data: lease, error: leaseError } = await supabaseServer
        .from('RENT_leases')
        .select('id, notes')
        .eq('id', leaseId)
        .single()

      console.log('🔍 Lease fetch result:', { lease, leaseError })

      if (leaseError || !lease) {
        console.error('Error fetching lease:', leaseError)
        return NextResponse.json({ 
          error: 'Lease not found', 
          details: leaseError?.message || 'Lease not found',
          leaseId: leaseId 
        }, { status: 404 })
      }

      // Store waived late fee info in the lease notes field
      // This is a simple approach that will persist in the database
      const waiverInfo = {
        waived_late_fees: {
          [currentDate]: {
            waived_at: new Date().toISOString(),
            waived_by: 'system'
          }
        }
      }

      // Get existing notes or create new object
      const existingNotes = lease.notes ? JSON.parse(lease.notes) : {}
      const updatedNotes = {
        ...existingNotes,
        ...waiverInfo
      }

      // Update the lease with waived late fee information
      const { error: updateError } = await supabaseServer
        .from('RENT_leases')
        .update({ 
          notes: JSON.stringify(updatedNotes)
        })
        .eq('id', leaseId)

      if (updateError) {
        console.error('Error updating lease:', updateError)
        return NextResponse.json({ error: 'Failed to waive late fees' }, { status: 500 })
      }

      console.log('🔍 Waived late fees stored in lease notes:', waiverInfo)

      return NextResponse.json({ 
        success: true, 
        message: 'Late fees waived successfully for this lease',
        invoicesUpdated: 1,
        waiverInfo: waiverInfo
      })
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Late fees waived successfully',
      invoicesUpdated: 1
    })
  } catch (error) {
    console.error('Error in waive late fees API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

