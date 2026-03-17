import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = params.id

    const { data: document, error } = await supabaseServer
      .from('RENT_documents')
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      console.error('Error fetching document:', error)
      return NextResponse.json(
        { error: 'Failed to fetch document', details: error.message },
        { status: 500 }
      )
    }

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    let signedUrl: string | null = null
    if (document.file_url) {
      const { data: signed, error: urlError } = await supabaseServer.storage
        .from('documents')
        .createSignedUrl(document.file_url, 60 * 10) // 10 minutes

      if (urlError) {
        console.error('Error creating signed URL:', urlError)
      } else {
        signedUrl = signed?.signedUrl || null
      }
    }

    return NextResponse.json({
      ...document,
      signed_url: signedUrl,
      download_url: signedUrl,
    })
  } catch (error) {
    console.error('Error in document GET API:', error)
    return NextResponse.json(
      { error: 'Failed to fetch document', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = params.id
    const body = await request.json()

    const {
      title,
      notes,
      property_id,
      tenant_id,
      lease_id,
      expense_id,
      deal_id,
    } = body || {}

    const updateData: any = {}

    if (title !== undefined) updateData.title = title
    if (notes !== undefined) updateData.notes = notes
    if (property_id !== undefined) updateData.property_id = property_id || null
    if (tenant_id !== undefined) updateData.tenant_id = tenant_id || null
    if (lease_id !== undefined) updateData.lease_id = lease_id || null
    if (expense_id !== undefined) updateData.expense_id = expense_id || null
    if (deal_id !== undefined) updateData.deal_id = deal_id || null

    const { data, error } = await supabaseServer
      .from('RENT_documents')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating document:', error)
      return NextResponse.json(
        { error: 'Failed to update document', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in document PUT API:', error)
    return NextResponse.json(
      { error: 'Failed to update document', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = params.id

    // Fetch document to get storage path
    const { data: document, error: fetchError } = await supabaseServer
      .from('RENT_documents')
      .select('id, file_url')
      .eq('id', id)
      .single()

    if (fetchError) {
      console.error('Error fetching document for delete:', fetchError)
      return NextResponse.json(
        { error: 'Failed to delete document', details: fetchError.message },
        { status: 500 }
      )
    }

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    // Delete storage file first (best-effort)
    if (document.file_url) {
      const { error: storageError } = await supabaseServer.storage
        .from('documents')
        .remove([document.file_url])

      if (storageError) {
        console.error('Error deleting storage file for document:', storageError)
        // Continue anyway; DB record will still be removed
      }
    }

    const { error: deleteError } = await supabaseServer
      .from('RENT_documents')
      .delete()
      .eq('id', id)

    if (deleteError) {
      console.error('Error deleting document record:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete document', details: deleteError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in document DELETE API:', error)
    return NextResponse.json(
      { error: 'Failed to delete document', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

