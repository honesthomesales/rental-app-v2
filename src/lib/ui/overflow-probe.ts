/**
 * Detect page-level horizontal overflow and the widest offending element.
 * Used by E2E and unit tests so table regressions name the culprit.
 */
export type OverflowProbeResult = {
  pageOverflowPx: number
  scrollWidth: number
  clientWidth: number
  widest: {
    tag: string
    width: number
    className: string
    testId: string | null
  } | null
  containedScrollers: string[]
}

export function probeHorizontalOverflow(
  doc: Document = document,
): OverflowProbeResult {
  const root = doc.documentElement
  const body = doc.body
  const scrollWidth = Math.max(root.scrollWidth, body.scrollWidth)
  const clientWidth = root.clientWidth
  let widest: OverflowProbeResult['widest'] = null

  doc.querySelectorAll('body *').forEach((el) => {
    const r = (el as HTMLElement).getBoundingClientRect?.()
    if (!r) return
    if (!widest || r.width > widest.width) {
      widest = {
        tag: el.tagName.toLowerCase(),
        width: Math.round(r.width),
        className: String((el as HTMLElement).className || '').slice(0, 120),
        testId: el.getAttribute('data-testid'),
      }
    }
  })

  const containedScrollers: string[] = []
  doc
    .querySelectorAll(
      '[data-testid="last-paid-table-scroller"],[data-testid="profit-totals-table-scroller"]',
    )
    .forEach((el) => {
      const id = el.getAttribute('data-testid')
      if (id) containedScrollers.push(id)
    })

  return {
    pageOverflowPx: scrollWidth - clientWidth,
    scrollWidth,
    clientWidth,
    widest,
    containedScrollers,
  }
}

export function assertNoPageOverflow(
  result: OverflowProbeResult,
  maxPx = 1,
): void {
  if (result.pageOverflowPx > maxPx) {
    throw new Error(
      `Page horizontal overflow ${result.pageOverflowPx}px; widest=${JSON.stringify(result.widest)}`,
    )
  }
}
