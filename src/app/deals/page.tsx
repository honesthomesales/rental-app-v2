'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Legacy /deals -> combined Deals / Docs (deals view). */
export default function DealsRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/deals-docs?view=deals')
  }, [router])
  return (
    <div className="p-6">
      <p className="text-sm text-gray-600">Opening Deals...</p>
    </div>
  )
}
