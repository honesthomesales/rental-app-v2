'use client'

import { PhoneIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline'
import { telHref, isUsablePhone } from '@/lib/communications/phone'

type Props = {
  phone?: string | null
  onText: () => void
  /** When feature is off, show Coming soon on Text */
  comingSoon?: boolean
  size?: 'sm' | 'lg'
  className?: string
}

export function TenantCommunicationActions({
  phone,
  onText,
  comingSoon = false,
  size = 'sm',
  className = '',
}: Props) {
  const usable = isUsablePhone(phone)
  const href = telHref(phone)
  const pad = size === 'lg' ? 'px-4 py-3 text-base' : 'px-3 py-2 text-sm'
  const icon = size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      <a
        href={usable && href ? href : undefined}
        aria-disabled={!usable}
        onClick={(e) => {
          if (!usable) e.preventDefault()
        }}
        className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium border ${pad} ${
          usable
            ? 'bg-white border-gray-300 text-gray-800 hover:bg-gray-50'
            : 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed pointer-events-none'
        }`}
      >
        <PhoneIcon className={icon} />
        Call Tenant
      </a>
      <button
        type="button"
        onClick={onText}
        disabled={comingSoon && !usable}
        title={comingSoon ? 'Coming soon' : undefined}
        className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium ${pad} ${
          comingSoon
            ? 'bg-gray-200 text-gray-600'
            : 'bg-blue-600 text-white hover:bg-blue-700'
        }`}
      >
        <ChatBubbleLeftRightIcon className={icon} />
        {comingSoon ? 'Text (Coming soon)' : 'Text Tenant'}
      </button>
    </div>
  )
}
