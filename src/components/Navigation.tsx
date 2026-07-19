'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { 
  HomeIcon, 
  BuildingOfficeIcon, 
  UsersIcon, 
  DocumentTextIcon,
  CurrencyDollarIcon, 
  ChartBarIcon,
  Bars3Icon,
  XMarkIcon,
  ReceiptPercentIcon,
  ShoppingBagIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  ShieldCheckIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline'
import { useEffect, useState } from 'react'

const navigation = [
  { name: 'Dashboard', href: '/', icon: HomeIcon },
  { name: 'Properties', href: '/properties', icon: BuildingOfficeIcon },
  { name: 'Tenants', href: '/tenants', icon: UsersIcon },
  { name: 'Leases', href: '/leases', icon: DocumentTextIcon },
  { name: 'Payments', href: '/payments', icon: CurrencyDollarIcon },
  { name: 'Late Tenants', href: '/late-tenants', icon: ExclamationTriangleIcon },
  { name: 'Expenses', href: '/expenses', icon: ReceiptPercentIcon },
  { name: 'Last Paid', href: '/last-paid', icon: ClockIcon },
  { name: 'Profit', href: '/profit', icon: ChartBarIcon },
]

const ownerNavigationAlways = [
  { name: 'Data Health', href: '/data-health', icon: ShieldCheckIcon },
]

const ownerCommunicationsNav = {
  name: 'Communication Approvals',
  href: '/communication-approvals',
  icon: ChatBubbleLeftRightIcon,
}

const DEAL_DOCS = { deals: '/deals', docs: '/documents' } as const

function DealDocsToggle({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const isDeals = pathname === DEAL_DOCS.deals
  const isDocs = pathname === DEAL_DOCS.docs

  const segmentClass = (active: boolean) =>
    `px-2 py-0.5 text-xs font-medium rounded transition-colors ${
      active
        ? 'bg-blue-600 text-white'
        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
    }`

  return (
    <div
      className="inline-flex items-center rounded-md border border-gray-200 bg-gray-50 p-0.5"
      role="group"
      aria-label="Switch between Deals and Documents"
    >
      <Link
        href={DEAL_DOCS.deals}
        onClick={onNavigate}
        className={segmentClass(isDeals)}
      >
        Deal
      </Link>
      <Link
        href={DEAL_DOCS.docs}
        onClick={onNavigate}
        className={segmentClass(isDocs)}
      >
        Docs
      </Link>
    </div>
  )
}

function DealDocsNavItem({
  layout,
  onNavigate,
}: {
  layout: 'desktop' | 'mobile'
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const isActive = pathname === DEAL_DOCS.deals || pathname === DEAL_DOCS.docs

  if (layout === 'mobile') {
    return (
      <div
        className={`rounded-md px-3 py-2 ${
          isActive ? 'bg-blue-100' : 'text-gray-600'
        }`}
      >
        <div className="flex items-center text-base font-medium text-gray-900">
          <ShoppingBagIcon
            className={`mr-3 h-5 w-5 flex-shrink-0 ${
              isActive ? 'text-blue-500' : 'text-gray-400'
            }`}
          />
          Deal / Docs
        </div>
        <div className="mt-2 ml-8">
          <DealDocsToggle onNavigate={onNavigate} />
        </div>
      </div>
    )
  }

  return (
    <div
      className={`flex flex-col items-center px-2 py-1 rounded-md ${
        isActive ? 'bg-blue-50' : ''
      }`}
    >
      <div
        className={`flex items-center text-sm font-medium ${
          isActive ? 'text-blue-700' : 'text-gray-600'
        }`}
      >
        <ShoppingBagIcon
          className={`mr-1.5 h-5 w-5 flex-shrink-0 ${
            isActive ? 'text-blue-500' : 'text-gray-400'
          }`}
        />
        Deal / Docs
      </div>
      <div className="mt-1">
        <DealDocsToggle />
      </div>
    </div>
  )
}

export function Navigation() {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  const [communicationsEnabled, setCommunicationsEnabled] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/auth/session', {
          credentials: 'include',
          cache: 'no-store',
        })
        if (!res.ok) return
        const data = await res.json()
        setIsOwner(data.role === 'owner')
        setCommunicationsEnabled(
          Boolean(data.features?.tenantCommunicationsEnabled),
        )
      } catch {
        /* ignore */
      }
    })()
  }, [])

  const ownerNavigation = [
    ...(communicationsEnabled ? [ownerCommunicationsNav] : []),
    ...ownerNavigationAlways,
  ]

  const navItems = isOwner
    ? [...navigation, ...ownerNavigation]
    : navigation

  const renderNavLink = (
    item: (typeof navigation)[0],
    layout: 'desktop' | 'mobile'
  ) => {
    const isActive = pathname === item.href
    const isLateTenants = item.name === 'Late Tenants'
    const baseClass =
      layout === 'desktop'
        ? 'flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors'
        : 'flex items-center px-3 py-2 text-base font-medium rounded-md'
    const activeClass = isActive
      ? isLateTenants
        ? 'bg-red-100 text-red-700'
        : 'bg-blue-100 text-blue-700'
      : isLateTenants
        ? 'text-red-600 hover:bg-red-50 hover:text-red-900'
        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'

    return (
      <Link
        key={item.name}
        href={item.href}
        className={`${baseClass} ${activeClass}`}
        onClick={layout === 'mobile' ? () => setMobileMenuOpen(false) : undefined}
      >
        <item.icon
          className={`${layout === 'desktop' ? 'mr-2' : 'mr-3'} h-5 w-5 flex-shrink-0 ${
            isActive
              ? isLateTenants
                ? 'text-red-500'
                : 'text-blue-500'
              : isLateTenants
                ? 'text-red-400'
                : 'text-gray-400'
          }`}
        />
        {item.name}
      </Link>
    )
  }

  const desktopItems: React.ReactNode[] = []
  navItems.forEach((item) => {
    if (item.name === 'Payments') {
      desktopItems.push(
        <DealDocsNavItem key="deal-docs" layout="desktop" />
      )
    }
    desktopItems.push(renderNavLink(item, 'desktop'))
  })

  const mobileItems: React.ReactNode[] = []
  navItems.forEach((item) => {
    if (item.name === 'Payments') {
      mobileItems.push(
        <DealDocsNavItem
          key="deal-docs"
          layout="mobile"
          onNavigate={() => setMobileMenuOpen(false)}
        />
      )
    }
    mobileItems.push(renderNavLink(item, 'mobile'))
  })

  return (
    <>
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="h-8 w-8 bg-red-600 rounded flex items-center justify-center">
                  <span className="text-white font-bold text-sm">R</span>
                </div>
              </div>
              <span className="ml-2 text-lg font-semibold text-gray-900">Rental App</span>
            </div>

            <div className="hidden md:flex items-center space-x-4 lg:space-x-6">
              {desktopItems}
              <button
                type="button"
                onClick={async () => {
                  await fetch("/api/auth/logout", {
                    method: "POST",
                    credentials: "include",
                  })
                  window.location.href = "/login"
                }}
                className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-md"
              >
                Log out
              </button>
            </div>

            <div className="md:hidden flex items-center">
              <button
                type="button"
                className="text-gray-400 hover:text-gray-600"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? (
                  <XMarkIcon className="h-6 w-6" />
                ) : (
                  <Bars3Icon className="h-6 w-6" />
                )}
              </button>
            </div>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-200 bg-white">
            <div className="px-2 pt-2 pb-3 space-y-1">
              {mobileItems}
              <button
                type="button"
                onClick={async () => {
                  await fetch("/api/auth/logout", {
                    method: "POST",
                    credentials: "include",
                  })
                  window.location.href = "/login"
                }}
                className="w-full text-left px-3 py-2 text-base font-medium text-gray-600 hover:bg-gray-50 rounded-md"
              >
                Log out
              </button>
            </div>
          </div>
        )}
      </nav>
    </>
  )
}
