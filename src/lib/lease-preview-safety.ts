/**
 * Preview-only lease safety overrides (no live DB writes).
 * Applied to missing-invoice preview and data-health warnings only.
 */

export type PreviewCadenceOverride = {
  leaseId: string;
  forceCadence: "monthly";
  forceRent: number;
  reason: string;
  dataHealthWarning: string;
};

export type PreviewPaidThroughOverride = {
  leaseId: string;
  paidThroughDate: string; // inclusive YYYY-MM-DD — do not propose dues on or before
  reason: string;
};

/** Tyler / 177 Craton — stored weekly must be treated as monthly for preview. */
export const TYLER_LEASE_ID = "3469bb2e-d1a7-4c1f-ba89-eafe5d798acf";

export const PREVIEW_CADENCE_OVERRIDES: PreviewCadenceOverride[] = [
  {
    leaseId: TYLER_LEASE_ID,
    forceCadence: "monthly",
    forceRent: 1275,
    reason: "stored_cadence_incorrect_should_be_monthly",
    dataHealthWarning:
      "Stored rent_cadence is weekly but confirmed rent is $1,275 monthly. Preview uses monthly until the lease row is corrected.",
  },
];

/** Billy-confirmed paid-through — suppress rejected July obligations in preview. */
export const PREVIEW_PAID_THROUGH_OVERRIDES: PreviewPaidThroughOverride[] = [
  {
    leaseId: "36f68a06-3ffb-4f14-9808-4bd1dbea4163", // Ramon / Greenwood Camper
    paidThroughDate: "2026-07-31",
    reason: "Billy confirmed paid through July 2026",
  },
  {
    leaseId: "8992f727-ce25-4a59-be3f-ce971413ff93", // Lane
    paidThroughDate: "2026-07-31",
    reason: "Billy confirmed paid through July 2026",
  },
];

/** Rejected due dates that must never be proposed or created. */
export const REJECTED_PREVIEW_DUE_DATES: Record<string, string[]> = {
  [TYLER_LEASE_ID]: ["2026-07-17", "2026-07-24"],
  "36f68a06-3ffb-4f14-9808-4bd1dbea4163": ["2026-07-21"],
  "8992f727-ce25-4a59-be3f-ce971413ff93": ["2026-07-15"],
};

export function getPreviewCadenceOverride(leaseId: string) {
  return PREVIEW_CADENCE_OVERRIDES.find((o) => o.leaseId === leaseId) || null;
}

export function getPreviewPaidThrough(leaseId: string) {
  return PREVIEW_PAID_THROUGH_OVERRIDES.find((o) => o.leaseId === leaseId) || null;
}

export function isRejectedPreviewDueDate(leaseId: string, dueDate: string): boolean {
  const list = REJECTED_PREVIEW_DUE_DATES[leaseId] || [];
  const d = String(dueDate).split("T")[0];
  return list.includes(d);
}

export function applyPreviewSafetyToScheduleInput(args: {
  leaseId: string;
  rentCadence: string | null | undefined;
  rentAmount?: number | null;
}): { rentCadence: string; rentAmount?: number | null; overrideApplied: boolean; warning: string | null } {
  const o = getPreviewCadenceOverride(args.leaseId);
  if (!o) {
    return {
      rentCadence: args.rentCadence || "monthly",
      rentAmount: args.rentAmount,
      overrideApplied: false,
      warning: null,
    };
  }
  return {
    rentCadence: o.forceCadence,
    rentAmount: o.forceRent,
    overrideApplied: true,
    warning: o.dataHealthWarning,
  };
}
