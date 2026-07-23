/**
 * Scored matching for Cash App / Zelle bank deposits.
 * Auto-post only when ALL high-confidence gates pass AND BANK_AUTO_POST_ENABLED.
 */

export type MatchEvidence = {
  exactReference: boolean;
  exactAmount: boolean;
  knownSender: boolean;
  competingTenants: number;
  isPending: boolean;
  removed: boolean;
  duplicateProviderId: boolean;
};

export type MatchScoreResult = {
  score: number;
  autoPostEligible: boolean;
  reasons: string[];
};

export function scoreDepositMatch(evidence: MatchEvidence): MatchScoreResult {
  const reasons: string[] = [];
  let score = 0;

  if (evidence.removed) {
    return { score: 0, autoPostEligible: false, reasons: ["removed_or_reversed"] };
  }
  if (evidence.isPending) {
    return { score: 0, autoPostEligible: false, reasons: ["pending_not_posted"] };
  }
  if (evidence.duplicateProviderId) {
    return { score: 0, autoPostEligible: false, reasons: ["duplicate_provider_id"] };
  }

  if (evidence.exactReference) {
    score += 50;
    reasons.push("exact_reference");
  }
  if (evidence.exactAmount) {
    score += 25;
    reasons.push("exact_amount");
  }
  if (evidence.knownSender) {
    score += 25;
    reasons.push("known_sender");
  }
  if (evidence.competingTenants > 0) {
    score = Math.min(score, 40);
    reasons.push("competing_matches");
  }

  const autoPostEligible =
    evidence.exactReference &&
    evidence.exactAmount &&
    (evidence.knownSender || evidence.exactReference) &&
    evidence.competingTenants === 0 &&
    !evidence.isPending &&
    !evidence.removed &&
    !evidence.duplicateProviderId &&
    score >= 75;

  return { score, autoPostEligible, reasons };
}

export function classifyDescription(description: string | null | undefined): string {
  const d = String(description || "").toLowerCase();
  if (d.includes("cash app") || d.includes("cashapp") || d.includes("sq *cash")) {
    return "potential_cash_app";
  }
  if (d.includes("zelle")) return "potential_zelle";
  if (d.includes("transfer") || d.includes("ach")) return "other_bank_transfer";
  return "unknown_deposit";
}

export function extractReferenceCode(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.toUpperCase().match(/\bHHS-\d{4}\b/);
  return m ? m[0] : null;
}
