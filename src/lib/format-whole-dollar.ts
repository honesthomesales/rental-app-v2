/** Display-only whole-dollar formatting for dashboard summary cards. */
export function formatWholeDollarDisplay(amount: number | null | undefined): string {
  const n = Math.round(Number(amount) || 0)
  const abs = Math.abs(n).toLocaleString('en-US')
  return n < 0 ? `-$${abs}` : `$${abs}`
}
