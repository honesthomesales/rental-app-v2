import {
  calculateFeeCents,
  dollarsToCents,
  formatCents,
} from "@/lib/payments/money";
import { scoreDepositMatch, extractReferenceCode } from "@/lib/payments/bank-matching";
import { canTransition } from "@/lib/payments/types";
import {
  getPaymentPublicFeatureFlags,
  isTenantPaymentPortalEnabled,
} from "@/lib/payments/feature-flags";
import { derivePaymentReference, hashPortalToken } from "@/lib/payments/tokens";

describe("payment money helpers", () => {
  it("uses integer cents without float drift", () => {
    expect(dollarsToCents(10.1)).toBe(1010);
    expect(formatCents(1010)).toBe("$10.10");
  });

  it("calculates flat + percent fee", () => {
    const result = calculateFeeCents(10000, {
      enabled: true,
      flatCents: 30,
      percentBps: 290,
      minimumCents: 0,
      maximumCents: null,
      payer: "tenant",
      grossUp: false,
    });
    expect(result.feeCents).toBe(30 + 290);
    expect(result.totalChargedCents).toBe(10000 + 320);
  });

  it("keeps fee at zero when disabled or owner-paid", () => {
    expect(
      calculateFeeCents(5000, {
        enabled: false,
        flatCents: 100,
        percentBps: 300,
        minimumCents: 0,
        maximumCents: null,
        payer: "tenant",
        grossUp: false,
      }).feeCents,
    ).toBe(0);
    expect(
      calculateFeeCents(5000, {
        enabled: true,
        flatCents: 100,
        percentBps: 300,
        minimumCents: 0,
        maximumCents: null,
        payer: "owner",
        grossUp: false,
      }).feeCents,
    ).toBe(0);
  });
});

describe("bank matching", () => {
  it("requires high confidence for auto-post eligibility", () => {
    const low = scoreDepositMatch({
      exactReference: false,
      exactAmount: true,
      knownSender: false,
      competingTenants: 0,
      isPending: false,
      removed: false,
      duplicateProviderId: false,
    });
    expect(low.autoPostEligible).toBe(false);

    const high = scoreDepositMatch({
      exactReference: true,
      exactAmount: true,
      knownSender: true,
      competingTenants: 0,
      isPending: false,
      removed: false,
      duplicateProviderId: false,
    });
    expect(high.autoPostEligible).toBe(true);
  });

  it("rejects pending or duplicate deposits", () => {
    expect(
      scoreDepositMatch({
        exactReference: true,
        exactAmount: true,
        knownSender: true,
        competingTenants: 0,
        isPending: true,
        removed: false,
        duplicateProviderId: false,
      }).autoPostEligible,
    ).toBe(false);
  });

  it("extracts HHS references", () => {
    expect(extractReferenceCode("rent HHS-1047 thanks")).toBe("HHS-1047");
    expect(extractReferenceCode("no ref")).toBeNull();
  });
});

describe("attempt transitions", () => {
  it("allows pending to settled for ACH", () => {
    expect(canTransition("pending", "settled")).toBe(true);
    expect(canTransition("settled", "pending")).toBe(false);
  });
});

describe("feature flags default off", () => {
  it("defaults portal disabled", () => {
    const emptyEnv = {} as NodeJS.ProcessEnv;
    expect(isTenantPaymentPortalEnabled(emptyEnv)).toBe(false);
    const flags = getPaymentPublicFeatureFlags(emptyEnv);
    expect(flags.portalEnabled).toBe(false);
    expect(flags.bankAutoPostEnabled).toBe(false);
    expect(flags.achEnabled).toBe(false);
  });
});

describe("tokens", () => {
  it("hashes portal tokens stably", () => {
    expect(hashPortalToken("abc")).toBe(hashPortalToken("abc"));
    expect(hashPortalToken("abc")).not.toBe(hashPortalToken("abd"));
  });

  it("derives HHS references", () => {
    expect(derivePaymentReference("11111111-1111-1111-1111-111111111111")).toMatch(
      /^HHS-\d{4}$/,
    );
  });
});
