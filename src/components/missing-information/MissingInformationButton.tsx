'use client'

import { useCallback, useEffect, useState } from 'react'
import { MissingInformationModal } from './MissingInformationModal'

type Props = {
  className?: string
}

export function MissingInformationButton({ className }: Props) {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState<number | null>(null)
  const [loadingCount, setLoadingCount] = useState(false)

  const refreshCount = useCallback(async () => {
    setLoadingCount(true)
    try {
      const res = await fetch('/api/missing-information', {
        credentials: 'include',
        cache: 'no-store',
      })
      const data = await res.json()
      if (!res.ok) {
        setCount(null)
        return
      }
      const next =
        typeof data.count === 'number'
          ? data.count
          : Array.isArray(data.findings)
            ? data.findings.length
            : 0
      setCount(next)
    } catch {
      setCount(null)
    } finally {
      setLoadingCount(false)
    }
  }, [])

  useEffect(() => {
    void refreshCount()
  }, [refreshCount])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ||
          'inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700'
        }
      >
        Missing Information
        <span className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-white/20 px-1.5 py-0.5 text-xs font-semibold">
          {loadingCount ? '…' : count == null ? '—' : count}
        </span>
      </button>
      <MissingInformationModal
        open={open}
        onClose={() => {
          setOpen(false)
          void refreshCount()
        }}
      />
    </>
  )
}
