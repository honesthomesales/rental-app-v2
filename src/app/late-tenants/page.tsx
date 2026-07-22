import { redirect } from 'next/navigation'

/** Preserve bookmarks: Late Tenants → Tenant Accounts (late view). */
export default function LateTenantsRedirectPage() {
  redirect('/tenant-accounts?view=late')
}
