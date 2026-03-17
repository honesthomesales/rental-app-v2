import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: 'File is required' },
        { status: 400 }
      )
    }

    const extension = 'pdf'
    const fileName =
      (formData.get('filename') as string | null) ||
      `${crypto.randomUUID()}.${extension}`

    const arrayBuffer = await file.arrayBuffer()
    const buffer = new Uint8Array(arrayBuffer)

    const { data, error } = await supabaseServer.storage
      .from('documents')
      .upload(fileName, buffer, {
        contentType: 'application/pdf',
        upsert: false,
      })

    if (error) {
      console.error('Error uploading document to storage:', error)
      return NextResponse.json(
        { error: 'Failed to upload file', details: error.message },
        { status: 500 }
      )
    }

    const fileSize = buffer.byteLength

    return NextResponse.json({
      file_url: data.path,
      file_size: fileSize,
    })
  } catch (error) {
    console.error('Error in document upload API:', error)
    return NextResponse.json(
      { error: 'Failed to upload file', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

