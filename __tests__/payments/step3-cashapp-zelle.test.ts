import {
  ContactDuplicateError,
  normalizeEmail,
  normalizePhone,
} from "@/lib/payments/contacts";
import {
  formatCashAppDestinationForDisplay,
  formatZelleDestinationForDisplay,
  getCashAppDestination,
  getZelleDestination,
  getPaymentSupportEmail,
  getPaymentSupportPhone,
  hasCashAppDestination,
  hasZelleDestination,
  isValidCashAppDestination,
  isValidZelleDestination,
} from "@/lib/payments/destinations";
import { getPaymentPublicFeatureFlags } from "@/lib/payments/feature-flags";
import {
  isPortalCheckoutBlocked,
  recordPortalCheckout,
} from "@/lib/payments/portal-rate-limit";
import fs from "fs";
import path from "path";

function readSrc(rel: string) {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("contact normalization and duplicates", () => {
  it("normalizes email and phone", () => {
    expect(normalizeEmail("  Lara.Test@Example.COM ")).toBe("lara.test@example.com");
    expect(normalizePhone("(864) 555-0188")).toBe("+18645550188");
    expect(normalizePhone("8645550188")).toBe("+18645550188");
  });

  it("exposes typed duplicate error without DB names", () => {
    const err = new ContactDuplicateError("email");
    expect(err.code).toBe("DUPLICATE_CONTACT");
    expect(err.message).toBe("DUPLICATE_CONTACT");
    expect(String(err)).not.toMatch(/idx_rent/i);
  });
});

describe("payment destinations", () => {
  it("reads TENANT_* names with EXISTING_* aliases", () => {
    const env = {
      TENANT_CASH_APP_DESTINATION: "$Honesthomesales",
      TENANT_ZELLE_DESTINATION: "8643223432",
      TENANT_PAYMENT_SUPPORT_PHONE: "8643223432",
      TENANT_PAYMENT_SUPPORT_EMAIL: "honesthomesales@gmail.com",
    } as NodeJS.ProcessEnv;
    expect(getCashAppDestination(env)).toBe("$Honesthomesales");
    expect(getZelleDestination(env)).toBe("864-322-3432");
    expect(getPaymentSupportPhone(env)).toBe("864-322-3432");
    expect(getPaymentSupportEmail(env)).toBe("honesthomesales@gmail.com");
  });

  it("falls back to EXISTING_* destination names", () => {
    const env = {
      EXISTING_CASH_APP_DESTINATION: "Honesthomesales",
      EXISTING_ZELLE_DESTINATION: "864-322-3432",
    } as NodeJS.ProcessEnv;
    expect(formatCashAppDestinationForDisplay("Honesthomesales")).toBe(
      "$Honesthomesales",
    );
    expect(getCashAppDestination(env)).toBe("$Honesthomesales");
    expect(getZelleDestination(env)).toBe("864-322-3432");
  });

  it("rejects invalid destinations", () => {
    expect(isValidCashAppDestination("")).toBe(false);
    expect(isValidZelleDestination("123")).toBe(false);
    expect(hasCashAppDestination({} as NodeJS.ProcessEnv)).toBe(false);
    expect(hasZelleDestination({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("keeps methods disabled without destinations even when flags true", () => {
    const env = {
      TENANT_EXISTING_CASH_APP_ENABLED: "true",
      TENANT_ZELLE_ENABLED: "true",
    } as NodeJS.ProcessEnv;
    const flags = getPaymentPublicFeatureFlags(env);
    expect(flags.existingCashAppEnabled).toBe(false);
    expect(flags.zelleEnabled).toBe(false);
  });

  it("enables methods when flag + destination present", () => {
    const env = {
      TENANT_EXISTING_CASH_APP_ENABLED: "true",
      TENANT_ZELLE_ENABLED: "true",
      TENANT_CASH_APP_DESTINATION: "$Honesthomesales",
      TENANT_ZELLE_DESTINATION: "8643223432",
    } as NodeJS.ProcessEnv;
    const flags = getPaymentPublicFeatureFlags(env);
    expect(flags.existingCashAppEnabled).toBe(true);
    expect(flags.zelleEnabled).toBe(true);
  });

  it("formats zelle phone for display", () => {
    expect(formatZelleDestinationForDisplay("8643223432")).toBe("864-322-3432");
  });
});

describe("checkout rate limit", () => {
  it("blocks after repeated checkout submissions", () => {
    const key = `checkout-test-${Date.now()}-${Math.random()}`;
    expect(isPortalCheckoutBlocked(key)).toBe(false);
    for (let i = 0; i < 10; i++) recordPortalCheckout(key);
    expect(isPortalCheckoutBlocked(key)).toBe(true);
  });
});

describe("navigation regressions", () => {
  it("uses normal inactive style for Tenant Accounts and compact Deals/Docs label", () => {
    const nav = readSrc("src/components/Navigation.tsx");
    expect(nav).toContain("Tenant Accounts");
    expect(nav).toContain("{ name: 'Deals/Docs'");
    expect(nav).not.toContain("{ name: 'Deals / Docs'");
    expect(nav).not.toMatch(/name: ['"]Deals['"]/);
    expect(nav).not.toMatch(/name: ['"]Docs['"]/);
    expect(nav).not.toContain("text-red-600 hover:bg-red-50");
    expect(nav).not.toContain("isTenantAccounts");
    expect(nav).not.toContain("overflow-x-auto");
  });

  it("keeps Deals / Docs page title and toggle", () => {
    const page = readSrc("src/app/deals-docs/page.tsx");
    expect(page).toContain("Deals / Docs");
    expect(page).toContain("Deals or Docs view");
  });
});

describe("portal contact duplicate API mapping", () => {
  it("maps duplicates to 409 with safe message", () => {
    const route = readSrc("src/app/api/portal/[token]/contacts/route.ts");
    expect(route).toContain("ContactDuplicateError");
    expect(route).toContain("status: 409");
    expect(route).toContain("That email address is already on this account.");
    expect(route).not.toMatch(/idx_rent_v3_contacts/);
  });
});
