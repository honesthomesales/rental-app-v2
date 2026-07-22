'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Alias /docs -> Deals / Docs documents view. */
export default function DocsAliasRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/deals-docs?view=docs')
  }, [router])
  return (
    <div className="p-6">
      <p className="text-sm text-gray-600">Opening Docs...</p>
    </div>
  )
}
