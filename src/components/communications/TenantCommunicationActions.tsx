'use client'

import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline'
import { isUsablePhone } from '@/lib/communications/phone'

type Props = {
  phone?: string | null
  onText: () => void
  /** Kept for call-site compatibility; Text Tenant is always shown. */
  textEnabled?: boolean
  size?: 'xs' | 'sm' | 'lg'
  /** Optional compact label (e.g. "Text"). Defaults to "Text Tenant". */
  label?: string
  className?: string
}

/**
 * Primary tenant contact action: Text Tenant (manual SMS workflow).
 * Telephone call actions are not offered in the active interface.
 */
export function TenantCommunicationActions({
  phone,
  onText,
  size = 'sm',
  label = 'Text Tenant',
  className = '',
}: Props) {
  const usable = isUsablePhone(phone)
  const pad =
    size === 'lg'
      ? 'px-4 py-3 text-base'
      : size === 'xs'
        ? 'px-2 py-1 text-xs'
        : 'px-3 py-2 text-sm'
  const icon = size === 'lg' ? 'h-5 w-5' : size === 'xs' ? 'h-3.5 w-3.5' : 'h-4 w-4'

  return (
    <div className={`inline-flex flex-nowrap ${className}`}>
      <button
        type="button"
        onClick={onText}
        title={
          usable
            ? 'Prepare a text message for this tenant'
            : 'Open Text Tenant (phone missing or invalid)'
        }
        className={`inline-flex items-center justify-center gap-1 rounded-md font-medium bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap ${pad}`}
      >
        <ChatBubbleLeftRightIcon className={icon} aria-hidden />
        {label}
      </button>
    </div>
  )
}
