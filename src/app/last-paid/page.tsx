import { redirect } from 'next/navigation'

/** Preserve bookmarks: Last Paid → Tenant Accounts (last-paid view). */
export default function LastPaidRedirectPage() {
  redirect('/tenant-accounts?view=last-paid')
}
