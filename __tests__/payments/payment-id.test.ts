import { parsePaymentUuid } from "@/lib/payments/payment-id";

describe("parsePaymentUuid", () => {
  it("accepts valid UUIDs", () => {
    const id = "a1b2c3d4-e5f6-4789-a012-3456789abcde";
    expect(parsePaymentUuid(id)).toBe(id);
  });

  it("rejects empty and invalid values", () => {
    expect(parsePaymentUuid("")).toBeNull();
    expect(parsePaymentUuid("not-a-uuid")).toBeNull();
    expect(parsePaymentUuid(null)).toBeNull();
    expect(parsePaymentUuid(123)).toBeNull();
  });
});
