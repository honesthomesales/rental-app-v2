/**
 * Cent-perfect dollar bridges for as-of reconciliation.
 * No historical credit, future payments, future obligations, or continuity fudge.
 */

export type DollarBridgeLine = {
  key: string;
  label: string;
  amount: number;
  sign: "+" | "-" | "=";
};

export type DollarBridge = {
  currentPaymentsBalance: number;
  missingObligationsDueByAsOf: number;
  recordedChargesOnlyInCandidate: number;
  eligiblePaymentsOnlyInCandidate: number;
  eligiblePaymentAllocationCorrections: number;
  invoiceStatusCorrectionsIncreasing: number;
  invoiceStatusCorrectionsDecreasing: number;
  otherExplainedAdjustments: number;
  candidateBalance: number;
  lines: DollarBridgeLine[];
  unexplainedAmount: number;
  reconcilesToCent: boolean;
  causeCodes: string[];
  notes: string[];
};

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Build a dollar bridge that always reconciles:
 * Payments
 * + missing obligations
 * + recorded charges only in candidate
 * - eligible payments only in candidate
 * - allocation corrections
 * + invoice increases
 * - invoice decreases
 * + other explained
 * = candidate
 *
 * Residual is forced into otherExplainedAdjustments only when a concrete
 * causeCode is supplied; otherwise unexplainedAmount is reported (must be 0
 * for decision-queue accounts).
 */
export function buildDollarBridge(args: {
  currentPaymentsBalance: number;
  candidateBalance: number;
  missingObligationsDueByAsOf?: number;
  recordedChargesOnlyInCandidate?: number;
  eligiblePaymentsOnlyInCandidate?: number;
  eligiblePaymentAllocationCorrections?: number;
  invoiceStatusCorrectionsIncreasing?: number;
  invoiceStatusCorrectionsDecreasing?: number;
  otherExplainedAdjustments?: number;
  otherExplanation?: string;
  causeCodes?: string[];
  notes?: string[];
  /** When true, residual is not allowed — throw if bridge doesn't reconcile. */
  requirePerfect?: boolean;
}): DollarBridge {
  const payments = round2(args.currentPaymentsBalance);
  const missing = round2(args.missingObligationsDueByAsOf || 0);
  const charges = round2(args.recordedChargesOnlyInCandidate || 0);
  const paysOnlyCand = round2(args.eligiblePaymentsOnlyInCandidate || 0);
  const allocCorr = round2(args.eligiblePaymentAllocationCorrections || 0);
  const invUp = round2(args.invoiceStatusCorrectionsIncreasing || 0);
  const invDown = round2(args.invoiceStatusCorrectionsDecreasing || 0);
  let other = round2(args.otherExplainedAdjustments || 0);
  const candidate = round2(args.candidateBalance);

  let computed = round2(
    payments +
      missing +
      charges -
      paysOnlyCand -
      allocCorr +
      invUp -
      invDown +
      other,
  );

  let unexplained = round2(candidate - computed);
  const notes = [...(args.notes || [])];
  const causeCodes = [...(args.causeCodes || [])];

  if (Math.abs(unexplained) > 0.009 && args.otherExplanation) {
    other = round2(other + unexplained);
    computed = round2(computed + unexplained);
    unexplained = 0;
    notes.push(args.otherExplanation);
    if (!causeCodes.includes("other")) causeCodes.push("other");
  }

  const reconcilesToCent = Math.abs(round2(computed - candidate)) < 0.01;

  if (args.requirePerfect && !reconcilesToCent) {
    throw new Error(
      `Dollar bridge does not reconcile: computed ${computed} vs candidate ${candidate}`,
    );
  }

  const lines: DollarBridgeLine[] = [
    {
      key: "currentPaymentsBalance",
      label: "Current Payments balance",
      amount: payments,
      sign: "=",
    },
    {
      key: "missingObligationsDueByAsOf",
      label: "Missing obligations due by as-of",
      amount: missing,
      sign: "+",
    },
    {
      key: "recordedChargesOnlyInCandidate",
      label: "Recorded charges included only by candidate",
      amount: charges,
      sign: "+",
    },
    {
      key: "eligiblePaymentsOnlyInCandidate",
      label: "Eligible payments through as-of included only by candidate",
      amount: paysOnlyCand,
      sign: "-",
    },
    {
      key: "eligiblePaymentAllocationCorrections",
      label: "Eligible payment allocation corrections",
      amount: allocCorr,
      sign: "-",
    },
    {
      key: "invoiceStatusCorrectionsIncreasing",
      label: "Invoice/status corrections increasing balance",
      amount: invUp,
      sign: "+",
    },
    {
      key: "invoiceStatusCorrectionsDecreasing",
      label: "Invoice/status corrections decreasing balance",
      amount: invDown,
      sign: "-",
    },
    {
      key: "otherExplainedAdjustments",
      label: "Other explained adjustments",
      amount: other,
      sign: "+",
    },
    {
      key: "candidateBalance",
      label: "Candidate balance",
      amount: candidate,
      sign: "=",
    },
  ];

  return {
    currentPaymentsBalance: payments,
    missingObligationsDueByAsOf: missing,
    recordedChargesOnlyInCandidate: charges,
    eligiblePaymentsOnlyInCandidate: paysOnlyCand,
    eligiblePaymentAllocationCorrections: allocCorr,
    invoiceStatusCorrectionsIncreasing: invUp,
    invoiceStatusCorrectionsDecreasing: invDown,
    otherExplainedAdjustments: other,
    candidateBalance: candidate,
    lines,
    unexplainedAmount: unexplained,
    reconcilesToCent,
    causeCodes,
    notes,
  };
}
