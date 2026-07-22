import { formatWholeDollarDisplay } from '@/lib/format-whole-dollar'
import { smsHref, normalizeToE164, isUsablePhone } from '@/lib/communications/phone'

describe('approved enhancement helpers', () => {
  it('formats whole dollars without cents', () => {
    expect(formatWholeDollarDisplay(14525.4)).toBe('$14,525')
    expect(formatWholeDollarDisplay(8210.9)).toBe('$8,211')
    expect(formatWholeDollarDisplay(-1245.2)).toBe('-$1,245')
  })

  it('builds sms href with normalized number', () => {
    expect(normalizeToE164('(704) 555-1212')).toBe('+17045551212')
    expect(isUsablePhone('7045551212')).toBe(true)
    expect(smsHref('7045551212', 'Hello')).toContain('sms:+17045551212')
    expect(smsHref('7045551212', 'Hello')).toContain('body=Hello')
    expect(smsHref('bad')).toBeNull()
  })
})
