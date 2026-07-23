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
  ExclamationTriangleIcon,
  ShieldCheckIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline'
import { useEffect, useState } from 'react'
import {
  performLogoutAndRedirect,
  useAuth,
} from '@/components/auth/AuthProvider'
import { logoutRedirectPath } from '@/lib/auth/session-state'

const navigation = [
  { name: 'Dashboard', href: '/', icon: HomeIcon },
  { name: 'Properties', href: '/properties', icon: BuildingOfficeIcon },
  { name: 'Tenants', href: '/tenants', icon: UsersIcon },
  { name: 'Leases', href: '/leases', icon: DocumentTextIcon },
  // Compact nav label prevents horizontal menu scroll; page title remains Deals slash Docs.
  { name: 'Deals/Docs', href: '/deals-docs?view=deals', icon: ShoppingBagIcon },
  { name: 'Payments', href: '/payments', icon: CurrencyDollarIcon },
  { name: 'Tenant Accounts', href: '/tenant-accounts?view=late', icon: ExclamationTriangleIcon },
  { name: 'Expenses', href: '/expenses', icon: ReceiptPercentIcon },
  { name: 'Profit', href: '/profit', icon: ChartBarIcon },
]

const incomingPaymentsNav = {
  name: 'Incoming Payments',
  href: '/incoming-payments',
  icon: CurrencyDollarIcon,
}

const ownerNavigationAlways = [
  { name: 'Data Health', href: '/data-health', icon: ShieldCheckIcon },
]

const ownerCommunicationsNav = {
  name: 'Communication Approvals',
  href: '/communication-approvals',
  icon: ChatBubbleLeftRightIcon,
}

export function Navigation() {
  const pathname = usePathname()
  const auth = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  const [communicationsEnabled, setCommunicationsEnabled] = useState(false)
  const [portalEnabled, setPortalEnabled] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    if (auth.status !== 'authenticated') {
      setIsOwner(false)
      setCommunicationsEnabled(false)
      setPortalEnabled(false)
      return
    }
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
        setPortalEnabled(Boolean(data.features?.portalEnabled))
      } catch {
        /* ignore */
      }
    })()
  }, [auth.status])

  const handleSignOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await performLogoutAndRedirect(auth.signOut)
    } finally {
      setSigningOut(false)
    }
  }

  const authStatusLabel =
    auth.status === 'authenticated' && auth.email
      ? `Signed in as ${auth.email}`
      : auth.status === 'session_error'
        ? 'Session expired'
        : auth.status === 'loading'
          ? 'Checking sign-in…'
          : 'Sign in required'

  const authAction =
    auth.status === 'authenticated' ? (
      <button
        type="button"
        disabled={signingOut}
        onClick={() => void handleSignOut()}
        className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-md shrink-0 disabled:opacity-60"
        data-testid="sign-out-button"
      >
        {signingOut ? 'Signing out…' : 'Sign Out'}
      </button>
    ) : (
      <a
        href={logoutRedirectPath()}
        className="px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 rounded-md shrink-0"
        data-testid="sign-in-link"
      >
        Sign In
      </a>
    )

  const ownerNavigation = [
    ...(communicationsEnabled ? [ownerCommunicationsNav] : []),
    ...ownerNavigationAlways,
  ]

  const baseNavigation = portalEnabled
    ? [
        ...navigation.slice(0, 6),
        incomingPaymentsNav,
        ...navigation.slice(6),
      ]
    : navigation

  const navItems = isOwner
    ? [...baseNavigation, ...ownerNavigation]
    : baseNavigation

  const renderNavLink = (
    item: (typeof navigation)[0],
    layout: 'desktop' | 'mobile'
  ) => {
    const itemPath = item.href.split('?')[0]
    const isActive =
      pathname === itemPath ||
      (itemPath === '/tenant-accounts' &&
        (pathname === '/tenant-accounts' ||
          pathname === '/late-tenants' ||
          pathname === '/last-paid')) ||
      (itemPath === '/deals-docs' &&
        (pathname === '/deals-docs' ||
          pathname === '/deals' ||
          pathname === '/documents' ||
          pathname === '/docs'))
    const baseClass =
      layout === 'desktop'
        ? 'flex items-center px-2 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap'
        : 'flex items-center px-3 py-2 text-base font-medium rounded-md'
    const activeClass = isActive
      ? 'bg-blue-100 text-blue-700'
      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'

    return (
      <Link
        key={item.name}
        href={item.href}
        className={`${baseClass} ${activeClass}`}
        onClick={layout === 'mobile' ? () => setMobileMenuOpen(false) : undefined}
      >
        <item.icon
          className={`${layout === 'desktop' ? 'mr-1.5' : 'mr-3'} h-5 w-5 flex-shrink-0 ${
            isActive ? 'text-blue-500' : 'text-gray-400'
          }`}
        />
        {item.name}
      </Link>
    )
  }

  const desktopItems = navItems.map((item) => renderNavLink(item, 'desktop'))
  const mobileItems = navItems.map((item) => renderNavLink(item, 'mobile'))

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

            <div className="hidden lg:flex items-center gap-1 xl:gap-2 min-w-0 flex-wrap justify-end max-w-[calc(100vw-11rem)]">
              {desktopItems}
              <span
                className="text-xs text-gray-500 shrink-0 max-w-[14rem] truncate"
                title={authStatusLabel}
                data-testid="auth-status-label"
              >
                {authStatusLabel}
              </span>
              {authAction}
            </div>

            <div className="lg:hidden flex items-center">
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
          <div className="lg:hidden border-t border-gray-200 bg-white">
            <div className="px-2 pt-2 pb-3 space-y-1">
              {mobileItems}
              <div className="px-3 py-2 text-sm text-gray-500" data-testid="auth-status-label-mobile">
                {authStatusLabel}
              </div>
              {auth.status === 'authenticated' ? (
                <button
                  type="button"
                  disabled={signingOut}
                  onClick={() => void handleSignOut()}
                  className="w-full text-left px-3 py-2 text-base font-medium text-gray-600 hover:bg-gray-50 rounded-md disabled:opacity-60"
                  data-testid="sign-out-button-mobile"
                >
                  {signingOut ? 'Signing out…' : 'Sign Out'}
                </button>
              ) : (
                <a
                  href={logoutRedirectPath()}
                  className="block px-3 py-2 text-base font-medium text-blue-700 hover:bg-blue-50 rounded-md"
                  data-testid="sign-in-link-mobile"
                >
                  Sign In
                </a>
              )}
            </div>
          </div>
        )}
      </nav>
    </>
  )
}
