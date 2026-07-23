import { supabaseServer } from "@/lib/supabase-server";
import {
  calculateFeeCents,
  type FeePolicyInput,
} from "@/lib/payments/money";
import { isPaymentFeeEngineEnabled } from "@/lib/payments/feature-flags";

const METHOD_TO_POLICY: Record<string, string> = {
  ach: "ach",
  card: "card_generic",
  cash_app_pay: "cash_app_pay",
  existing_cash_app: "existing_cash_app",
  zelle: "zelle",
};

export async function resolveFeeForMethod(args: {
  method: string;
  rentCents: number;
  cardFunding?: "credit" | "debit" | "prepaid" | "unknown";
}): Promise<{
  feeCents: number;
  totalChargedCents: number;
  policyId: string | null;
  policyVersion: number | null;
  disclosureText: string | null;
}> {
  if (!isPaymentFeeEngineEnabled()) {
    return {
      feeCents: 0,
      totalChargedCents: args.rentCents,
      policyId: null,
      policyVersion: null,
      disclosureText: null,
    };
  }

  // Critical: do not surcharge debit/prepaid by default.
  if (
    args.method === "card" &&
    (args.cardFunding === "debit" ||
      args.cardFunding === "prepaid" ||
      args.cardFunding === "unknown")
  ) {
    const { data: debitPolicy } = await supabaseServer
      .from("RENT_v3_payment_fee_policies")
      .select("*")
      .eq("method", "card_debit")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!debitPolicy?.enabled) {
      return {
        feeCents: 0,
        totalChargedCents: args.rentCents,
        policyId: debitPolicy?.id || null,
        policyVersion: debitPolicy?.version || null,
        disclosureText:
          "No payment-service fee applies to debit or prepaid cards.",
      };
    }
  }

  const policyMethod =
    args.method === "card" && args.cardFunding === "credit"
      ? "card_credit"
      : METHOD_TO_POLICY[args.method] || "card_generic";

  const { data: policy } = await supabaseServer
    .from("RENT_v3_payment_fee_policies")
    .select("*")
    .eq("method", policyMethod)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!policy) {
    return {
      feeCents: 0,
      totalChargedCents: args.rentCents,
      policyId: null,
      policyVersion: null,
      disclosureText: null,
    };
  }

  const input: FeePolicyInput = {
    enabled: Boolean(policy.enabled),
    flatCents: Number(policy.flat_cents || 0),
    percentBps: Number(policy.percent_bps || 0),
    minimumCents: Number(policy.minimum_cents || 0),
    maximumCents:
      policy.maximum_cents == null ? null : Number(policy.maximum_cents),
    payer: policy.payer === "owner" ? "owner" : "tenant",
    grossUp: Boolean(policy.gross_up),
  };

  const calc = calculateFeeCents(args.rentCents, input);
  return {
    feeCents: calc.feeCents,
    totalChargedCents: calc.totalChargedCents,
    policyId: policy.id,
    policyVersion: policy.version,
    disclosureText: policy.disclosure_text,
  };
}
