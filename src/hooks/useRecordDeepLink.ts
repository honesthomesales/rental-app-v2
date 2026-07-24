'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

/**
 * Deep-link helper for Missing Information → existing screens.
 * Reads ?id= or ?highlight= and invokes onSelect once records are available.
 */
export function useRecordDeepLink<T extends { id: string }>(args: {
  records: T[]
  loading?: boolean
  onSelect: (record: T, field: string | null) => void
}) {
  const searchParams = useSearchParams()
  const id = searchParams.get('id') || searchParams.get('highlight')
  const field = searchParams.get('field')

  useEffect(() => {
    if (args.loading) return
    if (!id || args.records.length === 0) return
    const match = args.records.find((r) => String(r.id) === String(id))
    if (!match) return
    args.onSelect(match, field)
    // Scroll selected row into view when present
    requestAnimationFrame(() => {
      const el =
        document.querySelector(`[data-record-id="${id}"]`) ||
        document.getElementById(`record-${id}`)
      if (el && 'scrollIntoView' in el) {
        ;(el as HTMLElement).scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        })
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run when list/id ready
  }, [args.loading, args.records, id, field])
}
