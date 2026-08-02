/**
 * Read-only audit of Misc Income rows in RENT_expenses.
 * Does NOT insert, update, or delete anything.
 *
 * Usage (from worktree root, with env loaded):
 *   node --env-file=.env.local scripts/audit-misc-income-readonly.mjs
 */
import { createClient } from '@supabase/supabase-js'

const MISC_INCOME_RATE = 9.9999
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error(
    'Missing Supabase env (NEXT_PUBLIC_SUPABASE_URL + service/anon key). Audit aborted (read-only).',
  )
  process.exit(1)
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { data, error } = await supabase
  .from('RENT_expenses')
  .select(
    'id, property_id, category, amount, amount_owed, interest_rate, last_paid_date, expense_date, mail_info, memo',
  )
  .eq('interest_rate', MISC_INCOME_RATE)
  .order('last_paid_date', { ascending: false })

if (error) {
  console.error('Audit query failed:', error.message)
  process.exit(1)
}

const rows = data || []
const total = rows.reduce(
  (sum, r) => sum + (Number(r.amount_owed) || Number(r.amount) || 0),
  0,
)
const withProperty = rows.filter((r) => r.property_id).length
const unassigned = rows.length - withProperty
const byMonth = new Map()
for (const r of rows) {
  const d = String(r.last_paid_date || r.expense_date || '').slice(0, 7) || 'unknown'
  byMonth.set(d, (byMonth.get(d) || 0) + (Number(r.amount_owed) || Number(r.amount) || 0))
}

console.log('=== Misc Income audit (READ-ONLY) ===')
console.log(`Rows: ${rows.length}`)
const totalRounded = Math.round(total * 100) / 100
console.log(`Total amount_owed: $${totalRounded.toFixed(2)}`)
console.log(`With property_id: ${withProperty}`)
console.log(`Unassigned / portfolio: ${unassigned}`)
console.log('By month (last_paid_date/expense_date):')
for (const [month, amt] of [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
  console.log(`  ${month}: $${(Math.round(amt * 100) / 100).toFixed(2)}`)
}
console.log('Sample (up to 15 newest):')
for (const r of rows.slice(0, 15)) {
  console.log(
    `  ${r.id} | $${Number(r.amount_owed) || Number(r.amount) || 0} | ${r.last_paid_date || r.expense_date || 'n/a'} | prop=${r.property_id || 'NONE'} | ${r.mail_info || r.memo || ''}`,
  )
}
console.log('=== end audit (no writes performed) ===')
