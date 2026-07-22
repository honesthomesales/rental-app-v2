import {
  assertNoPageOverflow,
  probeHorizontalOverflow,
  type OverflowProbeResult,
} from '@/lib/ui/overflow-probe'

describe('table overflow probe', () => {
  it('reports zero overflow for a fitting document', () => {
    const doc = {
      documentElement: { scrollWidth: 390, clientWidth: 390 },
      body: { scrollWidth: 390 },
      querySelectorAll: (sel: string) => {
        if (sel === 'body *') return [] as unknown as NodeListOf<Element>
        if (sel.includes('last-paid-table-scroller')) {
          const el = {
            getAttribute: () => 'last-paid-table-scroller',
          }
          return [el] as unknown as NodeListOf<Element>
        }
        return [] as unknown as NodeListOf<Element>
      },
    } as unknown as Document

    const result = probeHorizontalOverflow(doc)
    expect(result.pageOverflowPx).toBe(0)
    expect(result.containedScrollers).toContain('last-paid-table-scroller')
    expect(() => assertNoPageOverflow(result)).not.toThrow()
  })

  it('names overflow when page scrolls horizontally', () => {
    const result: OverflowProbeResult = {
      pageOverflowPx: 40,
      scrollWidth: 430,
      clientWidth: 390,
      widest: {
        tag: 'table',
        width: 960,
        className: 'min-w-[960px]',
        testId: null,
      },
      containedScrollers: [],
    }
    expect(() => assertNoPageOverflow(result)).toThrow(/Page horizontal overflow 40px/)
  })
})

describe('deals-docs view parsing', () => {
  function parseView(raw: string | null): 'deals' | 'docs' {
    if (raw === 'docs' || raw === 'documents' || raw === 'document') return 'docs'
    return 'deals'
  }

  it('defaults to deals', () => {
    expect(parseView(null)).toBe('deals')
    expect(parseView('deals')).toBe('deals')
  })

  it('accepts docs aliases', () => {
    expect(parseView('docs')).toBe('docs')
    expect(parseView('documents')).toBe('docs')
  })
})
